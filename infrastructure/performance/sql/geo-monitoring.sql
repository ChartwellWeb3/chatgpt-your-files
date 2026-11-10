-- Chartwell GEO monitoring: initial SQL Editor installation.
-- Run this ENTIRE file in the PERFORMANCE Supabase project's SQL Editor.
-- This adds only geo_* objects. It does not change performance/chatbot tables,
-- copy users, install a scheduler, deploy a worker, or make paid API calls.
-- Browser access is closed. The app must authenticate/authorize using the
-- ORIGINAL project's session before using the performance service client.
-- Safe to repeat for this schema version; future schema changes need new SQL.
begin;

create table if not exists public.geo_topics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table if not exists public.geo_markets (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null check (length(btrim(name)) between 1 and 120),
  scope text not null check (scope in ('national', 'province', 'city')),
  country_code text not null default 'CA' check (country_code ~ '^[A-Z]{2}$'),
  province text,
  city text,
  created_at timestamptz not null default now(),
  check ((scope = 'national' and province is null and city is null)
    or (scope = 'province' and province is not null and length(btrim(province)) > 0 and city is null)
    or (scope = 'city' and province is not null and city is not null
      and length(btrim(province)) > 0 and length(btrim(city)) > 0))
);

-- A residence is resolved to its parent brand during extraction. Each brand
-- can appear only once per answer, even if several residences are mentioned.
create table if not exists public.geo_brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null check (length(btrim(name)) between 1 and 160),
  aliases text[] not null default '{}',
  domains text[] not null default '{}',
  is_chartwell boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists geo_one_chartwell_brand
  on public.geo_brands (is_chartwell) where is_chartwell;

-- Drafts are also the prompt-discovery review queue. Store imported topics or
-- de-identified source summaries here, not visitor/contact-form transcripts.
-- Actor UUIDs refer to the ORIGINAL Auth project; deliberately no Auth FK.
create table if not exists public.geo_questions (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('qa', 'prod')),
  question text not null check (length(btrim(question)) between 10 and 4000),
  language text not null default 'en' check (language in ('en', 'fr')),
  question_kind text not null default 'unbranded' check (question_kind in ('unbranded', 'branded')),
  topic_id uuid not null references public.geo_topics(id),
  market_id uuid not null references public.geo_markets(id),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  revision integer not null default 1 check (revision > 0),
  discovery_source text not null default 'manual',
  discovery_notes text,
  source_reference text,
  created_by uuid,
  updated_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'active' or (approved_by is not null and approved_at is not null))
);
create index if not exists geo_questions_queue
  on public.geo_questions (environment, status, topic_id, market_id);

-- No benchmark is seeded: select and verify a search-capable model before use.
-- These are reproducible measurement configurations, separate from chatbot
-- OPENAI_ANALYSIS_MODEL. Settings must include the web-search/location policy.
-- Changes to measurement settings after a run require a NEW benchmark row.
create table if not exists public.geo_benchmarks (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('qa', 'prod')),
  name text not null check (length(btrim(name)) between 1 and 160),
  provider text not null default 'openai' check (provider = 'openai'),
  model text not null check (length(btrim(model)) > 0),
  analysis_model text not null check (length(btrim(analysis_model)) > 0),
  collection_prompt text not null check (length(btrim(collection_prompt)) > 0),
  extraction_prompt text not null check (length(btrim(extraction_prompt)) > 0),
  measurement_version text not null default 'v1',
  request_settings jsonb not null default '{}' check (jsonb_typeof(request_settings) = 'object'),
  schedule_enabled boolean not null default false,
  schedule_days smallint[] not null default '{1,3,5}', -- ISO: Monday/Wednesday/Friday
  schedule_time time not null default '09:00',
  schedule_timezone text not null default 'America/Toronto',
  next_scheduled_at timestamptz,
  monthly_budget_usd numeric(12,4) not null default 200 check (monthly_budget_usd > 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (cardinality(schedule_days) between 1 and 7 and schedule_days <@ array[1,2,3,4,5,6,7]::smallint[])
);
create unique index if not exists geo_one_scheduled_benchmark_per_environment
  on public.geo_benchmarks (environment) where schedule_enabled;

