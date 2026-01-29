create or replace function public.chat_visitors_needing_analysis(
  p_cutoff_days int,
  p_limit int,
  p_force boolean default false,
  p_min_days_since int default 0
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
  ),
  last_analysis as (
    select visitor_id, max(created_at) as last_analysis_at
    from public.chat_visitor_analyses
    where source = 'auto'
    group by visitor_id
  )
  select lm.visitor_id, lm.last_message_at
  from last_msg lm
  left join last_analysis la on la.visitor_id = lm.visitor_id
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
    and (
      p_min_days_since <= 0
      or la.last_analysis_at is null
      or la.last_analysis_at < now() - (p_min_days_since || ' days')::interval
    )
  order by lm.last_message_at asc
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.chat_visitors_needing_analysis(int, int, boolean, int) from public;
grant execute on function public.chat_visitors_needing_analysis(int, int, boolean, int) to service_role;
