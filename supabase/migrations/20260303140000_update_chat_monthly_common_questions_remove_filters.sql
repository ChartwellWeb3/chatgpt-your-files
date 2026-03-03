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
  answer_example text,
  freq bigint
)
language sql
security definer
set search_path = public
as $$
  with filtered as (
    select
      um.content as user_content,
      um.created_at,
      s.page_url,
      s.residence_custom_id,
      s.lang,
      am.content as assistant_content
    from public.chat_messages um
    join public.chat_sessions s on s.id = um.session_id
    left join lateral (
      select m2.content
      from public.chat_messages m2
      where m2.session_id = um.session_id
        and m2.created_at > um.created_at
        and m2.role = 'assistant'
      order by m2.created_at asc
      limit 1
    ) am on true
    where um.role = 'user'
      and um.created_at >= p_start
      and um.created_at < (p_end + interval '1 day')
      and lower(coalesce(s.lang, '')) = lower(p_lang)
  ),
  normalized as (
    select
      case
        when lower(coalesce(residence_custom_id, '')) in ('corporateen','corporatefr')
          then 'corporate'
        when nullif(residence_custom_id, '') is not null
          then 'residence'
        else 'unknown'
      end as page_type,
      lower(coalesce(lang, 'unknown')) as lang,
      trim(
        regexp_replace(
          regexp_replace(
            lower(unaccent(coalesce(user_content, ''))),
            '[^a-z0-9\s]+',
            ' ',
            'g'
          ),
          '\s+',
          ' ',
          'g'
        )
      ) as question,
      left(coalesce(user_content, ''), 240) as example,
      left(coalesce(assistant_content, ''), 240) as answer_example
    from filtered
  ),
  ranked as (
    select
      page_type,
      lang,
      question,
      min(example) as example,
      min(answer_example) as answer_example,
      count(*)::bigint as freq,
      row_number() over (
        partition by page_type, lang
        order by count(*) desc
      ) as rn
    from normalized
    group by page_type, lang, question
  )
  select page_type, lang, question, example, answer_example, freq
  from ranked
  where rn <= greatest(1, least(p_limit, 500))
  order by page_type, lang, freq desc;
$$;

revoke all on function public.chat_monthly_common_questions(date, date, text, int) from public;
grant execute on function public.chat_monthly_common_questions(date, date, text, int) to authenticated, service_role;
