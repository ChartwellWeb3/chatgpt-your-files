-- Run in the PERFORMANCE project after the initial pricing installation.
-- Includes the earlier French-only skip update; that update need not be run first.
-- Missing EN and FR versions are neutral skips. Other errors remain actionable.
begin;

alter table public.sitecore_pricing_rows drop constraint if exists sitecore_pricing_rows_status_check;
alter table public.sitecore_pricing_rows add constraint sitecore_pricing_rows_status_check
  check (status in ('invalid','pending','ready','unchanged','applying','applied','conflict','failed','skipped'));

update public.sitecore_pricing_rows
set status='skipped',
  message=case language when 'en' then 'No English SuitePlan version; skipped.' else 'No French SuitePlan version; skipped.' end,
  updated_at=now()
where language in ('en','fr') and status in ('invalid','conflict')
  and message=format('No existing %s SuitePlan version. Language fallback is not eligible for updating.',upper(language));

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

revoke all on function public.sitecore_pricing_save_row(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sitecore_pricing_save_row(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
