select vault.create_secret(
  'http://api.supabase.internal:8000',
  'supabase_url'
);

-- Create bucket "files" in a version-compatible way (local vs remote storage schema)
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'storage'
      and table_name = 'buckets'
      and column_name = 'public'
  ) then
    -- Newer schema (has "public")
    execute $sql$
      insert into storage.buckets (id, name, public)
      values ('files', 'files', false)
      on conflict (id) do update
      set name = excluded.name,
          public = excluded.public;
    $sql$;
  else
    -- Older schema (no "public")
    execute $sql$
      insert into storage.buckets (id, name)
      values ('files', 'files')
      on conflict (id) do update
      set name = excluded.name;
    $sql$;
  end if;
end $$;

