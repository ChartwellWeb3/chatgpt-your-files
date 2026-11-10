-- READ ONLY. PERFORMANCE project, after the mapping-review installation.
-- Replaces the inspection queries in 20261110141000_geo_mapping_review_inspect.sql.
-- No schema changes, collection, AI calls, or review decisions are performed.

-- Pending residence/operator pairs.
select id as review_id,environment,run_id,attempt_id,observed_name,proposed_brand_name,
 question_snapshot->>'question' as question,purpose,created_at
from public.geo_mapping_review_queue order by created_at desc;

-- Batches paused for mapping review.
select id,environment,trigger_kind,total,queued,collecting,analyzing,completed,failed,cancelled,mapping_review
from public.geo_batch_progress where mapping_review>0 order by created_at desc;

-- Immutable verification audit.
select v.id,v.environment,v.run_id,v.observed_name,v.proposed_brand_name,
 b.name as verified_parent,v.reference_url,v.verification_notes,v.verified_by,v.verified_at
from public.geo_mapping_reviews v join public.geo_brands b on b.id=v.verified_brand_id
where v.status='verified' order by v.verified_at desc limit 100;

-- Saved analysis response IDs show which analysis is reused after verification.
select r.id as run_id,r.environment,r.purpose,r.status,a.id as attempt_id,a.attempt_number,
 a.extraction->'rawResponse'->>'id' as saved_analysis_response_id,
 j.status as queue_status,j.reuse_extraction,j.extraction_tries
from public.geo_runs r join public.geo_run_jobs j on j.run_id=r.id
join public.geo_run_attempts a on a.id=j.attempt_id
where exists(select 1 from public.geo_mapping_reviews v where v.run_id=r.id)
order by r.created_at desc limit 100;

-- Both must return zero. Mentions belong to attempts, and attempts belong to runs.
select count(distinct r.id) as paused_answers_with_published_brand_mentions
from public.geo_mentions m
join public.geo_run_attempts a on a.id=m.attempt_id
join public.geo_runs r on r.id=a.run_id
where r.status='needs_review';

select count(*) as tests_with_successful_reporting_status
from public.geo_reporting_runs r join public.geo_test_runs t using(id) where r.status='succeeded';

-- invalid_selected_attempts must be zero for each group.
select r.environment,r.purpose,count(*) as held_answers,
 count(*) filter(where r.selected_attempt_id is not null) as invalid_selected_attempts
from public.geo_runs r where r.status='needs_review' group by r.environment,r.purpose;
