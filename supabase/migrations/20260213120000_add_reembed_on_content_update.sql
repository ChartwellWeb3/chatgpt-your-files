create or replace function public.document_sections_embedding_reset()
returns trigger
language plpgsql
as $$
begin
  if new.content is distinct from old.content then
    new.embedding = null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_document_sections_embedding_reset on public.document_sections;
create trigger trg_document_sections_embedding_reset
before update of content on public.document_sections
for each row
execute function public.document_sections_embedding_reset();

drop trigger if exists embed_document_sections_update on public.document_sections;
create trigger embed_document_sections_update
after update on public.document_sections
referencing new table as inserted
for each statement
execute function private.embed('content', 'embedding');
