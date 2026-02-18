create or replace function public.analytics_duration_summary(
  p_start date default null,
  p_end date default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
with
  params as (
    select p_start as start_date, p_end as end_date
  ),
  latest as (
    select distinct on (visitor_id)
      visitor_id,
      duration_seconds,
      last_message_at,
      created_at
    from public.chat_visitor_durations
    where source = 'auto'
    order by visitor_id, created_at desc
  ),
  filtered as (
    select l.*
    from latest l, params p
    where (p.start_date is null or l.last_message_at >= p.start_date)
      and (p.end_date is null or l.last_message_at < (p.end_date + interval '1 day'))
  ),
  stats as (
    select
      coalesce(avg(duration_seconds), 0)::float as avg_seconds,
      count(*)::int as total
    from filtered
  )
select jsonb_build_object(
  'avgSeconds', coalesce(avg_seconds, 0),
  'total', coalesce(total, 0)
)
from stats;
$$;

revoke all on function public.analytics_duration_summary(date, date) from public;
grant execute on function public.analytics_duration_summary(date, date) to authenticated;
