create or replace function public.chat_monthly_common_questions(
  p_start date,
  p_end date,
  p_lang text,
  p_limit int default 200
)
returns table (
  page_type text,
  lang text,
  question text,
  example text,
  freq bigint
)
language sql
security definer
set search_path = public
as $$
  with filtered as (
    select
      m.content,
      s.page_url,
      s.residence_custom_id,
      s.lang
    from public.chat_messages m
    join public.chat_sessions s on s.id = m.session_id
    where m.role = 'user'
      and m.created_at >= p_start
      and m.created_at < (p_end + interval '1 day')
      and lower(coalesce(s.lang, '')) = lower(p_lang)
  ),
  normalized as (
    select
      case
        when lower(coalesce(residence_custom_id, '')) in ('corporateen','corporatefr')
          then 'corporate'
        when page_url ilike '%/find-a-residence%'
          then 'find_a_residence'
        when nullif(residence_custom_id, '') is not null
          then 'residence'
        else 'unknown'
      end as page_type,
      lower(coalesce(lang, 'unknown')) as lang,
      trim(
        regexp_replace(
          regexp_replace(
            lower(unaccent(coalesce(content, ''))),
            '[^a-z0-9\s]+',
            ' ',
            'g'
          ),
          '\s+',
          ' ',
          'g'
        )
      ) as question,
      left(coalesce(content, ''), 240) as example
    from filtered
  ),
  ranked as (
    select
      page_type,
      lang,
      question,
      min(example) as example,
      count(*)::bigint as freq,
      row_number() over (
        partition by page_type, lang
        order by count(*) desc
      ) as rn
    from normalized
    where length(question) > 2
    group by page_type, lang, question
  )
  select page_type, lang, question, example, freq
  from ranked
  where rn <= greatest(1, least(p_limit, 500))
  order by page_type, lang, freq desc;
$$;

revoke all on function public.chat_monthly_common_questions(date, date, text, int) from public;
grant execute on function public.chat_monthly_common_questions(date, date, text, int) to authenticated, service_role;
