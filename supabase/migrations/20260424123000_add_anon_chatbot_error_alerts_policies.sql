alter table public.chatbot_error_alerts enable row level security;

create policy "Allow anon select chatbot error alerts"
on public.chatbot_error_alerts
for select
to anon
using (true);

create policy "Allow anon insert chatbot error alerts"
on public.chatbot_error_alerts
for insert
to anon
with check (true);

create policy "Allow anon update chatbot error alerts"
on public.chatbot_error_alerts
for update
to anon
using (true)
with check (true);
