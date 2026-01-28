alter table public.chat_visitor_analyses
  drop column if exists prompt_scope,
  drop column if exists prompt_adherence_1_to_10,
  drop column if exists prompt_violations;
