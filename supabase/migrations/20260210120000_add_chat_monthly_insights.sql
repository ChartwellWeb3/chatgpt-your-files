create table if not exists public.chat_monthly_insights (
  id bigint generated always as identity primary key,
  month date not null,
  page_type text not null check (page_type in ('corporate', 'residence', 'find_a_residence', 'unknown')),
  lang text not null default 'all' check (lang in ('en', 'fr', 'all', 'unknown')),
  source text not null default 'manual' check (source in ('manual', 'auto')),
  model text not null,
  prompt_version text not null default 'v1',
  summary jsonb not null,
  raw jsonb null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_chat_monthly_insights_month_page_lang_source
  on public.chat_monthly_insights (month, page_type, lang, source);

create index if not exists idx_chat_monthly_insights_month
  on public.chat_monthly_insights (month desc);

alter table public.chat_monthly_insights enable row level security;

create policy "auth_select_chat_monthly_insights"
  on public.chat_monthly_insights
  for select
  to authenticated
  using (true);

create policy "admin_insert_chat_monthly_insights"
  on public.chat_monthly_insights
  for insert
  to authenticated
  with check (public.is_admin());

create policy "admin_update_chat_monthly_insights"
  on public.chat_monthly_insights
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update on table public.chat_monthly_insights to authenticated, service_role;

create or replace function public.chat_monthly_common_questions(
  p_start date,
  p_end date,
  p_limit int default 200
)
returns table (
  page_type text,
  question text,
  example text,
  freq bigint
)
language sql
security definer
set search_path = public
as $$
  with filtered as (
    select
      m.content,
      s.page_url,
      s.residence_custom_id
    from public.chat_messages m
    join public.chat_sessions s on s.id = m.session_id
    where m.role = 'user'
      and m.created_at >= p_start
      and m.created_at < (p_end + interval '1 day')
  ),
  normalized as (
    select
      case
        when lower(coalesce(residence_custom_id, '')) in ('corporateen','corporatefr')
          then 'corporate'
        when page_url ilike '%/find-a-residence%'
          then 'find_a_residence'
        when nullif(residence_custom_id, '') is not null
          then 'residence'
        else 'unknown'
      end as page_type,
      trim(
        regexp_replace(
          regexp_replace(
            lower(unaccent(coalesce(content, ''))),
            '[^a-z0-9\s]+',
            ' ',
            'g'
          ),
          '\s+',
          ' ',
          'g'
        )
      ) as question,
      left(coalesce(content, ''), 240) as example
    from filtered
  ),
  ranked as (
    select
      page_type,
      question,
      min(example) as example,
      count(*)::bigint as freq,
      row_number() over (
        partition by page_type
        order by count(*) desc
      ) as rn
    from normalized
    where length(question) > 2
    group by page_type, question
  )
  select page_type, question, example, freq
  from ranked
  where rn <= greatest(1, least(p_limit, 500))
  order by page_type, freq desc;
$$;

revoke all on function public.chat_monthly_common_questions(date, date, int) from public;
grant execute on function public.chat_monthly_common_questions(date, date, int) to authenticated, service_role;
