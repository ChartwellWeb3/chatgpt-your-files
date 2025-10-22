-- safe_files_policies.sql

-- 1) Idempotent schema/function setup
create schema if not exists private;

create or replace function private.uuid_or_null(str text)
returns uuid
language plpgsql
as $$
begin
  return str::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

-- Ensure bucket exists (safe if already there)
insert into storage.buckets (id, name)
values ('files', 'files')
on conflict do nothing;

-- 2) Replace policies (idempotent / safe to re-run)
drop policy if exists "Authenticated users can upload files" on storage.objects;
drop policy if exists "Users can view their own files"      on storage.objects;
drop policy if exists "Users can update their own files"     on storage.objects;
drop policy if exists "Users can delete their own files"     on storage.objects;

-- IMPORTANT: use split_part(name,'/',1) instead of path_tokens[1]
create policy "Authenticated users can upload files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'files'
  and owner = auth.uid()
  and private.uuid_or_null(split_part(name, '/', 1)) is not null
);

create policy "Users can view their own files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'files'
  and owner = auth.uid()
);

create policy "Users can update their own files"
on storage.objects
for update
to authenticated
with check (
  bucket_id = 'files'
  and owner = auth.uid()
);

create policy "Users can delete their own files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'files'
  and owner = auth.uid()
);
