-- PERFORMANCE project only. Requires geo-monitoring.sql and the 20261027190000 update.
-- Installation is paused. Activate the dispatcher separately after deploying geo-worker.
begin;
alter table public.geo_runs add column if not exists purpose text check (purpose in ('monitoring','test'));
-- NULL is reserved for immutable legacy history. No historical rows are rewritten.
create table public.geo_batches (
 id uuid primary key default gen_random_uuid(), environment text not null check(environment in ('qa','prod')),
 benchmark_id uuid not null references public.geo_benchmarks, purpose text not null check(purpose in ('monitoring','test')),
 trigger_kind text not null check(trigger_kind in ('scheduled','single','all','test')),
 request_key text not null, question_id uuid references public.geo_questions, created_by uuid,
 scheduled_for timestamptz not null default now(), created_at timestamptz not null default now(),
 unique(environment,request_key), check((purpose='test')=(trigger_kind='test'))
);
alter table public.geo_runs add column if not exists batch_id uuid references public.geo_batches;
create or replace view public.geo_reporting_runs with (security_invoker=true) as
 select * from public.geo_runs where coalesce(purpose,case when source='scheduled' then 'monitoring' else 'test' end)='monitoring';
create or replace view public.geo_test_runs with (security_invoker=true) as
 select * from public.geo_runs where coalesce(purpose,case when source='scheduled' then 'monitoring' else 'test' end)='test';
create table public.geo_run_jobs (
 run_id uuid primary key references public.geo_runs, batch_id uuid not null references public.geo_batches,
 stage text not null default 'collection' check(stage in ('collection','extraction')),
 status text not null default 'ready' check(status in ('ready','leased','done','failed','cancelled')),
 collection_tries integer not null default 0, extraction_tries integer not null default 0,
 available_at timestamptz not null default now(), lease_token uuid, lease_expires_at timestamptz,
 attempt_id uuid references public.geo_run_attempts, error_message text, needs_review boolean not null default false
);
create index geo_jobs_ready on public.geo_run_jobs(available_at) where status='ready';
create index geo_batch_runs on public.geo_runs(batch_id);
create table public.geo_worker_runtime(id boolean primary key default true check(id),dispatcher_enabled boolean not null default false,last_seen_at timestamptz);
insert into public.geo_worker_runtime(id) values(true);
alter table public.geo_worker_runtime enable row level security;
revoke all on public.geo_worker_runtime from public,anon,authenticated;
grant select,update on public.geo_worker_runtime to service_role;
alter table public.geo_batches enable row level security;
alter table public.geo_run_jobs enable row level security;
revoke all on public.geo_batches,public.geo_run_jobs,public.geo_reporting_runs,public.geo_test_runs from public,anon,authenticated;
grant select,insert,update on public.geo_batches,public.geo_run_jobs to service_role;
grant select on public.geo_reporting_runs,public.geo_test_runs to service_role;

-- New identity fields are immutable too. Existing completed history stays untouched.
create or replace function public.geo_queue_identity() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' then
  new.purpose:=coalesce(new.purpose,case when new.source='scheduled' then 'monitoring' else 'test' end);
  if new.batch_id is not null and not exists(select 1 from public.geo_batches b where b.id=new.batch_id
    and b.environment=new.environment and b.benchmark_id=new.benchmark_id and b.purpose=new.purpose) then
   raise exception 'Batch scope mismatch.' using errcode='22023';
  end if;
 elsif row(new.purpose,new.batch_id) is distinct from row(old.purpose,old.batch_id) then
  raise exception 'Run purpose and batch are immutable.';
 end if;
 return new;
end $$;
create trigger geo_00_queue_identity before insert or update on public.geo_runs for each row execute function public.geo_queue_identity();

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
  and (p_question_id is null or id=p_question_id) and (status='active' or (p_kind='test' and status='draft')) order by id for share loop
  insert into public.geo_runs(environment,benchmark_id,question_id,source,purpose,batch_id,scheduled_for,idempotency_key,created_by)
   values(p_environment,p_benchmark_id,q.id,case when p_kind='scheduled' then 'scheduled' else 'manual' end,
    purpose_value,b.id,b.scheduled_for,b.id||':'||q.id,p_actor) returning id into rid;
  insert into public.geo_run_jobs(run_id,batch_id) values(rid,b.id);
  n:=n+1; first_run:=coalesce(first_run,rid);
 end loop;
 if n=0 and p_kind<>'scheduled' then raise exception 'No eligible questions. Save a draft to test, or approve questions to monitor.' using errcode='22023'; end if;
 return jsonb_build_object('batchId',b.id,'runId',case when p_kind in ('single','test') then first_run else null end,'count',n,'purpose',purpose_value);
