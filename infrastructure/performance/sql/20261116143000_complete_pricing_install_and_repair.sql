-- RUN THIS ENTIRE FILE in the PERFORMANCE project's SQL Editor.
-- Use the project configured by the app's PERFORMANCE_SUPABASE_URL, not chatbot/Auth.
-- Complete installation/repair: no earlier pricing SQL files are required.
-- Safe after missing, partial, or complete earlier pricing installations.
-- Keeps all import IDs, source rows, snapshots, statuses, actors, and active leases.
-- Does not run an import, approve historical jobs, delete data, publish, or call Sitecore.
-- Creates only missing tables/columns/indexes and replaces pricing RPC definitions.
-- Includes empty-update/shared-property-ID support, EN/FR neutral skips, Edge jobs,
-- schema diagnostics, service-only permissions, and import-history deletion.
-- Cron and Vault setup are separate and are not changed by this file.
begin;


-- Base tables and service-only access.

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

-- Allow neutral skips without changing any saved result rows.

alter table public.sitecore_pricing_rows drop constraint if exists sitecore_pricing_rows_status_check;
alter table public.sitecore_pricing_rows add constraint sitecore_pricing_rows_status_check
  check (status in ('invalid','pending','ready','unchanged','applying','applied','conflict','failed','skipped'));

-- Per-residence targets; remove only the superseded uniqueness constraint.

alter table public.sitecore_pricing_rows add column if not exists residence_item_id text;
alter table public.sitecore_pricing_rows add column if not exists residence_path text;
alter table public.sitecore_pricing_rows drop constraint if exists sitecore_pricing_rows_import_id_row_number_language_key;
create unique index if not exists sitecore_pricing_rows_residence_target
  on public.sitecore_pricing_rows(import_id,row_number,language,coalesce(residence_item_id,''));

-- DEV Edge processing columns, catalog checkpoints, and developer filter.

alter table public.sitecore_pricing_imports
  add column if not exists execution_mode text not null default 'manual' check (execution_mode in ('manual','edge_auto')),
  add column if not exists edge_stage text not null default 'catalog' check (edge_stage in ('catalog','expand','preview','apply','done')),
  add column if not exists content_root text,
  add column if not exists progress integer not null default 0 check (progress between 0 and 100),
  add column if not exists run_requested_by uuid,
  add column if not exists run_requested_at timestamptz;
alter table public.sitecore_pricing_imports drop constraint if exists sitecore_pricing_imports_status_check;
alter table public.sitecore_pricing_imports add constraint sitecore_pricing_imports_status_check
  check (status in ('uploaded','preview_queued','previewing','review','apply_queued','applying','completed','failed','cancelled'));

create table if not exists public.sitecore_pricing_catalog_tasks (
  import_id uuid not null references public.sitecore_pricing_imports(id),
  path text not null, depth integer not null check (depth between 0 and 3),
  cursor text, pages integer not null default 0, done boolean not null default false,
  primary key (import_id,path)
);
create table if not exists public.sitecore_pricing_catalog (
  import_id uuid not null references public.sitecore_pricing_imports(id),
  item_id text not null, path text not null, property_id text not null,
  primary key (import_id,item_id)
);
create index if not exists sitecore_pricing_catalog_property on public.sitecore_pricing_catalog(import_id,property_id);
alter table public.sitecore_pricing_catalog_tasks enable row level security;
alter table public.sitecore_pricing_catalog enable row level security;
revoke all on public.sitecore_pricing_catalog_tasks,public.sitecore_pricing_catalog from public,anon,authenticated;
grant select on public.sitecore_pricing_catalog_tasks,public.sitecore_pricing_catalog to service_role;
alter table public.sitecore_pricing_imports enable row level security;
alter table public.sitecore_pricing_rows enable row level security;
alter table public.sitecore_pricing_runtime enable row level security;
revoke all on public.sitecore_pricing_imports,public.sitecore_pricing_rows,public.sitecore_pricing_runtime from public,anon,authenticated;
grant select on public.sitecore_pricing_imports,public.sitecore_pricing_rows,public.sitecore_pricing_runtime to service_role;

