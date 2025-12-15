-- =========================
-- Fix chat_sessions RLS for anon upsert
-- Re-runnable migration
-- =========================

-- 0) helper schema + function (safe if already exists)
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

-- 1) Ensure RLS enabled
alter table public.chat_sessions enable row level security;

-- 2) Drop policies if they already exist (so we can re-run)
drop policy if exists "anon_insert_chat_sessions" on public.chat_sessions;
drop policy if exists "anon_select_chat_sessions" on public.chat_sessions;
drop policy if exists "anon_update_chat_sessions_same_id" on public.chat_sessions;
drop policy if exists "auth_select_chat_sessions" on public.chat_sessions;

-- 3) Recreate policies

-- INSERT (anon)
create policy "anon_insert_chat_sessions"
on public.chat_sessions
for insert
to anon
with check (
  private.uuid_or_null(id::text) is not null
  and private.uuid_or_null(visitor_id::text) is not null
);

-- SELECT (anon)  ✅ required for UPSERT -> UPDATE path
create policy "anon_select_chat_sessions"
on public.chat_sessions
for select
to anon
using (
  private.uuid_or_null(visitor_id::text) is not null
);

-- UPDATE (anon) ✅ required for UPSERT conflict path
create policy "anon_update_chat_sessions_same_id"
on public.chat_sessions
for update
to anon
using (
  private.uuid_or_null(id::text) is not null
)
with check (
  private.uuid_or_null(id::text) is not null
  and private.uuid_or_null(visitor_id::text) is not null
);

-- SELECT (authenticated admin / analytics page)
create policy "auth_select_chat_sessions"
on public.chat_sessions
for select
to authenticated
using (true);