end $$;

create or replace function public.geo_next_monday(p_after timestamptz) returns timestamptz
language sql stable set search_path=pg_catalog,public as $$
 select case when slot>p_after then slot else ((slot at time zone 'America/Toronto')+interval '7 days') at time zone 'America/Toronto' end
 from (select (date_trunc('week',p_after at time zone 'America/Toronto')+interval '9 hours') at time zone 'America/Toronto' as slot) s;
$$;
create or replace function public.geo_set_schedule(p_environment text,p_benchmark_id uuid,p_enabled boolean)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare b public.geo_benchmarks;
begin
 perform pg_advisory_xact_lock(hashtext('geo-schedule:'||p_environment));
 select * into b from public.geo_benchmarks where id=p_benchmark_id and environment=p_environment for update;
 if b.id is null or p_enabled is null then raise exception 'Unknown benchmark.' using errcode='22023'; end if;
 if p_enabled then
  update public.geo_benchmarks set schedule_enabled=false,next_scheduled_at=null where environment=p_environment and id<>b.id and schedule_enabled;
 end if;
 update public.geo_benchmarks set schedule_enabled=p_enabled,schedule_days=array[1]::smallint[],schedule_time='09:00',schedule_timezone='America/Toronto',
 next_scheduled_at=case when p_enabled then case when b.schedule_enabled then coalesce(b.next_scheduled_at,public.geo_next_monday(now())) else public.geo_next_monday(now()) end else null end
 where id=b.id;
end $$;
-- Prior scheduling fields were scaffolding; never activate them during installation.
update public.geo_benchmarks set schedule_enabled=false,next_scheduled_at=null where schedule_enabled or next_scheduled_at is not null;

create or replace function public.geo_queue_due() returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare b public.geo_benchmarks; latest timestamptz;
begin
 for b in select * from public.geo_benchmarks where schedule_enabled and next_scheduled_at<=now() for update skip locked loop
  latest:=(date_trunc('week',now() at time zone 'America/Toronto')+interval '9 hours') at time zone 'America/Toronto';
  if latest>now() then latest:=((latest at time zone 'America/Toronto')-interval '7 days') at time zone 'America/Toronto'; end if;
  if latest>=b.next_scheduled_at and latest>=now()-interval '24 hours' then
   perform public.geo_enqueue(b.environment,b.id,'scheduled',gen_random_uuid(),null,null,latest);
  end if;
  update public.geo_benchmarks set next_scheduled_at=public.geo_next_monday(now()) where id=b.id;
 end loop;
end $$;

-- The claim lock serializes lease expiry and global two-stage concurrency.
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
   if q.revision<>r.question_revision or q.status='archived' or (r.purpose='monitoring' and q.status<>'active') then
    update public.geo_run_jobs set status='cancelled',error_message='Question changed or is no longer eligible.' where run_id=r.id;
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

create or replace function public.geo_worker_save(p_run_id uuid,p_token uuid,p_response jsonb,p_text text default null,p_usage jsonb default '{}')
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare j public.geo_run_jobs;
begin
 select * into j from public.geo_run_jobs where run_id=p_run_id for update;
 if j.status<>'leased' or j.lease_token is distinct from p_token or j.lease_expires_at<=now() then raise exception 'Stale worker lease.' using errcode='22023'; end if;
 perform 1 from public.geo_runs where id=p_run_id and lease_token=p_token and status='running' for update;
 if not found then raise exception 'Stale run lease.' using errcode='22023'; end if;
 if j.stage='collection' then
  update public.geo_run_attempts set raw_response=p_response,provider_response_id=p_response->>'id',returned_model=p_response->>'model',response_text=p_text,
   usage=jsonb_build_object('collection',p_usage),status='extracting' where id=j.attempt_id;
 else
  update public.geo_run_attempts set extraction=jsonb_build_object('rawResponse',p_response),usage=coalesce(usage,'{}')||jsonb_build_object('extraction',p_usage) where id=j.attempt_id;
 end if;
end $$;

create or replace function public.geo_worker_advance(p_run_id uuid,p_token uuid) returns void
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare j public.geo_run_jobs;
begin
 select * into j from public.geo_run_jobs where run_id=p_run_id for update;
 if j.status<>'leased' or j.stage<>'collection' or j.lease_token is distinct from p_token or j.lease_expires_at<=now() then raise exception 'Stale worker lease.' using errcode='22023'; end if;
 if not exists(select 1 from public.geo_run_attempts where id=j.attempt_id and response_text is not null and raw_response->>'status'='completed') then raise exception 'Save completed response first.'; end if;
 update public.geo_runs set status='queued',lease_token=null,lease_expires_at=null where id=p_run_id and lease_token=p_token;
 update public.geo_run_jobs set status='ready',stage='extraction',available_at=now(),lease_token=null,lease_expires_at=null,error_message=null where run_id=p_run_id;