-- A generated column keeps developer filtering/pagination in the database.
alter table public.sitecore_pricing_rows add column if not exists developer_attention boolean generated always as (
  status in ('invalid','conflict','failed') or
  (status <> 'skipped' and jsonb_array_length(coalesce(source->'warnings','[]'::jsonb)) > 0)
) stored;
create index if not exists sitecore_pricing_rows_developer on public.sitecore_pricing_rows(import_id,developer_attention,row_number,language);

-- Latest definitions only. No legacy implementation is exposed mid-upgrade.

create or replace function public.sitecore_pricing_create(
  p_filename text,p_sha256 text,p_sheet text,p_host text,p_config_hash text,p_actor uuid,p_rows jsonb
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
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
      case when sitecore_pricing_is_empty_update(r) then 'skipped'
        when jsonb_array_length(r->'errors')>0 then 'invalid' else 'pending' end,
      case when sitecore_pricing_is_empty_update(r) then 'No price or date values supplied; skipped.'
        when jsonb_array_length(r->'errors')>0 then (select string_agg(value,' ') from jsonb_array_elements_text(r->'errors')) end
    from jsonb_array_elements(p_rows) r cross join unnest(array['en','fr']) l;
  -- No Sitecore worker is needed for an upload containing no actionable rows.
  if not exists(select 1 from sitecore_pricing_rows where import_id=v_id and status='pending') then
    update sitecore_pricing_imports set status='review' where id=v_id;
  end if;
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
begin
  raise exception 'Local pricing worker retired. Use sitecore-pricing Edge Function and upload again.' using errcode='55000';
end $$;

create or replace function public.sitecore_pricing_heartbeat(p_id uuid,p_token uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update sitecore_pricing_imports set lease_expires_at=now()+interval '180 seconds',heartbeat_at=now()
    where id=p_id and lease_token=p_token and lease_expires_at>now() and status in ('previewing','applying');
  return found;
end $$;

create or replace function public.sitecore_pricing_save_row(p_id uuid,p_token uuid,p_row_id uuid,p_result jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job sitecore_pricing_imports%rowtype; v_status text := p_result->>'status'; v_language text;
begin
  select * into v_job from sitecore_pricing_imports where id=p_id and lease_token=p_token and lease_expires_at>now()
    and status in ('previewing','applying') for update;
  if not found then raise exception 'Worker lease lost' using errcode='40001'; end if;
  select language into v_language from sitecore_pricing_rows where id=p_row_id and import_id=p_id;
  if not found then raise exception 'Row changed or missing' using errcode='40001'; end if;

  -- Normalize the exact old error for either language during rolling updates.
  if v_status in ('invalid','conflict') and p_result->>'message'=
    format('No existing %s SuitePlan version. Language fallback is not eligible for updating.',upper(v_language)) then
    v_status := 'skipped';
    p_result := jsonb_set(p_result,'{message}',to_jsonb(case v_language
      when 'en' then 'No English SuitePlan version; skipped.' else 'No French SuitePlan version; skipped.' end));
  end if;
  if (v_job.phase='preview' and v_status not in ('invalid','ready','unchanged','skipped'))
    or (v_job.phase='apply' and v_status not in ('applying','applied','conflict','failed','skipped')) then
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

create or replace function public.sitecore_pricing_is_empty_update(p_source jsonb)
returns boolean language sql immutable security definer set search_path=public,pg_temp as $$
  select coalesce(p_source->'values','{}'::jsonb)='{}'::jsonb and (
    coalesce(p_source->>'skipReason'='empty_update',false) or (
      coalesce(p_source->'errors','[]'::jsonb) ? 'No price or date values to update.'
      and not exists (
        select 1 from jsonb_array_elements_text(case when jsonb_typeof(p_source->'errors')='array' then p_source->'errors' else '[]'::jsonb end) e(value)
        where value not in ('No price or date values to update.','Missing or invalid Web Property ID.',
          'Missing or unsupported Marketing Care Level.','Missing or invalid Web SuiteTitle.')
          and not starts_with(value,'Duplicate matching key on Excel rows ')
      )
    )
  );
$$;

create or replace function public.sitecore_pricing_expand_row(p_id uuid,p_token uuid,p_row_id uuid,p_residences jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job sitecore_pricing_imports%rowtype; v_row sitecore_pricing_rows%rowtype;
  v_residence jsonb; v_first boolean := true; v_target_id text;
begin
  select * into v_job from sitecore_pricing_imports where id=p_id and lease_token=p_token and lease_expires_at>now()
    and phase='preview' and status='previewing' for update;
  if not found then raise exception 'Worker lease lost' using errcode='40001'; end if;
  select * into v_row from sitecore_pricing_rows where id=p_row_id and import_id=p_id and status='pending' for update;
  if not found then raise exception 'Row changed or missing' using errcode='40001'; end if;
  -- Repeated calls cannot duplicate targets after a lost response or restart.
  if v_row.residence_item_id is not null then return; end if;
  if jsonb_typeof(p_residences)<>'array' or jsonb_array_length(p_residences) not between 1 and 2000 then
    raise exception 'Invalid residence targets' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_residences) r
    where coalesce(lower(regexp_replace(r->>'id','[{}-]','','g')),'') !~ '^[a-f0-9]{32}$'
      or coalesce(r->>'path','') !~ '^/sitecore/content/' or position('..' in (r->>'path'))>0)
    or (select count(distinct lower(regexp_replace(r->>'id','[{}-]','','g'))) from jsonb_array_elements(p_residences) r)<>jsonb_array_length(p_residences) then
    raise exception 'Invalid or duplicate residence targets' using errcode='22023';
  end if;
  for v_residence in select value from jsonb_array_elements(p_residences) order by value->>'path',value->>'id'
  loop
    v_target_id := lower(regexp_replace(v_residence->>'id','[{}-]','','g'));
    if v_first then
      update sitecore_pricing_rows set residence_item_id=v_target_id,residence_path=v_residence->>'path',updated_at=now()
        where id=p_row_id;
      v_first := false;
    else
      insert into sitecore_pricing_rows(import_id,row_number,language,source,status,residence_item_id,residence_path)
        values(p_id,v_row.row_number,v_row.language,v_row.source,'pending',v_target_id,v_residence->>'path');
    end if;
  end loop;
end $$;

create or replace function public.sitecore_pricing_upload(
  p_filename text,p_sha256 text,p_sheet text,p_host text,p_config_hash text,p_actor uuid,p_rows jsonb,p_root text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if p_root is null or p_root not like '/sitecore/content/%' or position('..' in p_root)>0 then
    raise exception 'Invalid content root' using errcode='22023';
  end if;
  v_id := sitecore_pricing_create(p_filename,p_sha256,p_sheet,p_host,p_config_hash,p_actor,p_rows);
  update sitecore_pricing_imports set execution_mode='edge_auto',status='uploaded',content_root=p_root where id=v_id;
  insert into sitecore_pricing_catalog_tasks(import_id,path,depth) values(v_id,p_root,0);
  return v_id;
end $$;

create or replace function public.sitecore_pricing_edge_command(p_import_id uuid,p_action text,p_actor uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare j sitecore_pricing_imports%rowtype;
begin
  select * into j from sitecore_pricing_imports where id=p_import_id and execution_mode='edge_auto' for update;
  if not found or p_actor is null then raise exception 'Upload a new automatic import' using errcode='22023'; end if;
  if p_action='run' then
    -- Repeated Run clicks are idempotent; they cannot reset applied content.
    if j.run_requested_at is not null then return; end if;
    if j.status<>'uploaded' then raise exception 'Import already started' using errcode='22023'; end if;
    update sitecore_pricing_imports set status='preview_queued',progress=1,
      run_requested_by=p_actor,run_requested_at=now() where id=j.id;
    -- All-empty/all-invalid files need no external requests or catalog scan.
    if not exists(select 1 from sitecore_pricing_rows where import_id=j.id and status='pending') then
      update sitecore_pricing_imports set status='completed',phase='apply',edge_stage='done',progress=100,finished_at=now() where id=j.id;
    end if;
  elsif p_action='retry' then
    if j.status not in ('failed','completed') or j.run_requested_at is null then
      raise exception 'Import is not retryable' using errcode='22023';
    end if;
    if j.phase='apply' then
      if not exists(select 1 from sitecore_pricing_rows where import_id=j.id and status in ('failed','ready','applying')) then
        raise exception 'No interrupted updates' using errcode='22023';
      end if;
      update sitecore_pricing_rows set status='ready',message=null where import_id=j.id and status in ('failed','applying');
    end if;
    update sitecore_pricing_imports set status=case when phase='apply' then 'apply_queued' else 'preview_queued' end,
      edge_stage=case when phase='apply' then 'apply' else edge_stage end,
      progress=case when phase='apply' then 60 else least(progress,59) end,
      error_message=null,finished_at=null,lease_token=null,lease_expires_at=null where id=j.id;
  elsif p_action='cancel' then
    -- Cancellation is only allowed between batches or after a lease expires.
    if j.status in ('completed','cancelled') or j.lease_expires_at>now() then
      raise exception 'An active batch cannot be cancelled' using errcode='22023';
    end if;
    update sitecore_pricing_imports set status='cancelled',finished_at=now(),lease_token=null,lease_expires_at=null where id=j.id;
  else raise exception 'Unknown action' using errcode='22023'; end if;
end $$;

create or replace function public.sitecore_pricing_edge_claim(p_config_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j sitecore_pricing_imports%rowtype;
begin
  if not pg_try_advisory_xact_lock(711302611) then return null; end if;
  select q.* into j from sitecore_pricing_imports q
  where q.execution_mode='edge_auto' and q.run_requested_at is not null and q.config_hash=p_config_hash
    and q.status in ('preview_queued','previewing','apply_queued','applying')
    and (q.lease_expires_at is null or q.lease_expires_at<now())
    and not exists(select 1 from sitecore_pricing_imports a where a.id<>q.id and a.target_host=q.target_host and a.lease_expires_at>=now())
  order by q.created_at limit 1 for update skip locked;
  if not found then return null; end if;
  update sitecore_pricing_imports set status=case when phase='preview' then 'previewing' else 'applying' end,
    lease_token=gen_random_uuid(),lease_expires_at=now()+interval '180 seconds',heartbeat_at=now()
    where id=j.id returning * into j;
  return to_jsonb(j);
end $$;

create or replace function public.sitecore_pricing_catalog_page(
  p_id uuid,p_token uuid,p_path text,p_cursor text,p_next text,p_folders jsonb,p_residences jsonb
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare j sitecore_pricing_imports%rowtype; t sitecore_pricing_catalog_tasks%rowtype; r jsonb;
begin
  select * into j from sitecore_pricing_imports where id=p_id and lease_token=p_token and lease_expires_at>now()
    and status='previewing' and edge_stage='catalog' for update;
  if not found then raise exception 'Lease lost' using errcode='40001'; end if;
  select * into t from sitecore_pricing_catalog_tasks where import_id=p_id and path=p_path and not done for update;
  if not found or t.cursor is distinct from p_cursor then raise exception 'Catalog checkpoint changed' using errcode='40001'; end if;
  if t.pages>=100 or (p_next is not null and p_next is not distinct from p_cursor)
    or jsonb_typeof(p_folders)<>'array' or jsonb_typeof(p_residences)<>'array' then
    raise exception 'Invalid catalog page' using errcode='22023';
  end if;
  for r in select value from jsonb_array_elements(p_folders) loop
    if t.depth>=3 or left(r->>'path',length(j.content_root)+1)<>j.content_root||'/' then
      raise exception 'Invalid folder scope' using errcode='22023';
    end if;
    insert into sitecore_pricing_catalog_tasks(import_id,path,depth) values(p_id,r->>'path',t.depth+1) on conflict do nothing;
  end loop;
  for r in select value from jsonb_array_elements(p_residences) loop
    if (r->>'path'<>j.content_root and left(r->>'path',length(j.content_root)+1)<>j.content_root||'/')
      or coalesce(r->>'id','') !~ '^[a-fA-F0-9{}-]{32,38}$' then
      raise exception 'Invalid residence scope' using errcode='22023';
    end if;
    insert into sitecore_pricing_catalog(import_id,item_id,path,property_id)
      values(p_id,lower(regexp_replace(r->>'id','[{}-]','','g')),r->>'path',coalesce(r->>'propertyId',''))
      on conflict(import_id,item_id) do update set path=excluded.path,property_id=excluded.property_id;
  end loop;
  if (select count(*) from sitecore_pricing_catalog_tasks where import_id=p_id)>1500 then
    raise exception 'Catalog exceeds 1500 folders; narrow the root' using errcode='22023';
  end if;
  update sitecore_pricing_catalog_tasks set cursor=p_next,done=p_next is null,pages=pages+1 where import_id=p_id and path=p_path;
end $$;

create or replace function public.sitecore_pricing_edge_advance(p_id uuid,p_token uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j sitecore_pricing_imports%rowtype; v_total bigint; v_pending bigint; v_terminal bigint; v_progress integer;
begin
  select * into j from sitecore_pricing_imports where id=p_id and lease_token=p_token and lease_expires_at>now()
    and execution_mode='edge_auto' and run_requested_at is not null and status in ('previewing','applying') for update;
  if not found then raise exception 'Lease lost' using errcode='40001'; end if;
  if j.edge_stage='catalog' then
    select count(*),count(*) filter(where not done) into v_total,v_pending from sitecore_pricing_catalog_tasks where import_id=p_id;
    v_progress:=1+floor(14.0*(v_total-v_pending)/greatest(v_total,1));
    if v_pending=0 then
      if not exists(select 1 from sitecore_pricing_catalog where import_id=p_id and property_id<>'') then
        raise exception 'No PropertyPage with populated PropertyID under the configured root' using errcode='22023';
      end if;
      j.edge_stage:='expand'; v_progress:=15;
    end if;
  elsif j.edge_stage='expand' then
    select count(*),count(*) filter(where status='pending' and residence_item_id is null) into v_total,v_pending
      from sitecore_pricing_rows where import_id=p_id;
    v_progress:=15+floor(5.0*(v_total-v_pending)/greatest(v_total,1));
    if v_pending=0 then j.edge_stage:='preview'; v_progress:=20; end if;
  elsif j.edge_stage='preview' then
    select count(*),count(*) filter(where status='pending') into v_total,v_pending from sitecore_pricing_rows where import_id=p_id;
    v_progress:=20+floor(40.0*(v_total-v_pending)/greatest(v_total,1));
    if v_pending=0 then j.edge_stage:='apply'; j.phase:='apply'; j.status:='applying'; v_progress:=60; end if;
  elsif j.edge_stage='apply' then
    select count(*),count(*) filter(where status in ('ready','applying')) into v_total,v_pending from sitecore_pricing_rows where import_id=p_id;
    v_terminal:=v_total-v_pending;
    v_progress:=60+floor(39.0*v_terminal/greatest(v_total,1));
    if v_pending=0 then j.edge_stage:='done'; j.status:='completed'; v_progress:=100; end if;
  else v_progress:=100;
  end if;
  update sitecore_pricing_imports set edge_stage=j.edge_stage,phase=j.phase,status=j.status,
    progress=greatest(progress,v_progress),finished_at=case when j.status='completed' then now() else null end,
    lease_token=case when j.status='completed' then null else lease_token end,
    lease_expires_at=case when j.status='completed' then null else lease_expires_at end where id=p_id returning * into j;
  return to_jsonb(j);
end $$;

create or replace function public.sitecore_pricing_edge_release(p_id uuid,p_token uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update sitecore_pricing_imports set lease_token=null,lease_expires_at=null
    where id=p_id and lease_token=p_token and lease_expires_at>now();
  if not found then raise exception 'Lease lost' using errcode='40001'; end if;
end $$;

create or replace function public.sitecore_pricing_delete_import(p_import_id uuid,p_actor uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare j sitecore_pricing_imports%rowtype;
begin
  if p_actor is null then raise exception 'Missing actor' using errcode='22023'; end if;
  select * into j from sitecore_pricing_imports where id=p_import_id and environment='dev' for update;
  if not found then return false; end if;
  if j.lease_expires_at>now() then
    raise exception 'An active import cannot be deleted' using errcode='55006';
  end if;
  delete from sitecore_pricing_catalog_tasks where import_id=p_import_id;
  delete from sitecore_pricing_catalog where import_id=p_import_id;
  delete from sitecore_pricing_rows where import_id=p_import_id;
  delete from sitecore_pricing_imports where id=p_import_id;
  return true;
end $$;

create or replace function public.sitecore_pricing_schema_status()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare missing text[] := array[]::text[]; t text; c text; signature text; spec jsonb;
begin
  for t,spec in select key,value from jsonb_each('{
    "sitecore_pricing_imports":["execution_mode","edge_stage","content_root","progress","run_requested_by","run_requested_at","lease_token","lease_expires_at"],
    "sitecore_pricing_rows":["developer_attention","residence_item_id","residence_path","source","status"],
    "sitecore_pricing_catalog_tasks":["import_id","path","depth","cursor","pages","done"],
    "sitecore_pricing_catalog":["import_id","item_id","path","property_id"],
    "sitecore_pricing_runtime":["id","last_seen_at","config_hash"]
  }'::jsonb) loop
    if to_regclass('public.'||t) is null then missing:=array_append(missing,t);
    else
      if not has_table_privilege('service_role',to_regclass('public.'||t),'SELECT') then
        missing:=array_append(missing,t||' (service_role SELECT permission)');
      end if;
      for c in select jsonb_array_elements_text(spec) loop
        if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name=c) then
          missing:=array_append(missing,t||'.'||c);
        end if;
      end loop;
    end if;
  end loop;
  foreach signature in array array[
    'sitecore_pricing_upload(text,text,text,text,text,uuid,jsonb,text)',
    'sitecore_pricing_edge_command(uuid,text,uuid)',
    'sitecore_pricing_edge_claim(text)',
    'sitecore_pricing_catalog_page(uuid,uuid,text,text,text,jsonb,jsonb)',
    'sitecore_pricing_edge_advance(uuid,uuid)',
    'sitecore_pricing_edge_release(uuid,uuid)',
    'sitecore_pricing_heartbeat(uuid,uuid)',
    'sitecore_pricing_counts(uuid)',
    'sitecore_pricing_expand_row(uuid,uuid,uuid,jsonb)',
    'sitecore_pricing_save_row(uuid,uuid,uuid,jsonb)',
    'sitecore_pricing_finish(uuid,uuid,text)',
    'sitecore_pricing_ping(text)',
    'sitecore_pricing_delete_import(uuid,uuid)'
  ] loop
    if to_regprocedure('public.'||signature) is null then missing:=array_append(missing,signature);
    elsif not has_function_privilege('service_role',to_regprocedure('public.'||signature),'EXECUTE') then
      missing:=array_append(missing,signature||' (service_role EXECUTE permission)');
    end if;
  end loop;
  return jsonb_build_object('ready',cardinality(missing)=0,'missing',to_jsonb(missing),'version','20261116143000');
end $$;

-- Applies to all pricing functions, including newly added ones.
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and starts_with(p.proname,'sitecore_pricing_')
  loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

notify pgrst,'reload schema';
commit;

-- Expected result: ready=true, missing=[]. Read-only metadata check.
select public.sitecore_pricing_schema_status() as pricing_setup;
