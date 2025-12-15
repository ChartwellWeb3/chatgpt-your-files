-- =========================
-- Fix visitors RLS for anon upsert
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

alter table public.visitors enable row level security;

-- Drop existing policies to avoid "already exists"
drop policy if exists "anon_insert_visitors" on public.visitors;
drop policy if exists "anon_select_visitors" on public.visitors;
drop policy if exists "anon_update_visitors_same_id" on public.visitors;
drop policy if exists "auth_select_visitors" on public.visitors;

-- INSERT (anon)
create policy "anon_insert_visitors"
on public.visitors
for insert
to anon
with check (
  private.uuid_or_null(id::text) is not null
);

-- SELECT (anon) required for UPSERT conflict path
create policy "anon_select_visitors"
on public.visitors
for select
to anon
using (
  private.uuid_or_null(id::text) is not null
);

-- UPDATE (anon) required for UPSERT conflict path
create policy "anon_update_visitors_same_id"
on public.visitors
for update
to anon
using (
  private.uuid_or_null(id::text) is not null
)
with check (
  private.uuid_or_null(id::text) is not null
);

-- SELECT (authenticated admin / analytics)
create policy "auth_select_visitors"
on public.visitors
for select
to authenticated
using (true);
