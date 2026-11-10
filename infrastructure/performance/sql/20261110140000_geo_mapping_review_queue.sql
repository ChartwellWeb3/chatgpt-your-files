-- PERFORMANCE project only. Run after the GEO queue, validation, and compact-read updates.
-- Deploy this SQL, then the updated geo-worker, then the website. No Cron changes.
-- Unresolved ownership pauses collection results; successful reporting SQL stays unchanged.
begin;

alter table public.geo_runs drop constraint geo_runs_status_check;
alter table public.geo_runs add constraint geo_runs_status_check
 check(status in ('queued','running','succeeded','failed','cancelled','needs_review'));
alter table public.geo_run_attempts drop constraint geo_run_attempts_status_check;
alter table public.geo_run_attempts add constraint geo_run_attempts_status_check
 check(status in ('collecting','extracting','succeeded','failed','needs_review'));
alter table public.geo_run_jobs drop constraint geo_run_jobs_status_check;
alter table public.geo_run_jobs add constraint geo_run_jobs_status_check
 check(status in ('ready','leased','done','failed','cancelled','needs_review'));
alter table public.geo_run_jobs add column reuse_extraction boolean not null default false;

-- Uses PostgreSQL's built-in Unicode normalization; no extension is required.
-- https://www.postgresql.org/docs/current/functions-string.html
create function public.geo_brand_key(p_value text) returns text
language sql immutable strict parallel safe set search_path=pg_catalog,public as $$
 select btrim(regexp_replace(lower(regexp_replace(normalize(p_value,NFKD),U&'[\0300-\036f]','','g')),'[^a-z0-9]+',' ','g'));
$$;

create table public.geo_mapping_reviews (
 id uuid primary key default gen_random_uuid(), environment text not null check(environment in ('qa','prod')),
 run_id uuid not null references public.geo_runs,attempt_id uuid not null references public.geo_run_attempts,
 analysis_response_id text not null check(length(analysis_response_id)>0),
 mention_index integer not null check(mention_index between 0 and 49),
 observed_name text not null check(length(btrim(observed_name)) between 1 and 200),
 proposed_brand_id uuid references public.geo_brands,proposed_brand_name text not null check(length(btrim(proposed_brand_name)) between 1 and 160),
 evidence_quote text not null check(length(btrim(evidence_quote))>0),raw_mention jsonb not null check(jsonb_typeof(raw_mention)='object'),
 status text not null default 'pending' check(status in ('pending','verified')),
 verified_brand_id uuid references public.geo_brands,reference_url text,verification_notes text,
 verified_by uuid,verified_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 check((status='verified')=(verified_brand_id is not null)),
 foreign key(run_id,attempt_id) references public.geo_run_attempts(run_id,id),
 check(status<>'verified' or (verified_by is not null and verified_at is not null and reference_url is not null
   and reference_url ~ '^https?://[^[:space:]]+$' and length(reference_url)<=2000)),
 check(length(verification_notes)<=4000)
);
create unique index geo_mapping_pending_once on public.geo_mapping_reviews(run_id,attempt_id,analysis_response_id,mention_index) where status='pending';
create index geo_mapping_review_lookup on public.geo_mapping_reviews(run_id,attempt_id,analysis_response_id,created_at desc);
alter table public.geo_mapping_reviews enable row level security;
revoke all on public.geo_mapping_reviews from public,anon,authenticated;
grant select,insert,update on public.geo_mapping_reviews to service_role;

create function public.geo_guard_mapping_history() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if tg_op='DELETE' or (tg_op='UPDATE' and (old.status='verified' or new.status<>'verified'
  or row(new.id,new.environment,new.run_id,new.attempt_id,new.analysis_response_id,new.mention_index,new.observed_name,
    new.proposed_brand_id,new.proposed_brand_name,new.evidence_quote,new.raw_mention,new.created_at)
   is distinct from row(old.id,old.environment,old.run_id,old.attempt_id,old.analysis_response_id,old.mention_index,old.observed_name,
    old.proposed_brand_id,old.proposed_brand_name,old.evidence_quote,old.raw_mention,old.created_at))) then
  raise exception 'Mapping evidence and completed verifications are immutable.';
 end if;
 return new;
