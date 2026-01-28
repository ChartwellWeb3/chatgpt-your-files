alter table public.chat_visitor_analyses
  add column if not exists prompt_scope text not null default 'unknown'
    check (prompt_scope in ('property', 'corporate', 'unknown')),
  add column if not exists prompt_adherence_1_to_10 int not null default 5
    check (prompt_adherence_1_to_10 between 1 and 10),
  add column if not exists prompt_violations text[] null;
