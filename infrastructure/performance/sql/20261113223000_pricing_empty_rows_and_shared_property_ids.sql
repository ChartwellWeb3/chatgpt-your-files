-- PERFORMANCE project. Run after 20261113213000_skip_missing_suite_versions.sql.
-- Empty uploads become neutral skips; each matched residence receives its own
-- persistent preview target before any user-approved Sitecore writes.
begin;

alter table public.sitecore_pricing_rows add column if not exists residence_item_id text;
alter table public.sitecore_pricing_rows add column if not exists residence_path text;
alter table public.sitecore_pricing_rows drop constraint if exists sitecore_pricing_rows_import_id_row_number_language_key;
create unique index if not exists sitecore_pricing_rows_residence_target
  on public.sitecore_pricing_rows(import_id,row_number,language,coalesce(residence_item_id,''));

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

-- Historical blank rows may also have missing identifier fields. Those fields
-- are immaterial when no updates were supplied. Preserve genuine price/date errors.
update public.sitecore_pricing_rows set status='skipped',message='No price or date values supplied; skipped.',updated_at=now()
where status='invalid' and public.sitecore_pricing_is_empty_update(source);

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

revoke all on function public.sitecore_pricing_is_empty_update(jsonb) from public,anon,authenticated;
revoke all on function public.sitecore_pricing_create(text,text,text,text,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.sitecore_pricing_expand_row(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sitecore_pricing_is_empty_update(jsonb) to service_role;
grant execute on function public.sitecore_pricing_create(text,text,text,text,text,uuid,jsonb) to service_role;
grant execute on function public.sitecore_pricing_expand_row(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