end $$;

create or replace function public.geo_worker_finish(p_run_id uuid,p_token uuid,p_extraction jsonb,p_mentions jsonb,p_sources jsonb)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare j public.geo_run_jobs; r public.geo_runs; a public.geo_run_attempts;
begin
 select * into j from public.geo_run_jobs where run_id=p_run_id for update;
 if j.status='done' then return; end if;
 if j.status<>'leased' or j.stage<>'extraction' or j.lease_token is distinct from p_token or j.lease_expires_at<=now() then raise exception 'Stale worker lease.' using errcode='22023'; end if;
 select * into r from public.geo_runs where id=p_run_id for update;
 select * into a from public.geo_run_attempts where id=j.attempt_id;
 perform public.geo_finish_manual_run(r.environment,r.id,a.id,p_token,p_extraction,p_mentions,p_sources,a.usage);
 update public.geo_run_jobs set status='done',lease_token=null,lease_expires_at=null,error_message=null,needs_review=false where run_id=r.id;
end $$;

create or replace function public.geo_worker_fail(p_run_id uuid,p_token uuid,p_message text,p_retryable boolean,p_unknown boolean default false)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare j public.geo_run_jobs; retry boolean; tries integer;
begin
 select * into j from public.geo_run_jobs where run_id=p_run_id for update;
 if j.status<>'leased' or j.lease_token is distinct from p_token or j.lease_expires_at<=now() then return; end if;
 perform 1 from public.geo_runs where id=p_run_id for update;
 tries:=case when j.stage='collection' then j.collection_tries else j.extraction_tries end;
 retry:=p_retryable and not p_unknown and tries<4;
 if j.stage='collection' or not retry then
  update public.geo_run_attempts set status='failed',error_stage=j.stage,error_message=left(p_message,1000),finished_at=now() where id=j.attempt_id;
 end if;
 update public.geo_run_jobs set status=case when retry then 'ready' else 'failed' end,
  available_at=now()+make_interval(secs=>least(900,60*power(2,tries-1)::integer)),error_message=left(p_message,1000),needs_review=p_unknown,
  lease_token=null,lease_expires_at=null where run_id=p_run_id;
 update public.geo_runs set status=case when retry then 'queued' else 'failed' end,finished_at=case when retry then null else now() end,
  lease_token=null,lease_expires_at=null where id=p_run_id;
end $$;

create table public.geo_retry_requests(id uuid primary key,batch_id uuid not null references public.geo_batches,created_at timestamptz not null default now());
alter table public.geo_retry_requests enable row level security;
revoke all on public.geo_retry_requests from public,anon,authenticated;
grant select,insert on public.geo_retry_requests to service_role;

create or replace function public.geo_retry_batch(p_environment text,p_batch_id uuid,p_request_key uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare j public.geo_run_jobs; n integer:=0; can_analyze boolean;
begin
 perform 1 from public.geo_batches where id=p_batch_id and environment=p_environment and purpose='monitoring' for update;
 if not found then raise exception 'Unknown monitoring batch.' using errcode='22023'; end if;
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
   collection_tries=0,extraction_tries=0,available_at=now(),error_message=null,needs_review=false where run_id=j.run_id;
  n:=n+1;
 end loop;
 return jsonb_build_object('batchId',p_batch_id,'count',n);
end $$;


create or replace view public.geo_batch_progress with(security_invoker=true) as
 select b.*,count(r.id)::integer as total,
 count(r.id) filter(where j.status='ready')::integer as queued,
 count(r.id) filter(where j.status='leased' and j.stage='collection')::integer as collecting,
 count(r.id) filter(where j.status='leased' and j.stage='extraction')::integer as analyzing,
 count(r.id) filter(where j.status='done')::integer as completed,
 count(r.id) filter(where j.status='failed')::integer as failed,
 count(r.id) filter(where j.status='cancelled')::integer as cancelled,
 count(r.id) filter(where j.needs_review)::integer as needs_review
 from public.geo_batches b left join public.geo_runs r on r.batch_id=b.id left join public.geo_run_jobs j on j.run_id=r.id group by b.id;
grant select on public.geo_batch_progress to service_role;
revoke all on public.geo_batch_progress from public,anon,authenticated;

-- Reporting opportunities cannot cite test evidence, even through direct RPC calls.
create or replace function public.geo_check_insight_evidence() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.geo_insights i join public.geo_reporting_runs r on r.id=new.run_id
  where i.id=new.insight_id and i.environment=r.environment and i.benchmark_id=r.benchmark_id and r.status='succeeded') then
  raise exception 'Opportunity evidence must be completed monitoring from this benchmark/environment.' using errcode='22023';
 end if;
 return new;
