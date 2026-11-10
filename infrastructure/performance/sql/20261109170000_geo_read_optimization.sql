-- PERFORMANCE project only. Run after the 15:00 and 16:00 validation updates.
-- Adds compact read functions. Does not alter history, schedules, workers, or Cron.
begin;

create index geo_jobs_live_activity on public.geo_run_jobs(run_id) where status in ('ready','leased');
create index geo_latest_scheduled_batch on public.geo_batches(environment,benchmark_id,created_at desc,id)
 where trigger_kind='scheduled';

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
  'counts',jsonb_build_object('succeeded',(select count(*) from valid where scheduled_for>=start_at),
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

create or replace function public.geo_reporting_count(
 p_environment text,p_benchmark_id uuid,p_start timestamptz,p_end timestamptz,
 p_topic_id uuid default null,p_market_id uuid default null,p_language text default null,
 p_question_kind text default 'unbranded',p_include_manual boolean default false
) returns bigint language sql stable security invoker set search_path=pg_catalog,public as $$
 select count(*) from public.geo_reporting_runs r join public.geo_run_attempts a on a.id=r.selected_attempt_id and a.run_id=r.id
 where r.environment=p_environment and r.benchmark_id=p_benchmark_id and r.status='succeeded' and a.status='succeeded'
  and r.scheduled_for>=p_start and r.scheduled_for<p_end
  and (p_topic_id is null or r.question_snapshot->>'topicId'=p_topic_id::text)
  and (p_market_id is null or r.question_snapshot->>'marketId'=p_market_id::text)
  and (p_language is null or r.question_snapshot->>'language'=p_language)
  and (p_question_kind is null or r.question_snapshot->>'questionKind'=p_question_kind);
$$;

create or replace function public.geo_last_scheduled_batch(p_environment text,p_benchmark_id uuid) returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
 select to_jsonb(p) from public.geo_batch_progress p where p.id=(
  select id from public.geo_batches where environment=p_environment and benchmark_id=p_benchmark_id and trigger_kind='scheduled'
  order by created_at desc,id limit 1);
$$;

revoke all on function public.geo_overview(text,uuid,date,date,uuid,uuid,text),public.geo_live_status(text),
 public.geo_reporting_count(text,uuid,timestamptz,timestamptz,uuid,uuid,text,text,boolean),
 public.geo_last_scheduled_batch(text,uuid) from public,anon,authenticated;
grant execute on function public.geo_overview(text,uuid,date,date,uuid,uuid,text),public.geo_live_status(text),
 public.geo_reporting_count(text,uuid,timestamptz,timestamptz,uuid,uuid,text,text,boolean),
 public.geo_last_scheduled_batch(text,uuid) to service_role;
commit;
