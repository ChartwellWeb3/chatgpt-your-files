create or replace function public.analytics_visitors_filtered(
  p_filter text,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  created_at timestamptz,
  total_count bigint
)
language sql
security definer
set search_path = public
as $$
  with base as (
    select v.id, v.created_at
    from visitors v
    where (p_start_date is null or v.created_at >= p_start_date)
      and (p_end_date is null or v.created_at <= p_end_date)
  ),
  submitted as (
    select distinct vf.visitor_id
    from visitor_forms vf
    where vf.form_type = 'chat_bot_book_a_tour'
      and vf.is_submitted is true
      and (p_start_date is null or vf.submitted_at >= p_start_date)
      and (p_end_date is null or vf.submitted_at <= p_end_date)
  ),
  requested as (
    select distinct cr.visitor_id
    from chat_review_requests cr
    where cr.status = 'pending'
  ),
  reviewed as (
    select distinct cr.visitor_id
    from chat_review_requests cr
    where cr.status = 'reviewed'
  ),
  latest_analysis as (
    select distinct on (a.visitor_id) a.visitor_id, a.sentiment
    from chat_visitor_analyses a
    order by a.visitor_id, a.created_at desc
  ),
  filtered as (
    select b.id, b.created_at
    from base b
    left join submitted s on s.visitor_id = b.id
    left join requested r on r.visitor_id = b.id
    left join reviewed rv on rv.visitor_id = b.id
    left join latest_analysis la on la.visitor_id = b.id
    where case
      when p_filter = 'submitted' then s.visitor_id is not null
      when p_filter = 'not_submitted' then s.visitor_id is null
      when p_filter = 'requested' then r.visitor_id is not null
      when p_filter = 'reviewed' then rv.visitor_id is not null
      when p_filter = 'ai_satisfied' then la.sentiment = 'satisfied'
      when p_filter = 'ai_neutral' then la.sentiment = 'neutral'
      when p_filter = 'ai_angry' then la.sentiment = 'angry'
      else true
    end
  )
  select f.id, f.created_at, count(*) over () as total_count
  from filtered f
  order by f.created_at desc
  limit p_limit offset p_offset;
$$;

revoke all on function public.analytics_visitors_filtered(
  text,
  timestamptz,
  timestamptz,
  integer,
  integer
) from public;

grant execute on function public.analytics_visitors_filtered(
  text,
  timestamptz,
  timestamptz,
  integer,
  integer
) to authenticated;
