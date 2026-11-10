-- PERFORMANCE project only. Run AFTER 20261109120000_geo_queue.sql.
-- Adds batch cancellation. The currently deployed geo-worker already fences
-- cancelled leases, so this update does not require a worker redeployment.
begin;
alter table public.geo_batches add column if not exists cancelled_at timestamptz;
alter table public.geo_batches add column if not exists cancelled_by uuid;

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
 for j in select * from public.geo_run_jobs where batch_id=b.id and status in ('ready','leased') order by run_id for update loop
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
   collection_tries=0,extraction_tries=0,available_at=now(),error_message=null,needs_review=false where run_id=j.run_id;
  n:=n+1;
 end loop;
 return jsonb_build_object('batchId',p_batch_id,'count',n);
end $$;

-- Prevent retryBatch or direct RPCs from restarting a stopped batch.
create or replace function public.geo_prevent_cancelled_restart() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.status in ('ready','leased') and exists(select 1 from public.geo_batches where id=new.batch_id and cancelled_at is not null) then
  raise exception 'This collection was cancelled. Start a new collection to run these questions again.' using errcode='22023';
 end if;
 return new;
end $$;
create or replace trigger geo_cancelled_batch_guard before insert or update on public.geo_run_jobs
 for each row execute function public.geo_prevent_cancelled_restart();

-- Keep the original view column order; append the new cancellation metadata.
create or replace view public.geo_batch_progress with(security_invoker=true) as
 select b.id,b.environment,b.benchmark_id,b.purpose,b.trigger_kind,b.request_key,b.question_id,b.created_by,b.scheduled_for,b.created_at,
 count(r.id)::integer as total,
 count(r.id) filter(where j.status='ready')::integer as queued,
 count(r.id) filter(where j.status='leased' and j.stage='collection')::integer as collecting,
 count(r.id) filter(where j.status='leased' and j.stage='extraction')::integer as analyzing,
 count(r.id) filter(where j.status='done')::integer as completed,
 count(r.id) filter(where j.status='failed')::integer as failed,
 count(r.id) filter(where j.status='cancelled')::integer as cancelled,
 count(r.id) filter(where j.needs_review)::integer as needs_review,
 b.cancelled_at,b.cancelled_by
 from public.geo_batches b left join public.geo_runs r on r.batch_id=b.id left join public.geo_run_jobs j on j.run_id=r.id group by b.id;

revoke all on function public.geo_cancel_batch(text,uuid,uuid),public.geo_prevent_cancelled_restart() from public,anon,authenticated;
grant execute on function public.geo_cancel_batch(text,uuid,uuid),public.geo_prevent_cancelled_restart() to service_role;
notify pgrst,'reload schema';
commit;
