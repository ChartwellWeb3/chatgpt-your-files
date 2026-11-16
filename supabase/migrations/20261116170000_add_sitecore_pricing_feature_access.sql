-- ORIGINAL CHATBOT / AUTH project only. Not the performance project.
-- Rerunnable feature-grant install/upgrade; no Sitecore requests or job changes.
begin;

-- If the original grants migration is absent, preserve existing access to the
-- previously unrestricted Performance / AI Visibility sections.
alter table public.profiles add column if not exists feature_access jsonb not null
  default '{"performance":true,"ai_visibility":true}'::jsonb;

alter table public.profiles drop constraint if exists profiles_feature_access_check;

-- Preserve existing pricing grants/revocations when this script is rerun.
-- Current Admin / Content Team users retain pricing access; Basic stays off.
update public.profiles
set feature_access = jsonb_set(feature_access, '{sitecore_pricing}', to_jsonb(level in (1,2)), true)
where not (feature_access ? 'sitecore_pricing');

alter table public.profiles alter column feature_access set default
  '{"performance":false,"ai_visibility":false,"sitecore_pricing":false}'::jsonb;

alter table public.profiles add constraint profiles_feature_access_check check (
  jsonb_typeof(feature_access) = 'object'
  and feature_access ?& array['performance','ai_visibility','sitecore_pricing']
  and jsonb_typeof(feature_access -> 'performance') = 'boolean'
  and jsonb_typeof(feature_access -> 'ai_visibility') = 'boolean'
  and jsonb_typeof(feature_access -> 'sitecore_pricing') = 'boolean'
  and feature_access - 'performance' - 'ai_visibility' - 'sitecore_pricing' = '{}'::jsonb
);

-- Update one grant atomically. Existing profile RLS remains enforced.
create or replace function public.set_profile_feature_access(
  p_user_id uuid, p_feature text, p_enabled boolean
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only admins can change feature access' using errcode = '42501';
  end if;
  if p_feature is null or p_feature not in ('performance','ai_visibility','sitecore_pricing') or p_enabled is null then
    raise exception 'Invalid feature access change' using errcode = '22023';
  end if;
  update public.profiles
    set feature_access = jsonb_set(feature_access, array[p_feature], to_jsonb(p_enabled))
    where id = p_user_id and level <> 1
      and (p_feature <> 'sitecore_pricing' or not p_enabled or level = 2);
  if not found then
    raise exception 'User not found, role is ineligible, or admin access is always enabled' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.set_profile_feature_access(uuid,text,boolean) from public,anon;
grant execute on function public.set_profile_feature_access(uuid,text,boolean) to authenticated;
comment on column public.profiles.feature_access is
  'Explicit section grants for non-admins. Admins always have access. Suite pricing also requires Content Team role. New users default all grants off.';
notify pgrst,'reload schema';
commit;
