-- Run LAST, in the PERFORMANCE project, after geo-worker and its secrets exist.
-- First create these two Vault secrets in Dashboard > Integrations > Vault:
-- geo_project_url   = https://YOUR-PERFORMANCE-PROJECT.supabase.co
-- geo_worker_secret = the same random value as the GEO_WORKER_SECRET Edge secret
-- No OpenAI key belongs in this SQL file or Vault dispatcher settings.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.geo_dispatch() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare endpoint text; credential text; n integer; i integer;
begin
 if not pg_try_advisory_xact_lock(hashtext('geo-dispatch')) then return; end if;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='geo_project_url';
 select decrypted_secret into credential from vault.decrypted_secrets where name='geo_worker_secret';
 if endpoint is null or endpoint !~ '^https://[a-z0-9-]+\.supabase\.co/?$' or length(coalesce(credential,''))<32 then
  raise exception 'Configure geo_project_url and geo_worker_secret in Vault first.';
 end if;
 perform public.geo_queue_due();
 -- Invoke twice when there is work (including expired leases); otherwise once
 -- for a worker heartbeat. The claim RPC enforces the global concurrency limit.
 select case when exists(select 1 from public.geo_run_jobs where status in ('ready','leased')) then 2 else 1 end into n;
 for i in 1..n loop
  perform net.http_post(url:=rtrim(endpoint,'/')||'/functions/v1/geo-worker',
   headers:=jsonb_build_object('Content-Type','application/json','x-geo-worker-secret',credential),
   body:='{}'::jsonb,timeout_milliseconds:=110000);
 end loop;
end $$;
revoke all on function public.geo_dispatch() from public,anon,authenticated;
grant execute on function public.geo_dispatch() to service_role;

do $$ begin
 if not exists(select 1 from vault.decrypted_secrets where name='geo_project_url') or
    not exists(select 1 from vault.decrypted_secrets where name='geo_worker_secret' and length(decrypted_secret)>=32) then
  raise exception 'Add the Vault settings before activating Cron.';
 end if;
end $$;
select cron.schedule('geo-dispatch-every-minute','* * * * *','select public.geo_dispatch();');
update public.geo_worker_runtime set dispatcher_enabled=true where id=true;
-- Question schedules stay paused until enabled by an admin in the website.
-- Emergency pause for ALL processing (queued jobs are retained):
-- select cron.unschedule('geo-dispatch-every-minute');
-- update public.geo_worker_runtime set dispatcher_enabled=false where id=true;
