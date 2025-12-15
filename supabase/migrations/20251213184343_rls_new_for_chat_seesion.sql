-- helpers (if you already have it, keep it)
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

-- Ensure RLS is enabled
alter table public.chat_sessions enable row level security;

-- Drop old policies (re-runnable)
drop policy if exists "anon_insert_chat_sessions" on public.chat_sessions;
drop policy if exists "anon_update_chat_sessions_same_id" on public.chat_sessions;
drop policy if exists "auth_select_chat_sessions" on public.chat_sessions;

-- INSERT policy (anon)
create policy "anon_insert_chat_sessions"
on public.chat_sessions
for insert
to anon
with check (
  private.uuid_or_null(id::text) is not null
  and private.uuid_or_null(visitor_id::text) is not null
);

-- UPDATE policy (anon)  ✅ REQUIRED for upsert()
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

-- SELECT policy (authenticated only)
create policy "auth_select_chat_sessions"
on public.chat_sessions
for select
to authenticated
using (true);
