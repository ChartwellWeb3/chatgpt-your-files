-- READ ONLY. Run individual queries after 20261109170000_geo_read_optimization.sql.
-- Change 'qa' to 'prod' to inspect the other environment.

select public.geo_live_status('qa');

-- Compare the compact overview with the existing metric definition for the same
-- benchmark and Toronto calendar period. No data or processing jobs are changed.
with chosen as (
 select id,environment,(now() at time zone 'America/Toronto')::date as last_day
 from public.geo_benchmarks where environment='qa' order by created_at desc limit 1
), reports as (
 select c.*,public.geo_overview(c.environment,c.id,c.last_day-29,c.last_day) as compact
 from chosen c
), old_metric as (
 select m.* from chosen c cross join lateral public.geo_brand_metrics(c.environment,c.id,
   (c.last_day-29)::timestamp at time zone 'America/Toronto',
   (c.last_day+1)::timestamp at time zone 'America/Toronto','overall',null,null,null,'unbranded',false) m
 where m.is_chartwell
)
select r.compact->'chartwell' as compact_metric,
 to_jsonb(m)-'group_key'-'group_label'-'brand_id'-'brand_name'-'is_chartwell' as existing_metric,
 r.compact->'counts' as counts,r.compact->'differences' as differences,
 r.compact->>'previousFrom' as previous_from,r.compact->>'previousTo' as previous_to,
 r.compact->'trend' as weekly_points
from reports r cross join old_metric m;

-- The weekly list includes gaps with visibility=null. Topic/market arrays are sorted.
with chosen as (
 select id,environment from public.geo_benchmarks where environment='qa' order by created_at desc limit 1
)
select public.geo_overview(environment,id,'2026-10-20'::date,'2026-11-09'::date) from chosen;

-- These functions must not be callable with browser keys.
select has_function_privilege('anon','public.geo_overview(text,uuid,date,date,uuid,uuid,text)','EXECUTE') as anon_overview,
 has_function_privilege('authenticated','public.geo_overview(text,uuid,date,date,uuid,uuid,text)','EXECUTE') as browser_overview,
 has_function_privilege('anon','public.geo_live_status(text)','EXECUTE') as anon_status;
