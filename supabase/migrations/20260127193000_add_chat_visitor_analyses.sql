create extension if not exists pg_cron with schema extensions;

create table if not exists public.chat_visitor_analyses (
  id bigint generated always as identity primary key,
  visitor_id uuid not null references public.visitors(id) on delete cascade,
  last_message_at timestamptz not null,
  source text not null check (source in ('auto', 'manual')),
  model text not null,
  prompt_version text not null default 'v1',
  satisfaction_1_to_10 int not null check (satisfaction_1_to_10 between 1 and 10),
  sentiment text not null check (sentiment in ('satisfied', 'neutral', 'angry', 'unknown')),
  improvement text not null,
  summary text not null,
  raw jsonb null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_visitor_analyses_visitor_created
  on public.chat_visitor_analyses (visitor_id, created_at desc);

create index if not exists idx_chat_visitor_analyses_last_message
  on public.chat_visitor_analyses (last_message_at desc);

create unique index if not exists uq_chat_visitor_analyses_auto_snapshot
  on public.chat_visitor_analyses (visitor_id, last_message_at)
  where source = 'auto';

alter table public.chat_visitor_analyses enable row level security;

create policy "auth_select_chat_visitor_analyses"
  on public.chat_visitor_analyses
  for select
  to authenticated
  using (true);

create policy "admin_insert_chat_visitor_analyses"
  on public.chat_visitor_analyses
  for insert
  to authenticated
  with check (public.is_admin());

grant select, insert on table public.chat_visitor_analyses to authenticated, service_role;

create or replace function public.chat_visitors_needing_analysis(
  p_cutoff_days int,
  p_limit int
)
returns table (visitor_id uuid, last_message_at timestamptz)
language sql
security definer
set search_path = public
as $$
  with last_msg as (
    select visitor_id, max(created_at) as last_message_at
    from public.chat_messages
    group by visitor_id
  )
  select lm.visitor_id, lm.last_message_at
  from last_msg lm
  where lm.last_message_at < now() - (p_cutoff_days || ' days')::interval
    and not exists (
      select 1
      from public.chat_visitor_analyses a
      where a.visitor_id = lm.visitor_id
        and a.last_message_at = lm.last_message_at
        and a.source = 'auto'
    )
  order by lm.last_message_at asc
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.chat_visitors_needing_analysis(int, int) from public;
grant execute on function public.chat_visitors_needing_analysis(int, int) to service_role;

do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'daily-chat-visitor-analysis'
  ) then
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
              'limit', 25
            )
          );
      $cmd$
    );
  end if;
end $$;