end $$;
create or replace view public.geo_reporting_insights with(security_invoker=true) as
 select i.* from public.geo_insights i where exists(select 1 from public.geo_insight_evidence e where e.insight_id=i.id)
 and not exists(select 1 from public.geo_insight_evidence e left join public.geo_reporting_runs r on r.id=e.run_id and r.status='succeeded' where e.insight_id=i.id and r.id is null);
revoke all on public.geo_reporting_insights from public,anon,authenticated;
grant select on public.geo_reporting_insights to service_role;

create or replace function public.geo_prepare_run() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare q public.geo_questions; b public.geo_benchmarks;
begin
  if tg_op = 'INSERT' then
    select * into q from public.geo_questions where id = new.question_id for share;
    select * into b from public.geo_benchmarks where id = new.benchmark_id for share;
    if q.id is null or b.id is null or (q.status <> 'active' and not (new.purpose='test' and q.status='draft'))
      or q.environment <> new.environment or b.environment <> new.environment then
      raise exception 'Run requires an approved question and benchmark in the same environment.';
    end if;
    new.question_revision := q.revision;
    select jsonb_build_object('question', q.question, 'language', q.language,
      'questionKind', q.question_kind, 'topicId', t.id, 'topic', t.name,
      'marketId', m.id, 'market', m.name, 'scope', m.scope,
      'country', m.country_code, 'province', m.province, 'city', m.city)
      into new.question_snapshot from public.geo_topics t cross join public.geo_markets m
      where t.id = q.topic_id and m.id = q.market_id;
    if new.status <> 'queued' then raise exception 'New runs must be queued.'; end if;
  else
    if old.status = 'succeeded' then raise exception 'Completed runs are immutable.'; end if;
    if row(new.id, new.environment, new.benchmark_id, new.question_id, new.question_revision,
      new.question_snapshot, new.source, new.scheduled_for, new.idempotency_key)
      is distinct from row(old.id, old.environment, old.benchmark_id, old.question_id, old.question_revision,
      old.question_snapshot, old.source, old.scheduled_for, old.idempotency_key) then
      raise exception 'Run sampling identity and question snapshot are immutable.';
    end if;
  end if;
  if new.status = 'succeeded' and not exists (
    select 1 from public.geo_run_attempts a
    where a.id = new.selected_attempt_id and a.run_id = new.id and a.status = 'succeeded'
  ) then raise exception 'Select a successful, fully extracted attempt before completing a run.'; end if;
  return new;
end $$;

