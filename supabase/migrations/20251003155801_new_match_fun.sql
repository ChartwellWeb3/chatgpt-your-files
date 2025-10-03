-- Safer public wrapper
create or replace function public.match_document_sections_public(
  p_embedding vector(384),
  p_match_threshold float,
  p_residence_custom_id text default null,
  p_limit int default 20
)
returns setof document_sections
language sql
security definer
set search_path = public, extensions
as $$
  -- IMPORTANT: use cosine similarity correctly
  -- similarity = 1 - distance; keep rows where similarity >= threshold
  select ds.*
  from document_sections ds
  join documents d on d.id = ds.document_id
  left join residences r on r.id = d.residence_id
  where
    (1 - (ds.embedding <#> p_embedding)) >= p_match_threshold
    and (
      (p_residence_custom_id is not null and (r.custom_id = p_residence_custom_id or d.is_common))
      or (p_residence_custom_id is null and d.is_common)
    )
  order by ds.embedding <#> p_embedding asc
  limit greatest(1, least(p_limit, 50));
$$;

revoke all on function public.match_document_sections_public(vector, float, text, int) from public;
grant execute on function public.match_document_sections_public(vector, float, text, int) to anon, authenticated;
