-- Returns assistant messages that contain a phone number or contact detail,
-- paired with the preceding user question and an extracted contact snippet.
create or replace function public.analytics_contact_mentions(
  p_start date default null,
  p_end date default null,
  p_limit int default 200
)
returns table (
  assistant_message_id bigint,
  session_id uuid,
  visitor_id uuid,
  created_at timestamptz,
  user_question text,
  bot_answer text,
  contact_snippet text
)
language sql
security definer
set search_path = public
as $$
  with assistant_msgs as (
    select
      m.id,
      m.session_id,
      m.visitor_id,
      m.content,
      m.created_at
    from public.chat_messages m
    where m.role = 'assistant'
      -- North-American phone: (514) 555-1234 / 514-555-1234 / 514.555.1234
      and (
        m.content ~ '\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4}'
        -- International with + prefix: +1 514 555 1234, +33 6 12 34 56 78
        or m.content ~ '\+\d[\d\s\-\.]{8,15}\d'
      )
      and (p_start is null or m.created_at >= p_start::timestamptz)
      and (p_end   is null or m.created_at <  (p_end + interval '1 day')::timestamptz)
  ),
  with_context as (
    select
      a.id           as assistant_message_id,
      a.session_id,
      a.visitor_id,
      a.created_at,
      coalesce(
        (
          select u.content
          from public.chat_messages u
          where u.session_id  = a.session_id
            and u.role        = 'user'
            and u.created_at  < a.created_at
          order by u.created_at desc
          limit 1
        ),
        ''
      ) as user_question,
      a.content as bot_answer
    from assistant_msgs a
  )
  select
    q.assistant_message_id,
    q.session_id,
    q.visitor_id,
    q.created_at,
    q.user_question,
    q.bot_answer,
    coalesce(
      -- Try North-American format first
      (regexp_match(q.bot_answer, '\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4}'))[1],
      -- Fall back to international +prefix
      (regexp_match(q.bot_answer, '\+\d[\d\s\-\.]{8,15}\d'))[1],
      ''
    ) as contact_snippet
  from with_context q
  order by q.created_at desc
  limit greatest(1, least(p_limit, 1000));
$$;

revoke all on function public.analytics_contact_mentions(date, date, int) from public;
grant execute on function public.analytics_contact_mentions(date, date, int) to authenticated;
