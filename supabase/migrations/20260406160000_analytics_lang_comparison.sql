-- Compares key metrics side-by-side across all languages detected in the period.
--
-- Language is derived from each visitor's most-used session lang during the period.
-- AI metrics (satisfaction, sentiment) use the latest analysis per visitor with no date
-- restriction — matching the pattern used by analytics_booker_profile.
--
-- p_start / p_end filter chat_sessions.created_at and visitor_forms.submitted_at.
create or replace function public.analytics_lang_comparison(
  p_start date default null,
  p_end   date default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
with
  -- sessions in range
  sessions_in_range as (
    select
      visitor_id,
      id as session_id,
      coalesce(lang, 'unknown') as lang
    from public.chat_sessions
    where (p_start is null or created_at >= p_start::timestamptz)
      and (p_end   is null or created_at <  (p_end + interval '1 day')::timestamptz)
  ),

  -- visitor → primary lang (most sessions wins; tie-breaks by lang alphabetically)
  visitor_lang_counts as (
    select visitor_id, lang, count(*) as n
    from sessions_in_range
    group by visitor_id, lang
  ),

  visitor_primary_lang as (
    select distinct on (visitor_id)
      visitor_id, lang
    from visitor_lang_counts
    order by visitor_id, n desc, lang
  ),

  -- visitor counts per lang
  lang_visitors as (
    select lang, count(*)::int as visitor_count
    from visitor_primary_lang
    group by lang
  ),

  -- session counts per lang
  lang_sessions as (
    select lang, count(*)::int as session_count
    from sessions_in_range
    group by lang
  ),

  -- latest AI analysis per visitor (no date restriction)
  latest_analyses as (
    select distinct on (visitor_id)
      visitor_id, sentiment, satisfaction_1_to_10
    from public.chat_visitor_analyses
    order by visitor_id, created_at desc
  ),

  -- satisfaction + sentiment breakdown per lang
  lang_ai as (
    select
      vpl.lang,
      count(*)::int                                                          as analyzed_count,
      coalesce(round(avg(la.satisfaction_1_to_10)::numeric, 2), 0)::float   as avg_satisfaction,
      count(*) filter (where la.sentiment = 'satisfied')::int                as satisfied,
      count(*) filter (where la.sentiment = 'neutral')::int                  as neutral,
      count(*) filter (where la.sentiment = 'angry')::int                    as angry
    from visitor_primary_lang vpl
    join latest_analyses la on la.visitor_id = vpl.visitor_id
    group by vpl.lang
  ),

  -- tour booking form submissions per lang (date-filtered)
  lang_forms as (
    select
      vpl.lang,
      count(*) filter (where vf.is_submitted = true)::int as form_submissions
    from visitor_primary_lang vpl
    join public.visitor_forms vf
      on  vf.visitor_id = vpl.visitor_id
      and vf.form_type  = 'chat_bot_book_a_tour'
      and (p_start is null or vf.submitted_at >= p_start::timestamptz)
      and (p_end   is null or vf.submitted_at <  (p_end + interval '1 day')::timestamptz)
    group by vpl.lang
  ),

  -- union of all langs seen
  all_langs as (
    select lang from lang_visitors
    union
    select lang from lang_sessions
  ),

  -- assemble per-lang row
  lang_rows as (
    select
      al.lang,
      coalesce(lv.visitor_count,   0) as visitor_count,
      coalesce(ls.session_count,   0) as session_count,
      coalesce(lai.analyzed_count, 0) as analyzed_count,
      coalesce(lai.avg_satisfaction, 0)::float as avg_satisfaction,
      coalesce(lai.satisfied, 0)      as satisfied,
      coalesce(lai.neutral,   0)      as neutral,
      coalesce(lai.angry,     0)      as angry,
      coalesce(lf.form_submissions, 0) as form_submissions
    from all_langs al
    left join lang_visitors lv  on lv.lang  = al.lang
    left join lang_sessions  ls  on ls.lang  = al.lang
    left join lang_ai         lai on lai.lang = al.lang
    left join lang_forms      lf  on lf.lang  = al.lang
  )

select coalesce(
  jsonb_agg(
    jsonb_build_object(
      'lang',             lang,
      'visitor_count',    visitor_count,
      'session_count',    session_count,
      'analyzed_count',   analyzed_count,
      'avg_satisfaction', avg_satisfaction,
      'satisfied',        satisfied,
      'neutral',          neutral,
      'angry',            angry,
      'form_submissions', form_submissions
    )
    order by visitor_count desc
  ),
  '[]'::jsonb
)
from lang_rows;
$$;

revoke all on function public.analytics_lang_comparison(date, date) from public;
grant execute on function public.analytics_lang_comparison(date, date) to authenticated;
