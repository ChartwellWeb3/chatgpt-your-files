create table if not exists public.chat_common_words (
  day date not null,
  lang text not null,
  word text not null,
  freq bigint not null,
  updated_at timestamptz not null default now(),
  primary key (day, lang, word)
);

create index if not exists idx_chat_common_words_day_lang_freq
  on public.chat_common_words (day, lang, freq desc);

alter table public.chat_common_words enable row level security;

create policy "auth_select_chat_common_words"
  on public.chat_common_words
  for select
  to authenticated
  using (true);

grant select on table public.chat_common_words to authenticated, service_role;

create or replace function public.refresh_chat_common_words(
  p_day date default current_date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.chat_common_words
  where day = p_day;

  insert into public.chat_common_words (day, lang, word, freq)
  select day, lang, word, freq
  from (
    select
      p_day as day,
      s.lang as lang,
      w.word as word,
      count(*) as freq,
      row_number() over (
        partition by s.lang
        order by count(*) desc
      ) as rn
    from public.chat_messages m
    join public.chat_sessions s on s.id = m.session_id
    cross join lateral (
      select regexp_split_to_table(
        regexp_replace(lower(unaccent(coalesce(m.content, ''))), '[^a-z0-9\s]+', ' ', 'g'),
        '\s+'
      ) as word
    ) w
    where
      m.role = 'user'
      and s.lang in ('en', 'fr')
      and m.created_at >= p_day
      and m.created_at < (p_day + interval '1 day')
      and length(w.word) > 1
      and w.word not in (
        'the','and','for','you','with','this','that','have','your','are','was',
        'from','not','but','what','when','where','who','how','why','can','could',
        'de','la','le','les','des','du','un','une','et','ou','est','pour','avec',
        'dans','pas','que','qui','quoi','comment','pourquoi','je','vous','nous'
      )
    group by s.lang, w.word
  ) ranked
  where rn <= 50;
end;
$$;

revoke all on function public.refresh_chat_common_words(date) from public;
grant execute on function public.refresh_chat_common_words(date) to service_role;
