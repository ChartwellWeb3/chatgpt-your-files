create table if not exists public.prompt_versions (
  id bigserial primary key,
  family text not null check (family in ('property', 'corporate')),
  name text not null,
  prompt_text text not null,
  is_default boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create unique index if not exists prompt_versions_default_per_family
  on public.prompt_versions (family)
  where is_default;

create unique index if not exists prompt_versions_family_name_unique
  on public.prompt_versions (family, name);

alter table public.prompt_versions enable row level security;

create policy "prompt_versions_select_auth"
  on public.prompt_versions
  for select
  to authenticated
  using (true);

create policy "prompt_versions_insert_auth"
  on public.prompt_versions
  for insert
  to authenticated
  with check (auth.uid() = created_by and is_default = false);

create policy "prompt_versions_update_owner"
  on public.prompt_versions
  for update
  to authenticated
  using (auth.uid() = created_by and is_default = false)
  with check (auth.uid() = created_by and is_default = false);

create policy "prompt_versions_delete_owner"
  on public.prompt_versions
  for delete
  to authenticated
  using (auth.uid() = created_by and is_default = false);

create or replace function public.set_default_prompt_version(
  p_family text,
  p_version_id bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden: Admin only.';
  end if;

  update public.prompt_versions
  set is_default = false
  where family = p_family and is_default = true;

  update public.prompt_versions
  set is_default = true
  where id = p_version_id and family = p_family;
end;
$$;

grant execute on function public.set_default_prompt_version(text, bigint) to authenticated;

insert into public.prompt_versions (family, name, prompt_text, is_default, created_by)
select 'property', 'Default', '', true, null
where not exists (
  select 1 from public.prompt_versions where family = 'property' and is_default = true
);

insert into public.prompt_versions (family, name, prompt_text, is_default, created_by)
select 'corporate', 'Default', '', true, null
where not exists (
  select 1 from public.prompt_versions where family = 'corporate' and is_default = true
);