-- One run = one question at one sampling time. Retries are separate attempts,
-- not extra samples. Manual runs are excluded from scheduled metrics by default.
create table if not exists public.geo_runs (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('qa', 'prod')),
  benchmark_id uuid not null references public.geo_benchmarks(id),
  question_id uuid not null references public.geo_questions(id),
  question_revision integer not null,
  question_snapshot jsonb not null,
  source text not null default 'scheduled' check (source in ('scheduled', 'manual')),
  scheduled_for timestamptz not null,
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 250),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  selected_attempt_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (environment, idempotency_key),
  check ((status = 'succeeded') = (selected_attempt_id is not null)),
  check (status not in ('succeeded', 'failed', 'cancelled') or finished_at is not null)
);
create unique index if not exists geo_one_scheduled_sample
  on public.geo_runs (benchmark_id, question_id, scheduled_for) where source = 'scheduled';
create index if not exists geo_runs_history
  on public.geo_runs (environment, benchmark_id, scheduled_for desc);
create index if not exists geo_runs_question_history
  on public.geo_runs (question_id, question_revision, scheduled_for desc);
create index if not exists geo_runs_pending
  on public.geo_runs (environment, status, scheduled_for) where status in ('queued', 'running');

create table if not exists public.geo_run_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.geo_runs(id),
  attempt_number integer not null check (attempt_number > 0),
  status text not null default 'collecting' check (status in ('collecting', 'extracting', 'succeeded', 'failed')),
  provider_response_id text,
  returned_model text,
  response_text text,
  raw_response jsonb,
  extraction jsonb,
  usage jsonb not null default '{}' check (jsonb_typeof(usage) = 'object'),
  estimated_cost_usd numeric(12,6) check (estimated_cost_usd >= 0),
  error_stage text check (error_stage in ('collection', 'extraction')),
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (run_id, attempt_number),
  unique (run_id, id),
  check (status <> 'succeeded' or (
    provider_response_id is not null and returned_model is not null
    and response_text is not null and length(btrim(response_text)) > 0
    and raw_response is not null and jsonb_typeof(raw_response) = 'object'
    and extraction is not null and jsonb_typeof(extraction) = 'object'
    and finished_at is not null and error_stage is null)),
  check (status <> 'failed' or (error_stage is not null and error_message is not null and finished_at is not null))
);
create unique index if not exists geo_provider_response_once
  on public.geo_run_attempts (provider_response_id) where provider_response_id is not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.geo_runs'::regclass and conname = 'geo_selected_attempt_same_run') then
    alter table public.geo_runs add constraint geo_selected_attempt_same_run
      foreign key (id, selected_attempt_id) references public.geo_run_attempts(run_id, id);
  end if;
end $$;

create table if not exists public.geo_mentions (
  attempt_id uuid not null references public.geo_run_attempts(id),
  brand_id uuid not null references public.geo_brands(id),
  observed_name text not null,
  is_recommendation boolean not null default false,
  position integer check (position > 0),
  evidence_quote text not null check (length(btrim(evidence_quote)) > 0),
  primary key (attempt_id, brand_id),
  check (position is null or is_recommendation)
);

-- Keep actual inline citations separate from other consulted web sources.
-- A URL mentioned by the extractor is not a citation unless the provider's
-- response contains its citation annotation. Preserve the original annotation.
create table if not exists public.geo_sources (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.geo_run_attempts(id),
  source_kind text not null check (source_kind in ('cited', 'consulted')),
  source_index integer not null check (source_index >= 0),
  url text not null check (url ~* '^https?://'),
  normalized_url text not null check (normalized_url ~* '^https?://'),
  domain text not null check (length(btrim(domain)) > 0),
  title text,
  owner_brand_id uuid references public.geo_brands(id),
  source_type text not null default 'unknown'
    check (source_type in ('owned', 'directory', 'reviews', 'media', 'healthcare', 'other', 'unknown')),
  annotation jsonb not null default '{}' check (jsonb_typeof(annotation) = 'object'),
  citation_start integer,
  citation_end integer,
  unique (attempt_id, source_kind, source_index),
  check ((citation_start is null and citation_end is null)
    or (citation_start is not null and citation_end is not null
      and citation_start >= 0 and citation_end > citation_start))
);
create index if not exists geo_sources_domains on public.geo_sources (domain, source_kind);

