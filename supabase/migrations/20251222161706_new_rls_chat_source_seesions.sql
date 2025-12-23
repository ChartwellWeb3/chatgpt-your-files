alter table public.chat_message_sources enable row level security;

drop policy if exists cms_insert on public.chat_message_sources;

create policy cms_insert
on public.chat_message_sources
for insert
to anon, authenticated
with check (
  -- session must exist
  exists (
    select 1
    from public.chat_sessions s
    where s.id = chat_message_sources.session_id
  )
  -- user_message must belong to same session AND visitor must match session's visitor
  and exists (
    select 1
    from public.chat_messages um
    join public.chat_sessions s on s.id = chat_message_sources.session_id
    where um.id = chat_message_sources.user_message_id
      and um.session_id = chat_message_sources.session_id
      and um.visitor_id = s.visitor_id
  )
  -- assistant_message must belong to same session AND visitor must match session's visitor
  and exists (
    select 1
    from public.chat_messages am
    join public.chat_sessions s on s.id = chat_message_sources.session_id
    where am.id = chat_message_sources.assistant_message_id
      and am.session_id = chat_message_sources.session_id
      and am.visitor_id = s.visitor_id
  )
);
