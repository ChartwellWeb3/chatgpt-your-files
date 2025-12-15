-- ============================================
-- Minimal, scalable chat logging schema
-- Objects:
--   1) visitors
--   2) chat_sessions
--   3) chat_messages
--   4) chat_message_sources
-- Includes: FKs, indexes, RLS + simple policies
-- ============================================

begin;

-- 0) Safety: ensure uuid generator exists
create extension if not exists "pgcrypto";

-- ============================================
-- 1) VISITORS (anonymous site visitor id)
-- ============================================
create table if not exists public.visitors (
  id uuid primary key,
  created_at timestamptz not null default now()
);

-- ============================================
-- 2) CHAT SESSIONS (groups a conversation run)
-- ============================================
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null references public.visitors(id) on delete cascade,
  created_at timestamptz not null default now(),

  -- Optional (safe to keep now, ignore later if you want)
  page_url text null,
  residence_custom_id text null,
  lang text null
);

create index if not exists idx_chat_sessions_visitor_created
  on public.chat_sessions (visitor_id, created_at desc);

create index if not exists idx_chat_sessions_created
  on public.chat_sessions (created_at desc);

-- ============================================
-- 3) CHAT MESSAGES (user + assistant messages)
-- ============================================
create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,

  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  visitor_id uuid not null references public.visitors(id) on delete cascade,

  role text not null,
  content text not null,

  created_at timestamptz not null default now(),

  constraint chat_messages_role_check
    check (role in ('user','assistant','system'))
);

create index if not exists idx_chat_messages_session_created
  on public.chat_messages (session_id, created_at asc);

create index if not exists idx_chat_messages_visitor_created
  on public.chat_messages (visitor_id, created_at desc);

create index if not exists idx_chat_messages_role
  on public.chat_messages (role);

-- ============================================
-- 4) CHAT MESSAGE SOURCES (document sections used)
-- One assistant message can have N sources
-- ============================================
create table if not exists public.chat_message_sources (
  id bigint generated always as identity primary key,

  assistant_message_id bigint not null
    references public.chat_messages(id) on delete cascade,

  document_section_id bigint not null
    references public.document_sections(id) on delete cascade,

  rank int not null default 1,
  score double precision null,
  source_type text null,   -- e.g. 'vector' | 'keyword' | 'hybrid' | 'fallback'
  snippet_used text null,

  created_at timestamptz not null default now(),

  constraint chat_message_sources_rank_check
    check (rank >= 1)
);

-- Prevent duplicates (same assistant msg + same section)
create unique index if not exists uq_chat_message_sources_msg_section
  on public.chat_message_sources (assistant_message_id, document_section_id);

create index if not exists idx_chat_message_sources_msg_rank
  on public.chat_message_sources (assistant_message_id, rank asc);

create index if not exists idx_chat_message_sources_section
  on public.chat_message_sources (document_section_id);

-- ============================================
-- RLS (simple + safe defaults)
-- - anon: can INSERT (so public site can log)
-- - authenticated: can SELECT (so your dashboard can read)
-- - service_role: bypasses RLS automatically
-- ============================================

alter table public.visitors enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_message_sources enable row level security;

-- VISITORS policies
drop policy if exists "anon_insert_visitors" on public.visitors;
create policy "anon_insert_visitors"
on public.visitors for insert
to anon
with check (true);

drop policy if exists "auth_select_visitors" on public.visitors;
create policy "auth_select_visitors"
on public.visitors for select
to authenticated
using (true);

-- CHAT_SESSIONS policies
drop policy if exists "anon_insert_chat_sessions" on public.chat_sessions;
create policy "anon_insert_chat_sessions"
on public.chat_sessions for insert
to anon
with check (true);

drop policy if exists "auth_select_chat_sessions" on public.chat_sessions;
create policy "auth_select_chat_sessions"
on public.chat_sessions for select
to authenticated
using (true);

-- CHAT_MESSAGES policies
drop policy if exists "anon_insert_chat_messages" on public.chat_messages;
create policy "anon_insert_chat_messages"
on public.chat_messages for insert
to anon
with check (true);

drop policy if exists "auth_select_chat_messages" on public.chat_messages;
create policy "auth_select_chat_messages"
on public.chat_messages for select
to authenticated
using (true);

-- CHAT_MESSAGE_SOURCES policies
drop policy if exists "anon_insert_chat_message_sources" on public.chat_message_sources;
create policy "anon_insert_chat_message_sources"
on public.chat_message_sources for insert
to anon
with check (true);

drop policy if exists "auth_select_chat_message_sources" on public.chat_message_sources;
create policy "auth_select_chat_message_sources"
on public.chat_message_sources for select
to authenticated
using (true);

commit;
