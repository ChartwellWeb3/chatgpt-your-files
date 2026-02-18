create or replace function public.analytics_duration_by_sentiment(
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
  latest_analysis as (
    select distinct on (visitor_id)
      visitor_id,
      sentiment,
      last_message_at,
      created_at
    from public.chat_visitor_analyses
    order by visitor_id, created_at desc
  ),
  latest_duration as (
    select distinct on (visitor_id)
      visitor_id,
      duration_seconds,
      last_message_at,
      created_at
    from public.chat_visitor_durations
    where source = 'auto'
    order by visitor_id, created_at desc
  ),
  joined as (
    select
      a.visitor_id,
      a.sentiment,
      a.last_message_at as analysis_last_message_at,
      d.duration_seconds,
      d.last_message_at as duration_last_message_at
    from latest_analysis a
    join latest_duration d on d.visitor_id = a.visitor_id
  ),
  filtered as (
    select j.*
    from joined j, params p
    where (p.start_date is null or coalesce(j.duration_last_message_at, j.analysis_last_message_at) >= p.start_date)
      and (p.end_date is null or coalesce(j.duration_last_message_at, j.analysis_last_message_at) < (p.end_date + interval '1 day'))
  ),
  stats as (
    select
      coalesce(avg(duration_seconds) filter (where sentiment = 'satisfied'), 0)::float as satisfied_avg_seconds,
      coalesce(avg(duration_seconds) filter (where sentiment = 'neutral'), 0)::float as neutral_avg_seconds,
      coalesce(avg(duration_seconds) filter (where sentiment = 'angry'), 0)::float as angry_avg_seconds,
      count(*) filter (where sentiment = 'satisfied')::int as satisfied_total,
      count(*) filter (where sentiment = 'neutral')::int as neutral_total,
      count(*) filter (where sentiment = 'angry')::int as angry_total
    from filtered
  )
select jsonb_build_object(
  'satisfiedAvgSeconds', coalesce(satisfied_avg_seconds, 0),
  'neutralAvgSeconds', coalesce(neutral_avg_seconds, 0),
  'angryAvgSeconds', coalesce(angry_avg_seconds, 0),
  'satisfiedTotal', coalesce(satisfied_total, 0),
  'neutralTotal', coalesce(neutral_total, 0),
  'angryTotal', coalesce(angry_total, 0)
)
from stats;
$$;

revoke all on function public.analytics_duration_by_sentiment(date, date) from public;
grant execute on function public.analytics_duration_by_sentiment(date, date) to authenticated;
