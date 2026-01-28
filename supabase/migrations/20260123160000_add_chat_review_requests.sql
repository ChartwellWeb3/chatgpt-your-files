create table if not exists public.chat_review_requests (
  id bigint generated always as identity primary key,
  visitor_id uuid not null references public.visitors(id) on delete cascade,
  session_id uuid null references public.chat_sessions(id) on delete set null,
  requester_id uuid not null references auth.users(id) on delete cascade,
  requester_comment text not null,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'closed')),
  reviewer_id uuid null references auth.users(id) on delete set null,
  reviewer_comment text null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz null
);

create index if not exists idx_chat_review_requests_status_created
  on public.chat_review_requests (status, created_at desc);

create index if not exists idx_chat_review_requests_visitor
  on public.chat_review_requests (visitor_id, created_at desc);

alter table public.chat_review_requests enable row level security;

create policy "auth_select_chat_review_requests"
  on public.chat_review_requests
  for select
  to authenticated
  using (true);

create policy "auth_insert_chat_review_requests"
  on public.chat_review_requests
  for insert
  to authenticated
  with check (requester_id = auth.uid());

create policy "admin_update_chat_review_requests"
  on public.chat_review_requests
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "admin_delete_chat_review_requests"
  on public.chat_review_requests
  for delete
  to authenticated
  using (public.is_admin());

grant select, insert, update, delete on table public.chat_review_requests to authenticated, service_role;
