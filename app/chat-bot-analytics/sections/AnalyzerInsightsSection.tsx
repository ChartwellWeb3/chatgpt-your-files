"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { InfoDialog } from "./InfoDialog";
import { createClient } from "@/app/utils/supabase/client";
import { fmtDate } from "@/app/helpers/fmtDate";
import { pill } from "@/components/ui/pill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AnalyzerInsightsSectionProps = {
  startDate: string;
  endDate: string;
};

type AnalyzerRow = {
  id: number;
  visitor_id: string;
  last_message_at: string;
  created_at: string;
  source: string;
  page_type: string | null;
  intent_primary: string | null;
  intents: string[] | null;
  intent_other: string | null;
  missed_or_weak_answers: unknown[] | null;
};

type MissedItem = {
  visitor_question: string;
  assistant_response: string;
  issue_type: "unanswered";
  why_insufficient: string;
  visitor_id: string;
  last_message_at: string;
};

const MAX_ROWS = 2000;
const MAX_MISSED = 50;

function toString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function AnalyzerInsightsSection({
  startDate,
  endDate,
}: AnalyzerInsightsSectionProps) {
  const supabase = useMemo(() => createClient(), []);
  const [pageTypeFilter, setPageTypeFilter] = useState<
    "corporate" | "residence"
  >("corporate");
  const [missedPage, setMissedPage] = useState(1);
  const missedPageSize = 10;

  useEffect(() => {
    setMissedPage(1);
  }, [startDate, endDate, pageTypeFilter]);

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: [
      "analytics-analyzer-insights",
      startDate,
      endDate,
      pageTypeFilter,
    ],
    queryFn: async (): Promise<AnalyzerRow[]> => {
      let query = supabase
        .from("chat_visitor_analyses")
        .select(
          "id,visitor_id,last_message_at,created_at,source,page_type,intent_primary,intents,intent_other,missed_or_weak_answers"
        )
        .order("last_message_at", { ascending: false })
        .limit(MAX_ROWS);
      if (startDate) {
        query = query.gte("last_message_at", startDate);
      }
      if (endDate) {
        query = query.lte("last_message_at", endDate);
      }
      query = query.eq("page_type", pageTypeFilter);
      const { data, error: fetchErr } = await query;
      if (fetchErr) throw fetchErr;
      return (data ?? []) as AnalyzerRow[];
    },
  });

  const insights = useMemo(() => {
    const intentCounts = new Map<string, number>();
    const otherIntentCounts = new Map<string, number>();
    const missedItems: MissedItem[] = [];

    for (const row of rows) {
      const rawIntents = Array.isArray(row.intents)
        ? row.intents.filter((v) => typeof v === "string")
        : [];
      const intentPrimary = toString(row.intent_primary);
      const intents =
        rawIntents.length > 0
          ? rawIntents
          : intentPrimary
          ? [intentPrimary]
          : [];
      const uniqueIntents = new Set(intents);
      uniqueIntents.forEach((intent) => {
        intentCounts.set(intent, (intentCounts.get(intent) ?? 0) + 1);
      });
      const intentOther = toString(row.intent_other);
      if (intentOther) {
        otherIntentCounts.set(
          intentOther,
          (otherIntentCounts.get(intentOther) ?? 0) + 1
        );
      }

      const rawMissed = Array.isArray(row.missed_or_weak_answers)
        ? row.missed_or_weak_answers
        : [];
      for (const entry of rawMissed) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        const issueType = toString(record.issue_type).toLowerCase();
        if (issueType !== "unanswered") continue;
        const item: MissedItem = {
          visitor_question: toString(record.visitor_question),
          assistant_response: toString(record.assistant_response),
          issue_type: "unanswered",
          why_insufficient: toString(record.why_insufficient),
          visitor_id: row.visitor_id,
          last_message_at: row.last_message_at,
        };
        if (
          item.visitor_question ||
          item.assistant_response ||
          item.why_insufficient
        ) {
          missedItems.push(item);
        }
      }
    }

    const topIntents = Array.from(intentCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
    const topOtherIntents = Array.from(otherIntentCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const missedRecent = missedItems
      .sort((a, b) => (a.last_message_at < b.last_message_at ? 1 : -1))
      .slice(0, MAX_MISSED);

    const missedTotalPages = Math.max(
      1,
      Math.ceil(missedRecent.length / missedPageSize)
    );
    const safeMissedPage = Math.min(
      Math.max(1, missedPage),
      missedTotalPages
    );
    const missedStart = (safeMissedPage - 1) * missedPageSize;
    const missedPageItems = missedRecent.slice(
      missedStart,
      missedStart + missedPageSize
    );

    const monthly = new Map<string, { total: number; missed: number; intents: Map<string, number> }>();
    for (const row of rows) {
      const month = row.last_message_at?.slice(0, 7);
      if (!month) continue;
      if (!monthly.has(month)) {
        monthly.set(month, { total: 0, missed: 0, intents: new Map() });
      }
      const bucket = monthly.get(month)!;
      bucket.total += 1;
      const intents = Array.isArray(row.intents) ? row.intents : [];
      const intentPrimary = toString(row.intent_primary);
      const intentList =
        intents.length > 0 ? intents : intentPrimary ? [intentPrimary] : [];
      new Set(intentList).forEach((intent) => {
        bucket.intents.set(intent, (bucket.intents.get(intent) ?? 0) + 1);
      });
      const missed = Array.isArray(row.missed_or_weak_answers)
        ? row.missed_or_weak_answers.length
        : 0;
      bucket.missed += missed;
    }
    const monthlyRows = Array.from(monthly.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([month, data]) => {
        const topIntents = Array.from(data.intents.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([intent]) => intent);
        return {
          month,
          total: data.total,
          missed: data.missed,
          topIntents,
        };
      });

    return {
      totalRows: rows.length,
      topIntents,
      topOtherIntents,
      missedRecent,
      missedPageItems,
      missedTotalPages,
      missedSafePage: safeMissedPage,
      monthlyRows,
    };
  }, [rows, missedPage]);

  const missedPageLabel = `${insights.missedSafePage} / ${insights.missedTotalPages}`;

  const rangeLabel =
    startDate || endDate
      ? `${startDate || "…"} → ${endDate || "…"}`
      : "All time";

  return (
    <section id="analytics-analyzer-insights" className="space-y-4">
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Analyzer insights</h2>
            <InfoDialog
              title="Analyzer insights"
              summary="Aggregates analyzer outputs (intents and missed/weak answers) from chat_visitor_analyses."
            >
              <p>
                Uses analyzer outputs stored in{" "}
                <span className="font-medium">chat_visitor_analyses</span>{" "}
                intent/missed-answer columns. Shows intent distribution and
                examples of missed or weak answers for the selected date range.
              </p>
            </InfoDialog>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-xs text-muted-foreground">
              Range: {rangeLabel} • Max {MAX_ROWS} rows
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Page type</span>
              <Select
                value={pageTypeFilter}
                onValueChange={(value) =>
                  setPageTypeFilter(
                    value === "residence" ? "residence" : "corporate"
                  )
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
          <div className="text-sm text-muted-foreground">Loading insights…</div>
        ) : null}
        {error ? (
          <div className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load insights."}
          </div>
        ) : null}

        {!isLoading && !error ? (
          <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-[1fr_3fr] items-start">
              <Card className="p-4 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Top intents
                </div>
                {insights.topIntents.length ? (
                  <ol className="space-y-1 text-sm">
                    {insights.topIntents.map(([intent, count]) => (
                      <li key={intent} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-12 text-right">
                          {count}
                        </span>
                        <span className="font-mono">{intent}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="text-xs text-muted-foreground">—</div>
                )}
                {insights.topOtherIntents.length ? (
                  <div className="pt-2">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                      Other intent labels
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {insights.topOtherIntents.map(([label, count]) =>
                        pill(`${label}: ${count}`)
                      )}
                    </div>
                  </div>
                ) : null}
              </Card>

              <Card className="p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Recent missed/weak answers
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {insights.missedRecent.length
                      ? `Showing ${insights.missedPageItems.length} of ${insights.missedRecent.length}`
                      : "—"}
                  </div>
                </div>
                {insights.missedRecent.length ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-end text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="h-7 px-2 rounded border border-border text-xs disabled:opacity-50"
                          onClick={() => setMissedPage((p) => Math.max(1, p - 1))}
                          disabled={insights.missedSafePage <= 1}
                        >
                          Prev
                        </button>
                        <span>{missedPageLabel}</span>
                        <button
                          type="button"
                          className="h-7 px-2 rounded border border-border text-xs disabled:opacity-50"
                          onClick={() =>
                            setMissedPage((p) =>
                              Math.min(insights.missedTotalPages, p + 1)
                            )
                          }
                          disabled={
                            insights.missedSafePage >= insights.missedTotalPages
                          }
                        >
                          Next
                        </button>
                      </div>
                    </div>
                    {insights.missedPageItems.map((item, idx) => (
                      <Card key={`${item.visitor_id}-${idx}`} className="p-3">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          {pill(item.issue_type)}
                          <span>Visitor: {item.visitor_id}</span>
                          <span>Last msg: {fmtDate(item.last_message_at)}</span>
                        </div>
                        <div className="mt-2 text-sm">
                          <div className="font-medium">
                            Q: {item.visitor_question}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            A: {item.assistant_response}
                          </div>
                          <div className="mt-2 text-xs">
                            {item.why_insufficient}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">—</div>
                )}
              </Card>
            </div>
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Monthly summary
              </div>
              {insights.monthlyRows.length ? (
                <div className="space-y-2 text-sm">
                  {insights.monthlyRows.map((row) => (
                    <Card key={row.month} className="p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-mono">{row.month}</span>
                        <span>{pill(`Analyses: ${row.total}`)}</span>
                        <span>{pill(`Missed: ${row.missed}`)}</span>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        Top intents:{" "}
                        {row.topIntents.length
                          ? row.topIntents.join(", ")
                          : "—"}
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">—</div>
              )}
            </div>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
