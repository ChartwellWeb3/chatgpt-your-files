-- Run LAST in the PERFORMANCE project, after deploying sitecore-pricing.
-- First add Vault secrets using Dashboard > Integrations > Vault:
-- pricing_project_url = https://YOUR-PERFORMANCE-PROJECT.supabase.co
-- pricing_dispatch_secret = SAME value as SITECORE_PRICING_DISPATCH_SECRET
-- Never put the Sitecore client secret in this file or the cron command.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create function public.sitecore_pricing_dispatch() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare endpoint text; credential text;
begin
  if not pg_try_advisory_xact_lock(hashtext('sitecore-pricing-dispatch')) then return; end if;
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='pricing_project_url';
  select decrypted_secret into credential from vault.decrypted_secrets where name='pricing_dispatch_secret';
  if endpoint is null or endpoint !~ '^https://[a-z0-9-]+\.supabase\.co/?$' or length(coalesce(credential,''))<32 then
    raise exception 'Configure pricing_project_url and pricing_dispatch_secret in Vault first.';
  end if;
  -- An idle call also updates the Edge heartbeat. Active leases prevent overlap.
  perform net.http_post(url:=rtrim(endpoint,'/')||'/functions/v1/sitecore-pricing',
    headers:=jsonb_build_object('Content-Type','application/json','x-pricing-secret',credential),
    body:='{}'::jsonb,timeout_milliseconds:=15000);
end $$;
revoke all on function public.sitecore_pricing_dispatch() from public,anon,authenticated;
grant execute on function public.sitecore_pricing_dispatch() to service_role;
do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name='pricing_project_url' and decrypted_secret ~ '^https://[a-z0-9-]+\.supabase\.co/?$')
    or not exists(select 1 from vault.decrypted_secrets where name='pricing_dispatch_secret' and length(decrypted_secret)>=32) then
    raise exception 'Add the Vault settings before activating pricing Cron.';
  end if;
end $$;
select cron.schedule('sitecore-pricing-every-minute','* * * * *','select public.sitecore_pricing_dispatch();');
commit;

-- Pause automatic recovery (does not stop a batch already running, a chained
-- continuation, or a new Run click):
-- select cron.unschedule('sitecore-pricing-every-minute');
-- To stop remaining work, cancel between batches in the app. Never rotate a
-- Sitecore credential in the middle of an unverified write.
