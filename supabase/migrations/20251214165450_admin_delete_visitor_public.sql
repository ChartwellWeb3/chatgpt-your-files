create or replace function public.admin_delete_visitor(p_visitor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only allow authenticated users (your admin UI)
  if auth.role() <> 'authenticated' then
    raise exception 'not allowed';
  end if;

  delete from public.visitors
  where id = p_visitor_id;
end;
$$;

grant execute on function public.admin_delete_visitor(uuid) to authenticated;
revoke execute on function public.admin_delete_visitor(uuid) from anon;