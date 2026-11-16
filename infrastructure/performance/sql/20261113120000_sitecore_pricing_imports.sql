-- Run in the PERFORMANCE project's SQL Editor. No chatbot/Auth tables are used.
-- DEV only. App authorization is checked in the original chatbot project.
begin;

create table if not exists public.sitecore_pricing_imports (
  id uuid primary key default gen_random_uuid(),
  environment text not null default 'dev' check (environment = 'dev'),
  filename text not null, file_sha256 text not null, sheet_name text not null,
  target_host text not null, config_hash text not null,
  created_by uuid not null, approved_by uuid,
  created_at timestamptz not null default now(), approved_at timestamptz, finished_at timestamptz,
  phase text not null default 'preview' check (phase in ('preview','apply')),
  status text not null default 'preview_queued' check (status in ('preview_queued','previewing','review','apply_queued','applying','completed','failed','cancelled')),
  error_message text, lease_token uuid, lease_expires_at timestamptz, heartbeat_at timestamptz
);
create table if not exists public.sitecore_pricing_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.sitecore_pricing_imports(id),
  row_number integer not null check (row_number > 0),
  language text not null check (language in ('en','fr')),
  source jsonb not null check (jsonb_typeof(source) = 'object'),
  status text not null check (status in ('invalid','pending','ready','unchanged','applying','applied','conflict','failed')),
  item_id text, item_path text, item_version integer, revision text,
  before_values jsonb, after_values jsonb, message text,
  attempts integer not null default 0, updated_at timestamptz not null default now(),
  unique (import_id,row_number,language)
);
create index if not exists sitecore_pricing_imports_created on public.sitecore_pricing_imports(created_at desc);
create index if not exists sitecore_pricing_rows_page on public.sitecore_pricing_rows(import_id,status,row_number,language);
create table if not exists public.sitecore_pricing_runtime (
  id boolean primary key default true check (id),
  last_seen_at timestamptz not null, config_hash text not null
);

alter table public.sitecore_pricing_imports enable row level security;
alter table public.sitecore_pricing_rows enable row level security;
alter table public.sitecore_pricing_runtime enable row level security;
revoke all on public.sitecore_pricing_imports,public.sitecore_pricing_rows,public.sitecore_pricing_runtime from public,anon,authenticated;
grant select on public.sitecore_pricing_imports,public.sitecore_pricing_rows,public.sitecore_pricing_runtime to service_role;

create or replace function public.sitecore_pricing_create(
  p_filename text,p_sha256 text,p_sheet text,p_host text,p_config_hash text,p_actor uuid,p_rows jsonb
) returns uuid language plpgsql security definer set search_path = public,pg_temp as $$
declare v_id uuid;
begin
  if p_actor is null or length(p_filename) not between 1 and 240 or p_sha256 !~ '^[a-f0-9]{64}$'
    or p_config_hash !~ '^[a-f0-9]{64}$' or p_host !~ '^https://[^/]+$'
    or p_sheet <> 'Market Rates and Business Cases' or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) not between 1 and 5000 then
    raise exception 'Invalid pricing import' using errcode='22023';
  end if;
  insert into sitecore_pricing_imports(filename,file_sha256,sheet_name,target_host,config_hash,created_by)
    values(p_filename,p_sha256,p_sheet,p_host,p_config_hash,p_actor) returning id into v_id;
  insert into sitecore_pricing_rows(import_id,row_number,language,source,status,message)
    select v_id,(r->>'rowNumber')::integer,l,r,
      case when jsonb_array_length(r->'errors')>0 then 'invalid' else 'pending' end,
      case when jsonb_array_length(r->'errors')>0 then (select string_agg(value,' ') from jsonb_array_elements_text(r->'errors')) end
    from jsonb_array_elements(p_rows) r cross join unnest(array['en','fr']) l;
  return v_id;
end $$;

create or replace function public.sitecore_pricing_counts(p_import_id uuid)
returns jsonb language sql stable security definer set search_path = public,pg_temp as $$
  select coalesce(jsonb_object_agg(status,n),'{}'::jsonb) from
    (select status,count(*) n from sitecore_pricing_rows where import_id=p_import_id group by status) counts;
$$;

create or replace function public.sitecore_pricing_command(p_import_id uuid,p_action text,p_actor uuid)
returns void language plpgsql security definer set search_path = public,pg_temp as $$
declare v_job sitecore_pricing_imports%rowtype;
begin
  select * into v_job from sitecore_pricing_imports where id=p_import_id for update;
  if not found or p_actor is null then raise exception 'Import not found' using errcode='22023'; end if;
  if p_action='approve' then
    if v_job.status <> 'review' or not exists(select 1 from sitecore_pricing_rows where import_id=p_import_id and status='ready') then
      raise exception 'No reviewed changes are ready' using errcode='22023';
    end if;
    if not exists(select 1 from sitecore_pricing_runtime where id and config_hash=v_job.config_hash and last_seen_at>now()-interval '90 seconds') then
      raise exception 'Start the matching DEV worker first' using errcode='55000';
    end if;
    update sitecore_pricing_imports set status='apply_queued',phase='apply',approved_by=p_actor,approved_at=now(),finished_at=null where id=p_import_id;
  elsif p_action='retry' then
    if v_job.status not in ('failed','completed') then raise exception 'Import is not retryable' using errcode='22023'; end if;
    if v_job.phase='apply' then
      if not exists(select 1 from sitecore_pricing_rows where import_id=p_import_id
        and (status in ('failed','applying') or (v_job.status='failed' and status='ready'))) then
        raise exception 'No failed updates to retry' using errcode='22023';
      end if;
      -- Keep before/after snapshots. The worker reconciles uncertain remote writes.
      update sitecore_pricing_rows set status='ready',message=null where import_id=p_import_id and status in ('failed','applying');
    end if;
    update sitecore_pricing_imports set status=case when phase='preview' then 'preview_queued' else 'apply_queued' end,
      error_message=null,finished_at=null,lease_token=null,lease_expires_at=null where id=p_import_id;
  elsif p_action='cancel' then
    if v_job.status not in ('preview_queued','review','apply_queued','failed') then raise exception 'An active operation cannot be cancelled' using errcode='22023'; end if;
    update sitecore_pricing_imports set status='cancelled',finished_at=now(),lease_token=null,lease_expires_at=null where id=p_import_id;
  else raise exception 'Unknown pricing action' using errcode='22023'; end if;