end $$;
create trigger geo_mapping_history before update or delete on public.geo_mapping_reviews for each row execute function public.geo_guard_mapping_history();

create function public.geo_worker_needs_mapping_review(p_run_id uuid,p_token uuid,p_extraction jsonb,p_issues jsonb)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare j public.geo_run_jobs;r public.geo_runs;a public.geo_run_attempts;issue jsonb;response_id text;idx integer;
begin
 select * into j from public.geo_run_jobs where run_id=p_run_id for update;
 if j.status is distinct from 'leased' or j.stage<>'extraction' or j.lease_token is distinct from p_token or j.lease_expires_at<=now() then
  raise exception 'Stale worker lease.' using errcode='22023'; end if;
 select * into r from public.geo_runs where id=p_run_id for update;
 if r.status<>'running' or r.lease_token is distinct from p_token then raise exception 'Stale run lease.' using errcode='22023'; end if;
 select * into a from public.geo_run_attempts where id=j.attempt_id and run_id=r.id;
 response_id:=a.extraction->'rawResponse'->>'id';
 if a.extraction->'rawResponse'->>'status' is distinct from 'completed' or response_id is null
   or jsonb_typeof(p_extraction->'mentions') is distinct from 'array'
   or jsonb_typeof(p_issues) is distinct from 'array' or jsonb_array_length(p_issues) not between 1 and 50 then
  raise exception 'Save completed extraction evidence before mapping review.' using errcode='22023'; end if;
 for issue in select * from jsonb_array_elements(p_issues) loop
  idx:=(issue->>'mention_index')::integer;
  if idx is null or idx not between 0 and 49 or p_extraction->'mentions'->idx is distinct from issue->'raw_mention'
    or length(btrim(coalesce(issue->>'evidence_quote','')))=0 or strpos(a.response_text,issue->>'evidence_quote')=0 then
   raise exception 'Mapping evidence must match the saved answer and extraction.' using errcode='22023'; end if;
  insert into public.geo_mapping_reviews(environment,run_id,attempt_id,analysis_response_id,mention_index,
    observed_name,proposed_brand_id,proposed_brand_name,evidence_quote,raw_mention)
  values(r.environment,r.id,a.id,response_id,idx,issue->>'observed_name',nullif(issue->>'proposed_brand_id','')::uuid,
    issue->>'proposed_brand_name',issue->>'evidence_quote',issue->'raw_mention')
  on conflict(run_id,attempt_id,analysis_response_id,mention_index) where status='pending' do nothing;
 end loop;
 update public.geo_run_attempts set status='needs_review',error_stage='extraction',finished_at=null,
  error_message='Brand ownership needs administrator verification.',extraction=extraction||jsonb_build_object('mentions',p_extraction->'mentions') where id=a.id;
 update public.geo_runs set status='needs_review',finished_at=null,lease_token=null,lease_expires_at=null where id=r.id;
 update public.geo_run_jobs set status='needs_review',needs_review=true,reuse_extraction=true,
  lease_token=null,lease_expires_at=null,error_message='Brand ownership needs administrator verification.' where run_id=r.id;
end $$;

-- Current evidence only: previous analysis responses remain in the audit table.
create view public.geo_mapping_review_context with(security_invoker=true) as
 select v.*,r.question_snapshot,r.purpose,r.status as run_status,b.name as verified_brand_name
 from (select distinct on(run_id,attempt_id,analysis_response_id,mention_index) * from public.geo_mapping_reviews
   order by run_id,attempt_id,analysis_response_id,mention_index,created_at desc,id) v
 join public.geo_runs r on r.id=v.run_id and r.environment=v.environment
 join public.geo_run_attempts a on a.id=v.attempt_id and a.run_id=r.id and a.extraction->'rawResponse'->>'id'=v.analysis_response_id
 left join public.geo_brands b on b.id=v.verified_brand_id;
