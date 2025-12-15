-- =========================
-- Chat analytics (Option A)
-- anon: INSERT only
-- authenticated: SELECT only
-- =========================

-- 0) Helpers
create schema if not exists private;

create or replace function private.uuid_or_null(str text)
returns uuid
language plpgsql
as $$
begin
  return str::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- 1) Enable RLS
alter table public.visitors enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_message_sources enable row level security;

-- 2) Drop existing policies (re-runnable)
drop policy if exists "anon_insert_visitors" on public.visitors;
drop policy if exists "auth_select_visitors" on public.visitors;

drop policy if exists "anon_insert_chat_sessions" on public.chat_sessions;
drop policy if exists "auth_select_chat_sessions" on public.chat_sessions;

drop policy if exists "anon_insert_chat_messages" on public.chat_messages;
drop policy if exists "auth_select_chat_messages" on public.chat_messages;

drop policy if exists "anon_insert_chat_message_sources" on public.chat_message_sources;
drop policy if exists "auth_select_chat_message_sources" on public.chat_message_sources;

-- (optional) if you previously created these, drop them too
drop policy if exists "anon_update_visitors_same_id" on public.visitors;

-- 3) VISITORS
-- anon can insert a visitor row (id must be a valid uuid)
create policy "anon_insert_visitors"
on public.visitors
for insert
to anon
with check (
  private.uuid_or_null(id::text) is not null
);

-- authenticated can read visitors (admin dashboard)
create policy "auth_select_visitors"
on public.visitors
for select
to authenticated
using (true);

-- OPTIONAL:
-- Only add this if your code uses UPSERT on visitors (which can trigger UPDATE).
-- This is intentionally permissive (simple mode).
-- create policy "anon_update_visitors_same_id"
-- on public.visitors
-- for update
-- to anon
-- using (private.uuid_or_null(id::text) is not null)
-- with check (private.uuid_or_null(id::text) is not null);

-- 4) CHAT SESSIONS
create policy "anon_insert_chat_sessions"
on public.chat_sessions
for insert
to anon
with check (
  private.uuid_or_null(id::text) is not null
  and private.uuid_or_null(visitor_id::text) is not null
);

create policy "auth_select_chat_sessions"
on public.chat_sessions
for select
to authenticated
using (true);

-- 5) CHAT MESSAGES
create policy "anon_insert_chat_messages"
on public.chat_messages
for insert
to anon
with check (
  private.uuid_or_null(visitor_id::text) is not null
  and private.uuid_or_null(session_id::text) is not null
  and role in ('user', 'assistant', 'system')
  and content is not null
);

create policy "auth_select_chat_messages"
on public.chat_messages
for select
to authenticated
using (true);

-- 6) CHAT MESSAGE SOURCES
-- IMPORTANT: this matches your real columns:
-- assistant_message_id, document_section_id, rank, score, source_type, snippet_used, created_at
create policy "anon_insert_chat_message_sources"
on public.chat_message_sources
for insert
to anon
with check (
  assistant_message_id is not null
  and document_section_id is not null
);

create policy "auth_select_chat_message_sources"
on public.chat_message_sources
for select
to authenticated
using (true);
