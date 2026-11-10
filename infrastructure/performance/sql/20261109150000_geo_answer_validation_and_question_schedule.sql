-- PERFORMANCE project only. Run after the queue and cancellation SQL updates.
-- Adds human factual reviews and per-question Monday schedule selection.
-- Does not enable, pause, or replace existing schedules. No worker redeployment.
begin;

-- Preserve the existing schedule population; users can opt individual questions out.
alter table public.geo_questions add column schedule_included boolean not null default true;
comment on column public.geo_questions.schedule_included is
 'Include an approved question in automatic Monday collection. Manual Run now, Run all, and Test remain available.';
create index geo_questions_scheduled on public.geo_questions(environment,id)
 where status='active' and schedule_included;

-- Reviews are append-only: changing a verdict preserves the previous human decision.
-- Original-project reviewer IDs are audit values, never cross-project auth foreign keys.
create table public.geo_answer_reviews (
 id uuid primary key default gen_random_uuid(),
 environment text not null check(environment in ('qa','prod')),
 run_id uuid not null references public.geo_runs(id),
 attempt_id uuid not null references public.geo_run_attempts(id),
 review_version integer not null check(review_version>0),
 verdict text not null check(verdict in ('correct','partially_correct','incorrect','unverifiable')),
 expected_answer text check(length(expected_answer)<=4000),
 ground_truth_url text check(length(ground_truth_url)<=2000 and ground_truth_url ~ '^https?://[^[:space:]]+$'),
 severity text check(severity in ('high','medium','low')),
 notes text check(length(notes)<=4000), reviewed_by uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(run_id,review_version),
 check(verdict='unverifiable' or (length(btrim(coalesce(expected_answer,'')))>0 and ground_truth_url is not null)),
 check((verdict in ('partially_correct','incorrect') and severity is not null)
    or (verdict not in ('partially_correct','incorrect') and severity is null)),
 check(verdict='correct' or length(btrim(coalesce(notes,'')))>0)
);
create index geo_reviews_latest on public.geo_answer_reviews(run_id,attempt_id,review_version desc);
alter table public.geo_answer_reviews enable row level security;
revoke all on public.geo_answer_reviews from public,anon,authenticated;
grant select,insert on public.geo_answer_reviews to service_role;

create or replace function public.geo_guard_answer_review() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if tg_op<>'INSERT' then raise exception 'Answer reviews are immutable. Save a new review instead.'; end if;
 if not exists(select 1 from public.geo_reporting_runs r join public.geo_run_attempts a
   on a.id=r.selected_attempt_id and a.run_id=r.id
   where r.id=new.run_id and r.environment=new.environment and a.id=new.attempt_id
     and r.status='succeeded' and a.status='succeeded') then
  raise exception 'Only completed reporting answers can be reviewed.' using errcode='22023';
 end if;
 return new;
end $$;
create trigger geo_answer_review_history before insert or update or delete on public.geo_answer_reviews
 for each row execute function public.geo_guard_answer_review();