create view public.geo_mapping_review_queue with(security_invoker=true) as
 select v.* from public.geo_mapping_review_context v join public.geo_run_jobs j on j.run_id=v.run_id and j.attempt_id=v.attempt_id
 where v.status='pending' and v.run_status='needs_review' and j.status='needs_review';
revoke all on public.geo_mapping_review_context,public.geo_mapping_review_queue from public,anon,authenticated;
grant select on public.geo_mapping_review_context,public.geo_mapping_review_queue to service_role;

create function public.geo_verify_mapping(
 p_environment text,p_review_id uuid,p_actor uuid,p_brand_id uuid,p_brand_name text,p_reference_url text,p_notes text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v public.geo_mapping_reviews;j public.geo_run_jobs;r public.geo_runs;b public.geo_brands;key text;slug_value text;pending integer;
begin
 if p_actor is null or p_reference_url is null or p_reference_url !~ '^https?://[^[:space:]]+$' or length(p_reference_url)>2000
   or length(coalesce(p_notes,''))>4000 then raise exception 'A reviewer and reference URL are required.' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtext('geo-worker-claims'));
 select * into v from public.geo_mapping_reviews where id=p_review_id and environment=p_environment;
 if v.id is null then raise exception 'Unknown mapping review.' using errcode='22023'; end if;
 select * into j from public.geo_run_jobs where run_id=v.run_id for update;
 select * into r from public.geo_runs where id=v.run_id and environment=p_environment for update;
 select * into v from public.geo_mapping_reviews where id=p_review_id for update;
 if v.status='verified' then
  if p_brand_id is not null and p_brand_id<>v.verified_brand_id then raise exception 'Mapping already verified. Refresh before continuing.' using errcode='40001'; end if;
  return jsonb_build_object('saved',true,'existing',true,'runId',r.id);
 end if;
 if j.status<>'needs_review' or r.status<>'needs_review' or j.attempt_id<>v.attempt_id
   or exists(select 1 from public.geo_batches where id=j.batch_id and cancelled_at is not null)
   or not exists(select 1 from public.geo_run_attempts where id=v.attempt_id and extraction->'rawResponse'->>'id'=v.analysis_response_id) then
  raise exception 'This mapping is no longer awaiting verification.' using errcode='40001'; end if;
 -- Serialize registry edits, including aliases for different brands.
 perform pg_advisory_xact_lock(hashtext('geo-brand-registry'));
 if p_brand_id is null then
  key:=public.geo_brand_key(p_brand_name);
  if length(btrim(coalesce(p_brand_name,''))) not between 1 and 160 or length(coalesce(key,''))=0 then raise exception 'Enter a parent brand name.' using errcode='22023'; end if;
  if exists(select 1 from public.geo_brands b0 where public.geo_brand_key(b0.name)=key
    or exists(select 1 from unnest(b0.aliases) x where public.geo_brand_key(x)=key)) then
   raise exception 'That brand already exists. Select it from the list.' using errcode='22023'; end if;
  slug_value:=replace(key,' ','-');
  if exists(select 1 from public.geo_brands where slug=slug_value) then raise exception 'That brand slug already exists.' using errcode='22023'; end if;
  insert into public.geo_brands(slug,name) values(slug_value,btrim(p_brand_name)) returning * into b;
 else
  select * into b from public.geo_brands where id=p_brand_id for update;
  if b.id is null then raise exception 'Unknown parent brand.' using errcode='22023'; end if;
 end if;
 key:=public.geo_brand_key(v.observed_name);
 if exists(select 1 from public.geo_brands b0 where b0.id<>b.id and (public.geo_brand_key(b0.name)=key
   or exists(select 1 from unnest(b0.aliases) x where public.geo_brand_key(x)=key))) then
  raise exception 'This residence is registered to another brand. Resolve the catalog conflict before verifying.' using errcode='22023'; end if;
 if public.geo_brand_key(b.name)<>key and not exists(select 1 from unnest(b.aliases) x where public.geo_brand_key(x)=key) then
  update public.geo_brands set aliases=array_append(aliases,v.observed_name) where id=b.id;
 end if;
 update public.geo_mapping_reviews set status='verified',verified_brand_id=b.id,reference_url=p_reference_url,
  verification_notes=nullif(btrim(p_notes),''),verified_by=p_actor,verified_at=clock_timestamp() where id=v.id;
 select count(*) into pending from public.geo_mapping_reviews where run_id=r.id and attempt_id=v.attempt_id
   and analysis_response_id=v.analysis_response_id and status='pending';
 if pending=0 then
  update public.geo_run_attempts set status='extracting',error_stage=null,error_message=null,finished_at=null where id=v.attempt_id;
  update public.geo_runs set status='queued',finished_at=null where id=r.id;
  update public.geo_run_jobs set status='ready',reuse_extraction=true,needs_review=false,
    available_at=now(),extraction_tries=0,error_message=null where run_id=r.id;
 end if;
 return jsonb_build_object('saved',true,'runId',r.id,'pendingMappings',pending,'queued',pending=0);
