alter table public.chat_visitor_analyses
  add column if not exists evidence_visitor_goal text,
  add column if not exists evidence_goal_met text,
  add column if not exists evidence_key_quotes text[];
