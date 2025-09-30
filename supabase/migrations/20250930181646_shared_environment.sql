-- Migration to convert from per-user ownership to shared environment
-- All authenticated users will have equal permissions

-- Step 1: Create residences table
create extension if not exists vector with schema extensions;
set local search_path = public, extensions;  

create table residences (
  id bigint primary key generated always as identity,
  name text not null,
  custom_id text not null unique,
  created_at timestamp with time zone not null default now(),
  created_by uuid references auth.users (id) default auth.uid()
);

-- Enable RLS on residences (but allow all authenticated users)
alter table residences enable row level security;

-- Step 2: Update documents table to support residence scoping
alter table documents
  add column residence_id bigint references residences (id) on delete cascade,
  add column is_common boolean not null default false;

-- Add constraint: document must have either residence_id OR is_common = true
alter table documents
  add constraint documents_scope_check check (
    (residence_id is not null and is_common = false) or
    (residence_id is null and is_common = true)
  );

-- Step 3: Drop all existing ownership-based RLS policies

-- Drop documents policies
drop policy if exists "Users can insert documents" on documents;
drop policy if exists "Users can query their own documents" on documents;

-- Drop document_sections policies
drop policy if exists "Users can insert document sections" on document_sections;
drop policy if exists "Users can update their own document sections" on document_sections;
drop policy if exists "Users can query their own document sections" on document_sections;

-- Step 4: Create new permissive RLS policies for all authenticated users

-- Residences: all authenticated users can do everything
create policy "Authenticated users can select residences"
on residences for select to authenticated using (true);

create policy "Authenticated users can insert residences"
on residences for insert to authenticated with check (true);

create policy "Authenticated users can update residences"
on residences for update to authenticated using (true) with check (true);

create policy "Authenticated users can delete residences"
on residences for delete to authenticated using (true);

-- Documents: all authenticated users can do everything
create policy "Authenticated users can select documents"
on documents for select to authenticated using (true);

create policy "Authenticated users can insert documents"
on documents for insert to authenticated with check (true);

create policy "Authenticated users can update documents"
on documents for update to authenticated using (true) with check (true);

create policy "Authenticated users can delete documents"
on documents for delete to authenticated using (true);

-- Document sections: all authenticated users can do everything
create policy "Authenticated users can select document sections"
on document_sections for select to authenticated using (true);

create policy "Authenticated users can insert document sections"
on document_sections for insert to authenticated with check (true);

create policy "Authenticated users can update document sections"
on document_sections for update to authenticated using (true) with check (true);

create policy "Authenticated users can delete document sections"
on document_sections for delete to authenticated using (true);

-- Step 5: Update the documents_with_storage_path view to include residence info
drop view if exists documents_with_storage_path;

create view documents_with_storage_path
with (security_invoker=true)
as
  select 
    documents.*, 
    storage.objects.name as storage_object_path,
    residences.name as residence_name,
    residences.custom_id as residence_custom_id
  from documents
  join storage.objects
    on storage.objects.id = documents.storage_object_id
  left join residences
    on residences.id = documents.residence_id;

-- Step 6: Update match_document_sections to support residence filtering
create or replace function match_document_sections(
  embedding vector(384), 
  match_threshold float,
  residence_custom_id text default null
)
returns setof document_sections
language plpgsql
as $$
#variable_conflict use_variable
begin
  return query
  select ds.*
  from document_sections ds
  join documents d on d.id = ds.document_id
  left join residences r on r.id = d.residence_id
  where 
    -- Vector similarity check
    ds.embedding <#> embedding < -match_threshold
    -- Residence filtering logic
    and (
      -- If residence_custom_id is provided, match that residence + common
      (residence_custom_id is not null and (r.custom_id = residence_custom_id or d.is_common = true))
      -- If residence_custom_id is null, return only common documents
      or (residence_custom_id is null and d.is_common = true)
    )
  order by ds.embedding <#> embedding;
end;
$$;

-- Step 7: Update storage trigger to handle residence_id and is_common
-- The trigger now expects path format: files/{residence_custom_id}/{uuid}/{filename} or files/common/{uuid}/{filename}
create or replace function private.handle_storage_update() 
returns trigger 
language plpgsql
as $$
declare
  document_id bigint;
  result int;
  residence_id_val bigint;
  is_common_val boolean;
  scope_identifier text;
begin
  -- Extract scope from path: path_tokens[1] is either residence_custom_id or 'common'
  scope_identifier := new.path_tokens[1];
  
  if scope_identifier = 'common' then
    -- This is a common file
    is_common_val := true;
    residence_id_val := null;
  else
    -- This is a residence file, look up the residence_id
    select id into residence_id_val
    from residences
    where custom_id = scope_identifier;
    
    is_common_val := false;
    
    -- If residence doesn't exist, create it automatically
    if residence_id_val is null then
      insert into residences (name, custom_id)
      values (scope_identifier, scope_identifier)
      returning id into residence_id_val;
    end if;
  end if;

  -- Insert document with residence scoping
  insert into documents (name, storage_object_id, created_by, residence_id, is_common)
    values (new.path_tokens[3], new.id, new.owner, residence_id_val, is_common_val)
    returning id into document_id;

  -- Trigger processing
  select
    net.http_post(
      url := supabase_url() || '/functions/v1/process',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', current_setting('request.headers')::json->>'authorization'
      ),
      body := jsonb_build_object(
        'document_id', document_id
      )
    )
  into result;

  return null;
end;
$$;
