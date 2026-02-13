create or replace function public.reembed_missing_document_sections(
  p_residence_custom_id text,
  p_limit int default 200
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count int;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  with to_touch as (
    select ds.id
    from public.document_sections ds
    join public.documents d on d.id = ds.document_id
    left join public.residences r on r.id = d.residence_id
    where ds.embedding is null
      and (
        (
          p_residence_custom_id is not null
          and p_residence_custom_id <> ''
          and p_residence_custom_id <> 'common'
          and r.custom_id = p_residence_custom_id
        )
        or (
          (p_residence_custom_id is null or p_residence_custom_id = '' or p_residence_custom_id = 'common')
          and d.is_common = true
        )
      )
    limit greatest(1, least(p_limit, 500))
  )
  update public.document_sections ds
  set content = ds.content
  from to_touch t
  where ds.id = t.id;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.reembed_missing_document_sections(text, int) from public;
grant execute on function public.reembed_missing_document_sections(text, int) to authenticated, service_role;