end $$;

create function public.geo_recheck_mapping(p_environment text,p_run_id uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare j public.geo_run_jobs;r public.geo_runs;
begin
 perform pg_advisory_xact_lock(hashtext('geo-worker-claims'));
 select * into j from public.geo_run_jobs where run_id=p_run_id for update;
 select * into r from public.geo_runs where id=p_run_id and environment=p_environment for update;
 if r.id is null or r.status not in ('failed','needs_review') or j.stage<>'extraction'
   or j.status not in ('failed','needs_review') or exists(select 1 from public.geo_batches where id=j.batch_id and cancelled_at is not null)
   or not exists(select 1 from public.geo_run_attempts where id=j.attempt_id and run_id=r.id and length(response_text)>0
     and raw_response->>'status'='completed' and extraction->'rawResponse'->>'status'='completed') then
  raise exception 'No completed saved analysis is available to recheck for this answer.' using errcode='22023'; end if;
 update public.geo_run_attempts set status='extracting',error_stage=null,error_message=null,finished_at=null where id=j.attempt_id;
 update public.geo_runs set status='queued',finished_at=null,lease_token=null,lease_expires_at=null where id=r.id;
 update public.geo_run_jobs set status='ready',reuse_extraction=true,needs_review=false,available_at=now(),extraction_tries=0,
   error_message=null,lease_token=null,lease_expires_at=null where run_id=r.id;
 return jsonb_build_object('queued',true,'runId',r.id);
end $$;

-- Updated queue/read definitions and service-only grants follow.
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
   'reuseExtraction',j.reuse_extraction,'attempt',(select to_jsonb(a) from public.geo_run_attempts a where a.id=aid));
 end loop;
 return null;
end $$;

