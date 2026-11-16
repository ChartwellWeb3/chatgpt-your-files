-- PERFORMANCE project only. Install after 20261113223000.
-- Additive update: historical/manual imports are NEVER automatically approved.
begin;
alter table public.sitecore_pricing_imports
  add column execution_mode text not null default 'manual' check (execution_mode in ('manual','edge_auto')),
  add column edge_stage text not null default 'catalog' check (edge_stage in ('catalog','expand','preview','apply','done')),
  add column content_root text,
  add column progress integer not null default 0 check (progress between 0 and 100),
  add column run_requested_by uuid,
  add column run_requested_at timestamptz;
alter table public.sitecore_pricing_imports drop constraint sitecore_pricing_imports_status_check;
alter table public.sitecore_pricing_imports add constraint sitecore_pricing_imports_status_check
  check (status in ('uploaded','preview_queued','previewing','review','apply_queued','applying','completed','failed','cancelled'));

create table public.sitecore_pricing_catalog_tasks (
  import_id uuid not null references public.sitecore_pricing_imports(id),
  path text not null, depth integer not null check (depth between 0 and 3),
  cursor text, pages integer not null default 0, done boolean not null default false,
  primary key (import_id,path)
);
create table public.sitecore_pricing_catalog (
  import_id uuid not null references public.sitecore_pricing_imports(id),
  item_id text not null, path text not null, property_id text not null,
  primary key (import_id,item_id)
);
create index sitecore_pricing_catalog_property on public.sitecore_pricing_catalog(import_id,property_id);
alter table public.sitecore_pricing_catalog_tasks enable row level security;
alter table public.sitecore_pricing_catalog enable row level security;
revoke all on public.sitecore_pricing_catalog_tasks,public.sitecore_pricing_catalog from public,anon,authenticated;
grant select on public.sitecore_pricing_catalog_tasks,public.sitecore_pricing_catalog to service_role;

-- A generated column keeps developer filtering/pagination in the database.
alter table public.sitecore_pricing_rows add column developer_attention boolean generated always as (
  status in ('invalid','conflict','failed') or
  (status <> 'skipped' and jsonb_array_length(coalesce(source->'warnings','[]'::jsonb)) > 0)
) stored;
create index sitecore_pricing_rows_developer on public.sitecore_pricing_rows(import_id,developer_attention,row_number,language);

create function public.sitecore_pricing_upload(
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

create function public.sitecore_pricing_edge_command(p_import_id uuid,p_action text,p_actor uuid)
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

-- Retire the local worker entry point. It cannot claim new automatic imports.
create or replace function public.sitecore_pricing_claim(p_config_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  raise exception 'Local pricing worker retired. Use sitecore-pricing Edge Function and upload again.' using errcode='55000';
end $$;

create function public.sitecore_pricing_edge_claim(p_config_hash text)
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

create or replace function public.sitecore_pricing_heartbeat(p_id uuid,p_token uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update sitecore_pricing_imports set lease_expires_at=now()+interval '180 seconds',heartbeat_at=now()
    where id=p_id and lease_token=p_token and lease_expires_at>now() and status in ('previewing','applying');
  return found;
end $$;

-- Catalog page, its discovered residences, and next cursor are one transaction.
create function public.sitecore_pricing_catalog_page(
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

-- Transitions are automatic ONLY for jobs explicitly authorized by Run.
create function public.sitecore_pricing_edge_advance(p_id uuid,p_token uuid)
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

create function public.sitecore_pricing_edge_release(p_id uuid,p_token uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update sitecore_pricing_imports set lease_token=null,lease_expires_at=null
    where id=p_id and lease_token=p_token and lease_expires_at>now();
  if not found then raise exception 'Lease lost' using errcode='40001'; end if;
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
