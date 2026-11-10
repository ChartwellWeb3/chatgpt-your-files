-- Original chatbot/Auth project only. Keep profiles.email aligned with Auth.
begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, level, created_at, email)
  values (new.id, 3, now(), new.email)
  on conflict (id) do update set email = excluded.email;

  return new;
end;
$$;

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = new.email
  where id = new.id and email is distinct from new.email;

  return new;
end;
$$;

-- The signup trigger already calls handle_new_user. Wire email updates as well.
drop trigger if exists chartwell_sync_profile_email on auth.users;
create trigger chartwell_sync_profile_email
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function public.sync_profile_email();

-- Repair missing or stale emails without changing roles or feature grants.
update public.profiles as profile
set email = auth_user.email
from auth.users as auth_user
where profile.id = auth_user.id
  and profile.email is distinct from auth_user.email;

commit;