create or replace function public.geo_brand_metrics(
  p_environment text, p_benchmark_id uuid, p_start timestamptz, p_end timestamptz,
  p_group_by text default 'overall', p_topic_id uuid default null,
  p_market_id uuid default null, p_language text default null,
  p_question_kind text default 'unbranded', p_include_manual boolean default false
) returns table (
  group_key text, group_label text, brand_id uuid, brand_name text, is_chartwell boolean,
  samples bigint, mentions bigint, ranked_mentions bigint, top3_mentions bigint,
  visibility_rate numeric, average_position numeric, top3_rate numeric, share_of_voice numeric
) language plpgsql stable security invoker set search_path = pg_catalog, public as $$
begin
  if p_environment is null or p_environment not in ('qa', 'prod') or p_start is null or p_end is null or p_end <= p_start
    or p_group_by is null or p_group_by not in ('overall', 'topic', 'market', 'week', 'month')
    or (p_language is not null and p_language not in ('en', 'fr'))
    or (p_question_kind is not null and p_question_kind not in ('unbranded', 'branded'))
    or p_include_manual is null
    or not exists (select 1 from public.geo_benchmarks b where b.id = p_benchmark_id and b.environment = p_environment) then
    raise exception 'Invalid GEO metric filters or benchmark.' using errcode = '22023';
  end if;
  return query with observations as (
    select r.selected_attempt_id, r.question_snapshot,
      case p_group_by
        when 'topic' then r.question_snapshot->>'topicId'
        when 'market' then r.question_snapshot->>'marketId'
        when 'week' then to_char(date_trunc('week', r.scheduled_for at time zone 'America/Toronto'), 'YYYY-MM-DD')
        when 'month' then to_char(r.scheduled_for at time zone 'America/Toronto', 'YYYY-MM')
        else 'overall' end as key,
      case p_group_by when 'topic' then r.question_snapshot->>'topic'
        when 'market' then r.question_snapshot->>'market' else null end as label
    from public.geo_reporting_runs r join public.geo_run_attempts a on a.id = r.selected_attempt_id and a.run_id = r.id
    where r.environment = p_environment and r.benchmark_id = p_benchmark_id
      and r.status = 'succeeded' and a.status = 'succeeded'
      and r.scheduled_for >= p_start and r.scheduled_for < p_end
      -- p_include_manual is retained only for old SQL callers; tests never count.
      and (p_topic_id is null or r.question_snapshot->>'topicId' = p_topic_id::text)
      and (p_market_id is null or r.question_snapshot->>'marketId' = p_market_id::text)
      and (p_language is null or r.question_snapshot->>'language' = p_language)
      and (p_question_kind is null or r.question_snapshot->>'questionKind' = p_question_kind)
  ), groups as (
    select o.key, coalesce(max(o.label), o.key) as label, count(*) as n from observations o group by o.key
    union all select 'overall', 'overall', 0::bigint
      where p_group_by = 'overall' and not exists (select 1 from observations)
  ), counts as (
    select g.key, g.label, b.id, b.name, b.is_chartwell, g.n,
      count(m.brand_id) as mentioned,
      count(m.position) as ranked,
      count(*) filter (where m.position <= 3) as top3,
      avg(m.position) as avg_position
    from groups g cross join public.geo_brands b
    left join observations o on o.key = g.key
    left join public.geo_mentions m on m.attempt_id = o.selected_attempt_id and m.brand_id = b.id
    group by g.key, g.label, b.id, b.name, b.is_chartwell, g.n
  ) select c.key, c.label, c.id, c.name, c.is_chartwell, c.n, c.mentioned, c.ranked, c.top3,
      round(c.mentioned::numeric / nullif(c.n, 0), 6), round(c.avg_position, 4),
      round(c.top3::numeric / nullif(c.n, 0), 6),
      round(c.mentioned::numeric / nullif(sum(c.mentioned) over (partition by c.key), 0), 6)
    from counts c order by c.key, c.mentioned desc, c.name;
end $$;

create or replace function public.geo_dashboard_summary(
  p_environment text, p_benchmark_id uuid, p_start timestamptz, p_end timestamptz,
  p_topic_id uuid default null, p_market_id uuid default null, p_language text default null,
  p_question_kind text default 'unbranded', p_include_manual boolean default false
) returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, public as $$
declare result jsonb;
begin
  if not exists(select 1 from public.geo_benchmarks where id=p_benchmark_id and environment=p_environment)
    or p_start is null or p_end is null or p_end <= p_start then
    raise exception 'Invalid dashboard filters.' using errcode='22023';
  end if;
  with matching as (
    select r.* from public.geo_reporting_runs r where r.environment=p_environment and r.benchmark_id=p_benchmark_id
      and r.scheduled_for >= p_start and r.scheduled_for < p_end
      -- Legacy argument ignored: only monitoring runs are visible.
      and (p_topic_id is null or r.question_snapshot->>'topicId'=p_topic_id::text)
      and (p_market_id is null or r.question_snapshot->>'marketId'=p_market_id::text)
      and (p_language is null or r.question_snapshot->>'language'=p_language)
      and (p_question_kind is null or r.question_snapshot->>'questionKind'=p_question_kind)
  ), valid as (
    select r.* from matching r join public.geo_run_attempts a on a.id=r.selected_attempt_id and a.run_id=r.id
      where r.status='succeeded' and a.status='succeeded'
  ), domains as (
    select s.domain,count(distinct r.id) filter(where s.source_kind='cited') as cited_answers,
      count(distinct r.id) filter(where s.source_kind='consulted') as consulted_answers,
      count(distinct s.normalized_url) as urls,min(s.url) as example_url,max(s.title) as title
    from valid r join public.geo_sources s on s.attempt_id=r.selected_attempt_id
    group by s.domain order by cited_answers desc,consulted_answers desc,s.domain limit 100
  ) select jsonb_build_object('sources',coalesce((select jsonb_agg(to_jsonb(d)) from domains d),'[]'::jsonb),
    'counts',jsonb_build_object('succeeded',(select count(*) from valid),
      'failed',(select count(*) from matching where status in ('failed','cancelled') or (status='running' and lease_expires_at <= now())),
      'pending',(select count(*) from matching where status='queued' or (status='running' and (lease_expires_at is null or lease_expires_at > now()))))) into result;
  return result;
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'geo\_%' escape '\' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
