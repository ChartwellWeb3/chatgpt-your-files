alter table public.chat_visitor_analyses
  add column if not exists intent_primary text,
  add column if not exists intents text[],
  add column if not exists intent_other text,
  add column if not exists missed_or_weak_answers jsonb,
  add column if not exists page_type text;

alter table public.chat_visitor_analyses
  add constraint chat_visitor_analyses_page_type_check
  check (page_type in ('corporate', 'residence', 'find_a_residence', 'unknown'));

create index if not exists idx_chat_visitor_analyses_page_type
  on public.chat_visitor_analyses (page_type);

create index if not exists idx_chat_visitor_analyses_source
  on public.chat_visitor_analyses (source);

create index if not exists idx_chat_visitor_analyses_intent_primary
  on public.chat_visitor_analyses (intent_primary);

create index if not exists idx_chat_visitor_analyses_intents_gin
  on public.chat_visitor_analyses using gin (intents);
