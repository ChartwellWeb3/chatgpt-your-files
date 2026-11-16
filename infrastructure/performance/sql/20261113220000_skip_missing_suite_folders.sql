-- PERFORMANCE project. Run after 20261113213000_skip_missing_suite_versions.sql.
-- Only reclassifies row-level missing-folder results from earlier previews.
-- Job-level catalog/root errors, other errors, and before/after snapshots remain intact.
begin;

update public.sitecore_pricing_rows
set status='skipped',updated_at=now(),
  message='No SuitePlans folder for this care level; skipped.' ||
    case when starts_with(message,'Content folder not found: ')
      then ' Path: ' || regexp_replace(substr(message,length('Content folder not found: ')+1),'[.]$','')
      else '' end
where status in ('invalid','conflict')
  and (message in ('Content folder not found','Content folder not found.')
    or starts_with(message,'Content folder not found: '));

commit;
