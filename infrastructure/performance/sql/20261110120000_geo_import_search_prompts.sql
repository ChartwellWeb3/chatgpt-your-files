-- PERFORMANCE Supabase project: import 92 user-supplied search prompts.
-- Run this ENTIRE file in SQL Editor. Requires the existing GEO schema and
-- 20261109150000_geo_answer_validation_and_question_schedule.sql (schedule checkbox).
-- All eight "near me" prompts from the supplied list are intentionally excluded.
-- All 92 prompts are English: 89 unbranded and 3 branded comparisons.
-- New prompts are DRAFTS with Monday collection OFF. Approve/select them in the app.
-- No OpenAI requests, queue jobs, or schedule changes are made by this import.
-- Repeating the import preserves existing rows, including their edits and approvals.
-- The original supplied SQL files remain unchanged.
begin;

create temporary table _geo_prompt_import_settings (
 environment text not null check(environment in ('qa','prod')),
 import_key text not null
) on commit drop;
-- CHANGE ONLY 'qa' TO 'prod' BELOW IF THIS IMPORT IS FOR PRODUCTION.
insert into _geo_prompt_import_settings values ('qa','geo-search-prompts-20261110-v1');

do $$ begin
 perform pg_advisory_xact_lock(hashtext('geo-question-import:'||(select environment from _geo_prompt_import_settings)));
end $$;

-- Reuse existing topic IDs; do not rename topics already used by saved history.
insert into public.geo_topics(slug,name) values
  ('retirement-living','Retirement Living'),
  ('assisted-living','Assisted Living'),
  ('memory-care','Memory Care'),
  ('comparison','Comparison')
on conflict(slug) do nothing;

-- Canada / General is used only when no city/province is specified.
-- Province prompts remain province-wide. Every city carries its province and CA.
-- Etobicoke is a Toronto district: retain a separate local market label while
-- setting the worker's approximate city to Toronto. London means London, Ontario.
create temporary table _geo_prompt_import_markets (
 slug text primary key,name text not null,scope text not null,province text,city text
) on commit drop;
insert into _geo_prompt_import_markets(slug,name,scope,province,city) values
  ('canada', 'Canada / General', 'national', null, null),
  ('ontario', 'Ontario', 'province', 'Ontario', null),
  ('quebec', 'Quebec', 'province', 'Quebec', null),
  ('toronto', 'Toronto', 'city', 'Ontario', 'Toronto'),
  ('ottawa', 'Ottawa', 'city', 'Ontario', 'Ottawa'),
  ('london', 'London (Ontario)', 'city', 'Ontario', 'London'),
  ('barrie', 'Barrie', 'city', 'Ontario', 'Barrie'),
  ('hamilton', 'Hamilton', 'city', 'Ontario', 'Hamilton'),
  ('kitchener', 'Kitchener', 'city', 'Ontario', 'Kitchener'),
  ('waterloo', 'Waterloo', 'city', 'Ontario', 'Waterloo'),
  ('mississauga', 'Mississauga', 'city', 'Ontario', 'Mississauga'),
  ('pickering', 'Pickering', 'city', 'Ontario', 'Pickering'),
  ('bowmanville', 'Bowmanville', 'city', 'Ontario', 'Bowmanville'),
  ('oakville', 'Oakville', 'city', 'Ontario', 'Oakville'),
  ('etobicoke', 'Toronto / Etobicoke', 'city', 'Ontario', 'Toronto'),
  ('burlington', 'Burlington', 'city', 'Ontario', 'Burlington'),
  ('cambridge', 'Cambridge', 'city', 'Ontario', 'Cambridge'),
  ('guelph', 'Guelph', 'city', 'Ontario', 'Guelph'),
  ('brantford', 'Brantford', 'city', 'Ontario', 'Brantford'),
  ('woodstock', 'Woodstock', 'city', 'Ontario', 'Woodstock'),
  ('cornwall', 'Cornwall', 'city', 'Ontario', 'Cornwall'),
  ('brockville', 'Brockville', 'city', 'Ontario', 'Brockville'),
  ('kingston', 'Kingston', 'city', 'Ontario', 'Kingston'),
  ('calgary', 'Calgary', 'city', 'Alberta', 'Calgary'),
  ('edmonton', 'Edmonton', 'city', 'Alberta', 'Edmonton'),
  ('victoria', 'Victoria', 'city', 'British Columbia', 'Victoria'),
  ('vancouver', 'Vancouver', 'city', 'British Columbia', 'Vancouver'),
  ('langley', 'Langley', 'city', 'British Columbia', 'Langley'),
  ('kamloops', 'Kamloops', 'city', 'British Columbia', 'Kamloops'),
  ('kelowna', 'Kelowna', 'city', 'British Columbia', 'Kelowna'),
  ('montreal', 'Montreal', 'city', 'Quebec', 'Montreal'),
  ('gatineau', 'Gatineau', 'city', 'Quebec', 'Gatineau')
