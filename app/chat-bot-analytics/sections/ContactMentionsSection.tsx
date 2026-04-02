"use client";

import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { InfoDialog } from "./InfoDialog";
import { createClient } from "@/app/utils/supabase/client";
import { fmtDate } from "@/app/helpers/fmtDate";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ContactMentionsSectionProps = {
  startDate: string;
  endDate: string;
};

type ReviewStatus = "reviewed" | "extract_step_required" | "resolved";
type StatusFilter = "pending" | "extract_step_required" | "resolved" | "all";

type ContactMentionRow = {
  assistant_message_id: number;
  session_id: string;
  visitor_id: string;
  created_at: string;
  user_question: string;
  bot_answer: string;
  contact_snippet: string;
  review_status: ReviewStatus | null;
  review_comment: string | null;
};

type ResolveDialog = {
  messageId: number;
  comment: string;
};

const MAX_ROWS = 1000;
const PAGE_SIZE = 10;

export function ContactMentionsSection({
  startDate,
  endDate,
}: ContactMentionsSectionProps) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageTypeFilter, setPageTypeFilter] = useState<"corporate" | "residence">("corporate");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [resolveDialog, setResolveDialog] = useState<ResolveDialog | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [startDate, endDate, pageTypeFilter, statusFilter]);

  const queryKey = ["analytics-contact-mentions", startDate, endDate, pageTypeFilter, statusFilter];

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey,
    queryFn: async (): Promise<ContactMentionRow[]> => {
      const { data, error: fetchErr } = await supabase.rpc(
        "analytics_contact_mentions",
        {
          p_start: startDate || null,
          p_end: endDate || null,
          p_limit: MAX_ROWS,
          p_page_type: pageTypeFilter,
          p_status_filter: statusFilter,
        }
      );
      if (fetchErr) throw fetchErr;
      return (data ?? []) as ContactMentionRow[];
    },
  });

  async function applyReview(messageId: number, status: ReviewStatus, comment?: string) {
    setPendingIds((prev) => new Set(prev).add(messageId));
    try {
      const { error: rpcErr } = await supabase.rpc("upsert_contact_mention_review", {
        p_message_id: messageId,
        p_status: status,
        p_comment: comment ?? null,
      });
      if (rpcErr) throw rpcErr;
      await queryClient.invalidateQueries({ queryKey: ["analytics-contact-mentions"] });
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
    }
  }

  async function handleResolve() {
    if (!resolveDialog) return;
    setResolving(true);
    try {
      await applyReview(resolveDialog.messageId, "resolved", resolveDialog.comment || undefined);
      setResolveDialog(null);
    } finally {
      setResolving(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageItems = rows.slice(pageStart, pageStart + PAGE_SIZE);

  const rangeLabel =
    startDate || endDate
      ? `${startDate || "…"} → ${endDate || "…"}`
      : "All time";

  return (
    <>
      <section id="analytics-contact-mentions" className="space-y-4">
        <Card className="p-5 space-y-4">
          {/* Header */}
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
                <p>
                  Use <span className="font-medium">Reviewed</span> to dismiss
                  an entry. Use{" "}
                  <span className="font-medium">Extract Step Required</span> to
                  flag entries needing follow-up, then mark them{" "}
                  <span className="font-medium">Resolved</span> with a note.
                </p>
              </InfoDialog>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="text-xs text-muted-foreground">
                Range: {rangeLabel} • {rows.length} result
                {rows.length !== 1 ? "s" : ""}
              </div>

              {/* Status filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Status</span>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as StatusFilter)}
                >
                  <SelectTrigger className="h-8 w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="extract_step_required">Extract Step Required</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Page type filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Page type</span>
                <Select
                  value={pageTypeFilter}
                  onValueChange={(value) =>
                    setPageTypeFilter(value === "residence" ? "residence" : "corporate")
                  }
                >
                  <SelectTrigger className="h-8 w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="corporate">Corporate</SelectItem>
                    <SelectItem value="residence">Residence</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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

              {pageItems.map((row) => {
                const isBusy = pendingIds.has(row.assistant_message_id);
                return (
                  <Card key={row.assistant_message_id} className="p-3 space-y-2">
                    {/* Meta row */}
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {row.contact_snippet ? (
                        <span className="font-mono font-medium text-foreground bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded">
                          {row.contact_snippet}
                        </span>
                      ) : null}
                      {row.review_status === "extract_step_required" ? (
                        <Badge variant="outline" className="text-amber-600 border-amber-400 text-[10px]">
                          Extract Step Required
                        </Badge>
                      ) : null}
                      {row.review_status === "resolved" ? (
                        <Badge variant="outline" className="text-green-600 border-green-500 text-[10px]">
                          Resolved
                        </Badge>
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

                    {/* Resolution note */}
                    {row.review_status === "resolved" && row.review_comment ? (
                      <div className="text-xs border-t pt-2">
                        <span className="font-medium text-foreground">Resolution note: </span>
                        <span className="text-muted-foreground">{row.review_comment}</span>
                      </div>
                    ) : null}

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 pt-1 border-t">
                      {!row.review_status ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={isBusy}
                            onClick={() => applyReview(row.assistant_message_id, "reviewed")}
                          >
                            {isBusy ? "Saving…" : "Reviewed"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-amber-600 border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950"
                            disabled={isBusy}
                            onClick={() =>
                              applyReview(row.assistant_message_id, "extract_step_required")
                            }
                          >
                            {isBusy ? "Saving…" : "Extract Step Required"}
                          </Button>
                        </>
                      ) : null}

                      {row.review_status === "extract_step_required" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-green-600 border-green-500 hover:bg-green-50 dark:hover:bg-green-950"
                          disabled={isBusy}
                          onClick={() =>
                            setResolveDialog({ messageId: row.assistant_message_id, comment: "" })
                          }
                        >
                          {isBusy ? "Saving…" : "Mark as Resolved"}
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : null}
        </Card>
      </section>

      {/* Resolve modal */}
      {resolveDialog !== null ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setResolveDialog(null);
          }}
        >
          <div className="bg-card border rounded-lg shadow-lg w-full max-w-md p-5 space-y-4">
            <div>
              <h3 className="text-base font-semibold">Mark as Resolved</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Add a note describing what action was taken (optional).
              </p>
            </div>

            <Textarea
              value={resolveDialog.comment}
              onChange={(e) =>
                setResolveDialog((prev) =>
                  prev ? { ...prev, comment: e.target.value } : null
                )
              }
              placeholder="Describe the action taken…"
              rows={3}
              className="resize-none"
            />

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={resolving}
                onClick={() => setResolveDialog(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={resolving}
                onClick={handleResolve}
              >
                {resolving ? "Saving…" : "Mark as Resolved"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
