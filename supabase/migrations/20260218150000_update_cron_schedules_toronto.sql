-- Schedule analyzer + durations 3x daily for Toronto.
-- pg_cron uses the database timezone (often UTC). These times are UTC offsets for Toronto in winter (EST, UTC-5):
-- 11:00 PM ET -> 04:00 UTC, 5:00 AM ET -> 10:00 UTC, 8:00 AM ET -> 13:00 UTC.
-- If your DB timezone is America/Toronto, use local hours (23,5,8) instead.
-- If DST applies (EDT, UTC-4), update to 03:00/09:00/12:00 UTC.

do $$
begin
  begin
    perform cron.unschedule('daily-chat-visitor-analysis');
  exception
    when others then
      null;
  end;

  perform cron.schedule(
    'daily-chat-visitor-analysis',
    '0 4,10,13 * * *',
    $cmd$
      select
        net.http_post(
          url := public.supabase_url() || '/functions/v1/analyze-conversations',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'service_role_key'
            )
          ),
          body := jsonb_build_object(
            'cutoff_days', 7,
            'limit', 150
          )
        );
    $cmd$
  );
end $$;

do $$
begin
  begin
    perform cron.unschedule('daily-chat-visitor-durations');
  exception
    when others then
      null;
  end;

  perform cron.schedule(
    'daily-chat-visitor-durations',
    '10 4,10,13 * * *',
    $cmd$
      select
        net.http_post(
          url := public.supabase_url() || '/functions/v1/conversation-durations',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'service_role_key'
            )
          ),
          body := jsonb_build_object(
            'cutoff_days', 7,
            'limit', 150
          )
        );
    $cmd$
  );
end $$;
