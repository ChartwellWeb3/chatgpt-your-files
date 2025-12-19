-- =========================
-- Fix visitor_forms RLS (Option A)
-- anon: insert (+ optional select/update for upsert/returning)
-- authenticated: select
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

-- 1) Enable RLS
alter table public.visitor_forms enable row level security;

-- 2) Drop old policies (re-runnable)
drop policy if exists "anon_insert_visitor_forms" on public.visitor_forms;
drop policy if exists "anon_select_visitor_forms" on public.visitor_forms;
drop policy if exists "anon_update_visitor_forms" on public.visitor_forms;
drop policy if exists "auth_select_visitor_forms" on public.visitor_forms;

-- 3) INSERT (anon)
create policy "anon_insert_visitor_forms"
on public.visitor_forms
for insert
to anon
with check (
  private.uuid_or_null(visitor_id::text) is not null
  and form_type is not null
  and submitted_with_button in ('dynamic','static')
  and is_submitted is not null
);

-- 4) SELECT (anon) ONLY if your client does .insert(...).select() / .upsert(...).select()
-- If you never do returning/select from anon, you can remove this policy.
create policy "anon_select_visitor_forms"
on public.visitor_forms
for select
to anon
using (true);

-- 5) UPDATE (anon) OPTIONAL
-- Needed if you use UPSERT and the row already exists (upsert becomes UPDATE).
-- This allows anon to update rows, but only if the row has a valid visitor_id.
create policy "anon_update_visitor_forms"
on public.visitor_forms
for update
to anon
using (private.uuid_or_null(visitor_id::text) is not null)
with check (
  private.uuid_or_null(visitor_id::text) is not null
  and form_type is not null
  and submitted_with_button in ('dynamic','static')
  and is_submitted is not null
);

-- 6) SELECT for authenticated admin UI
create policy "auth_select_visitor_forms"
on public.visitor_forms
for select
to authenticated
using (true);
