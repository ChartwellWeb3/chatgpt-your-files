-- Returns document and section citation performance based on chat_message_sources.
--
-- top_sections  — most-cited document_sections with document name and content preview
-- top_documents — most-cited documents (citations aggregated from all their sections)
-- dead_documents — documents with zero citations in the period (dead content for review)
--
-- p_start / p_end filter chat_message_sources.created_at.
-- p_limit controls how many top rows are returned per list (default 20).
create or replace function public.analytics_source_performance(
  p_start date default null,
  p_end   date default null,
  p_limit int  default 20
)
returns jsonb
language sql
security definer
set search_path = public
as $$
with
  -- citations in the period
  cited as (
    select
      document_section_id,
      count(*)::int as citation_count
    from public.chat_message_sources
    where (p_start is null or created_at >= p_start::timestamptz)
      and (p_end   is null or created_at <  (p_end + interval '1 day')::timestamptz)
    group by document_section_id
  ),

  -- enrich with section content, document name, and residence
  enriched as (
    select
      c.document_section_id,
      c.citation_count,
      ds.document_id,
      left(ds.content, 140)        as content_preview,
      d.name                       as document_name,
      d.is_common,
      d.residence_id,
      coalesce(r.name, '')         as residence_name
    from cited c
    join public.document_sections ds on ds.id = c.document_section_id
    join public.documents          d  on d.id  = ds.document_id
    left join public.residences    r  on r.id  = d.residence_id
  ),

  -- top cited sections
  top_sections_agg as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'section_id',      document_section_id,
          'document_id',     document_id,
          'document_name',   document_name,
          'content_preview', content_preview,
          'citation_count',  citation_count,
          'is_common',       is_common,
          'residence_name',  residence_name
        )
        order by citation_count desc
      ),
      '[]'::jsonb
    ) as data
    from (
      select * from enriched
      order by citation_count desc
      limit p_limit
    ) t
  ),

  -- citations aggregated per document
  doc_totals as (
    select
      document_id,
      document_name,
      is_common,
      residence_id,
      residence_name,
      sum(citation_count)::int as total_citations
    from enriched
    group by document_id, document_name, is_common, residence_id, residence_name
  ),

  -- top cited documents
  top_documents_agg as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'document_id',     document_id,
          'document_name',   document_name,
          'is_common',       is_common,
          'residence_name',  residence_name,
          'total_citations', total_citations
        )
        order by total_citations desc
      ),
      '[]'::jsonb
    ) as data
    from (
      select * from doc_totals
      order by total_citations desc
      limit p_limit
    ) t
  ),

  -- all documents with their citation total (0 for uncited)
  all_docs_with_counts as (
    select
      d.id               as document_id,
      d.name             as document_name,
      d.is_common,
      d.residence_id,
      coalesce(r.name, '') as residence_name,
      coalesce(dt.total_citations, 0) as total_citations
    from public.documents d
    left join doc_totals dt on dt.document_id = d.id
    left join public.residences r on r.id = d.residence_id
  ),

  -- dead documents: cited zero times in the period
  dead_docs_agg as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'document_id',   document_id,
          'document_name', document_name,
          'is_common',     is_common,
          'residence_name',residence_name
        )
        order by document_name
      ),
      '[]'::jsonb
    ) as data
    from all_docs_with_counts
    where total_citations = 0
  ),

  -- summary totals
  totals as (
    select
      coalesce(sum(citation_count), 0)::int as total_citations,
      count(*)::int                          as total_cited_sections
    from cited
  ),

  doc_counts as (
    select
      count(*)::int                                              as total_documents,
      count(*) filter (where total_citations = 0)::int           as dead_document_count
    from all_docs_with_counts
  )

select jsonb_build_object(
  'top_sections',        (select data from top_sections_agg),
  'top_documents',       (select data from top_documents_agg),
  'dead_documents',      (select data from dead_docs_agg),
  'total_citations',     (select total_citations     from totals),
  'total_cited_sections',(select total_cited_sections from totals),
  'total_documents',     (select total_documents     from doc_counts),
  'dead_document_count', (select dead_document_count from doc_counts)
);
$$;

revoke all on function public.analytics_source_performance(date, date, int) from public;
grant execute on function public.analytics_source_performance(date, date, int) to authenticated;
