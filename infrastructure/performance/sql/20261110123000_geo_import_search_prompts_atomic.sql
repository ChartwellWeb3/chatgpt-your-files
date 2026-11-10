-- PERFORMANCE Supabase project: replacement for the 12:00 prompt import.
-- Run this COMPLETE file in SQL Editor. No temporary tables or persistent helper functions.
-- The DO block below is one SQL statement, so setup, checks, and inserts are atomic.
-- Requires the existing GEO schema and the 20261109150000 schedule-checkbox update.
-- Same 92 English prompts and IDs as the first file; all 8 near-me prompts excluded.
-- Existing matching questions/edits/approvals are preserved. New questions are drafts,
-- Monday collection OFF. No AI requests or collection jobs are started.
-- The earlier SQL file remains unchanged; use this replacement instead.

do $geo_prompt_import$
declare
 -- CHANGE 'qa' TO 'prod' HERE ONLY IF THE IMPORT IS FOR PRODUCTION.
 import_environment text := 'qa';
 import_key constant text := 'geo-search-prompts-20261110-v1';
 market_manifest jsonb := $geo_markets$
[
  {"slug": "canada", "name": "Canada / General", "scope": "national", "province": null, "city": null},
  {"slug": "ontario", "name": "Ontario", "scope": "province", "province": "Ontario", "city": null},
  {"slug": "quebec", "name": "Quebec", "scope": "province", "province": "Quebec", "city": null},
  {"slug": "toronto", "name": "Toronto", "scope": "city", "province": "Ontario", "city": "Toronto"},
  {"slug": "ottawa", "name": "Ottawa", "scope": "city", "province": "Ontario", "city": "Ottawa"},
  {"slug": "london", "name": "London (Ontario)", "scope": "city", "province": "Ontario", "city": "London"},
  {"slug": "barrie", "name": "Barrie", "scope": "city", "province": "Ontario", "city": "Barrie"},
  {"slug": "hamilton", "name": "Hamilton", "scope": "city", "province": "Ontario", "city": "Hamilton"},
  {"slug": "kitchener", "name": "Kitchener", "scope": "city", "province": "Ontario", "city": "Kitchener"},
  {"slug": "waterloo", "name": "Waterloo", "scope": "city", "province": "Ontario", "city": "Waterloo"},
  {"slug": "mississauga", "name": "Mississauga", "scope": "city", "province": "Ontario", "city": "Mississauga"},
  {"slug": "pickering", "name": "Pickering", "scope": "city", "province": "Ontario", "city": "Pickering"},
  {"slug": "bowmanville", "name": "Bowmanville", "scope": "city", "province": "Ontario", "city": "Bowmanville"},
  {"slug": "oakville", "name": "Oakville", "scope": "city", "province": "Ontario", "city": "Oakville"},
  {"slug": "etobicoke", "name": "Toronto / Etobicoke", "scope": "city", "province": "Ontario", "city": "Toronto"},
  {"slug": "burlington", "name": "Burlington", "scope": "city", "province": "Ontario", "city": "Burlington"},
  {"slug": "cambridge", "name": "Cambridge", "scope": "city", "province": "Ontario", "city": "Cambridge"},
  {"slug": "guelph", "name": "Guelph", "scope": "city", "province": "Ontario", "city": "Guelph"},
  {"slug": "brantford", "name": "Brantford", "scope": "city", "province": "Ontario", "city": "Brantford"},
  {"slug": "woodstock", "name": "Woodstock", "scope": "city", "province": "Ontario", "city": "Woodstock"},
  {"slug": "cornwall", "name": "Cornwall", "scope": "city", "province": "Ontario", "city": "Cornwall"},
  {"slug": "brockville", "name": "Brockville", "scope": "city", "province": "Ontario", "city": "Brockville"},
  {"slug": "kingston", "name": "Kingston", "scope": "city", "province": "Ontario", "city": "Kingston"},
  {"slug": "calgary", "name": "Calgary", "scope": "city", "province": "Alberta", "city": "Calgary"},
  {"slug": "edmonton", "name": "Edmonton", "scope": "city", "province": "Alberta", "city": "Edmonton"},
  {"slug": "victoria", "name": "Victoria", "scope": "city", "province": "British Columbia", "city": "Victoria"},
  {"slug": "vancouver", "name": "Vancouver", "scope": "city", "province": "British Columbia", "city": "Vancouver"},
  {"slug": "langley", "name": "Langley", "scope": "city", "province": "British Columbia", "city": "Langley"},
  {"slug": "kamloops", "name": "Kamloops", "scope": "city", "province": "British Columbia", "city": "Kamloops"},
  {"slug": "kelowna", "name": "Kelowna", "scope": "city", "province": "British Columbia", "city": "Kelowna"},
  {"slug": "montreal", "name": "Montreal", "scope": "city", "province": "Quebec", "city": "Montreal"},
  {"slug": "gatineau", "name": "Gatineau", "scope": "city", "province": "Quebec", "city": "Gatineau"}
]
$geo_markets$::jsonb;
 prompt_manifest jsonb := $geo_prompts$