create or replace function public.geo_review_answer(
 p_environment text,p_run_id uuid,p_attempt_id uuid,p_actor uuid,p_expected_review_id uuid,
 p_verdict text,p_expected_answer text,p_ground_truth_url text,p_severity text,p_notes text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r public.geo_runs; prior public.geo_answer_reviews; saved public.geo_answer_reviews;
begin
 if p_actor is null then raise exception 'Reviewer required.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtext('geo-answer-review:'||p_run_id));
 select * into r from public.geo_reporting_runs where id=p_run_id and environment=p_environment for share;
 if r.id is null or r.status<>'succeeded' or r.selected_attempt_id is distinct from p_attempt_id then
  raise exception 'Completed reporting answer not found.' using errcode='22023';
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

-- This list always excludes tests and unfinished answers, independently of API filters.
create view public.geo_answer_validation with (security_invoker=true) as
 select r.id,r.environment,r.benchmark_id,r.question_snapshot,r.source,r.scheduled_for,r.finished_at,
   left(a.response_text,600) as response_preview,
   coalesce(v.verdict,'unreviewed') as review_status,
   case when v.id is null then null else to_jsonb(v) end as review
 from public.geo_reporting_runs r
 join public.geo_run_attempts a on a.id=r.selected_attempt_id and a.run_id=r.id and a.status='succeeded'
 left join lateral (select v0.* from public.geo_answer_reviews v0
   where v0.run_id=r.id and v0.attempt_id=a.id order by v0.review_version desc limit 1) v on true
 where r.status='succeeded';
revoke all on public.geo_answer_validation from public,anon,authenticated;
grant select on public.geo_answer_validation to service_role;
revoke all on function public.geo_guard_answer_review(),
 public.geo_review_answer(text,uuid,uuid,uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.geo_guard_answer_review(),
 public.geo_review_answer(text,uuid,uuid,uuid,uuid,text,text,text,text,text) to service_role;

-- Updated enqueue/claim definitions follow. Only scheduled collection uses the
-- checkbox. Already collected answers finish analysis against their saved snapshot.

create or replace function public.geo_enqueue(
 p_environment text,p_benchmark_id uuid,p_kind text,p_request_key uuid,p_actor uuid,p_question_id uuid default null,
 p_slot timestamptz default null
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare b public.geo_batches; q public.geo_questions; rid uuid; n integer:=0; first_run uuid; key text; purpose_value text;
begin
 if p_kind is null or p_kind not in ('scheduled','single','all','test') or p_environment not in ('qa','prod') or p_request_key is null
  or (p_kind in ('single','test') and p_question_id is null) or (p_kind in ('all','scheduled') and p_question_id is not null)
  or (p_kind='scheduled' and p_slot is null) then raise exception 'Invalid collection request.' using errcode='22023'; end if;
 perform 1 from public.geo_benchmarks where id=p_benchmark_id and environment=p_environment for update;
 if not found then raise exception 'Unknown benchmark.' using errcode='22023'; end if;
 purpose_value:=case when p_kind='test' then 'test' else 'monitoring' end;
 key:=case when p_kind='scheduled' then 'schedule:'||p_benchmark_id||':'||extract(epoch from p_slot)::bigint else p_request_key::text end;
 select * into b from public.geo_batches where environment=p_environment and request_key=key;
 if found then
  if b.benchmark_id<>p_benchmark_id or b.trigger_kind<>p_kind or b.question_id is distinct from p_question_id
   or b.created_by is distinct from p_actor then raise exception 'Request key already used.' using errcode='22023'; end if;
  return jsonb_build_object('batchId',b.id,'runId',(select id from public.geo_runs where batch_id=b.id order by created_at,id limit 1),
    'count',(select count(*) from public.geo_runs where batch_id=b.id),'existing',true,'purpose',b.purpose);
 end if;
 insert into public.geo_batches(environment,benchmark_id,purpose,trigger_kind,request_key,question_id,created_by,scheduled_for)
 values(p_environment,p_benchmark_id,purpose_value,p_kind,key,p_question_id,p_actor,coalesce(p_slot,now())) returning * into b;
 for q in select * from public.geo_questions where environment=p_environment
  and (p_question_id is null or id=p_question_id) and (status='active' or (p_kind='test' and status='draft'))
  and (p_kind<>'scheduled' or schedule_included) order by id for share loop
  insert into public.geo_runs(environment,benchmark_id,question_id,source,purpose,batch_id,scheduled_for,idempotency_key,created_by)
   values(p_environment,p_benchmark_id,q.id,case when p_kind='scheduled' then 'scheduled' else 'manual' end,
    purpose_value,b.id,b.scheduled_for,b.id||':'||q.id,p_actor) returning id into rid;
  insert into public.geo_run_jobs(run_id,batch_id) values(rid,b.id);
  n:=n+1; first_run:=coalesce(first_run,rid);
 end loop;
 if n=0 and p_kind<>'scheduled' then raise exception 'No eligible questions. Save a draft to test, or approve questions to monitor.' using errcode='22023'; end if;
 return jsonb_build_object('batchId',b.id,'runId',case when p_kind in ('single','test') then first_run else null end,'count',n,'purpose',purpose_value);
end $$;

create or replace function public.geo_worker_claim() returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare j public.geo_run_jobs; r public.geo_runs; q public.geo_questions; token uuid; aid uuid; tries integer;
begin
 perform pg_advisory_xact_lock(hashtext('geo-worker-claims'));
 update public.geo_worker_runtime set last_seen_at=now() where id=true;
 for j in select * from public.geo_run_jobs where status='leased' and lease_expires_at<=now() for update loop
  select * into r from public.geo_runs where id=j.run_id for update;
  if j.stage='collection' then
   update public.geo_run_jobs set status='failed',needs_review=true,error_message='Collection interrupted; provider outcome unknown. Review before retry.',lease_token=null,lease_expires_at=null where run_id=j.run_id;
   update public.geo_run_attempts set status='failed',error_stage='collection',error_message='Provider outcome unknown after lease expiry.',finished_at=now() where id=j.attempt_id;
   update public.geo_runs set status='failed',finished_at=now(),lease_token=null,lease_expires_at=null where id=r.id;
  else
   update public.geo_run_jobs set status=case when extraction_tries<4 then 'ready' else 'failed' end,available_at=now()+interval '1 minute',
    error_message='Analysis interrupted.',lease_token=null,lease_expires_at=null where run_id=j.run_id;
   update public.geo_runs set status=case when j.extraction_tries<4 then 'queued' else 'failed' end,
    finished_at=case when j.extraction_tries>=4 then now() else null end,lease_token=null,lease_expires_at=null where id=r.id;
   if j.extraction_tries>=4 then update public.geo_run_attempts set status='failed',error_stage='extraction',error_message='Analysis retry limit reached.',finished_at=now() where id=j.attempt_id; end if;
  end if;
 end loop;
 if (select count(*) from public.geo_run_jobs where status='leased' and lease_expires_at>now())>=2 then return null; end if;
 -- Keep a preview responsive during a large batch; finish saved answers promptly.
 for j in select j0.* from public.geo_run_jobs j0 join public.geo_runs r0 on r0.id=j0.run_id
  where j0.status='ready' and j0.available_at<=now()
  order by (r0.purpose='test') desc,(j0.stage='extraction') desc,j0.available_at,j0.run_id for update of j0 skip locked loop
  select * into r from public.geo_runs where id=j.run_id for update;
  if j.stage='collection' then
   select * into q from public.geo_questions where id=r.question_id for share;
   if q.revision<>r.question_revision or q.status='archived' or (r.purpose='monitoring' and q.status<>'active')
     or (r.source='scheduled' and not q.schedule_included) then
    update public.geo_run_jobs set status='cancelled',error_message='Question changed, is no longer approved, or was removed from scheduled collection.' where run_id=r.id;
    update public.geo_runs set status='cancelled',finished_at=now(),lease_token=null,lease_expires_at=null where id=r.id;
    continue;
   end if;
   select coalesce(max(attempt_number),0)+1 into tries from public.geo_run_attempts where run_id=r.id;
   insert into public.geo_run_attempts(run_id,attempt_number) values(r.id,tries) returning id into aid;
  else
   aid:=j.attempt_id;
   update public.geo_run_attempts set status='extracting',error_stage=null,error_message=null,finished_at=null where id=aid;
  end if;
  token:=gen_random_uuid();
  update public.geo_run_jobs set status='leased',attempt_id=aid,lease_token=token,lease_expires_at=now()+interval '3 minutes',
   collection_tries=collection_tries+case when stage='collection' then 1 else 0 end,
   extraction_tries=extraction_tries+case when stage='extraction' then 1 else 0 end where run_id=r.id;
  update public.geo_runs set status='running',finished_at=null,lease_token=token,lease_expires_at=now()+interval '3 minutes' where id=r.id;
  return jsonb_build_object('runId',r.id,'environment',r.environment,'stage',j.stage,'attemptId',aid,'leaseToken',token,
   'snapshot',r.question_snapshot,'benchmark',(select to_jsonb(b) from public.geo_benchmarks b where b.id=r.benchmark_id),
   'attempt',(select to_jsonb(a) from public.geo_run_attempts a where a.id=aid));
 end loop;
 return null;
end $$;

commit;