end $$;

create or replace function public.sitecore_pricing_ping(p_config_hash text)
returns void language sql security definer set search_path=public,pg_temp as $$
  insert into sitecore_pricing_runtime(id,last_seen_at,config_hash) values(true,now(),p_config_hash)
  on conflict(id) do update set last_seen_at=excluded.last_seen_at,config_hash=excluded.config_hash;
$$;

create or replace function public.sitecore_pricing_claim(p_config_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job sitecore_pricing_imports%rowtype;
begin
  -- Serialize claims so concurrent workers cannot mutate the same DEV host.
  if not pg_try_advisory_xact_lock(711302611) then return null; end if;
  select j.* into v_job from sitecore_pricing_imports j
  where j.config_hash=p_config_hash and j.status in ('preview_queued','apply_queued','previewing','applying')
    and (j.lease_expires_at is null or j.lease_expires_at<now())
    and not exists(select 1 from sitecore_pricing_imports active where active.id<>j.id and active.target_host=j.target_host
      and active.status in ('previewing','applying') and active.lease_expires_at>=now())
  order by case when j.status in ('previewing','applying') then 0 else 1 end,j.created_at
  limit 1 for update skip locked;
  if not found then return null; end if;
  update sitecore_pricing_imports set status=case when phase='preview' then 'previewing' else 'applying' end,
    lease_token=gen_random_uuid(),lease_expires_at=now()+interval '90 seconds',heartbeat_at=now(),error_message=null
    where id=v_job.id returning * into v_job;
  return to_jsonb(v_job);
end $$;

create or replace function public.sitecore_pricing_heartbeat(p_id uuid,p_token uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update sitecore_pricing_imports set lease_expires_at=now()+interval '90 seconds',heartbeat_at=now()
    where id=p_id and lease_token=p_token and lease_expires_at>now() and status in ('previewing','applying');
  return found;
end $$;

create or replace function public.sitecore_pricing_save_row(p_id uuid,p_token uuid,p_row_id uuid,p_result jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job sitecore_pricing_imports%rowtype; v_status text := p_result->>'status';
begin
  select * into v_job from sitecore_pricing_imports where id=p_id and lease_token=p_token and lease_expires_at>now()
    and status in ('previewing','applying') for update;
  if not found then raise exception 'Worker lease lost' using errcode='40001'; end if;
  if (v_job.phase='preview' and v_status not in ('invalid','ready','unchanged'))
    or (v_job.phase='apply' and v_status not in ('applying','applied','conflict','failed')) then
    raise exception 'Invalid row transition' using errcode='22023';
  end if;
  update sitecore_pricing_rows set status=v_status,message=p_result->>'message',updated_at=now(),
    item_id=case when v_job.phase='preview' then p_result->>'item_id' else item_id end,
    item_path=case when v_job.phase='preview' then p_result->>'item_path' else item_path end,
    item_version=case when v_job.phase='preview' then (p_result->>'item_version')::integer else item_version end,
    revision=case when v_job.phase='preview' then p_result->>'revision' else revision end,
    before_values=case when v_job.phase='preview' then p_result->'before_values' else before_values end,
    after_values=case when v_job.phase='preview' then p_result->'after_values' else after_values end,
    attempts=attempts+case when v_status='applying' then 1 else 0 end
  where id=p_row_id and import_id=p_id
    and ((v_job.phase='preview' and status='pending') or (v_job.phase='apply' and status in ('ready','applying')));
  if not found then raise exception 'Row changed or missing' using errcode='40001'; end if;
end $$;

create or replace function public.sitecore_pricing_finish(p_id uuid,p_token uuid,p_error text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job sitecore_pricing_imports%rowtype;
begin
  select * into v_job from sitecore_pricing_imports where id=p_id and lease_token=p_token and lease_expires_at>now() for update;
  if not found then raise exception 'Worker lease lost' using errcode='40001'; end if;
  if p_error is null and exists(select 1 from sitecore_pricing_rows where import_id=p_id
    and ((v_job.phase='preview' and status='pending') or (v_job.phase='apply' and status in ('ready','applying')))) then
    raise exception 'Import has unfinished rows' using errcode='22023';
  end if;
  update sitecore_pricing_imports set status=case when p_error is not null then 'failed' when phase='preview' then 'review' else 'completed' end,
    error_message=left(p_error,2000),lease_token=null,lease_expires_at=null,
    finished_at=case when p_error is not null or phase='apply' then now() else null end where id=p_id;
end $$;

-- All functions and tables are service-only. No original-project JWT, profile FK,
-- or auth.uid() policy is valid in this separate database.
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and starts_with(p.proname,'sitecore_pricing_')
  loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