[
  {"n": 1, "question": "retirement home", "topic_slug": "retirement-living", "market_slug": "canada", "question_kind": "unbranded"},
  {"n": 2, "question": "retirement homes", "topic_slug": "retirement-living", "market_slug": "canada", "question_kind": "unbranded"},
  {"n": 3, "question": "retirement homes Toronto", "topic_slug": "retirement-living", "market_slug": "toronto", "question_kind": "unbranded"},
  {"n": 4, "question": "retirement homes Ottawa", "topic_slug": "retirement-living", "market_slug": "ottawa", "question_kind": "unbranded"},
  {"n": 5, "question": "retirement homes London Ontario", "topic_slug": "retirement-living", "market_slug": "london", "question_kind": "unbranded"},
  {"n": 6, "question": "retirement homes Barrie", "topic_slug": "retirement-living", "market_slug": "barrie", "question_kind": "unbranded"},
  {"n": 7, "question": "retirement homes Hamilton", "topic_slug": "retirement-living", "market_slug": "hamilton", "question_kind": "unbranded"},
  {"n": 8, "question": "retirement homes Kitchener", "topic_slug": "retirement-living", "market_slug": "kitchener", "question_kind": "unbranded"},
  {"n": 9, "question": "retirement homes Waterloo", "topic_slug": "retirement-living", "market_slug": "waterloo", "question_kind": "unbranded"},
  {"n": 10, "question": "retirement homes Mississauga", "topic_slug": "retirement-living", "market_slug": "mississauga", "question_kind": "unbranded"},
  {"n": 11, "question": "retirement homes Pickering", "topic_slug": "retirement-living", "market_slug": "pickering", "question_kind": "unbranded"},
  {"n": 12, "question": "retirement homes Bowmanville", "topic_slug": "retirement-living", "market_slug": "bowmanville", "question_kind": "unbranded"},
  {"n": 13, "question": "retirement homes Oakville", "topic_slug": "retirement-living", "market_slug": "oakville", "question_kind": "unbranded"},
  {"n": 14, "question": "retirement homes Etobicoke", "topic_slug": "retirement-living", "market_slug": "etobicoke", "question_kind": "unbranded"},
  {"n": 15, "question": "retirement homes Burlington", "topic_slug": "retirement-living", "market_slug": "burlington", "question_kind": "unbranded"},
  {"n": 16, "question": "retirement homes Cambridge", "topic_slug": "retirement-living", "market_slug": "cambridge", "question_kind": "unbranded"},
  {"n": 17, "question": "retirement homes Guelph", "topic_slug": "retirement-living", "market_slug": "guelph", "question_kind": "unbranded"},
  {"n": 18, "question": "retirement homes Brantford", "topic_slug": "retirement-living", "market_slug": "brantford", "question_kind": "unbranded"},
  {"n": 19, "question": "retirement homes Woodstock", "topic_slug": "retirement-living", "market_slug": "woodstock", "question_kind": "unbranded"},
  {"n": 20, "question": "retirement homes Cornwall", "topic_slug": "retirement-living", "market_slug": "cornwall", "question_kind": "unbranded"},
  {"n": 21, "question": "retirement homes Brockville", "topic_slug": "retirement-living", "market_slug": "brockville", "question_kind": "unbranded"},
  {"n": 22, "question": "retirement homes Kingston", "topic_slug": "retirement-living", "market_slug": "kingston", "question_kind": "unbranded"},
  {"n": 23, "question": "retirement residences Toronto", "topic_slug": "retirement-living", "market_slug": "toronto", "question_kind": "unbranded"},
  {"n": 24, "question": "retirement residences Ottawa", "topic_slug": "retirement-living", "market_slug": "ottawa", "question_kind": "unbranded"},
  {"n": 25, "question": "retirement residences London Ontario", "topic_slug": "retirement-living", "market_slug": "london", "question_kind": "unbranded"},
  {"n": 26, "question": "retirement residences Mississauga", "topic_slug": "retirement-living", "market_slug": "mississauga", "question_kind": "unbranded"},
  {"n": 27, "question": "retirement residences Pickering", "topic_slug": "retirement-living", "market_slug": "pickering", "question_kind": "unbranded"},
  {"n": 28, "question": "retirement residences Bowmanville", "topic_slug": "retirement-living", "market_slug": "bowmanville", "question_kind": "unbranded"},
  {"n": 29, "question": "retirement residences Oakville", "topic_slug": "retirement-living", "market_slug": "oakville", "question_kind": "unbranded"},
  {"n": 30, "question": "retirement residences Etobicoke", "topic_slug": "retirement-living", "market_slug": "etobicoke", "question_kind": "unbranded"},
  {"n": 31, "question": "retirement residences Cambridge", "topic_slug": "retirement-living", "market_slug": "cambridge", "question_kind": "unbranded"},
  {"n": 32, "question": "retirement residences Guelph", "topic_slug": "retirement-living", "market_slug": "guelph", "question_kind": "unbranded"},
  {"n": 33, "question": "retirement residences Brantford", "topic_slug": "retirement-living", "market_slug": "brantford", "question_kind": "unbranded"},
  {"n": 34, "question": "retirement residences Woodstock", "topic_slug": "retirement-living", "market_slug": "woodstock", "question_kind": "unbranded"},
  {"n": 35, "question": "retirement residences Cornwall", "topic_slug": "retirement-living", "market_slug": "cornwall", "question_kind": "unbranded"},
  {"n": 36, "question": "retirement residences Brockville", "topic_slug": "retirement-living", "market_slug": "brockville", "question_kind": "unbranded"},
  {"n": 37, "question": "retirement residences Kingston", "topic_slug": "retirement-living", "market_slug": "kingston", "question_kind": "unbranded"},
  {"n": 38, "question": "assisted living Toronto", "topic_slug": "assisted-living", "market_slug": "toronto", "question_kind": "unbranded"},
  {"n": 39, "question": "assisted living Ottawa", "topic_slug": "assisted-living", "market_slug": "ottawa", "question_kind": "unbranded"},
  {"n": 40, "question": "assisted living London Ontario", "topic_slug": "assisted-living", "market_slug": "london", "question_kind": "unbranded"},
  {"n": 41, "question": "assisted living Mississauga", "topic_slug": "assisted-living", "market_slug": "mississauga", "question_kind": "unbranded"},
  {"n": 42, "question": "assisted living Pickering", "topic_slug": "assisted-living", "market_slug": "pickering", "question_kind": "unbranded"},
  {"n": 43, "question": "assisted living Burlington", "topic_slug": "assisted-living", "market_slug": "burlington", "question_kind": "unbranded"},
  {"n": 44, "question": "assisted living Kitchener", "topic_slug": "assisted-living", "market_slug": "kitchener", "question_kind": "unbranded"},
  {"n": 45, "question": "assisted living Waterloo", "topic_slug": "assisted-living", "market_slug": "waterloo", "question_kind": "unbranded"},
  {"n": 46, "question": "assisted living Calgary", "topic_slug": "assisted-living", "market_slug": "calgary", "question_kind": "unbranded"},
  {"n": 47, "question": "assisted living Edmonton", "topic_slug": "assisted-living", "market_slug": "edmonton", "question_kind": "unbranded"},
  {"n": 48, "question": "assisted living Victoria", "topic_slug": "assisted-living", "market_slug": "victoria", "question_kind": "unbranded"},
  {"n": 49, "question": "assisted living Vancouver", "topic_slug": "assisted-living", "market_slug": "vancouver", "question_kind": "unbranded"},
  {"n": 50, "question": "assisted living Langley", "topic_slug": "assisted-living", "market_slug": "langley", "question_kind": "unbranded"},
  {"n": 51, "question": "assisted living Gatineau", "topic_slug": "assisted-living", "market_slug": "gatineau", "question_kind": "unbranded"},
  {"n": 52, "question": "assisted living Montreal", "topic_slug": "assisted-living", "market_slug": "montreal", "question_kind": "unbranded"},
  {"n": 53, "question": "memory care Toronto", "topic_slug": "memory-care", "market_slug": "toronto", "question_kind": "unbranded"},
  {"n": 54, "question": "memory care Ottawa", "topic_slug": "memory-care", "market_slug": "ottawa", "question_kind": "unbranded"},
  {"n": 55, "question": "memory care Oakville", "topic_slug": "memory-care", "market_slug": "oakville", "question_kind": "unbranded"},
  {"n": 56, "question": "memory care Etobicoke", "topic_slug": "memory-care", "market_slug": "etobicoke", "question_kind": "unbranded"},
  {"n": 57, "question": "memory care Pickering", "topic_slug": "memory-care", "market_slug": "pickering", "question_kind": "unbranded"},
  {"n": 58, "question": "memory care Calgary", "topic_slug": "memory-care", "market_slug": "calgary", "question_kind": "unbranded"},
  {"n": 59, "question": "memory care Edmonton", "topic_slug": "memory-care", "market_slug": "edmonton", "question_kind": "unbranded"},
  {"n": 60, "question": "memory care Victoria", "topic_slug": "memory-care", "market_slug": "victoria", "question_kind": "unbranded"},
  {"n": 61, "question": "memory care Vancouver", "topic_slug": "memory-care", "market_slug": "vancouver", "question_kind": "unbranded"},
  {"n": 62, "question": "memory care Langley", "topic_slug": "memory-care", "market_slug": "langley", "question_kind": "unbranded"},
  {"n": 63, "question": "memory care Montreal", "topic_slug": "memory-care", "market_slug": "montreal", "question_kind": "unbranded"},
  {"n": 64, "question": "memory care Gatineau", "topic_slug": "memory-care", "market_slug": "gatineau", "question_kind": "unbranded"},
  {"n": 65, "question": "senior living Ontario", "topic_slug": "retirement-living", "market_slug": "ontario", "question_kind": "unbranded"},
  {"n": 66, "question": "senior living Toronto", "topic_slug": "retirement-living", "market_slug": "toronto", "question_kind": "unbranded"},
  {"n": 67, "question": "senior living Ottawa", "topic_slug": "retirement-living", "market_slug": "ottawa", "question_kind": "unbranded"},
  {"n": 68, "question": "senior living Calgary", "topic_slug": "retirement-living", "market_slug": "calgary", "question_kind": "unbranded"},
  {"n": 69, "question": "senior living Edmonton", "topic_slug": "retirement-living", "market_slug": "edmonton", "question_kind": "unbranded"},
  {"n": 70, "question": "senior living Victoria", "topic_slug": "retirement-living", "market_slug": "victoria", "question_kind": "unbranded"},
  {"n": 71, "question": "senior living Vancouver", "topic_slug": "retirement-living", "market_slug": "vancouver", "question_kind": "unbranded"},
  {"n": 72, "question": "senior living Langley", "topic_slug": "retirement-living", "market_slug": "langley", "question_kind": "unbranded"},
  {"n": 73, "question": "senior living Kamloops", "topic_slug": "retirement-living", "market_slug": "kamloops", "question_kind": "unbranded"},
  {"n": 74, "question": "senior living Kelowna", "topic_slug": "retirement-living", "market_slug": "kelowna", "question_kind": "unbranded"},
  {"n": 75, "question": "senior living Montreal", "topic_slug": "retirement-living", "market_slug": "montreal", "question_kind": "unbranded"},
  {"n": 76, "question": "senior living Gatineau", "topic_slug": "retirement-living", "market_slug": "gatineau", "question_kind": "unbranded"},
  {"n": 77, "question": "best retirement homes in Toronto", "topic_slug": "comparison", "market_slug": "toronto", "question_kind": "unbranded"},
  {"n": 78, "question": "best retirement homes in Ottawa", "topic_slug": "comparison", "market_slug": "ottawa", "question_kind": "unbranded"},
  {"n": 79, "question": "best retirement homes in Mississauga", "topic_slug": "comparison", "market_slug": "mississauga", "question_kind": "unbranded"},
  {"n": 80, "question": "best retirement homes in London Ontario", "topic_slug": "comparison", "market_slug": "london", "question_kind": "unbranded"},
  {"n": 81, "question": "best retirement homes in Calgary", "topic_slug": "comparison", "market_slug": "calgary", "question_kind": "unbranded"},
  {"n": 82, "question": "best retirement homes in Edmonton", "topic_slug": "comparison", "market_slug": "edmonton", "question_kind": "unbranded"},
  {"n": 83, "question": "best retirement homes in Victoria", "topic_slug": "comparison", "market_slug": "victoria", "question_kind": "unbranded"},
  {"n": 84, "question": "best retirement homes in Montreal", "topic_slug": "comparison", "market_slug": "montreal", "question_kind": "unbranded"},
  {"n": 85, "question": "Chartwell vs Amica retirement residences", "topic_slug": "comparison", "market_slug": "canada", "question_kind": "branded"},
  {"n": 86, "question": "Chartwell vs Sienna retirement homes", "topic_slug": "comparison", "market_slug": "canada", "question_kind": "branded"},
  {"n": 87, "question": "Chartwell vs Cogir senior residences Quebec", "topic_slug": "comparison", "market_slug": "quebec", "question_kind": "branded"},
  {"n": 88, "question": "best retirement residence companies in Ontario", "topic_slug": "comparison", "market_slug": "ontario", "question_kind": "unbranded"},
  {"n": 89, "question": "best senior living companies in Canada", "topic_slug": "comparison", "market_slug": "canada", "question_kind": "unbranded"},
  {"n": 90, "question": "which websites compare retirement homes in Canada", "topic_slug": "comparison", "market_slug": "canada", "question_kind": "unbranded"},
  {"n": 91, "question": "looking for a retirement residence for my mother in Ottawa", "topic_slug": "retirement-living", "market_slug": "ottawa", "question_kind": "unbranded"},
  {"n": 92, "question": "helping my parents find a senior residence in Montreal", "topic_slug": "retirement-living", "market_slug": "montreal", "question_kind": "unbranded"}
]
$geo_prompts$::jsonb;
 market_record record;
 prompt_record record;
 saved_market public.geo_markets%rowtype;
 topic_uuid uuid;
 market_uuid uuid;
 added integer := 0;
 affected integer;
 province_matches boolean;
