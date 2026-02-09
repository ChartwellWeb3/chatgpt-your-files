do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'daily-chat-visitor-analysis'
  ) then
    update cron.job
    set schedule = '0 2 * * *',
        command = $cmd$
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
    where jobname = 'daily-chat-visitor-analysis';
  else
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
  end if;
end $$;
