-- Remove page_type_split from analytics_booker_profile (no longer needed in UI).
create or replace function public.analytics_booker_profile(
  p_start date default null,
  p_end date default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
with
  -- distinct visitor_ids who submitted a tour booking form in the period
  bookers as (
    select distinct visitor_id
    from public.visitor_forms
    where is_submitted = true
      and form_type = 'chat_bot_book_a_tour'
      and (p_start is null or submitted_at >= p_start::timestamptz)
      and (p_end   is null or submitted_at <  (p_end + interval '1 day')::timestamptz)
  ),

  -- latest analysis per booker (no date restriction — we want their profile)
  booker_analyses as (
    select distinct on (a.visitor_id)
      a.visitor_id,
      a.sentiment,
      a.satisfaction_1_to_10,
      a.intent_primary
    from public.chat_visitor_analyses a
    join bookers b on b.visitor_id = a.visitor_id
    order by a.visitor_id, a.created_at desc
  ),

  -- total bookers with an analysis
  booker_count as (
    select count(*)::int as n from booker_analyses
  ),

  -- sentiment + avg satisfaction for bookers
  booker_sentiment as (
    select
      count(*) filter (where sentiment = 'satisfied')::int                       as satisfied,
      count(*) filter (where sentiment = 'neutral')::int                         as neutral,
      count(*) filter (where sentiment = 'angry')::int                           as angry,
      count(*) filter (where sentiment not in ('satisfied','neutral','angry')
                       or sentiment is null)::int                                 as unknown,
      coalesce(round(avg(satisfaction_1_to_10)::numeric, 2), 0)::float           as avg_score
    from booker_analyses
  ),

  -- all-visitor avg satisfaction for the same period (latest analysis per visitor)
  all_avg as (
    select coalesce(round(avg(satisfaction_1_to_10)::numeric, 2), 0)::float as avg_score
    from (
      select distinct on (visitor_id)
        visitor_id, satisfaction_1_to_10, last_message_at
      from public.chat_visitor_analyses
      order by visitor_id, created_at desc
    ) latest
    where (p_start is null or latest.last_message_at >= p_start::timestamptz)
      and (p_end   is null or latest.last_message_at <  (p_end + interval '1 day')::timestamptz)
  ),

  -- intent_primary breakdown for bookers (ranked)
  booker_intents as (
    select
      intent_primary                                                                  as intent,
      count(*)::int                                                                   as cnt,
      (count(*)::float / nullif((select n from booker_count), 0) * 100)::float       as pct
    from booker_analyses
    where intent_primary is not null
    group by intent_primary
    order by cnt desc
  ),

  -- language split: most-recent session lang per booker
  booker_langs as (
    select
      count(*) filter (where lang like 'en%')::int as en,
      count(*) filter (where lang like 'fr%')::int as fr
    from (
      select distinct on (s.visitor_id) s.visitor_id, coalesce(s.lang, '') as lang
      from public.chat_sessions s
      join bookers b on b.visitor_id = s.visitor_id
      order by s.visitor_id, s.created_at desc
    ) latest_session
  )

select jsonb_build_object(
  'total_bookers',              (select n from booker_count),
  'avg_satisfaction_bookers',   (select avg_score from booker_sentiment),
  'avg_satisfaction_all',       (select avg_score from all_avg),
  'sentiment', jsonb_build_object(
    'satisfied', (select satisfied from booker_sentiment),
    'neutral',   (select neutral   from booker_sentiment),
    'angry',     (select angry     from booker_sentiment),
    'unknown',   (select unknown   from booker_sentiment)
  ),
  'top_intents', (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('intent', intent, 'count', cnt, 'pct', round(pct::numeric, 1))
        order by cnt desc
      ),
      '[]'::jsonb
    )
    from booker_intents
  ),
  'lang_split', jsonb_build_object(
    'en', (select en from booker_langs),
    'fr', (select fr from booker_langs)
  )
);
$$;

revoke all on function public.analytics_booker_profile(date, date) from public;
grant execute on function public.analytics_booker_profile(date, date) to authenticated;