;
insert into public.geo_markets(slug,name,scope,province,city)
select slug,name,scope,province,city from _geo_prompt_import_markets
on conflict(slug) do nothing;

create temporary table _geo_prompt_import (
 n integer primary key,
 question text not null,
 topic_slug text not null,
 market_slug text not null,
 question_kind text not null check(question_kind in ('unbranded','branded'))
) on commit drop;
insert into _geo_prompt_import(n,question,topic_slug,market_slug,question_kind) values
  (1, 'retirement home', 'retirement-living', 'canada', 'unbranded'),
  (2, 'retirement homes', 'retirement-living', 'canada', 'unbranded'),
  (3, 'retirement homes Toronto', 'retirement-living', 'toronto', 'unbranded'),
  (4, 'retirement homes Ottawa', 'retirement-living', 'ottawa', 'unbranded'),
  (5, 'retirement homes London Ontario', 'retirement-living', 'london', 'unbranded'),
  (6, 'retirement homes Barrie', 'retirement-living', 'barrie', 'unbranded'),
  (7, 'retirement homes Hamilton', 'retirement-living', 'hamilton', 'unbranded'),
  (8, 'retirement homes Kitchener', 'retirement-living', 'kitchener', 'unbranded'),
  (9, 'retirement homes Waterloo', 'retirement-living', 'waterloo', 'unbranded'),
  (10, 'retirement homes Mississauga', 'retirement-living', 'mississauga', 'unbranded'),
  (11, 'retirement homes Pickering', 'retirement-living', 'pickering', 'unbranded'),
  (12, 'retirement homes Bowmanville', 'retirement-living', 'bowmanville', 'unbranded'),
  (13, 'retirement homes Oakville', 'retirement-living', 'oakville', 'unbranded'),
  (14, 'retirement homes Etobicoke', 'retirement-living', 'etobicoke', 'unbranded'),
  (15, 'retirement homes Burlington', 'retirement-living', 'burlington', 'unbranded'),
  (16, 'retirement homes Cambridge', 'retirement-living', 'cambridge', 'unbranded'),
  (17, 'retirement homes Guelph', 'retirement-living', 'guelph', 'unbranded'),
  (18, 'retirement homes Brantford', 'retirement-living', 'brantford', 'unbranded'),
  (19, 'retirement homes Woodstock', 'retirement-living', 'woodstock', 'unbranded'),
  (20, 'retirement homes Cornwall', 'retirement-living', 'cornwall', 'unbranded'),
  (21, 'retirement homes Brockville', 'retirement-living', 'brockville', 'unbranded'),
  (22, 'retirement homes Kingston', 'retirement-living', 'kingston', 'unbranded'),
  (23, 'retirement residences Toronto', 'retirement-living', 'toronto', 'unbranded'),
  (24, 'retirement residences Ottawa', 'retirement-living', 'ottawa', 'unbranded'),
  (25, 'retirement residences London Ontario', 'retirement-living', 'london', 'unbranded'),
  (26, 'retirement residences Mississauga', 'retirement-living', 'mississauga', 'unbranded'),
  (27, 'retirement residences Pickering', 'retirement-living', 'pickering', 'unbranded'),
  (28, 'retirement residences Bowmanville', 'retirement-living', 'bowmanville', 'unbranded'),
  (29, 'retirement residences Oakville', 'retirement-living', 'oakville', 'unbranded'),
  (30, 'retirement residences Etobicoke', 'retirement-living', 'etobicoke', 'unbranded'),
  (31, 'retirement residences Cambridge', 'retirement-living', 'cambridge', 'unbranded'),
  (32, 'retirement residences Guelph', 'retirement-living', 'guelph', 'unbranded'),
  (33, 'retirement residences Brantford', 'retirement-living', 'brantford', 'unbranded'),
  (34, 'retirement residences Woodstock', 'retirement-living', 'woodstock', 'unbranded'),
  (35, 'retirement residences Cornwall', 'retirement-living', 'cornwall', 'unbranded'),
  (36, 'retirement residences Brockville', 'retirement-living', 'brockville', 'unbranded'),
  (37, 'retirement residences Kingston', 'retirement-living', 'kingston', 'unbranded'),
  (38, 'assisted living Toronto', 'assisted-living', 'toronto', 'unbranded'),
  (39, 'assisted living Ottawa', 'assisted-living', 'ottawa', 'unbranded'),
  (40, 'assisted living London Ontario', 'assisted-living', 'london', 'unbranded'),
  (41, 'assisted living Mississauga', 'assisted-living', 'mississauga', 'unbranded'),
  (42, 'assisted living Pickering', 'assisted-living', 'pickering', 'unbranded'),
  (43, 'assisted living Burlington', 'assisted-living', 'burlington', 'unbranded'),
  (44, 'assisted living Kitchener', 'assisted-living', 'kitchener', 'unbranded'),
  (45, 'assisted living Waterloo', 'assisted-living', 'waterloo', 'unbranded'),
  (46, 'assisted living Calgary', 'assisted-living', 'calgary', 'unbranded'),
  (47, 'assisted living Edmonton', 'assisted-living', 'edmonton', 'unbranded'),
  (48, 'assisted living Victoria', 'assisted-living', 'victoria', 'unbranded'),
  (49, 'assisted living Vancouver', 'assisted-living', 'vancouver', 'unbranded'),
  (50, 'assisted living Langley', 'assisted-living', 'langley', 'unbranded'),
  (51, 'assisted living Gatineau', 'assisted-living', 'gatineau', 'unbranded'),
  (52, 'assisted living Montreal', 'assisted-living', 'montreal', 'unbranded'),
  (53, 'memory care Toronto', 'memory-care', 'toronto', 'unbranded'),
  (54, 'memory care Ottawa', 'memory-care', 'ottawa', 'unbranded'),
  (55, 'memory care Oakville', 'memory-care', 'oakville', 'unbranded'),
  (56, 'memory care Etobicoke', 'memory-care', 'etobicoke', 'unbranded'),
  (57, 'memory care Pickering', 'memory-care', 'pickering', 'unbranded'),
  (58, 'memory care Calgary', 'memory-care', 'calgary', 'unbranded'),
  (59, 'memory care Edmonton', 'memory-care', 'edmonton', 'unbranded'),
  (60, 'memory care Victoria', 'memory-care', 'victoria', 'unbranded'),
  (61, 'memory care Vancouver', 'memory-care', 'vancouver', 'unbranded'),
  (62, 'memory care Langley', 'memory-care', 'langley', 'unbranded'),
  (63, 'memory care Montreal', 'memory-care', 'montreal', 'unbranded'),
  (64, 'memory care Gatineau', 'memory-care', 'gatineau', 'unbranded'),
  (65, 'senior living Ontario', 'retirement-living', 'ontario', 'unbranded'),
  (66, 'senior living Toronto', 'retirement-living', 'toronto', 'unbranded'),
  (67, 'senior living Ottawa', 'retirement-living', 'ottawa', 'unbranded'),
  (68, 'senior living Calgary', 'retirement-living', 'calgary', 'unbranded'),
  (69, 'senior living Edmonton', 'retirement-living', 'edmonton', 'unbranded'),
  (70, 'senior living Victoria', 'retirement-living', 'victoria', 'unbranded'),
  (71, 'senior living Vancouver', 'retirement-living', 'vancouver', 'unbranded'),
  (72, 'senior living Langley', 'retirement-living', 'langley', 'unbranded'),
  (73, 'senior living Kamloops', 'retirement-living', 'kamloops', 'unbranded'),
  (74, 'senior living Kelowna', 'retirement-living', 'kelowna', 'unbranded'),
  (75, 'senior living Montreal', 'retirement-living', 'montreal', 'unbranded'),
  (76, 'senior living Gatineau', 'retirement-living', 'gatineau', 'unbranded'),
  (77, 'best retirement homes in Toronto', 'comparison', 'toronto', 'unbranded'),
  (78, 'best retirement homes in Ottawa', 'comparison', 'ottawa', 'unbranded'),
  (79, 'best retirement homes in Mississauga', 'comparison', 'mississauga', 'unbranded'),
  (80, 'best retirement homes in London Ontario', 'comparison', 'london', 'unbranded'),
  (81, 'best retirement homes in Calgary', 'comparison', 'calgary', 'unbranded'),
  (82, 'best retirement homes in Edmonton', 'comparison', 'edmonton', 'unbranded'),
  (83, 'best retirement homes in Victoria', 'comparison', 'victoria', 'unbranded'),
  (84, 'best retirement homes in Montreal', 'comparison', 'montreal', 'unbranded'),
  (85, 'Chartwell vs Amica retirement residences', 'comparison', 'canada', 'branded'),
  (86, 'Chartwell vs Sienna retirement homes', 'comparison', 'canada', 'branded'),
  (87, 'Chartwell vs Cogir senior residences Quebec', 'comparison', 'quebec', 'branded'),
  (88, 'best retirement residence companies in Ontario', 'comparison', 'ontario', 'unbranded'),
  (89, 'best senior living companies in Canada', 'comparison', 'canada', 'unbranded'),
  (90, 'which websites compare retirement homes in Canada', 'comparison', 'canada', 'unbranded'),
  (91, 'looking for a retirement residence for my mother in Ottawa', 'retirement-living', 'ottawa', 'unbranded'),
  (92, 'helping my parents find a senior residence in Montreal', 'retirement-living', 'montreal', 'unbranded');

