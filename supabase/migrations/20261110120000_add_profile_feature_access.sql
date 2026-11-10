-- Original chatbot/Auth project only. Existing users retain their current access.
begin;

alter table public.profiles
  add column feature_access jsonb not null
  default '{"performance": false, "ai_visibility": false}'::jsonb;

update public.profiles
set feature_access = '{"performance": true, "ai_visibility": true}'::jsonb;

alter table public.profiles add constraint profiles_feature_access_check check (
  jsonb_typeof(feature_access) = 'object'
  and feature_access ?& array['performance', 'ai_visibility']
  and jsonb_typeof(feature_access -> 'performance') = 'boolean'
  and jsonb_typeof(feature_access -> 'ai_visibility') = 'boolean'
  and feature_access - 'performance' - 'ai_visibility' = '{}'::jsonb
);

comment on column public.profiles.feature_access is
  'Section grants for non-admins. Level 1 always has access. Roles still control actions. New users need explicit grants.';

-- Update one key atomically so concurrent edits do not overwrite other grants.
-- SECURITY INVOKER also enforces the existing admin_update_profiles RLS policy.
create or replace function public.set_profile_feature_access(
  p_user_id uuid, p_feature text, p_enabled boolean
) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only admins can change feature access' using errcode = '42501';
  end if;
  if p_feature is null or p_feature not in ('performance', 'ai_visibility') or p_enabled is null then
    raise exception 'Invalid feature access change' using errcode = '22023';
  end if;
  update public.profiles
    set feature_access = jsonb_set(feature_access, array[p_feature], to_jsonb(p_enabled))
    where id = p_user_id and level <> 1;
  if not found then
    raise exception 'User not found or admins already have full access' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.set_profile_feature_access(uuid, text, boolean) from public, anon;
grant execute on function public.set_profile_feature_access(uuid, text, boolean) to authenticated;

commit;
