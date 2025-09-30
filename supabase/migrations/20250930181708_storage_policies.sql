-- Update storage policies to allow all authenticated users full access

-- Drop existing ownership-based storage policies
drop policy if exists "Authenticated users can upload files" on storage.objects;
drop policy if exists "Users can view their own files" on storage.objects;
drop policy if exists "Users can update their own files" on storage.objects;
drop policy if exists "Users can delete their own files" on storage.objects;

-- Create new permissive storage policies for all authenticated users
create policy "Authenticated users can upload files"
on storage.objects for insert to authenticated with check (
  bucket_id = 'files'
);

create policy "Authenticated users can view files"
on storage.objects for select to authenticated using (
  bucket_id = 'files'
);

create policy "Authenticated users can update files"
on storage.objects for update to authenticated using (
  bucket_id = 'files'
) with check (
  bucket_id = 'files'
);

create policy "Authenticated users can delete files"
on storage.objects for delete to authenticated using (
  bucket_id = 'files'
);
