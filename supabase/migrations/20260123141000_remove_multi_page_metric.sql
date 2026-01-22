create or replace function public.analytics_overview_summary(
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
  visitors_count as (
    select count(*)::int as visitors
    from public.visitors v, params p
    where (p.start_date is null or v.created_at >= p.start_date)
      and (p.end_date is null or v.created_at < (p.end_date + interval '1 day'))
  ),
  sessions_count as (
    select count(*)::int as sessions
    from public.chat_sessions s, params p
    where (p.start_date is null or s.created_at >= p.start_date)
      and (p.end_date is null or s.created_at < (p.end_date + interval '1 day'))
  ),
  total_forms as (
    select count(*)::int as total_forms
    from public.visitor_forms f, params p
    where (p.start_date is null or f.created_at >= p.start_date)
      and (p.end_date is null or f.created_at < (p.end_date + interval '1 day'))
  ),
  submitted_forms as (
    select count(*)::int as submitted_forms
    from public.visitor_forms f, params p
    where f.is_submitted = true
      and (p.start_date is null or f.submitted_at >= p.start_date)
      and (p.end_date is null or f.submitted_at < (p.end_date + interval '1 day'))
  ),
  filtered_sessions as (
    select s.*
    from public.chat_sessions s, params p
    where (p.start_date is null or s.created_at >= p.start_date)
      and (p.end_date is null or s.created_at < (p.end_date + interval '1 day'))
  ),
  corporate_split as (
    select
      sum(
        case
          when lower(coalesce(residence_custom_id, '')) in ('corporateen','corporatefr')
          then 1 else 0
        end
      )::int as corporate_sessions,
      sum(
        case
          when lower(coalesce(residence_custom_id, '')) in ('corporateen','corporatefr')
          then 0 else 1
        end
      )::int as residence_sessions
    from filtered_sessions
  ),
  multi_message_visitors as (
    select count(*)::int as visitors
    from (
      select m.visitor_id
      from public.chat_messages m, params p
      where m.role = 'user'
        and (p.start_date is null or m.created_at >= p.start_date)
        and (p.end_date is null or m.created_at < (p.end_date + interval '1 day'))
      group by m.visitor_id
      having count(*) > 1
    ) t
  ),
  multi_session_message_visitors as (
    select count(*)::int as visitors
    from (
      select m.visitor_id
      from public.chat_messages m, params p
      where m.role = 'user'
        and (p.start_date is null or m.created_at >= p.start_date)
        and (p.end_date is null or m.created_at < (p.end_date + interval '1 day'))
      group by m.visitor_id
      having count(distinct m.session_id) > 1
    ) t
  ),
  top_pages as (
    select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', value)), '[]'::jsonb) as items
    from (
      select
        coalesce(page_url, 'Unknown') as label,
        count(*)::int as value
      from filtered_sessions
      group by 1
      order by value desc
      limit 5
    ) t
  ),
  top_residences as (
    select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', value)), '[]'::jsonb) as items
    from (
      select
        coalesce(r.name, nullif(s.residence_custom_id, ''), 'common') as label,
        count(*)::int as value
      from filtered_sessions s
      left join public.residences r
        on r.custom_id = s.residence_custom_id
      group by 1
      order by value desc
      limit 5
    ) t
  ),
  top_langs as (
    select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', value)), '[]'::jsonb) as items
    from (
      select
        coalesce(lang, 'Unknown') as label,
        count(*)::int as value
      from filtered_sessions
      group by 1
      order by value desc
      limit 5
    ) t
  )
select jsonb_build_object(
  'visitors', (select visitors from visitors_count),
  'sessions', (select sessions from sessions_count),
  'totalForms', (select total_forms from total_forms),
  'submittedForms', (select submitted_forms from submitted_forms),
  'corporateSessions', (select corporate_sessions from corporate_split),
  'residenceSessions', (select residence_sessions from corporate_split),
  'multiMessageVisitors', (select visitors from multi_message_visitors),
  'multiSessionMessageVisitors', (select visitors from multi_session_message_visitors),
  'topPages', (select items from top_pages),
  'topResidences', (select items from top_residences),
  'topLangs', (select items from top_langs)
);
$$;

revoke all on function public.analytics_overview_summary(date, date) from public;
grant execute on function public.analytics_overview_summary(date, date) to authenticated;
