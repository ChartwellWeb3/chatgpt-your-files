create or replace function public.chat_visitors_needing_analysis(
  p_cutoff_days int,
  p_limit int,
  p_force boolean default false
)
returns table (visitor_id uuid, last_message_at timestamptz)
language sql
security definer
set search_path = public
as $$
  with last_msg as (
    select visitor_id, max(created_at) as last_message_at
    from public.chat_messages
    group by visitor_id
  )
  select lm.visitor_id, lm.last_message_at
  from last_msg lm
  where lm.last_message_at < now() - (p_cutoff_days || ' days')::interval
    and (
      p_force
      or not exists (
        select 1
        from public.chat_visitor_analyses a
        where a.visitor_id = lm.visitor_id
          and a.last_message_at = lm.last_message_at
          and a.source = 'auto'
      )
    )
  order by lm.last_message_at asc
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.chat_visitors_needing_analysis(int, int, boolean) from public;
grant execute on function public.chat_visitors_needing_analysis(int, int, boolean) to service_role;
