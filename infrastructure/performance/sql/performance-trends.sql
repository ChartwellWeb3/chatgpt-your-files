-- Run this entire script in the WEBSITE PERFORMANCE project's SQL Editor.
-- Requires the existing performance_deployments, performance_runs, and
-- performance_page_results tables. It does not alter stored measurements.
begin;

create or replace function public.performance_measurement_key(p_summary jsonb, p_fingerprint text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_summary->'measurement'->'settings') = 'object'
      and jsonb_typeof(p_summary->'measurement'->'numberOfRuns') = 'number'
      and nullif(p_summary->>'profile', '') is not null
      and nullif(p_summary->'authentication'->>'mode', '') is not null
      and nullif(p_summary->'toolchain'->>'lighthouse', '') is not null
      and nullif(p_summary->'toolchain'->>'chromium', '') is not null
      and nullif(p_summary->'toolchain'->>'node', '') is not null
    then 'settings-v1:' || md5(jsonb_build_object(
      'schemaVersion', p_summary->'schemaVersion',
      'mode', p_summary->'mode',
      'profile', p_summary->'profile',
      'deviceProfile', p_summary->'deviceProfile',
      'measurement', p_summary->'measurement',
      'authentication', p_summary->'authentication',
      -- Keep browser/Lighthouse/toolchain versions and the Node major version.
      -- Node minor/patch updates alone do not change the measurement settings.
      'toolchain', (p_summary->'toolchain') || jsonb_build_object(
        'node', regexp_replace(p_summary->'toolchain'->>'node', '^v?([0-9]+)\.[0-9]+\.[0-9]+$', '\1')
      )
    )::text)
    else 'fingerprint:' || nullif(btrim(p_fingerprint), '')
  end;
$$;

create or replace function public.performance_page_score(p_score numeric, p_result jsonb)
returns numeric
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when p_score is not null then case when p_score between 0 and 100 then p_score end
    when jsonb_typeof(p_result->'aggregate'->'metrics'->'score') = 'number' then
      case when (p_result->'aggregate'->'metrics'->>'score')::numeric between 0 and 100
        then (p_result->'aggregate'->'metrics'->>'score')::numeric end
  end;
$$;

