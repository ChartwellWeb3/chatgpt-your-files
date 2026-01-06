create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  level int2 not null default 3 check (level in (1,2,3)),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "read own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());
