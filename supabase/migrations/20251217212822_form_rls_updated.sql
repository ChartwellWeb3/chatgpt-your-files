-- 1) Drop the unique constraint that forces upsert behavior
alter table public.visitor_forms
drop constraint if exists visitor_forms_visitor_id_form_type_key;

-- (optional but recommended) index for analytics
create index if not exists visitor_forms_visitor_id_idx
on public.visitor_forms(visitor_id);

create index if not exists visitor_forms_form_type_idx
on public.visitor_forms(form_type);

create index if not exists visitor_forms_submitted_at_idx
on public.visitor_forms(submitted_at desc);
