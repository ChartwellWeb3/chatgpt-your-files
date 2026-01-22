-- Ensure function exists (yours already exists, but safe)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, level, created_at)
  values (new.id, 3, now())
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Drop old trigger if it exists (idempotent)
drop trigger if exists on_auth_user_created on auth.users;

-- Create trigger
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();