-- Abort rather than silently lose a prompt through a missing taxonomy reference.
do $$ begin
 if (select count(*) from _geo_prompt_import)<>92
   or exists(select 1 from _geo_prompt_import where lower(question) like '%near me%') then
  raise exception 'Expected exactly 92 prompts, excluding every near-me prompt.';
 end if;
 if exists(select 1 from _geo_prompt_import_markets e join public.geo_markets m on m.slug=e.slug
   where m.country_code<>'CA' or m.scope<>e.scope
     or (e.province is null and m.province is not null)
     or (e.province is not null and not coalesce(lower(btrim(m.province))=any(
       case e.province when 'Ontario' then array['ontario','on']
         when 'Alberta' then array['alberta','ab']
         when 'British Columbia' then array['british columbia','bc']
         when 'Quebec' then array['quebec','québec','qc'] end),false))) then
  raise exception 'An existing market conflicts with the requested Canadian geography. Inspect geo_markets before importing.';
 end if;
 if exists(select 1 from _geo_prompt_import p
   left join public.geo_topics t on t.slug=p.topic_slug
   left join public.geo_markets m on m.slug=p.market_slug where t.id is null or m.id is null) then
  raise exception 'Missing GEO topic or market; no questions were imported.';
 end if;
end $$;

create temporary table _geo_prompt_import_added(id uuid primary key) on commit drop;
with added as (
 insert into public.geo_questions (
   id,environment,question,language,question_kind,topic_id,market_id,status,
   discovery_source,discovery_notes,source_reference,schedule_included
 )
 select md5(s.import_key||':'||s.environment||':'||lower(p.question))::uuid,
   s.environment,p.question,'en',p.question_kind,t.id,m.id,'draft','manual',
   'User-supplied search prompt. Review wording and tags before approval.'||
     case when p.market_slug='canada' then ' No city or province was supplied; the market is Canada / General.' else '' end||
     case when p.market_slug='etobicoke' then ' Etobicoke is within Toronto; the collection city is Toronto.' else '' end,
   s.import_key,false
 from _geo_prompt_import p cross join _geo_prompt_import_settings s
 join public.geo_topics t on t.slug=p.topic_slug
 join public.geo_markets m on m.slug=p.market_slug
 -- Preserve matching existing prompts even if they came from a different import.
 -- Normalize whitespace/case for duplicate matching; singular/plural stay distinct.
 where not exists (
   select 1 from public.geo_questions q where q.environment=s.environment and q.language='en'
    and lower(regexp_replace(btrim(q.question),'[[:space:]]+',' ','g'))=lower(p.question)
 )
 on conflict(id) do nothing
 returning id
)
insert into _geo_prompt_import_added(id) select id from added;

