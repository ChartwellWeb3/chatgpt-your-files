revoke all on function public.chat_visitors_needing_duration(int, int, boolean, int) from public;
grant execute on function public.chat_visitors_needing_duration(int, int, boolean, int)
  to authenticated, service_role;
