-- =========================
-- Fix chat_messages RLS (anon insert + anon select for RETURNING)
-- Re-runnable migration
-- =========================

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

alter table public.chat_messages enable row level security;

-- Drop existing policies to avoid "already exists"
drop policy if exists "anon_insert_chat_messages" on public.chat_messages;
drop policy if exists "anon_select_chat_messages" on public.chat_messages;
drop policy if exists "auth_select_chat_messages" on public.chat_messages;

-- INSERT (anon)
create policy "anon_insert_chat_messages"
on public.chat_messages
for insert
to anon
with check (
  private.uuid_or_null(visitor_id::text) is not null
  and private.uuid_or_null(session_id::text) is not null
  and role in ('user','assistant','system')
  and content is not null
);

-- SELECT (anon) needed because you use `.select(...).single()` after insert
-- This is intentionally permissive for now (Option A simplicity).
create policy "anon_select_chat_messages"
on public.chat_messages
for select
to anon
using (true);

-- SELECT (authenticated admin / analytics)
create policy "auth_select_chat_messages"
on public.chat_messages
for select
to authenticated
using (true);