create table if not exists public.geo_insights (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('qa', 'prod')),
  benchmark_id uuid not null references public.geo_benchmarks(id),
  period_start timestamptz not null,
  period_end timestamptz not null check (period_end > period_start),
  filters jsonb not null default '{}' check (jsonb_typeof(filters) = 'object'),
  title text not null,
  opportunity text not null,
  model text not null,
  raw_response jsonb not null,
  usage jsonb not null default '{}',
  estimated_cost_usd numeric(12,6) check (estimated_cost_usd >= 0),
  status text not null default 'new' check (status in ('new', 'investigating', 'dismissed')),
  created_at timestamptz not null default now()
);
create table if not exists public.geo_insight_evidence (
  insight_id uuid not null references public.geo_insights(id),
  run_id uuid not null references public.geo_runs(id),
  primary key (insight_id, run_id)
);

create or replace function public.geo_prepare_question() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Archive GEO questions instead of deleting them.';
  end if;
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.environment <> old.environment then
      raise exception 'Question identity/environment cannot change.';
    end if;
    if row(new.question, new.language, new.question_kind, new.topic_id, new.market_id)
      is distinct from row(old.question, old.language, old.question_kind, old.topic_id, old.market_id) then
      new.revision := old.revision + 1;
      new.status := 'draft';
      new.approved_by := null;
      new.approved_at := null;
    elsif new.revision <> old.revision then
      raise exception 'Question revisions are maintained automatically.';
    end if;
  else
    new.revision := 1;
  end if;
  if new.status = 'active' then
    if new.approved_by is null then raise exception 'Approval is required before monitoring.'; end if;
    new.approved_at := coalesce(new.approved_at, now());
  end if;
  new.updated_at := now();
  return new;
end $$;
create or replace trigger geo_question_review before insert or update or delete
  on public.geo_questions for each row execute function public.geo_prepare_question();

create or replace function public.geo_protect_benchmark() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if row(new.id, new.environment, new.provider, new.model, new.analysis_model,
    new.collection_prompt, new.extraction_prompt, new.measurement_version, new.request_settings)
    is distinct from row(old.id, old.environment, old.provider, old.model, old.analysis_model,
    old.collection_prompt, old.extraction_prompt, old.measurement_version, old.request_settings)
    and exists (select 1 from public.geo_runs where benchmark_id = old.id) then
    raise exception 'Create a new benchmark to change measurement settings after collecting samples.';
  end if;
  if not exists (select 1 from pg_timezone_names where name = new.schedule_timezone) then
    raise exception 'Unknown schedule timezone.';
  end if;
  return new;
end $$;
create or replace trigger geo_benchmark_history before insert or update
  on public.geo_benchmarks for each row execute function public.geo_protect_benchmark();

create or replace function public.geo_prepare_run() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare q public.geo_questions; b public.geo_benchmarks;
begin
  if tg_op = 'INSERT' then
    select * into q from public.geo_questions where id = new.question_id for share;
    select * into b from public.geo_benchmarks where id = new.benchmark_id for share;
    if q.id is null or b.id is null or q.status <> 'active'
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
create or replace trigger geo_run_snapshot before insert or update
  on public.geo_runs for each row execute function public.geo_prepare_run();

-- Finalize evidence, attempt, and run in that order in one worker transaction.
-- A retry after extraction failure can reuse the saved answer without searching
-- again. Do not finalize a run until mentions and citations are fully persisted.
create or replace function public.geo_protect_evidence() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare attempt uuid; parent_run uuid;
begin
  if tg_table_name = 'geo_run_attempts' then
    if tg_op = 'INSERT' then parent_run := new.run_id;
    else
      parent_run := old.run_id;
      if tg_op = 'UPDATE' and (new.id <> old.id or new.run_id <> old.run_id or new.attempt_number <> old.attempt_number) then
        raise exception 'Attempt identity is immutable.';
      end if;
    end if;
  else
    if tg_op = 'INSERT' then attempt := new.attempt_id;
    else
      attempt := old.attempt_id;
      if tg_op = 'UPDATE' and new.attempt_id <> old.attempt_id then
        raise exception 'Evidence attempt is immutable.';
      end if;
    end if;
    select run_id into parent_run from public.geo_run_attempts where id = attempt;
  end if;
  -- Lock the run to serialize finalization against concurrent evidence writes.
  perform 1 from public.geo_runs where id = parent_run for update;
  if exists (select 1 from public.geo_runs where id = parent_run and status = 'succeeded') then
    raise exception 'Evidence for a completed run is immutable.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create or replace trigger geo_attempt_history before insert or update or delete
  on public.geo_run_attempts for each row execute function public.geo_protect_evidence();
create or replace trigger geo_mention_history before insert or update or delete
  on public.geo_mentions for each row execute function public.geo_protect_evidence();
