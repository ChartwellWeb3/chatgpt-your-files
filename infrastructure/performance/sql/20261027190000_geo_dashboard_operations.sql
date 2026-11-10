-- GEO update 1. Run AFTER geo-monitoring.sql in the PERFORMANCE SQL Editor.
-- The original installation file is immutable. This update adds dashboard
-- queries, idempotent manual runs, atomic evidence writes, and an AI job ledger.
-- It does not enable scheduling or change any website-performance objects.
begin;

create table if not exists public.geo_ai_jobs (
  id uuid primary key,
  environment text not null check (environment in ('qa','prod')),
  kind text not null check (kind in ('discovery','opportunities')),
  model text not null,
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  created_by uuid not null,
  input jsonb not null,
  result jsonb,
  raw_response jsonb,
  usage jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.geo_ai_jobs enable row level security;
revoke all on public.geo_ai_jobs from public, anon, authenticated, service_role;
grant select, insert, update on public.geo_ai_jobs to service_role;
create index if not exists geo_ai_jobs_environment on public.geo_ai_jobs(environment,created_at desc);

create or replace function public.geo_begin_manual_run(
  p_environment text, p_benchmark_id uuid, p_question_id uuid, p_request_key uuid, p_actor uuid
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare r public.geo_runs; attempt uuid := gen_random_uuid(); token uuid := gen_random_uuid();
begin
  -- Serialize new requests for this benchmark, and make double-click/retry safe.
  perform 1 from public.geo_benchmarks where id=p_benchmark_id and environment=p_environment for update;
  if not found then raise exception 'Unknown benchmark.' using errcode='22023'; end if;
  select * into r from public.geo_runs where environment=p_environment and idempotency_key=p_request_key::text;
  if found then
    if r.question_id <> p_question_id or r.benchmark_id <> p_benchmark_id then
      raise exception 'Request key belongs to another run.' using errcode='22023';
    end if;
    return jsonb_build_object('created',false,'runId',r.id,'status',r.status);
  end if;
  if (select count(*) from public.geo_runs where environment=p_environment and benchmark_id=p_benchmark_id
    and status='running' and lease_expires_at > now()) >= 2 then
    raise exception 'Two monitoring runs are already in progress.' using errcode='22023';
  end if;
  if not exists(select 1 from public.geo_questions where id=p_question_id and environment=p_environment and status='active') then
    raise exception 'Approve this question before collecting an answer.' using errcode='22023';
  end if;
  insert into public.geo_runs(environment,benchmark_id,question_id,source,scheduled_for,idempotency_key,created_by)
    values(p_environment,p_benchmark_id,p_question_id,'manual',now(),p_request_key::text,p_actor) returning * into r;
  update public.geo_runs set status='running',lease_token=token,lease_expires_at=now()+interval '8 minutes' where id=r.id;
  insert into public.geo_run_attempts(id,run_id,attempt_number) values(attempt,r.id,1);
  return jsonb_build_object('created',true,'runId',r.id,'attemptId',attempt,'leaseToken',token,'snapshot',r.question_snapshot);
end $$;

create or replace function public.geo_finish_manual_run(
  p_environment text, p_run_id uuid, p_attempt_id uuid, p_lease_token uuid,
  p_extraction jsonb, p_mentions jsonb, p_sources jsonb, p_usage jsonb
) returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
declare r public.geo_runs; a public.geo_run_attempts; item jsonb; brand uuid;
begin
  select * into r from public.geo_runs where id=p_run_id and environment=p_environment for update;
  if r.id is null then raise exception 'Unknown run.' using errcode='22023'; end if;
  if r.status='succeeded' and r.selected_attempt_id=p_attempt_id then return; end if;
  if r.status <> 'running' or r.lease_token is distinct from p_lease_token or r.lease_expires_at <= now() then
    raise exception 'This monitoring lease has expired.' using errcode='22023';
  end if;
  select * into a from public.geo_run_attempts where id=p_attempt_id and run_id=r.id;
  if a.id is null or a.raw_response is null or a.response_text is null then
    raise exception 'Save the provider response first.' using errcode='22023';
  end if;
  if jsonb_typeof(p_mentions) is distinct from 'array' or jsonb_array_length(p_mentions)>50
    or jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources)>500
    or jsonb_typeof(p_extraction) is distinct from 'object' then
    raise exception 'Invalid evidence.' using errcode='22023';
  end if;
  for item in select * from jsonb_array_elements(p_mentions) loop
    if length(btrim(coalesce(item->>'evidence_quote','')))=0 or strpos(a.response_text,item->>'evidence_quote')=0 then
      raise exception 'Brand evidence must be present in the saved answer.' using errcode='22023';
    end if;
    if item->>'brand_id' is not null then
      select id into brand from public.geo_brands where id=(item->>'brand_id')::uuid;
      if brand is null then raise exception 'Unknown brand.' using errcode='22023'; end if;
    else
      if coalesce(item->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Invalid brand name.' using errcode='22023'; end if;
      insert into public.geo_brands(slug,name,aliases) values(item->>'slug',item->>'name',array[item->>'observed_name'])
        on conflict(slug) do nothing;
      select id into brand from public.geo_brands where slug=item->>'slug';
    end if;
    insert into public.geo_mentions(attempt_id,brand_id,observed_name,is_recommendation,position,evidence_quote)
      values(a.id,brand,item->>'observed_name',(item->>'is_recommendation')::boolean,(item->>'position')::integer,item->>'evidence_quote')
      on conflict(attempt_id,brand_id) do update set
        evidence_quote=case when geo_mentions.position is null or excluded.position < geo_mentions.position
          then excluded.evidence_quote else geo_mentions.evidence_quote end,
        observed_name=case when geo_mentions.position is null or excluded.position < geo_mentions.position
          then excluded.observed_name else geo_mentions.observed_name end,
        position=case when geo_mentions.position is null then excluded.position
          when excluded.position is null then geo_mentions.position else least(geo_mentions.position,excluded.position) end,
        is_recommendation=geo_mentions.is_recommendation or excluded.is_recommendation;
  end loop;
  for item in select * from jsonb_array_elements(p_sources) loop
    insert into public.geo_sources(attempt_id,source_kind,source_index,url,normalized_url,domain,title,
      owner_brand_id,source_type,annotation,citation_start,citation_end)
      values(a.id,item->>'source_kind',(item->>'source_index')::integer,item->>'url',item->>'normalized_url',
        item->>'domain',item->>'title',(item->>'owner_brand_id')::uuid,item->>'source_type',item->'annotation',
        (item->>'citation_start')::integer,(item->>'citation_end')::integer)
      on conflict(attempt_id,source_kind,source_index) do nothing;
  end loop;
  update public.geo_run_attempts set status='succeeded',extraction=p_extraction,usage=p_usage,
    finished_at=now(),error_stage=null,error_message=null where id=a.id;
  update public.geo_runs set status='succeeded',selected_attempt_id=a.id,finished_at=now(),
    lease_token=null,lease_expires_at=null where id=r.id;
end $$;

create or replace function public.geo_dashboard_summary(
  p_environment text, p_benchmark_id uuid, p_start timestamptz, p_end timestamptz,
  p_topic_id uuid default null, p_market_id uuid default null, p_language text default null,
  p_question_kind text default 'unbranded', p_include_manual boolean default false
) returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare result jsonb;
begin
  if not exists(select 1 from public.geo_benchmarks where id=p_benchmark_id and environment=p_environment)
    or p_start is null or p_end is null or p_end <= p_start then
    raise exception 'Invalid dashboard filters.' using errcode='22023';
  end if;
  with matching as (
    select r.* from public.geo_runs r where r.environment=p_environment and r.benchmark_id=p_benchmark_id
      and r.scheduled_for >= p_start and r.scheduled_for < p_end
      and (p_include_manual or r.source='scheduled')
      and (p_topic_id is null or r.question_snapshot->>'topicId'=p_topic_id::text)
      and (p_market_id is null or r.question_snapshot->>'marketId'=p_market_id::text)
      and (p_language is null or r.question_snapshot->>'language'=p_language)
      and (p_question_kind is null or r.question_snapshot->>'questionKind'=p_question_kind)
  ), valid as (
    select r.* from matching r join public.geo_run_attempts a on a.id=r.selected_attempt_id and a.run_id=r.id
      where r.status='succeeded' and a.status='succeeded'
  ), domains as (
    select s.domain,count(distinct r.id) filter(where s.source_kind='cited') as cited_answers,
      count(distinct r.id) filter(where s.source_kind='consulted') as consulted_answers,
      count(distinct s.normalized_url) as urls,min(s.url) as example_url,max(s.title) as title
    from valid r join public.geo_sources s on s.attempt_id=r.selected_attempt_id
    group by s.domain order by cited_answers desc,consulted_answers desc,s.domain limit 100
  ) select jsonb_build_object('sources',coalesce((select jsonb_agg(to_jsonb(d)) from domains d),'[]'::jsonb),
    'counts',jsonb_build_object('succeeded',(select count(*) from valid),
      'failed',(select count(*) from matching where status in ('failed','cancelled') or (status='running' and lease_expires_at <= now())),
      'pending',(select count(*) from matching where status='queued' or (status='running' and (lease_expires_at is null or lease_expires_at > now()))))) into result;
  return result;
end $$;

-- Opportunities can only cite successful evidence from the same environment
-- and benchmark. No original-project Auth dependencies are introduced.
create or replace function public.geo_check_insight_evidence() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.geo_insights i join public.geo_runs r on r.id=new.run_id
    where i.id=new.insight_id and i.environment=r.environment and i.benchmark_id=r.benchmark_id and r.status='succeeded') then
    raise exception 'Opportunity evidence must belong to the same benchmark and environment.' using errcode='22023';
  end if;
  return new;
end $$;
create or replace trigger geo_insight_evidence_scope before insert or update on public.geo_insight_evidence
  for each row execute function public.geo_check_insight_evidence();

create or replace function public.geo_save_opportunities(
  p_job_id uuid,p_environment text,p_benchmark_id uuid,p_start timestamptz,p_end timestamptz,
  p_filters jsonb,p_opportunities jsonb
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare job public.geo_ai_jobs; item jsonb; evidence jsonb; insight uuid; ids uuid[] := '{}';
begin
  select * into job from public.geo_ai_jobs where id=p_job_id and environment=p_environment for update;
  if job.id is null or job.kind <> 'opportunities' then raise exception 'Unknown opportunity request.' using errcode='22023'; end if;
  if job.status='succeeded' then return job.result; end if;
  if job.status <> 'running' or job.raw_response is null then raise exception 'Save the AI analysis first.' using errcode='22023'; end if;
  if not exists(select 1 from public.geo_benchmarks where id=p_benchmark_id and environment=p_environment)
    or jsonb_typeof(p_opportunities) is distinct from 'array' or jsonb_array_length(p_opportunities) not between 1 and 3 then
    raise exception 'Invalid opportunities.' using errcode='22023';
  end if;
  for item in select * from jsonb_array_elements(p_opportunities) loop
    if jsonb_typeof(item->'run_ids') is distinct from 'array' or jsonb_array_length(item->'run_ids') not between 1 and 10 then
      raise exception 'Supporting evidence is required.' using errcode='22023';
    end if;
    insert into public.geo_insights(environment,benchmark_id,period_start,period_end,filters,title,opportunity,model,raw_response,usage)
      values(p_environment,p_benchmark_id,p_start,p_end,p_filters,item->>'title',item->>'opportunity',job.model,job.raw_response,job.usage)
      returning id into insight;
    for evidence in select * from jsonb_array_elements(item->'run_ids') loop
      insert into public.geo_insight_evidence(insight_id,run_id) values(insight,(evidence#>>'{}')::uuid) on conflict do nothing;
    end loop;
    ids := array_append(ids,insight);
  end loop;
  update public.geo_ai_jobs set status='succeeded',result=jsonb_build_object('created',cardinality(ids),'insightIds',ids),finished_at=now() where id=job.id;
  return jsonb_build_object('created',cardinality(ids),'insightIds',ids);
end $$;

revoke all on function public.geo_begin_manual_run(text,uuid,uuid,uuid,uuid),
  public.geo_finish_manual_run(text,uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb),
  public.geo_dashboard_summary(text,uuid,timestamptz,timestamptz,uuid,uuid,text,text,boolean),
  public.geo_save_opportunities(uuid,text,uuid,timestamptz,timestamptz,jsonb,jsonb),
  public.geo_check_insight_evidence() from public,anon,authenticated;
grant execute on function public.geo_begin_manual_run(text,uuid,uuid,uuid,uuid),
  public.geo_finish_manual_run(text,uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb),
  public.geo_dashboard_summary(text,uuid,timestamptz,timestamptz,uuid,uuid,text,text,boolean),
  public.geo_save_opportunities(uuid,text,uuid,timestamptz,timestamptz,jsonb,jsonb),
  public.geo_check_insight_evidence() to service_role;
notify pgrst,'reload schema';
commit;
