do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.prompt_versions'::regclass
      and contype = 'c'
  loop
    execute format('alter table public.prompt_versions drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.prompt_versions
  add constraint prompt_versions_family_check
  check (family in ('property', 'corporate', 'analyzer'));

insert into public.prompt_versions (family, name, prompt_text, is_default, created_by)
select 'analyzer', 'Default', '', true, null
where not exists (
  select 1 from public.prompt_versions where family = 'analyzer' and is_default = true
);
