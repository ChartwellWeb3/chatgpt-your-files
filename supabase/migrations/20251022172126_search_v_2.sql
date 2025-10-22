-- 0) Extensions (safe to re-run)
create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- 1) Columns for FTS (no-op if already present)
alter table document_sections
  add column if not exists search_vector_en tsvector,
  add column if not exists search_vector_fr tsvector;

-- 2) Backfill existing rows (run once; harmless if re-run)
update document_sections
set
  search_vector_en = to_tsvector('english'::regconfig,
                      unaccent('unaccent'::regdictionary, coalesce(content,''))),
  search_vector_fr = to_tsvector('french'::regconfig,
                      unaccent('unaccent'::regdictionary, coalesce(content,'')));

-- 3) Trigger function (single definition)
create or replace function document_sections_tsvector_refresh()
returns trigger
language plpgsql
as $$
begin
  new.search_vector_en :=
    to_tsvector('english'::regconfig,
      unaccent('unaccent'::regdictionary, coalesce(new.content,'')));

  new.search_vector_fr :=
    to_tsvector('french'::regconfig,
      unaccent('unaccent'::regdictionary, coalesce(new.content,'')));

  return new;
end;
$$;

-- 4) Trigger (drop old, create new)
drop trigger if exists trg_document_sections_tsvector_refresh on document_sections;

create trigger trg_document_sections_tsvector_refresh
before insert or update of content
on document_sections
for each row
execute function document_sections_tsvector_refresh();

-- 5) Indexes for speed (safe to re-run)
create index if not exists idx_doc_sections_fts_en
  on document_sections using gin (search_vector_en);

create index if not exists idx_doc_sections_fts_fr
  on document_sections using gin (search_vector_fr);
