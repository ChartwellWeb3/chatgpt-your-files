-- READ ONLY. Run individual queries in the PERFORMANCE SQL Editor after the 15:00 update.

-- Approved questions selected for automatic Monday collection, by environment.
select environment,count(*) filter(where status='active') as approved,
 count(*) filter(where status='active' and schedule_included) as scheduled_questions
from public.geo_questions group by environment;

select id,environment,question,status,schedule_included,revision
from public.geo_questions order by environment,updated_at desc;

-- Current review queue. Tests and unfinished answers are excluded by the SQL view.
select id,environment,question_snapshot->>'question' as question,review_status,
 review->>'severity' as severity,review->>'ground_truth_url' as reference_url,scheduled_for
from public.geo_answer_validation order by scheduled_for desc limit 100;

-- Preserved human review history. Revisions are appended, never overwritten.
select run_id,attempt_id,review_version,verdict,severity,expected_answer,ground_truth_url,notes,created_at
from public.geo_answer_reviews order by created_at desc limit 100;

-- Must return zero; tests must never appear in the validation queue.
select count(*) as test_validation_overlap
from public.geo_answer_validation v join public.geo_test_runs t on t.id=v.id;

-- Must all be false: original-project users access these through the authenticated API.
select has_table_privilege('anon','public.geo_answer_reviews','SELECT') as anon_reviews,
 has_table_privilege('authenticated','public.geo_answer_reviews','SELECT') as browser_reviews,
 has_table_privilege('anon','public.geo_answer_validation','SELECT') as anon_validation,
 has_table_privilege('authenticated','public.geo_answer_validation','SELECT') as browser_validation;