create or replace function public.performance_trend_points(
  p_environment text,
  p_deployment_ids uuid[],
  p_device text,
  p_reference_run_id uuid,
  p_selected_run_id uuid default null,
  p_page_id text default null
)
returns table (
  "deploymentId" uuid, "runId" uuid, date timestamptz, build text,
  value numeric, reason text, "includedPages" bigint, "totalPages" bigint
)
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  reference_key text;
begin
  if p_environment not in ('qa', 'prod') or p_environment is null
    or p_device not in ('mobile', 'desktop') or p_device is null
    or p_deployment_ids is null or cardinality(p_deployment_ids) > 100 then
    raise exception 'Invalid trend environment, device, or deployment list' using errcode = '22023';
  end if;

  select public.performance_measurement_key(r.summary, r.profile_fingerprint)
    into reference_key
    from public.performance_runs r
    join public.performance_deployments d on d.id = r.deployment_id
    where r.id = p_reference_run_id and r.device = p_device and d.environment = p_environment;
  if not found then
    raise exception 'Reference measurement not found in this environment and device' using errcode = '22023';
  end if;

  if p_selected_run_id is not null and not exists (
    select 1 from public.performance_runs r
    join public.performance_deployments d on d.id = r.deployment_id
    where r.id = p_selected_run_id and r.device = p_device
      and d.environment = p_environment and d.id = any(p_deployment_ids)
  ) then
    raise exception 'Selected measurement not found in this environment and device' using errcode = '22023';
  end if;
  if p_page_id is not null and not exists (
    select 1 from public.performance_page_results p
    where p.run_id = p_selected_run_id and p.page_id = p_page_id
  ) then
    raise exception 'Selected page measurement not found' using errcode = '22023';
  end if;

  return query
  with selected_run as (
    select r.deployment_id from public.performance_runs r where r.id = p_selected_run_id
  ), target as (
    select p.* from public.performance_page_results p
    where p.run_id = p_selected_run_id and p.page_id = p_page_id
  ), attempts as (
    select d.id as deployment_id, coalesce(d.source_finished_at, d.created_at) as deployment_date,
      coalesce(d.source_build_number, left(d.commit_sha, 8), left(d.id::text, 8)) as build_number,
      r.id as run_id, r.status as run_status, r.upload_status,
      public.performance_measurement_key(r.summary, r.profile_fingerprint) as measurement_key
    from public.performance_deployments d
    left join lateral (
      select candidate.* from public.performance_runs candidate
      where candidate.deployment_id = d.id and candidate.device = p_device
        and (not exists (select 1 from selected_run s where s.deployment_id = d.id)
          or candidate.id = p_selected_run_id)
      order by candidate.created_at desc, candidate.id desc
      limit 1
    ) r on true
    where d.environment = p_environment and d.id = any(p_deployment_ids)
  ), measured as (
    select a.*, counts.total_pages, counts.included_pages, counts.score,
      counts.inconsistent_pages, counts.unknown_consistency_pages
    from attempts a
    left join lateral (
      select count(*) as total_pages,
        count(*) filter (where p.status = 'complete' and p.consistent and p.score is not null) as included_pages,
        avg(p.score) filter (where p.status = 'complete' and p.consistent) as score,
        count(*) filter (where p.status = 'complete' and p.consistent = false) as inconsistent_pages,
        count(*) filter (where p.status = 'complete' and p.consistent is null) as unknown_consistency_pages
      from (
        select page.status, public.performance_page_score(page.performance_score, page.result) as score,
          not coalesce(page.noisy, case
            when jsonb_typeof(page.result->'aggregate'->'noisy') = 'boolean'
            then (page.result->'aggregate'->>'noisy')::boolean end) as consistent
        from public.performance_page_results page
        where page.run_id = a.run_id and (
          p_page_id is null or exists (
            select 1 from target t where page.page_id = t.page_id and page.page_path = t.page_path
              and coalesce(page.locale, '') = coalesce(t.locale, '')
              and coalesce(page.result->'identity'->>'site', '') = coalesce(t.result->'identity'->>'site', '')
              and coalesce(page.result->'identity'->>'itemId', '') = coalesce(t.result->'identity'->>'itemId', '')
          )
        )
      ) p
    ) counts on true
  ), evaluated as (
    select m.*, case
      when m.run_id is null then 'No measurement'
      when reference_key is null or m.measurement_key is distinct from reference_key
        then 'Different or unknown measurement settings'
      when m.run_status <> 'complete' or m.upload_status <> 'ready' then 'Audit or ingestion incomplete'
      when m.total_pages = 0 then case when p_page_id is null
        then 'Page measurements unavailable' else 'Page identity not measured in this attempt' end
      when m.included_pages = 0 then case
        when p_page_id is null then 'No complete, consistent page scores'
        when m.inconsistent_pages > 0 then 'Inconsistent samples'
        when m.unknown_consistency_pages > 0 then 'Sample consistency not reported'
        else 'Page incomplete or score missing' end
    end as gap_reason from measured m
  )
  select e.deployment_id, e.run_id, e.deployment_date, e.build_number,
    case when e.gap_reason is null then e.score end, e.gap_reason,
    e.included_pages, e.total_pages
  from evaluated e
  order by e.deployment_date, e.deployment_id;
end;
$$;

create or replace function public.performance_overall_trend(
  p_environment text, p_deployment_ids uuid[], p_device text,
  p_reference_run_id uuid, p_selected_run_id uuid default null
)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.date, t."deploymentId"), '[]'::jsonb)
  from public.performance_trend_points(p_environment, p_deployment_ids, p_device,
    p_reference_run_id, p_selected_run_id, null) t;
$$;

create or replace function public.performance_page_trend(
  p_environment text, p_deployment_ids uuid[], p_device text,
  p_reference_run_id uuid, p_selected_run_id uuid, p_page_id text
)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
begin
  if p_page_id is null or btrim(p_page_id) = '' or p_selected_run_id is null then
    raise exception 'A selected measurement and page ID are required' using errcode = '22023';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(t) order by t.date, t."deploymentId"), '[]'::jsonb)
    from public.performance_trend_points(p_environment, p_deployment_ids, p_device,
      p_reference_run_id, p_selected_run_id, p_page_id) t);
end;
$$;

-- Calls go through the application API, after login in the chatbot project.
revoke all on function public.performance_measurement_key(jsonb, text) from public, anon, authenticated;
revoke all on function public.performance_page_score(numeric, jsonb) from public, anon, authenticated;
revoke all on function public.performance_trend_points(text, uuid[], text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.performance_overall_trend(text, uuid[], text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.performance_page_trend(text, uuid[], text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.performance_measurement_key(jsonb, text) to service_role;
grant execute on function public.performance_page_score(numeric, jsonb) to service_role;
grant execute on function public.performance_trend_points(text, uuid[], text, uuid, uuid, text) to service_role;
grant execute on function public.performance_overall_trend(text, uuid[], text, uuid, uuid) to service_role;
grant execute on function public.performance_page_trend(text, uuid[], text, uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
