create table if not exists public.chatbot_error_alerts (
  id bigserial primary key,
  error_key text unique not null,
  last_sent_at timestamptz not null default now(),
  count integer not null default 1
);

create index if not exists idx_chatbot_error_alerts_last_sent_at
  on public.chatbot_error_alerts (last_sent_at desc);

alter table public.chatbot_error_alerts enable row level security;

create policy "auth_select_chatbot_error_alerts"
  on public.chatbot_error_alerts
  for select
  to authenticated
  using (true);

grant select on table public.chatbot_error_alerts to authenticated;
grant select, insert, update on table public.chatbot_error_alerts to service_role;
