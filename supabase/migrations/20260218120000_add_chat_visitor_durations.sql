create table if not exists public.chat_visitor_durations (
  id bigint generated always as identity primary key,
  visitor_id uuid not null references public.visitors(id) on delete cascade,
  first_message_at timestamptz not null,
  last_message_at timestamptz not null,
  duration_seconds int not null check (duration_seconds >= 0),
  source text not null check (source in ('auto', 'manual')),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_visitor_durations_visitor_created
  on public.chat_visitor_durations (visitor_id, created_at desc);

create index if not exists idx_chat_visitor_durations_last_message
  on public.chat_visitor_durations (last_message_at desc);

create unique index if not exists uq_chat_visitor_durations_snapshot_per_source
  on public.chat_visitor_durations (visitor_id, last_message_at, source);

alter table public.chat_visitor_durations enable row level security;

create policy "auth_select_chat_visitor_durations"
  on public.chat_visitor_durations
  for select
  to authenticated
  using (true);

create policy "admin_insert_chat_visitor_durations"
  on public.chat_visitor_durations
  for insert
  to authenticated
  with check (public.is_admin());

grant select, insert on table public.chat_visitor_durations to authenticated, service_role;

create or replace function public.chat_visitors_needing_duration(
  p_cutoff_days int,
  p_limit int,
  p_force boolean default false,
  p_min_days_since int default 0
)
returns table (visitor_id uuid, first_message_at timestamptz, last_message_at timestamptz)
language sql
security definer
set search_path = public
as $$
  with msg_bounds as (
    select visitor_id, min(created_at) as first_message_at, max(created_at) as last_message_at
    from public.chat_messages
    group by visitor_id
  ),
  last_duration as (
    select visitor_id, max(created_at) as last_duration_at
    from public.chat_visitor_durations
    where source = 'auto'
    group by visitor_id
  )
  select mb.visitor_id, mb.first_message_at, mb.last_message_at
  from msg_bounds mb
  left join last_duration ld on ld.visitor_id = mb.visitor_id
  where mb.last_message_at < now() - (p_cutoff_days || ' days')::interval
    and (
      p_force
      or not exists (
        select 1
        from public.chat_visitor_durations d
        where d.visitor_id = mb.visitor_id
          and d.last_message_at = mb.last_message_at
          and d.source = 'auto'
      )
    )
    and (
      p_min_days_since <= 0
      or ld.last_duration_at is null
      or ld.last_duration_at < now() - (p_min_days_since || ' days')::interval
    )
  order by mb.last_message_at asc
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.chat_visitors_needing_duration(int, int, boolean, int) from public;
grant execute on function public.chat_visitors_needing_duration(int, int, boolean, int) to service_role;

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
    '10 2 * * *',
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
