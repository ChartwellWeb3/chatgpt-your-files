begin;

-- 1) Bucket (idempotent)
insert into storage.buckets (id, name, public)
values ('files', 'files', false)
on conflict (id) do nothing;

-- 2) Helper function (idempotent)
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

-- 3) Drop policies if they exist
drop policy if exists "Authenticated users can upload files" on storage.objects;
drop policy if exists "Users can view their own files" on storage.objects;
drop policy if exists "Users can update their own files" on storage.objects;
drop policy if exists "Users can delete their own files" on storage.objects;

-- 4) Recreate policies

create policy "Authenticated users can upload files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'files'
  and owner = auth.uid()
  and private.uuid_or_null(path_tokens[1]) is not null
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
using (
  bucket_id = 'files'
  and owner = auth.uid()
)
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

commit;
