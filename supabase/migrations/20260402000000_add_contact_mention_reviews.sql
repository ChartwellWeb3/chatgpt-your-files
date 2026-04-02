-- ─────────────────────────────────────────────────────────────────────────────
-- contact_mention_reviews
-- Tracks triage status for each Contact / Phone Mention entry.
-- Statuses:
--   reviewed              – acknowledged; hidden from the default "Pending" view
--   extract_step_required – further manual action needed
--   resolved              – action completed; optional comment stored
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.contact_mention_reviews (
  id                   bigint      generated always as identity primary key,
  assistant_message_id bigint      not null,
  status               text        not null
                                   check (status in ('reviewed', 'extract_step_required', 'resolved')),
  comment              text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid        references auth.users(id),
  constraint contact_mention_reviews_message_id_unique unique (assistant_message_id)
);

alter table public.contact_mention_reviews enable row level security;

create policy "authenticated users can manage contact mention reviews"
  on public.contact_mention_reviews
  for all
  to authenticated
  using (true)
  with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- upsert_contact_mention_review
-- Insert or update the review record for a single assistant message.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.upsert_contact_mention_review(
  p_message_id bigint,
  p_status     text,        -- 'reviewed' | 'extract_step_required' | 'resolved'
  p_comment    text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.contact_mention_reviews
    (assistant_message_id, status, comment, created_by)
  values
    (p_message_id, p_status, p_comment, auth.uid())
  on conflict (assistant_message_id) do update set
    status     = excluded.status,
    comment    = excluded.comment,
    updated_at = now(),
    created_by = auth.uid();
$$;

revoke all on function public.upsert_contact_mention_review(bigint, text, text) from public;
grant execute on function public.upsert_contact_mention_review(bigint, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- analytics_contact_mentions  (replaces 4-param version)
-- New params:
--   p_status_filter  – 'pending' (default) | 'extract_step_required' | 'resolved' | 'all'
-- New return columns:
--   review_status, review_comment
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop old 4-param signature so the new 5-param version becomes the canonical one.
drop function if exists public.analytics_contact_mentions(date, date, int, text);

create or replace function public.analytics_contact_mentions(
  p_start          date default null,
  p_end            date default null,
  p_limit          int  default 1000,
  p_page_type      text default null,      -- 'corporate' | 'residence' | null (all)
  p_status_filter  text default 'pending'  -- 'pending' | 'extract_step_required' | 'resolved' | 'all'
)
returns table (
  assistant_message_id bigint,
  session_id           uuid,
  visitor_id           uuid,
  created_at           timestamptz,
  user_question        text,
  bot_answer           text,
  contact_snippet      text,
  review_status        text,
  review_comment       text
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
      m.created_at,
      lower(coalesce(s.residence_custom_id, '')) as res_id
    from public.chat_messages m
    join public.chat_sessions s on s.id = m.session_id
    where m.role = 'assistant'
      and (
        m.content ~ '\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4}'
        or m.content ~ '\+\d[\d\s\-\.]{8,15}\d'
      )
      and (p_start is null or m.created_at >= p_start::timestamptz)
      and (p_end   is null or m.created_at <  (p_end + interval '1 day')::timestamptz)
      and (
        p_page_type is null
        or (p_page_type = 'corporate' and lower(coalesce(s.residence_custom_id, '')) in ('corporateen', 'corporatefr'))
        or (p_page_type = 'residence' and lower(coalesce(s.residence_custom_id, '')) not in ('corporateen', 'corporatefr'))
      )
  ),
  with_context as (
    select
      a.id as assistant_message_id,
      a.session_id,
      a.visitor_id,
      a.created_at,
      coalesce(
        (
          select u.content
          from public.chat_messages u
          where u.session_id = a.session_id
            and u.role       = 'user'
            and u.created_at < a.created_at
          order by u.created_at desc
          limit 1
        ),
        ''
      ) as user_question,
      a.content as bot_answer
    from assistant_msgs a
  ),
  with_review as (
    select
      q.assistant_message_id,
      q.session_id,
      q.visitor_id,
      q.created_at,
      q.user_question,
      q.bot_answer,
      coalesce(
        (regexp_match(q.bot_answer, '\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4}'))[1],
        (regexp_match(q.bot_answer, '\+\d[\d\s\-\.]{8,15}\d'))[1],
        ''
      )          as contact_snippet,
      r.status   as review_status,
      r.comment  as review_comment
    from with_context q
    left join public.contact_mention_reviews r
           on r.assistant_message_id = q.assistant_message_id
  )
  select
    assistant_message_id,
    session_id,
    visitor_id,
    created_at,
    user_question,
    bot_answer,
    contact_snippet,
    review_status,
    review_comment
  from with_review
  where
    case
      when p_status_filter = 'pending'               then review_status is null
      when p_status_filter = 'extract_step_required' then review_status = 'extract_step_required'
      when p_status_filter = 'resolved'              then review_status = 'resolved'
      when p_status_filter = 'all'                   then true
      else review_status is null  -- default: pending only
    end
  order by created_at desc
  limit greatest(1, least(p_limit, 1000));
$$;

revoke all on function public.analytics_contact_mentions(date, date, int, text, text) from public;
grant execute on function public.analytics_contact_mentions(date, date, int, text, text) to authenticated;