begin
 if import_environment not in ('qa','prod') then
  raise exception 'Import environment must be qa or prod.';
 end if;
 if not exists(select 1 from information_schema.columns
   where table_schema='public' and table_name='geo_questions' and column_name='schedule_included') then
  raise exception 'Install 20261109150000_geo_answer_validation_and_question_schedule.sql before this import.';
 end if;
 if jsonb_array_length(prompt_manifest)<>92 or exists(
   select 1 from jsonb_array_elements(prompt_manifest) p where lower(p->>'question') like '%near me%') then
  raise exception 'Expected exactly 92 prompts with all near-me prompts excluded.';
 end if;
 perform pg_advisory_xact_lock(hashtext('geo-question-import:'||import_environment));

 insert into public.geo_topics(slug,name) values
  ('retirement-living','Retirement Living'),('assisted-living','Assisted Living'),
  ('memory-care','Memory Care'),('comparison','Comparison')
 on conflict(slug) do nothing;

 for market_record in select * from jsonb_to_recordset(market_manifest)
   as m(slug text,name text,scope text,province text,city text) loop
  insert into public.geo_markets(slug,name,scope,country_code,province,city)
  values(market_record.slug,market_record.name,market_record.scope,'CA',market_record.province,market_record.city)
  on conflict(slug) do nothing;
  select m.* into saved_market from public.geo_markets m where m.slug=market_record.slug;
  province_matches := case
   when market_record.province is null then saved_market.province is null
   when market_record.province='Ontario' then lower(btrim(saved_market.province)) in ('ontario','on')
   when market_record.province='Alberta' then lower(btrim(saved_market.province)) in ('alberta','ab')
   when market_record.province='British Columbia' then lower(btrim(saved_market.province)) in ('british columbia','bc')
   when market_record.province='Quebec' then lower(btrim(saved_market.province)) in ('quebec','québec','qc')
   else false end;
  if saved_market.id is null or saved_market.country_code<>'CA' or saved_market.scope<>market_record.scope
     or not coalesce(province_matches,false) then
   raise exception 'Existing market % conflicts with the expected Canadian geography. No questions were imported.',market_record.slug;
  end if;
 end loop;

 for prompt_record in select * from jsonb_to_recordset(prompt_manifest)
   as p(n integer,question text,topic_slug text,market_slug text,question_kind text) order by p.n loop
  select t.id into topic_uuid from public.geo_topics t where t.slug=prompt_record.topic_slug;
  select m.id into market_uuid from public.geo_markets m where m.slug=prompt_record.market_slug;
  if topic_uuid is null or market_uuid is null then
   raise exception 'Missing topic or market for prompt %. No questions were imported.',prompt_record.n;
  end if;
  insert into public.geo_questions (
   id,environment,question,language,question_kind,topic_id,market_id,status,
   discovery_source,discovery_notes,source_reference,schedule_included
  )
  select md5(import_key||':'||import_environment||':'||lower(prompt_record.question))::uuid,
   import_environment,prompt_record.question,'en',prompt_record.question_kind,topic_uuid,market_uuid,'draft','manual',
   'User-supplied search prompt. Review wording and tags before approval.'||
    case when prompt_record.market_slug='canada' then ' No city or province was supplied; the market is Canada / General.' else '' end||
    case when prompt_record.market_slug='etobicoke' then ' Etobicoke is within Toronto; the collection city is Toronto.' else '' end,
   import_key,false
  where not exists (
   select 1 from public.geo_questions q where q.environment=import_environment and q.language='en'
    and lower(regexp_replace(btrim(q.question),'[[:space:]]+',' ','g'))=lower(prompt_record.question)
  )
  on conflict(id) do nothing;
  get diagnostics affected = row_count;
  added := added+affected;
 end loop;
 raise notice 'GEO import complete in %: 92 prompts checked, % inserted, % existing questions preserved. Near-me prompts excluded; new drafts have scheduling off.',
  import_environment,added,92-added;
end;
$geo_prompt_import$;

-- Independent read-only results: no temporary objects or shared session state.
-- Shows this import's saved rows in QA and/or production, with actual tags.
select q.environment,q.question,t.name as topic,m.name as market,m.province,m.city,
 q.language,q.question_kind,q.status,q.schedule_included
from public.geo_questions q
join public.geo_topics t on t.id=q.topic_id
join public.geo_markets m on m.id=q.market_id
where q.source_reference='geo-search-prompts-20261110-v1'
order by q.environment,q.question;
