create or replace function public.admin_delete_visitor(p_visitor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not coalesce(public.is_admin(), false) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;

  delete from public.visitors
  where id = p_visitor_id;
end;
$$;

revoke all on function public.admin_delete_visitor(uuid) from public, anon;
grant execute on function public.admin_delete_visitor(uuid) to authenticated, service_role;

create or replace function private.admin_delete_visitor(p_visitor_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if auth.role() <> 'service_role' and not coalesce(public.is_admin(), false) then
    raise exception 'not allowed'
      using errcode = '42501';
  end if;

  delete from public.visitors
  where id = p_visitor_id;
end;
$$;

revoke all on function private.admin_delete_visitor(uuid) from public, anon, authenticated;
grant execute on function private.admin_delete_visitor(uuid) to service_role;
