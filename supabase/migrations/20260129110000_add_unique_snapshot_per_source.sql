with ranked as (
  select
    ctid,
    row_number() over (
      partition by visitor_id, last_message_at, source
      order by created_at desc, id desc
    ) as rn
  from public.chat_visitor_analyses
)
delete from public.chat_visitor_analyses a
using ranked r
where a.ctid = r.ctid
  and r.rn > 1;

create unique index if not exists uq_chat_visitor_analyses_snapshot_per_source
  on public.chat_visitor_analyses (visitor_id, last_message_at, source);
