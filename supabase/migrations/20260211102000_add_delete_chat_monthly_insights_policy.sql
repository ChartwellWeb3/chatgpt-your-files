grant delete on table public.chat_monthly_insights to authenticated, service_role;

create policy "admin_delete_chat_monthly_insights"
  on public.chat_monthly_insights
  for delete
  to authenticated
  using (public.is_admin());
