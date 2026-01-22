create table if not exists public.chat_stopwords (
  id bigint generated always as identity primary key,
  lang text not null,
  word text not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create unique index if not exists uq_chat_stopwords_lang_word
  on public.chat_stopwords (lang, word);

create index if not exists idx_chat_stopwords_lang_word
  on public.chat_stopwords (lang, word);

alter table public.chat_stopwords enable row level security;

create policy "auth_select_chat_stopwords"
  on public.chat_stopwords
  for select
  to authenticated
  using (true);

create policy "admin_insert_chat_stopwords"
  on public.chat_stopwords
  for insert
  to authenticated
  with check (public.is_admin());

create policy "admin_delete_chat_stopwords"
  on public.chat_stopwords
  for delete
  to authenticated
  using (public.is_admin());

grant select on table public.chat_stopwords to authenticated, service_role;

insert into public.chat_stopwords (lang, word)
values
  ('en','a'),
  ('en','am'),
  ('en','an'),
  ('en','and'),
  ('en','are'),
  ('en','as'),
  ('en','at'),
  ('en','be'),
  ('en','but'),
  ('en','by'),
  ('en','can'),
  ('en','could'),
  ('en','do'),
  ('en','for'),
  ('en','from'),
  ('en','have'),
  ('en','how'),
  ('en','i'),
  ('en','is'),
  ('en','it'),
  ('en','like'),
  ('en','not'),
  ('en','of'),
  ('en','or'),
  ('en','that'),
  ('en','the'),
  ('en','this'),
  ('en','to'),
  ('en','was'),
  ('en','what'),
  ('en','when'),
  ('en','where'),
  ('en','who'),
  ('en','why'),
  ('en','with'),
  ('en','you'),
  ('en','your'),
  ('fr','a'),
  ('fr','avec'),
  ('fr','ce'),
  ('fr','ces'),
  ('fr','comment'),
  ('fr','dans'),
  ('fr','de'),
  ('fr','des'),
  ('fr','du'),
  ('fr','elle'),
  ('fr','en'),
  ('fr','est'),
  ('fr','et'),
  ('fr','il'),
  ('fr','je'),
  ('fr','la'),
  ('fr','le'),
  ('fr','les'),
  ('fr','mais'),
  ('fr','nous'),
  ('fr','ou'),
  ('fr','pas'),
  ('fr','pour'),
  ('fr','que'),
  ('fr','qui'),
  ('fr','quoi'),
  ('fr','tu'),
  ('fr','un'),
  ('fr','une'),
  ('fr','vous')
on conflict (lang, word) do nothing;

create or replace function public.refresh_chat_common_words(
  p_day date default current_date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

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
      and not exists (
        select 1
        from public.chat_stopwords sw
        where sw.lang = s.lang
          and sw.word = w.word
      )
    group by s.lang, w.word
  ) ranked
  where rn <= 50;
end;
$$;

revoke all on function public.refresh_chat_common_words(date) from public;
grant execute on function public.refresh_chat_common_words(date) to authenticated;
