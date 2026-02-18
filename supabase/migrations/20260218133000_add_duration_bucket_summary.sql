create or replace function public.analytics_duration_bucket_summary(
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
  latest_analysis as (
    select distinct on (visitor_id)
      visitor_id,
      sentiment,
      last_message_at,
      created_at
    from public.chat_visitor_analyses
    order by visitor_id, created_at desc
  ),
  duration_filtered as (
    select d.*
    from latest_duration d, params p
    where (p.start_date is null or d.last_message_at >= p.start_date)
      and (p.end_date is null or d.last_message_at < (p.end_date + interval '1 day'))
  ),
  sentiment_filtered as (
    select
      a.sentiment,
      d.duration_seconds
    from latest_duration d
    join latest_analysis a on a.visitor_id = d.visitor_id
    join params p on true
    where (p.start_date is null or d.last_message_at >= p.start_date)
      and (p.end_date is null or d.last_message_at < (p.end_date + interval '1 day'))
  ),
  overall as (
    select
      count(*) filter (where duration_seconds < 1800)::int as lt30m_count,
      coalesce(avg(duration_seconds) filter (where duration_seconds < 1800), 0)::float as lt30m_avg,
      count(*) filter (where duration_seconds >= 1800 and duration_seconds < 3600)::int as lt1h_count,
      coalesce(avg(duration_seconds) filter (where duration_seconds >= 1800 and duration_seconds < 3600), 0)::float as lt1h_avg,
      count(*) filter (where duration_seconds >= 3600 and duration_seconds < 86400)::int as lt1d_count,
      coalesce(avg(duration_seconds) filter (where duration_seconds >= 3600 and duration_seconds < 86400), 0)::float as lt1d_avg,
      count(*) filter (where duration_seconds >= 86400 and duration_seconds < 172800)::int as lt2d_count,
      coalesce(avg(duration_seconds) filter (where duration_seconds >= 86400 and duration_seconds < 172800), 0)::float as lt2d_avg,
      count(*) filter (where duration_seconds >= 172800)::int as gte2d_count,
      coalesce(avg(duration_seconds) filter (where duration_seconds >= 172800), 0)::float as gte2d_avg
    from duration_filtered
  ),
  sentiment as (
    select
      sentiment,
      count(*) filter (where duration_seconds < 1800)::int as lt30m_count,
      coalesce(avg(duration_seconds) filter (where duration_seconds < 1800), 0)::float as lt30m_avg,
      count(*) filter (where duration_seconds >= 1800 and duration_seconds < 3600)::int as lt1h_count,
      coalesce(avg(duration_seconds) filter (where duration_seconds >= 1800 and duration_seconds < 3600), 0)::float as lt1h_avg,
      count(*) filter (where duration_seconds >= 3600 and duration_seconds < 86400)::int as lt1d_count,
      coalesce(avg(duration_seconds) filter (where duration_seconds >= 3600 and duration_seconds < 86400), 0)::float as lt1d_avg,
      count(*) filter (where duration_seconds >= 86400 and duration_seconds < 172800)::int as lt2d_count,
      coalesce(avg(duration_seconds) filter (where duration_seconds >= 86400 and duration_seconds < 172800), 0)::float as lt2d_avg,
      count(*) filter (where duration_seconds >= 172800)::int as gte2d_count,
      coalesce(avg(duration_seconds) filter (where duration_seconds >= 172800), 0)::float as gte2d_avg
    from sentiment_filtered
    group by sentiment
  )
select jsonb_build_object(
  'overall',
  jsonb_build_object(
    'lt30m', jsonb_build_object('count', lt30m_count, 'avgSeconds', lt30m_avg),
    'lt1h', jsonb_build_object('count', lt1h_count, 'avgSeconds', lt1h_avg),
    'lt1d', jsonb_build_object('count', lt1d_count, 'avgSeconds', lt1d_avg),
    'lt2d', jsonb_build_object('count', lt2d_count, 'avgSeconds', lt2d_avg),
    'gte2d', jsonb_build_object('count', gte2d_count, 'avgSeconds', gte2d_avg)
  ),
  'satisfied',
  coalesce((
    select jsonb_build_object(
      'lt30m', jsonb_build_object('count', lt30m_count, 'avgSeconds', lt30m_avg),
      'lt1h', jsonb_build_object('count', lt1h_count, 'avgSeconds', lt1h_avg),
      'lt1d', jsonb_build_object('count', lt1d_count, 'avgSeconds', lt1d_avg),
      'lt2d', jsonb_build_object('count', lt2d_count, 'avgSeconds', lt2d_avg),
      'gte2d', jsonb_build_object('count', gte2d_count, 'avgSeconds', gte2d_avg)
    )
    from sentiment where sentiment = 'satisfied'
  ), jsonb_build_object(
    'lt30m', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt1h', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt1d', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt2d', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'gte2d', jsonb_build_object('count', 0, 'avgSeconds', 0)
  )),
  'neutral',
  coalesce((
    select jsonb_build_object(
      'lt30m', jsonb_build_object('count', lt30m_count, 'avgSeconds', lt30m_avg),
      'lt1h', jsonb_build_object('count', lt1h_count, 'avgSeconds', lt1h_avg),
      'lt1d', jsonb_build_object('count', lt1d_count, 'avgSeconds', lt1d_avg),
      'lt2d', jsonb_build_object('count', lt2d_count, 'avgSeconds', lt2d_avg),
      'gte2d', jsonb_build_object('count', gte2d_count, 'avgSeconds', gte2d_avg)
    )
    from sentiment where sentiment = 'neutral'
  ), jsonb_build_object(
    'lt30m', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt1h', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt1d', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt2d', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'gte2d', jsonb_build_object('count', 0, 'avgSeconds', 0)
  )),
  'angry',
  coalesce((
    select jsonb_build_object(
      'lt30m', jsonb_build_object('count', lt30m_count, 'avgSeconds', lt30m_avg),
      'lt1h', jsonb_build_object('count', lt1h_count, 'avgSeconds', lt1h_avg),
      'lt1d', jsonb_build_object('count', lt1d_count, 'avgSeconds', lt1d_avg),
      'lt2d', jsonb_build_object('count', lt2d_count, 'avgSeconds', lt2d_avg),
      'gte2d', jsonb_build_object('count', gte2d_count, 'avgSeconds', gte2d_avg)
    )
    from sentiment where sentiment = 'angry'
  ), jsonb_build_object(
    'lt30m', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt1h', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt1d', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt2d', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'gte2d', jsonb_build_object('count', 0, 'avgSeconds', 0)
  ))
)
from overall;
$$;

revoke all on function public.analytics_duration_bucket_summary(date, date) from public;
grant execute on function public.analytics_duration_bucket_summary(date, date) to authenticated;
