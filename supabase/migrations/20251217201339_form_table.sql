-- Create table: visitor_forms
create table if not exists public.visitor_forms (
  id uuid primary key default gen_random_uuid(),

  -- relation
  visitor_id uuid not null
    references public.visitors(id)
    on delete cascade,

  -- what form it is (e.g. "book_a_tour", "contact", "waitlist")
  form_type text not null,

  -- which button was used: "dynamic" | "static"
  submitted_with_button text not null
    check (submitted_with_button in ('dynamic', 'static')),

  -- submission state
  is_submitted boolean not null default false,
  submitted_at timestamptz null,

  created_at timestamptz not null default now()
);

-- Indexes for analytics & lookups
create index if not exists visitor_forms_visitor_id_idx
  on public.visitor_forms(visitor_id);

create index if not exists visitor_forms_submitted_idx
  on public.visitor_forms(is_submitted, submitted_at);
