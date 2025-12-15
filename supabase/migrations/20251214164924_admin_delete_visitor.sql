-- ==========================================
-- Cascade delete for visitor data + admin RPC
-- ==========================================

-- 0) Extensions (only if you need)
-- create extension if not exists pgcrypto;

-- 1) Ensure FK constraints use ON DELETE CASCADE

-- chat_sessions.visitor_id -> visitors.id
alter table public.chat_sessions
  drop constraint if exists chat_sessions_visitor_id_fkey;

alter table public.chat_sessions
  add constraint chat_sessions_visitor_id_fkey
  foreign key (visitor_id)
  references public.visitors(id)
  on delete cascade;

-- chat_messages.session_id -> chat_sessions.id
alter table public.chat_messages
  drop constraint if exists chat_messages_session_id_fkey;

alter table public.chat_messages
  add constraint chat_messages_session_id_fkey
  foreign key (session_id)
  references public.chat_sessions(id)
  on delete cascade;

-- chat_messages.visitor_id -> visitors.id
alter table public.chat_messages
  drop constraint if exists chat_messages_visitor_id_fkey;

alter table public.chat_messages
  add constraint chat_messages_visitor_id_fkey
  foreign key (visitor_id)
  references public.visitors(id)
  on delete cascade;

-- chat_message_sources.session_id -> chat_sessions.id (if you added it in Option 2)
alter table public.chat_message_sources
  drop constraint if exists chat_message_sources_session_fk;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'chat_message_sources'
      and column_name  = 'session_id'
  ) then
    alter table public.chat_message_sources
      add constraint chat_message_sources_session_fk
      foreign key (session_id)
      references public.chat_sessions(id)
      on delete cascade;
  end if;
end $$;

-- chat_message_sources.assistant_message_id -> chat_messages.id (cascade)
alter table public.chat_message_sources
  drop constraint if exists chat_message_sources_assistant_message_fk;

alter table public.chat_message_sources
  add constraint chat_message_sources_assistant_message_fk
  foreign key (assistant_message_id)
  references public.chat_messages(id)
  on delete cascade;

-- chat_message_sources.user_message_id -> chat_messages.id (if you added it)
alter table public.chat_message_sources
  drop constraint if exists chat_message_sources_user_message_fk;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'chat_message_sources'
      and column_name  = 'user_message_id'
  ) then
    alter table public.chat_message_sources
      add constraint chat_message_sources_user_message_fk
      foreign key (user_message_id)
      references public.chat_messages(id)
      on delete cascade;
  end if;
end $$;

-- 2) Admin RPC: delete visitor (one call)
-- NOTE: SECURITY DEFINER bypasses RLS, so we guard it with an auth check.
create schema if not exists private;

create or replace function private.admin_delete_visitor(p_visitor_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  -- Only allow authenticated users (admin UI)
  if auth.role() <> 'authenticated' then
    raise exception 'not allowed';
  end if;

  delete from public.visitors where id = p_visitor_id;
end;
$$;

-- Allow authenticated clients to call the function
grant execute on function private.admin_delete_visitor(uuid) to authenticated;
