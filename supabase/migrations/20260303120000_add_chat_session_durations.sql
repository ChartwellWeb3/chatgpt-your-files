create table if not exists public.chat_session_durations (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  visitor_id uuid not null references public.visitors(id) on delete cascade,
  first_message_at timestamptz not null,
  last_message_at timestamptz not null,
  duration_seconds int not null check (duration_seconds >= 0),
  source text not null check (source in ('auto', 'manual')),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_session_durations_session_created
  on public.chat_session_durations (session_id, created_at desc);

create index if not exists idx_chat_session_durations_visitor_created
  on public.chat_session_durations (visitor_id, created_at desc);

create index if not exists idx_chat_session_durations_last_message
  on public.chat_session_durations (last_message_at desc);

create unique index if not exists uq_chat_session_durations_snapshot_per_source
  on public.chat_session_durations (session_id, last_message_at, source);

alter table public.chat_session_durations enable row level security;

create policy "auth_select_chat_session_durations"
  on public.chat_session_durations
  for select
  to authenticated
  using (true);

create policy "admin_insert_chat_session_durations"
  on public.chat_session_durations
  for insert
  to authenticated
  with check (public.is_admin());

grant select, insert on table public.chat_session_durations to authenticated, service_role;

create or replace function public.chat_sessions_needing_duration(
  p_cutoff_days int,
  p_limit int,
  p_force boolean default false,
  p_min_days_since int default 0
)
returns table (
  session_id uuid,
  visitor_id uuid,
  first_message_at timestamptz,
  last_message_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with msg_bounds as (
    select
      session_id,
      min(created_at) as first_message_at,
      max(created_at) as last_message_at,
      min(visitor_id::text)::uuid as visitor_id
    from public.chat_messages
    group by session_id
  ),
  last_duration as (
    select session_id, max(created_at) as last_duration_at
    from public.chat_session_durations
    where source = 'auto'
    group by session_id
  )
  select mb.session_id, mb.visitor_id, mb.first_message_at, mb.last_message_at
  from msg_bounds mb
  left join last_duration ld on ld.session_id = mb.session_id
  where mb.last_message_at < now() - (p_cutoff_days || ' days')::interval
    and (
      p_force
      or not exists (
        select 1
        from public.chat_session_durations d
        where d.session_id = mb.session_id
          and d.last_message_at = mb.last_message_at
          and d.source = 'auto'
      )
    )
    and (
      p_min_days_since <= 0
      or ld.last_duration_at is null
      or ld.last_duration_at < now() - (p_min_days_since || ' days')::interval
    )
  order by mb.last_message_at asc
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.chat_sessions_needing_duration(int, int, boolean, int) from public;
grant execute on function public.chat_sessions_needing_duration(int, int, boolean, int)
  to authenticated, service_role;

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
    select distinct on (session_id)
      session_id,
      visitor_id,
      duration_seconds,
      last_message_at,
      created_at
    from public.chat_session_durations
    where source = 'auto'
    order by session_id, created_at desc
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
    select distinct on (session_id)
      session_id,
      visitor_id,
      duration_seconds,
      last_message_at,
      created_at
    from public.chat_session_durations
    where source = 'auto'
    order by session_id, created_at desc
  ),
  joined as (
    select
      d.session_id,
      d.visitor_id,
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
    select distinct on (session_id)
      session_id,
      visitor_id,
      duration_seconds,
      last_message_at,
      created_at
    from public.chat_session_durations
    where source = 'auto'
    order by session_id, created_at desc
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
      count(*) filter (where duration_seconds < 60)::int as lt1m_count,
      coalesce(avg(duration_seconds) filter (where duration_seconds < 60), 0)::float as lt1m_avg,
      count(*) filter (where duration_seconds >= 60 and duration_seconds < 600)::int as lt10m_count,
      coalesce(avg(duration_seconds) filter (where duration_seconds >= 60 and duration_seconds < 600), 0)::float as lt10m_avg,
      count(*) filter (where duration_seconds >= 600 and duration_seconds < 1800)::int as lt30m_count,
      coalesce(avg(duration_seconds) filter (where duration_seconds >= 600 and duration_seconds < 1800), 0)::float as lt30m_avg,
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
      count(*) filter (where duration_seconds < 60)::int as lt1m_count,
      coalesce(avg(duration_seconds) filter (where duration_seconds < 60), 0)::float as lt1m_avg,
      count(*) filter (where duration_seconds >= 60 and duration_seconds < 600)::int as lt10m_count,
      coalesce(avg(duration_seconds) filter (where duration_seconds >= 60 and duration_seconds < 600), 0)::float as lt10m_avg,
      count(*) filter (where duration_seconds >= 600 and duration_seconds < 1800)::int as lt30m_count,
      coalesce(avg(duration_seconds) filter (where duration_seconds >= 600 and duration_seconds < 1800), 0)::float as lt30m_avg,
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
    'lt1m', jsonb_build_object('count', lt1m_count, 'avgSeconds', lt1m_avg),
    'lt10m', jsonb_build_object('count', lt10m_count, 'avgSeconds', lt10m_avg),
    'lt30m', jsonb_build_object('count', lt30m_count, 'avgSeconds', lt30m_avg),
    'lt1h', jsonb_build_object('count', lt1h_count, 'avgSeconds', lt1h_avg),
    'lt1d', jsonb_build_object('count', lt1d_count, 'avgSeconds', lt1d_avg),
    'lt2d', jsonb_build_object('count', lt2d_count, 'avgSeconds', lt2d_avg),
    'gte2d', jsonb_build_object('count', gte2d_count, 'avgSeconds', gte2d_avg)
  ),
  'satisfied',
  coalesce((
    select jsonb_build_object(
      'lt1m', jsonb_build_object('count', lt1m_count, 'avgSeconds', lt1m_avg),
      'lt10m', jsonb_build_object('count', lt10m_count, 'avgSeconds', lt10m_avg),
      'lt30m', jsonb_build_object('count', lt30m_count, 'avgSeconds', lt30m_avg),
      'lt1h', jsonb_build_object('count', lt1h_count, 'avgSeconds', lt1h_avg),
      'lt1d', jsonb_build_object('count', lt1d_count, 'avgSeconds', lt1d_avg),
      'lt2d', jsonb_build_object('count', lt2d_count, 'avgSeconds', lt2d_avg),
      'gte2d', jsonb_build_object('count', gte2d_count, 'avgSeconds', gte2d_avg)
    )
    from sentiment where sentiment = 'satisfied'
  ), jsonb_build_object(
    'lt1m', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt10m', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt30m', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt1h', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt1d', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt2d', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'gte2d', jsonb_build_object('count', 0, 'avgSeconds', 0)
  )),
  'neutral',
  coalesce((
    select jsonb_build_object(
      'lt1m', jsonb_build_object('count', lt1m_count, 'avgSeconds', lt1m_avg),
      'lt10m', jsonb_build_object('count', lt10m_count, 'avgSeconds', lt10m_avg),
      'lt30m', jsonb_build_object('count', lt30m_count, 'avgSeconds', lt30m_avg),
      'lt1h', jsonb_build_object('count', lt1h_count, 'avgSeconds', lt1h_avg),
      'lt1d', jsonb_build_object('count', lt1d_count, 'avgSeconds', lt1d_avg),
      'lt2d', jsonb_build_object('count', lt2d_count, 'avgSeconds', lt2d_avg),
      'gte2d', jsonb_build_object('count', gte2d_count, 'avgSeconds', gte2d_avg)
    )
    from sentiment where sentiment = 'neutral'
  ), jsonb_build_object(
    'lt1m', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt10m', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt30m', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt1h', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt1d', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt2d', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'gte2d', jsonb_build_object('count', 0, 'avgSeconds', 0)
  )),
  'angry',
  coalesce((
    select jsonb_build_object(
      'lt1m', jsonb_build_object('count', lt1m_count, 'avgSeconds', lt1m_avg),
      'lt10m', jsonb_build_object('count', lt10m_count, 'avgSeconds', lt10m_avg),
      'lt30m', jsonb_build_object('count', lt30m_count, 'avgSeconds', lt30m_avg),
      'lt1h', jsonb_build_object('count', lt1h_count, 'avgSeconds', lt1h_avg),
      'lt1d', jsonb_build_object('count', lt1d_count, 'avgSeconds', lt1d_avg),
      'lt2d', jsonb_build_object('count', lt2d_count, 'avgSeconds', lt2d_avg),
      'gte2d', jsonb_build_object('count', gte2d_count, 'avgSeconds', gte2d_avg)
    )
    from sentiment where sentiment = 'angry'
  ), jsonb_build_object(
    'lt1m', jsonb_build_object('count', 0, 'avgSeconds', 0),
    'lt10m', jsonb_build_object('count', 0, 'avgSeconds', 0),
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
