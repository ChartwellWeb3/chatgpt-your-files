-- INSTALLATION: run this entire file once in the PERFORMANCE project's SQL Editor.
-- Requires the GEO queue, schedule-checkbox, and reporting updates already installed.
-- Then deploy the website. No worker, Cron, model, or secret changes are needed.
begin;

create index if not exists geo_question_metrics_history
 on public.geo_runs(environment,benchmark_id,question_id,question_revision,scheduled_for)
 where status='succeeded';

create function public.geo_question_metrics_page(
 p_environment text,p_benchmark_id uuid,p_from date,p_to date,
 p_topic_id uuid default null,p_market_id uuid default null,p_language text default null,
 p_question_kind text default null,p_status text default null,p_search text default '',
 p_page integer default 0,p_page_size integer default 10
) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare start_at timestamptz;end_at timestamptz;result jsonb;
begin
 if p_environment is null or p_environment not in ('qa','prod')
  or p_from is null or p_to is null or p_to<p_from or p_to-p_from>366
  or (p_benchmark_id is not null and not exists(select 1 from public.geo_benchmarks where id=p_benchmark_id and environment=p_environment))
  or (p_language is not null and p_language not in ('en','fr'))
  or (p_question_kind is not null and p_question_kind not in ('unbranded','branded'))
  or (p_status is not null and p_status not in ('draft','active','archived'))
  or length(coalesce(p_search,''))>200
  or p_page is null or p_page<0 or p_page>99999
  or p_page_size is null or p_page_size not between 1 and 50 then
  raise exception 'Invalid question metrics filters.' using errcode='22023';
 end if;
 start_at:=p_from::timestamp at time zone 'America/Toronto';
 end_at:=(p_to+1)::timestamp at time zone 'America/Toronto';
 with matching as materialized (
  select q.id,q.environment,q.question,q.language,q.question_kind,q.topic_id,q.market_id,q.status,q.revision,
   q.discovery_source,q.discovery_notes,q.updated_at,q.schedule_included
  from public.geo_questions q where q.environment=p_environment
   and (p_topic_id is null or q.topic_id=p_topic_id)
   and (p_market_id is null or q.market_id=p_market_id)
   and (p_language is null or q.language=p_language)
   and (p_question_kind is null or q.question_kind=p_question_kind)
   and (p_status is null or q.status=p_status)
   -- Literal substring search: %, _ and backslashes have no wildcard semantics.
   and (coalesce(btrim(p_search),'')='' or strpos(lower(q.question),lower(btrim(p_search)))>0)
 ), page_rows as materialized (
  select * from matching order by updated_at desc,id limit p_page_size offset p_page*p_page_size
 ), valid as materialized (
  -- Pagination happens first; only this page's questions require aggregation.
  select r.id,r.question_id,r.selected_attempt_id
  from page_rows q join public.geo_reporting_runs r on r.question_id=q.id and r.environment=q.environment
   and r.question_revision=q.revision
  join public.geo_run_attempts a on a.id=r.selected_attempt_id and a.run_id=r.id
  where p_benchmark_id is not null and r.benchmark_id=p_benchmark_id
   and r.scheduled_for>=start_at and r.scheduled_for<end_at
   and r.status='succeeded' and a.status='succeeded'
   and r.question_snapshot->>'questionKind'=q.question_kind
   and r.question_snapshot->>'language'=q.language
   and r.question_snapshot->>'topicId'=q.topic_id::text
   and r.question_snapshot->>'marketId'=q.market_id::text
 ), answer_mentions as materialized (
  -- One row per successful run, including answers with zero detected brands.
  select v.id,v.question_id,count(m.brand_id) as all_mentions,
   count(m.brand_id) filter(where b.is_chartwell) as chartwell_mentions
  from valid v left join public.geo_mentions m on m.attempt_id=v.selected_attempt_id
  left join public.geo_brands b on b.id=m.brand_id
  group by v.id,v.question_id
 ), metrics as (
  select question_id,count(*) as samples,sum(chartwell_mentions) as mentions,sum(all_mentions) as all_mentions,
   round(sum(chartwell_mentions)::numeric/nullif(count(*),0),6) as visibility_rate,
   round(sum(chartwell_mentions)::numeric/nullif(sum(all_mentions),0),6) as share_of_voice
  from answer_mentions group by question_id
 ) select jsonb_build_object(
  'rows',coalesce((select jsonb_agg(to_jsonb(q)||jsonb_build_object('metrics',
    case when p_benchmark_id is null then null else jsonb_build_object(
     'samples',coalesce(m.samples,0),'mentions',coalesce(m.mentions,0),'all_mentions',coalesce(m.all_mentions,0),
     'visibility_rate',m.visibility_rate,'share_of_voice',m.share_of_voice) end)
    order by q.updated_at desc,q.id)
    from page_rows q left join metrics m on m.question_id=q.id),'[]'::jsonb),
  'total',(select count(*) from matching),'page',p_page,'pageSize',p_page_size
 ) into result;
 return result;
end $$;

revoke all on function public.geo_question_metrics_page(text,uuid,date,date,uuid,uuid,text,text,text,text,integer,integer)
 from public,anon,authenticated;
grant execute on function public.geo_question_metrics_page(text,uuid,date,date,uuid,uuid,text,text,text,text,integer,integer)
 to service_role;
notify pgrst,'reload schema';
commit;
