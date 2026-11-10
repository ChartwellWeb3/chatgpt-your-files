-- READ ONLY. Run individual queries in the PERFORMANCE SQL Editor after installation.
-- Never select Vault contents when sharing diagnostics.

select id,name,environment,model,analysis_model,schedule_enabled,
 next_scheduled_at,next_scheduled_at at time zone 'America/Toronto' as next_toronto
from public.geo_benchmarks order by created_at desc;

select dispatcher_enabled,last_seen_at,now()-last_seen_at as heartbeat_age from public.geo_worker_runtime;

select id,environment,benchmark_id,trigger_kind,purpose,scheduled_for,total,queued,collecting,analyzing,completed,failed,cancelled,needs_review
from public.geo_batch_progress order by created_at desc limit 30;

select r.id,r.environment,r.batch_id,r.question_snapshot->>'question' as question,
 j.stage,j.status,j.collection_tries,j.extraction_tries,j.error_message,j.needs_review,j.lease_expires_at
from public.geo_run_jobs j join public.geo_runs r on r.id=j.run_id
where j.status in ('failed','leased') order by r.created_at desc limit 100;

select 'reporting' as dataset,count(*) as answers from public.geo_reporting_runs
union all select 'tests',count(*) from public.geo_test_runs;

-- Must return zero: reporting/test overlap is never allowed.
select count(*) as reporting_test_overlap from public.geo_reporting_runs r join public.geo_test_runs t using(id);

-- DST example: both dates resolve to 9 AM local time; their UTC hours differ.
select d,public.geo_next_monday(d) as next_utc,
 public.geo_next_monday(d) at time zone 'America/Toronto' as next_local
from (values('2026-10-30T12:00:00Z'::timestamptz),('2027-03-12T12:00:00Z'::timestamptz)) x(d);

-- After activation only (Cron may not exist before that step):
select jobname,schedule,active from cron.job where jobname='geo-dispatch-every-minute';
select status,start_time,end_time,return_message from cron.job_run_details
where jobid in(select jobid from cron.job where jobname='geo-dispatch-every-minute') order by start_time desc limit 10;
-- No headers/credentials are returned here. Non-200 results indicate worker/auth issues.
select id,status_code,timed_out,error_msg,created from net._http_response order by created desc limit 20;
