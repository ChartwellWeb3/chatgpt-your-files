-- Returns key metrics for two full calendar months for side-by-side comparison.
-- p_month_a / p_month_b: any date within the target month, e.g. '2026-02-01'
create or replace function public.analytics_monthly_comparison(
  p_month_a date,
  p_month_b date
)
returns jsonb
language sql
security definer
set search_path = public
as $$
with
  -- resolve month boundaries
  bounds as (
    select
      date_trunc('month', p_month_a)::date                                        as a_start,
      (date_trunc('month', p_month_a) + interval '1 month' - interval '1 day')::date as a_end,
      date_trunc('month', p_month_b)::date                                        as b_start,
      (date_trunc('month', p_month_b) + interval '1 month' - interval '1 day')::date as b_end
  ),

  -- ── month A ──────────────────────────────────────────────────────────────
  a_visitors as (
    select count(*)::int as n
    from public.visitors v, bounds b
    where v.created_at >= b.a_start and v.created_at < b.a_end + interval '1 day'
  ),
  a_sessions as (
    select count(*)::int as n
    from public.chat_sessions s, bounds b
    where s.created_at >= b.a_start and s.created_at < b.a_end + interval '1 day'
  ),
  a_forms as (
    select
      count(*)::int as total,
      count(*) filter (where is_submitted = true and submitted_at >= b.a_start
                       and submitted_at < b.a_end + interval '1 day')::int as submitted
    from public.visitor_forms f, bounds b
    where f.created_at >= b.a_start and f.created_at < b.a_end + interval '1 day'
  ),
  a_corp as (
    select
      count(*) filter (where lower(coalesce(residence_custom_id,'')) in ('corporateen','corporatefr'))::int as corporate,
      count(*) filter (where lower(coalesce(residence_custom_id,'')) not in ('corporateen','corporatefr'))::int as residence
    from public.chat_sessions s, bounds b
    where s.created_at >= b.a_start and s.created_at < b.a_end + interval '1 day'
  ),
  a_multi_msg as (
    select count(*)::int as n
    from (
      select v.id
      from public.visitors v
      join public.chat_sessions s on s.visitor_id = v.id
      join public.chat_messages cm on cm.session_id = s.id, bounds b
      where v.created_at >= b.a_start and v.created_at < b.a_end + interval '1 day'
        and cm.role = 'user'
      group by v.id
      having count(cm.id) >= 2
    ) sub
  ),
  a_ai as (
    select
      count(*) filter (where sentiment = 'satisfied')::int as satisfied,
      count(*) filter (where sentiment = 'neutral')::int   as neutral,
      count(*) filter (where sentiment = 'angry')::int     as angry,
      coalesce(avg(satisfaction_1_to_10), 0)::float        as avg_score,
      count(*)::int                                        as total
    from (
      select distinct on (visitor_id)
        visitor_id, sentiment, satisfaction_1_to_10, last_message_at
      from public.chat_visitor_analyses
      order by visitor_id, created_at desc
    ) latest, bounds b
    where latest.last_message_at >= b.a_start
      and latest.last_message_at < b.a_end + interval '1 day'
  ),

  -- ── month B ──────────────────────────────────────────────────────────────
  b_visitors as (
    select count(*)::int as n
    from public.visitors v, bounds b
    where v.created_at >= b.b_start and v.created_at < b.b_end + interval '1 day'
  ),
  b_sessions as (
    select count(*)::int as n
    from public.chat_sessions s, bounds b
    where s.created_at >= b.b_start and s.created_at < b.b_end + interval '1 day'
  ),
  b_forms as (
    select
      count(*)::int as total,
      count(*) filter (where is_submitted = true and submitted_at >= b.b_start
                       and submitted_at < b.b_end + interval '1 day')::int as submitted
    from public.visitor_forms f, bounds b
    where f.created_at >= b.b_start and f.created_at < b.b_end + interval '1 day'
  ),
  b_corp as (
    select
      count(*) filter (where lower(coalesce(residence_custom_id,'')) in ('corporateen','corporatefr'))::int as corporate,
      count(*) filter (where lower(coalesce(residence_custom_id,'')) not in ('corporateen','corporatefr'))::int as residence
    from public.chat_sessions s, bounds b
    where s.created_at >= b.b_start and s.created_at < b.b_end + interval '1 day'
  ),
  b_multi_msg as (
    select count(*)::int as n
    from (
      select v.id
      from public.visitors v
      join public.chat_sessions s on s.visitor_id = v.id
      join public.chat_messages cm on cm.session_id = s.id, bounds b
      where v.created_at >= b.b_start and v.created_at < b.b_end + interval '1 day'
        and cm.role = 'user'
      group by v.id
      having count(cm.id) >= 2
    ) sub
  ),
  b_ai as (
    select
      count(*) filter (where sentiment = 'satisfied')::int as satisfied,
      count(*) filter (where sentiment = 'neutral')::int   as neutral,
      count(*) filter (where sentiment = 'angry')::int     as angry,
      coalesce(avg(satisfaction_1_to_10), 0)::float        as avg_score,
      count(*)::int                                        as total
    from (
      select distinct on (visitor_id)
        visitor_id, sentiment, satisfaction_1_to_10, last_message_at
      from public.chat_visitor_analyses
      order by visitor_id, created_at desc
    ) latest, bounds b
    where latest.last_message_at >= b.b_start
      and latest.last_message_at < b.b_end + interval '1 day'
  )

select jsonb_build_object(
  'monthA', jsonb_build_object(
    'visitors',            (select n from a_visitors),
    'sessions',            (select n from a_sessions),
    'totalForms',          (select total from a_forms),
    'submittedForms',      (select submitted from a_forms),
    'corporateSessions',   (select corporate from a_corp),
    'residenceSessions',   (select residence from a_corp),
    'multiMessageVisitors',(select n from a_multi_msg),
    'aiSatisfied',         (select satisfied from a_ai),
    'aiNeutral',           (select neutral from a_ai),
    'aiAngry',             (select angry from a_ai),
    'aiAvgScore',          (select avg_score from a_ai),
    'aiTotal',             (select total from a_ai)
  ),
  'monthB', jsonb_build_object(
    'visitors',            (select n from b_visitors),
    'sessions',            (select n from b_sessions),
    'totalForms',          (select total from b_forms),
    'submittedForms',      (select submitted from b_forms),
    'corporateSessions',   (select corporate from b_corp),
    'residenceSessions',   (select residence from b_corp),
    'multiMessageVisitors',(select n from b_multi_msg),
    'aiSatisfied',         (select satisfied from b_ai),
    'aiNeutral',           (select neutral from b_ai),
    'aiAngry',             (select angry from b_ai),
    'aiAvgScore',          (select avg_score from b_ai),
    'aiTotal',             (select total from b_ai)
  )
);
$$;

revoke all on function public.analytics_monthly_comparison(date, date) from public;
grant execute on function public.analytics_monthly_comparison(date, date) to authenticated;
