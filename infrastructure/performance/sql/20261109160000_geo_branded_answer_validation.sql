-- PERFORMANCE project only. Run AFTER 20261109150000_geo_answer_validation_and_question_schedule.sql.
-- Factual validation is restricted to the saved question's branded classification.
-- Existing unbranded reviews remain stored as immutable history, outside validation.
-- No worker or Cron changes. Deploy the website after this SQL update.
begin;

create or replace function public.geo_guard_answer_review() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if tg_op<>'INSERT' then raise exception 'Answer reviews are immutable. Save a new review instead.'; end if;
 if not exists(select 1 from public.geo_reporting_runs r join public.geo_run_attempts a
   on a.id=r.selected_attempt_id and a.run_id=r.id
   where r.id=new.run_id and r.environment=new.environment and a.id=new.attempt_id
     and r.status='succeeded' and a.status='succeeded'
     and r.question_snapshot->>'questionKind'='branded') then
  raise exception 'Only completed reporting answers to questions with brand names can be reviewed.' using errcode='22023';
 end if;
 return new;
end $$;

create or replace function public.geo_review_answer(
 p_environment text,p_run_id uuid,p_attempt_id uuid,p_actor uuid,p_expected_review_id uuid,
 p_verdict text,p_expected_answer text,p_ground_truth_url text,p_severity text,p_notes text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r public.geo_runs; prior public.geo_answer_reviews; saved public.geo_answer_reviews;
begin
 if p_actor is null then raise exception 'Reviewer required.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtext('geo-answer-review:'||p_run_id));
 select * into r from public.geo_reporting_runs where id=p_run_id and environment=p_environment for share;
 if r.id is null or r.status<>'succeeded' or r.selected_attempt_id is distinct from p_attempt_id
   or r.question_snapshot->>'questionKind' is distinct from 'branded' then
  raise exception 'Completed branded reporting answer not found.' using errcode='22023';
 end if;
 select * into prior from public.geo_answer_reviews where run_id=r.id and attempt_id=p_attempt_id
  order by review_version desc limit 1;
 if prior.id is distinct from p_expected_review_id then
  raise exception 'This answer review changed. Refresh before saving.' using errcode='40001';
 end if;
 insert into public.geo_answer_reviews(environment,run_id,attempt_id,review_version,verdict,
   expected_answer,ground_truth_url,severity,notes,reviewed_by)
 values(p_environment,r.id,p_attempt_id,coalesce(prior.review_version,0)+1,p_verdict,
   nullif(btrim(p_expected_answer),''),nullif(btrim(p_ground_truth_url),''),p_severity,nullif(btrim(p_notes),''),p_actor)
 returning * into saved;
 return to_jsonb(saved);
end $$;

create or replace view public.geo_answer_validation with (security_invoker=true) as
 select r.id,r.environment,r.benchmark_id,r.question_snapshot,r.source,r.scheduled_for,r.finished_at,
   left(a.response_text,600) as response_preview,
   coalesce(v.verdict,'unreviewed') as review_status,
   case when v.id is null then null else to_jsonb(v) end as review
 from public.geo_reporting_runs r
 join public.geo_run_attempts a on a.id=r.selected_attempt_id and a.run_id=r.id and a.status='succeeded'
 left join lateral (select v0.* from public.geo_answer_reviews v0
   where v0.run_id=r.id and v0.attempt_id=a.id order by v0.review_version desc limit 1) v on true
 where r.status='succeeded' and r.question_snapshot->>'questionKind'='branded';

revoke all on public.geo_answer_validation from public,anon,authenticated;
grant select on public.geo_answer_validation to service_role;
revoke all on function public.geo_guard_answer_review(),
 public.geo_review_answer(text,uuid,uuid,uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.geo_guard_answer_review(),
 public.geo_review_answer(text,uuid,uuid,uuid,uuid,text,text,text,text,text) to service_role;
commit;
