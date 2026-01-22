alter table storage.objects enable row level security;

drop policy if exists "Authenticated users can upload files" on storage.objects;
drop policy if exists "Users can delete their own files" on storage.objects;
drop policy if exists "Users can update their own files" on storage.objects;
drop policy if exists "Users can view their own files" on storage.objects;

create policy "Authenticated users can upload files"
on storage.objects for insert to authenticated
with check (((bucket_id = 'files'::text) AND (owner = auth.uid()) AND (array_length(path_tokens, 1) > 1)));

create policy "Users can delete their own files"
on storage.objects for delete to authenticated
using ((bucket_id = 'files'::text));

create policy "Users can update their own files"
on storage.objects for update to authenticated
using ((bucket_id = 'files'::text))
with check ((bucket_id = 'files'::text));

create policy "Users can view their own files"
on storage.objects for select to authenticated
using ((bucket_id = 'files'::text));