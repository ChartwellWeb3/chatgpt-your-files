create or replace function public.refresh_chat_common_words(
  p_day date default current_date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := current_date;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  delete from public.chat_common_words;

  insert into public.chat_common_words (day, lang, word, freq)
  select day, lang, word, freq
  from (
    select
      v_day as day,
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
