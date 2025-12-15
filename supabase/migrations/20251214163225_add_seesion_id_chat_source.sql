alter table public.chat_message_sources
  add column if not exists session_id uuid,
  add column if not exists user_message_id bigint;

-- (optional but recommended) add FKs if your schema supports it
alter table public.chat_message_sources
  add constraint chat_message_sources_session_fk
  foreign key (session_id) references public.chat_sessions(id)
  on delete cascade;

alter table public.chat_message_sources
  add constraint chat_message_sources_user_message_fk
  foreign key (user_message_id) references public.chat_messages(id)
  on delete cascade;
