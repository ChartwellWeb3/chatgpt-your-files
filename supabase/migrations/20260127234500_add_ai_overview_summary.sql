create or replace function public.analytics_ai_summary(
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
      sentiment,
      satisfaction_1_to_10,
      last_message_at,
      created_at
    from public.chat_visitor_analyses
    order by visitor_id, created_at desc
  ),
  filtered as (
    select l.*
    from latest l, params p
    where (p.start_date is null or l.last_message_at >= p.start_date)
      and (p.end_date is null or l.last_message_at < (p.end_date + interval '1 day'))
  ),
  counts as (
    select
      count(*) filter (where sentiment = 'satisfied')::int as satisfied,
      count(*) filter (where sentiment = 'neutral')::int as neutral,
      count(*) filter (where sentiment = 'angry')::int as angry,
      coalesce(avg(satisfaction_1_to_10), 0)::float as avg_score,
      count(*)::int as total
    from filtered
  )
select jsonb_build_object(
  'satisfied', coalesce(satisfied, 0),
  'neutral', coalesce(neutral, 0),
  'angry', coalesce(angry, 0),
  'avgScore', coalesce(avg_score, 0),
  'total', coalesce(total, 0)
)
from counts;
$$;

revoke all on function public.analytics_ai_summary(date, date) from public;
grant execute on function public.analytics_ai_summary(date, date) to authenticated;
