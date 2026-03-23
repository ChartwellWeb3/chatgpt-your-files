"use client";

import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { InfoDialog } from "./InfoDialog";
import { createClient } from "@/app/utils/supabase/client";
import { fmtDate } from "@/app/helpers/fmtDate";

type ContactMentionsSectionProps = {
  startDate: string;
  endDate: string;
};

type ContactMentionRow = {
  assistant_message_id: number;
  session_id: string;
  visitor_id: string;
  created_at: string;
  user_question: string;
  bot_answer: string;
  contact_snippet: string;
};

const MAX_ROWS = 1000;
const PAGE_SIZE = 10;

export function ContactMentionsSection({
  startDate,
  endDate,
}: ContactMentionsSectionProps) {
  const supabase = useMemo(() => createClient(), []);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [startDate, endDate]);

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ["analytics-contact-mentions", startDate, endDate],
    queryFn: async (): Promise<ContactMentionRow[]> => {
      const { data, error: fetchErr } = await supabase.rpc(
        "analytics_contact_mentions",
        {
          p_start: startDate || null,
          p_end: endDate || null,
          p_limit: MAX_ROWS,
        }
      );
      if (fetchErr) throw fetchErr;
      return (data ?? []) as ContactMentionRow[];
    },
  });

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageItems = rows.slice(pageStart, pageStart + PAGE_SIZE);

  const rangeLabel =
    startDate || endDate
      ? `${startDate || "…"} → ${endDate || "…"}`
      : "All time";

  return (
    <section id="analytics-contact-mentions" className="space-y-4">
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Contact / Phone Mentions</h2>
            <InfoDialog
              title="Contact / Phone Mentions"
              summary="Bot responses that included a phone number or contact information."
            >
              <p>
                Detects assistant messages containing phone number patterns
                (e.g., <span className="font-mono">514-555-1234</span>,{" "}
                <span className="font-mono">+1 514 555 1234</span>) and shows
                the preceding user question alongside the full bot answer and
                the extracted number.
              </p>
              <p>
                Data is sourced directly from{" "}
                <span className="font-medium">chat_messages</span> — no
                pre-processing required. Results are filtered by the selected
                date range and capped at {MAX_ROWS} rows.
              </p>
            </InfoDialog>
          </div>
          <div className="text-xs text-muted-foreground">
            Range: {rangeLabel} • {rows.length} result
            {rows.length !== 1 ? "s" : ""}
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : null}

        {error ? (
          <div className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load."}
          </div>
        ) : null}

        {!isLoading && !error && rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No contact or phone mentions found for this period.
          </div>
        ) : null}

        {!isLoading && !error && rows.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
              <button
                type="button"
                className="h-7 px-2 rounded border border-border disabled:opacity-50"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
              >
                Prev
              </button>
              <span>
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                className="h-7 px-2 rounded border border-border disabled:opacity-50"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
              >
                Next
              </button>
            </div>

            {pageItems.map((row) => (
              <Card key={row.assistant_message_id} className="p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  {row.contact_snippet ? (
                    <span className="font-mono font-medium text-foreground bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded">
                      {row.contact_snippet}
                    </span>
                  ) : null}
                  <span>{fmtDate(row.created_at)}</span>
                  <span>Visitor: {row.visitor_id.slice(0, 8)}…</span>
                  <span>Session: {row.session_id.slice(0, 8)}…</span>
                </div>

                {row.user_question ? (
                  <div className="text-sm">
                    <span className="font-medium">Q: </span>
                    {row.user_question}
                  </div>
                ) : null}

                <div className="text-xs text-muted-foreground leading-relaxed line-clamp-6">
                  <span className="font-medium text-foreground">A: </span>
                  {row.bot_answer}
                </div>
              </Card>
            ))}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
