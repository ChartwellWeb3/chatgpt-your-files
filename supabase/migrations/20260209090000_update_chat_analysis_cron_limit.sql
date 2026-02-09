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
    '0 2 * * *',
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