create or replace trigger geo_source_history before insert or update or delete
  on public.geo_sources for each row execute function public.geo_protect_evidence();

-- Exactly one valid observation per successful run. No averaging in the browser.
-- Require ONE benchmark per query so models/settings are never silently pooled.
-- [start,end) is half-open; the API supplies Toronto calendar-day boundaries.
-- Visibility = mentioned answers / valid answers.
-- Avg position = mean explicit recommendation rank WHEN ranked (null otherwise).
-- Top 3 = answers with explicit recommendation rank <= 3 / ALL valid answers.
-- Share of voice = brand-answer mentions / all tracked brand-answer mentions.
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
    from public.geo_runs r join public.geo_run_attempts a on a.id = r.selected_attempt_id and a.run_id = r.id
    where r.environment = p_environment and r.benchmark_id = p_benchmark_id
      and r.status = 'succeeded' and a.status = 'succeeded'
      and r.scheduled_for >= p_start and r.scheduled_for < p_end
      and (p_include_manual or r.source = 'scheduled')
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

insert into public.geo_topics (slug, name) values
  ('memory-care', 'Memory Care'), ('independent-living', 'Independent Living'),
  ('assisted-living', 'Assisted Living'), ('pricing', 'Pricing'), ('location', 'Location'),
  ('amenities', 'Amenities'), ('food', 'Food'), ('safety', 'Safety'),
  ('reviews', 'Reviews'), ('comparison', 'Comparison') on conflict (slug) do nothing;
insert into public.geo_markets (slug, name, scope, province, city) values
  ('canada', 'Canada / General', 'national', null, null),
  ('ontario', 'Ontario', 'province', 'Ontario', null),
  ('alberta', 'Alberta', 'province', 'Alberta', null),
  ('british-columbia', 'British Columbia', 'province', 'British Columbia', null),
  ('toronto', 'Toronto', 'city', 'Ontario', 'Toronto'),
  ('ottawa', 'Ottawa', 'city', 'Ontario', 'Ottawa'),
  ('mississauga', 'Mississauga', 'city', 'Ontario', 'Mississauga'),
  ('calgary', 'Calgary', 'city', 'Alberta', 'Calgary'),
  ('vancouver', 'Vancouver', 'city', 'British Columbia', 'Vancouver') on conflict (slug) do nothing;
insert into public.geo_brands (slug, name, aliases, domains, is_chartwell) values
  ('chartwell', 'Chartwell', array['Chartwell', 'Chartwell Retirement Residences'], array['chartwell.com'], true)
  on conflict (slug) do nothing;

-- RLS intentionally has NO browser/user policies. Auth is in another project.
-- Grant only these GEO tables; never change grants for other public objects.
do $$ declare t text; begin
  foreach t in array array['geo_topics', 'geo_markets', 'geo_brands', 'geo_questions',
    'geo_benchmarks', 'geo_runs', 'geo_run_attempts', 'geo_mentions', 'geo_sources',
    'geo_insights', 'geo_insight_evidence'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert, update on table public.%I to service_role', t);
  end loop;
end $$;
revoke all on function public.geo_prepare_question() from public, anon, authenticated;
revoke all on function public.geo_protect_benchmark() from public, anon, authenticated;
revoke all on function public.geo_prepare_run() from public, anon, authenticated;
revoke all on function public.geo_protect_evidence() from public, anon, authenticated;
revoke all on function public.geo_brand_metrics(text,uuid,timestamptz,timestamptz,text,uuid,uuid,text,text,boolean)
  from public, anon, authenticated;
grant execute on function public.geo_prepare_question(), public.geo_protect_benchmark(),
  public.geo_prepare_run(), public.geo_protect_evidence() to service_role;
grant execute on function public.geo_brand_metrics(text,uuid,timestamptz,timestamptz,text,uuid,uuid,text,text,boolean)
  to service_role;

notify pgrst, 'reload schema';
commit;

-- Installation check: 11 tables, 10 topics, 9 markets, 1 Chartwell brand.
select (select count(*) from information_schema.tables where table_schema = 'public'
    and table_name in ('geo_topics','geo_markets','geo_brands','geo_questions','geo_benchmarks',
      'geo_runs','geo_run_attempts','geo_mentions','geo_sources','geo_insights','geo_insight_evidence')) as geo_tables,
  (select count(*) from public.geo_topics) as topics,
  (select count(*) from public.geo_markets) as markets,
  (select count(*) from public.geo_brands where is_chartwell) as chartwell_brands;
