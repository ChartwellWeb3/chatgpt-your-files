alter table public.chat_review_requests
  add column if not exists requester_email text,
  add column if not exists reviewer_email text;