-- Summary. Newly imported rows remain drafts with Monday collection disabled.
select s.environment,92 as supplied_prompts,
 (select count(*) from _geo_prompt_import_added) as inserted_now,
 92-(select count(*) from _geo_prompt_import_added) as already_present,
 89 as unbranded_prompts,3 as branded_prompts,8 as excluded_near_me_prompts
from _geo_prompt_import_settings s;

-- Review all requested prompts and their actual saved tags after the import.
-- Existing matching questions are preserved; tags_match_requested flags any
-- earlier custom tagging for manual review instead of overwriting that history.
select p.n,q.id,q.question,t.name as topic,m.name as market,m.province,m.city,
 q.language,q.question_kind,q.status,q.schedule_included,
 (a.id is not null) as inserted_now,
 (t.slug=p.topic_slug and m.slug=p.market_slug and q.language='en'
   and q.question_kind=p.question_kind) as tags_match_requested
from _geo_prompt_import p cross join _geo_prompt_import_settings s
cross join lateral (
 select q0.* from public.geo_questions q0 where q0.environment=s.environment and (
   q0.id=md5(s.import_key||':'||s.environment||':'||lower(p.question))::uuid or
   (q0.language='en' and lower(regexp_replace(btrim(q0.question),'[[:space:]]+',' ','g'))=lower(p.question))
 ) order by (q0.id=md5(s.import_key||':'||s.environment||':'||lower(p.question))::uuid) desc,q0.created_at,q0.id limit 1
) q
join public.geo_topics t on t.id=q.topic_id
join public.geo_markets m on m.id=q.market_id
left join _geo_prompt_import_added a on a.id=q.id
order by p.n;
commit;