create or replace function public.geo_cancel_batch(p_environment text,p_batch_id uuid,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare b public.geo_batches; j public.geo_run_jobs; r public.geo_runs; n integer:=0;
begin
 -- Same lock as the worker claim: no new stages can start during cancellation.
 perform pg_advisory_xact_lock(hashtext('geo-worker-claims'));
 select * into b from public.geo_batches where id=p_batch_id and environment=p_environment for update;
 if b.id is null or p_actor is null then raise exception 'Unknown collection batch.' using errcode='22023'; end if;
 if b.cancelled_at is not null then return jsonb_build_object('batchId',b.id,'cancelled',0,'existing',true); end if;
 -- Preserve completed and previously failed jobs. Stop only unfinished work.
 -- Lock jobs before their runs, matching worker save/finish lock ordering.
 for j in select * from public.geo_run_jobs where batch_id=b.id and status in ('ready','leased','needs_review') order by run_id for update loop
  select * into r from public.geo_runs where id=j.run_id for update;
  if r.status in ('succeeded','failed','cancelled') then continue; end if;
  if j.attempt_id is not null then
   update public.geo_run_attempts set status='failed',error_stage=j.stage,
    error_message='Collection cancelled by a team member. An in-flight provider request may still complete and incur usage.',finished_at=now()
   where id=j.attempt_id and status<>'succeeded';
  end if;
  update public.geo_runs set status='cancelled',finished_at=now(),lease_token=null,lease_expires_at=null where id=r.id;
  update public.geo_run_jobs set status='cancelled',lease_token=null,lease_expires_at=null,
   error_message='Collection cancelled by a team member.',needs_review=false where run_id=r.id;
  n:=n+1;
 end loop;
 if n>0 then update public.geo_batches set cancelled_at=now(),cancelled_by=p_actor where id=b.id; end if;
 return jsonb_build_object('batchId',b.id,'cancelled',n,'alreadyFinished',n=0);
end $$;

create or replace function public.geo_retry_batch(p_environment text,p_batch_id uuid,p_request_key uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare j public.geo_run_jobs; n integer:=0; can_analyze boolean;
begin
 perform 1 from public.geo_batches where id=p_batch_id and environment=p_environment and purpose='monitoring' for update;
 if not found then raise exception 'Unknown monitoring batch.' using errcode='22023'; end if;
 if exists(select 1 from public.geo_batches where id=p_batch_id and cancelled_at is not null) then
  raise exception 'This collection was cancelled. Start a new collection to run these questions again.' using errcode='22023';
 end if;
 -- Durable request record makes a retransmission safe, including after jobs have failed again.
 insert into public.geo_retry_requests(id,batch_id) values(p_request_key,p_batch_id) on conflict(id) do nothing;
 if not found then
  if not exists(select 1 from public.geo_retry_requests where id=p_request_key and batch_id=p_batch_id) then raise exception 'Request key already used.' using errcode='22023'; end if;
  return jsonb_build_object('batchId',p_batch_id,'existing',true);
 end if;
 for j in select * from public.geo_run_jobs where batch_id=p_batch_id and status='failed' for update loop
  select exists(select 1 from public.geo_run_attempts a where a.id=j.attempt_id and a.raw_response->>'status'='completed'
   and length(btrim(a.response_text))>0 and exists(select 1 from jsonb_array_elements(a.raw_response->'output') o
    where o->>'type'='web_search_call' and o->>'status'='completed')) into can_analyze;
  update public.geo_runs set status='queued',finished_at=null,lease_token=null,lease_expires_at=null where id=j.run_id;
  update public.geo_run_jobs set status='ready',stage=case when can_analyze then 'extraction' else 'collection' end,
   reuse_extraction=can_analyze and exists(select 1 from public.geo_run_attempts a where a.id=j.attempt_id and a.extraction->'rawResponse'->>'status'='completed' and (j.error_message like '%Parent brand ownership%' or j.error_message like '%administrator verification%')),
   collection_tries=0,extraction_tries=0,available_at=now(),error_message=null,needs_review=false where run_id=j.run_id;
  n:=n+1;
 end loop;
 return jsonb_build_object('batchId',p_batch_id,'count',n);
end $$;

create or replace view public.geo_batch_progress with(security_invoker=true) as
 select b.id,b.environment,b.benchmark_id,b.purpose,b.trigger_kind,b.request_key,b.question_id,b.created_by,b.scheduled_for,b.created_at,
 count(r.id)::integer as total,
 count(r.id) filter(where j.status='ready')::integer as queued,
 count(r.id) filter(where j.status='leased' and j.stage='collection')::integer as collecting,
 count(r.id) filter(where j.status='leased' and j.stage='extraction')::integer as analyzing,
 count(r.id) filter(where j.status='done')::integer as completed,
 count(r.id) filter(where j.status='failed')::integer as failed,
 count(r.id) filter(where j.status='cancelled')::integer as cancelled,
 count(r.id) filter(where j.needs_review and j.status<>'needs_review')::integer as needs_review,
 b.cancelled_at,b.cancelled_by,
 count(r.id) filter(where j.status='needs_review')::integer as mapping_review
 from public.geo_batches b left join public.geo_runs r on r.batch_id=b.id left join public.geo_run_jobs j on j.run_id=r.id group by b.id;

create or replace function public.geo_overview(
 p_environment text,p_benchmark_id uuid,p_from date,p_to date,
 p_topic_id uuid default null,p_market_id uuid default null,p_language text default null
) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare start_at timestamptz; end_at timestamptz; previous_at timestamptz; previous_day date; result jsonb;
begin
 if p_environment is null or p_environment not in ('qa','prod') or p_from is null or p_to is null
   or p_to<p_from or p_to-p_from>366 or (p_language is not null and p_language not in ('en','fr'))
   or not exists(select 1 from public.geo_benchmarks where id=p_benchmark_id and environment=p_environment) then
  raise exception 'Invalid overview filters.' using errcode='22023';
 end if;
 previous_day:=p_from-(p_to-p_from+1);
 start_at:=p_from::timestamp at time zone 'America/Toronto';
 end_at:=(p_to+1)::timestamp at time zone 'America/Toronto';
 previous_at:=previous_day::timestamp at time zone 'America/Toronto';
 with matching as materialized (
  select r.id,r.selected_attempt_id,r.status,r.lease_expires_at,r.question_snapshot,r.scheduled_for
  from public.geo_reporting_runs r where r.environment=p_environment and r.benchmark_id=p_benchmark_id
   and r.scheduled_for>=previous_at and r.scheduled_for<end_at
   and r.question_snapshot->>'questionKind'='unbranded'
   and (p_topic_id is null or r.question_snapshot->>'topicId'=p_topic_id::text)
   and (p_market_id is null or r.question_snapshot->>'marketId'=p_market_id::text)
   and (p_language is null or r.question_snapshot->>'language'=p_language)
 ), valid as materialized (
  select r.* from matching r join public.geo_run_attempts a on a.id=r.selected_attempt_id and a.run_id=r.id
   where r.status='succeeded' and a.status='succeeded'
 ), mention_totals as materialized (
  -- Share of mentions retains EVERY detected brand in its denominator.
  select m.attempt_id,count(*) as n from public.geo_mentions m join valid v on v.selected_attempt_id=m.attempt_id group by m.attempt_id
 ), facts as materialized (
  select v.scheduled_for>=start_at as current_period,
   v.question_snapshot->>'topicId' as topic_id,v.question_snapshot->>'topic' as topic_name,
   v.question_snapshot->>'marketId' as market_id,v.question_snapshot->>'market' as market_name,
   to_char(date_trunc('week',v.scheduled_for at time zone 'America/Toronto'),'YYYY-MM-DD') as week,
   (m.brand_id is not null)::integer as mentioned,m.position,coalesce(t.n,0) as all_mentions
  from valid v left join public.geo_mentions m on m.attempt_id=v.selected_attempt_id
   and m.brand_id=(select id from public.geo_brands where is_chartwell)
  left join mention_totals t on t.attempt_id=v.selected_attempt_id
 ), aggregates as (
  select current_period,
   case when grouping(topic_id)=0 then 'topic' when grouping(market_id)=0 then 'market'
     when grouping(week)=0 then 'week' else 'overall' end as kind,
   case when grouping(topic_id)=0 then topic_id when grouping(market_id)=0 then market_id
     when grouping(week)=0 then week else 'overall' end as key,
   case when grouping(topic_id)=0 then topic_name when grouping(market_id)=0 then market_name
     when grouping(week)=0 then week else 'overall' end as label,
   count(*) as samples,sum(mentioned) as mentions,count(position) as ranked_mentions,
   count(*) filter(where position<=3) as top3_mentions,
   round(sum(mentioned)::numeric/nullif(count(*),0),6) as visibility_rate,
   round(avg(position),4) as average_position,
   round(count(*) filter(where position<=3)::numeric/nullif(count(*),0),6) as top3_rate,
   round(sum(mentioned)::numeric/nullif(sum(all_mentions),0),6) as share_of_voice
  from facts group by grouping sets ((current_period),(current_period,topic_id,topic_name),
    (current_period,market_id,market_name),(current_period,week))
 ), current_metric as (
  select * from aggregates where current_period and kind='overall'
 ), previous_metric as (
  select * from aggregates where not current_period and kind='overall'
 ), weeks as (
  select to_char(w,'YYYY-MM-DD') as week,a.visibility_rate*100 as visibility,coalesce(a.samples,0) as samples
  from generate_series(date_trunc('week',p_from::timestamp),date_trunc('week',p_to::timestamp),interval '1 week') w
  left join aggregates a on a.current_period and a.kind='week' and a.key=to_char(w,'YYYY-MM-DD')
 ) select jsonb_build_object(
  'chartwell',(select to_jsonb(c)-'current_period'-'kind'-'key'-'label' from current_metric c),
  'previous',(select to_jsonb(p)-'current_period'-'kind'-'key'-'label' from previous_metric p),
  'differences',jsonb_build_object(
   'mentionRate',((select visibility_rate from current_metric)-(select visibility_rate from previous_metric))*100,
   'averageRank',(select average_position from current_metric)-(select average_position from previous_metric),
   'top3',((select top3_rate from current_metric)-(select top3_rate from previous_metric))*100,
   'shareOfMentions',((select share_of_voice from current_metric)-(select share_of_voice from previous_metric))*100),
  'topics',coalesce((select jsonb_agg(to_jsonb(a)-'current_period'-'kind' order by a.visibility_rate desc,a.label,a.key)
    from aggregates a where current_period and kind='topic'),'[]'::jsonb),
  'markets',coalesce((select jsonb_agg(to_jsonb(a)-'current_period'-'kind' order by a.visibility_rate desc,a.label,a.key)
    from aggregates a where current_period and kind='market'),'[]'::jsonb),
  'trend',coalesce((select jsonb_agg(to_jsonb(w) order by w.week) from weeks w),'[]'::jsonb),
  'counts',jsonb_build_object('needs_review',(select count(*) from matching where scheduled_for>=start_at and status='needs_review'),'succeeded',(select count(*) from valid where scheduled_for>=start_at),
   'failed',(select count(*) from matching where scheduled_for>=start_at and
     (status in ('failed','cancelled') or (status='running' and lease_expires_at<=now()))),
   'pending',(select count(*) from matching where scheduled_for>=start_at and
     (status='queued' or (status='running' and (lease_expires_at is null or lease_expires_at>now()))))),
  'previousFrom',previous_day::text,'previousTo',(p_from-1)::text
 ) into result;
 return result;
end $$;

create or replace function public.geo_live_status(p_environment text) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if p_environment is null or p_environment not in ('qa','prod') then raise exception 'Invalid environment.' using errcode='22023'; end if;
 select jsonb_build_object(
  'mappingReviews',(select count(*) from public.geo_mapping_review_queue where environment=p_environment),
  'counts',(select jsonb_build_object('draft',count(*) filter(where status='draft'),
    'active',count(*) filter(where status='active'),'archived',count(*) filter(where status='archived'),
    'scheduled',count(*) filter(where status='active' and schedule_included))
    from public.geo_questions where environment=p_environment),
  'worker',(select jsonb_build_object('dispatcher_enabled',dispatcher_enabled,'last_seen_at',last_seen_at) from public.geo_worker_runtime where id),
  'schedules',coalesce((select jsonb_agg(jsonb_build_object('id',id,'schedule_enabled',schedule_enabled,'next_scheduled_at',next_scheduled_at))
    from public.geo_benchmarks where environment=p_environment),'[]'::jsonb),
  'activity',(select jsonb_build_object('monitoring',coalesce(bool_or(r.purpose='monitoring'),false),
    'tests',coalesce(bool_or(r.purpose='test'),false)) from public.geo_run_jobs j join public.geo_runs r on r.id=j.run_id
    where r.environment=p_environment and j.status in ('ready','leased'))
 ) into result;
 return result;
end $$;

revoke all on function public.geo_brand_key(text),public.geo_guard_mapping_history(),
 public.geo_worker_needs_mapping_review(uuid,uuid,jsonb,jsonb),
 public.geo_verify_mapping(text,uuid,uuid,uuid,text,text,text),public.geo_recheck_mapping(text,uuid)
 from public,anon,authenticated;
grant execute on function public.geo_brand_key(text),public.geo_guard_mapping_history(),
 public.geo_worker_needs_mapping_review(uuid,uuid,jsonb,jsonb),
 public.geo_verify_mapping(text,uuid,uuid,uuid,text,text,text),public.geo_recheck_mapping(text,uuid)
 to service_role;
notify pgrst,'reload schema';
commit;
