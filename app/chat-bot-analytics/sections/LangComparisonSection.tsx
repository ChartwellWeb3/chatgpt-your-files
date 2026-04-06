"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { InfoDialog } from "./InfoDialog";
import { createClient } from "@/app/utils/supabase/client";

type LangComparisonSectionProps = {
  startDate: string;
  endDate: string;
};

type LangRow = {
  lang: string;
  visitor_count: number;
  session_count: number;
  analyzed_count: number;
  avg_satisfaction: number;
  satisfied: number;
  neutral: number;
  angry: number;
  form_submissions: number;
};

function sentimentColor(key: "satisfied" | "neutral" | "angry") {
  if (key === "satisfied") return { bar: "bg-green-500", text: "text-green-600" };
  if (key === "neutral") return { bar: "bg-amber-400", text: "text-amber-600" };
  return { bar: "bg-red-500", text: "text-red-600" };
}

function LangCard({ row }: { row: LangRow }) {
  const sentimentTotal = row.satisfied + row.neutral + row.angry;
  const conversionPct =
    row.visitor_count > 0
      ? ((row.form_submissions / row.visitor_count) * 100).toFixed(1)
      : "0.0";

  const sentimentEntries: { key: "satisfied" | "neutral" | "angry"; label: string }[] = [
    { key: "satisfied", label: "Satisfied" },
    { key: "neutral", label: "Neutral" },
    { key: "angry", label: "Angry" },
  ];

  return (
    <Card className="p-4 space-y-4 flex-1 min-w-[220px]">
      {/* Language badge */}
      <div className="flex items-center gap-2">
        <span className="text-xl font-bold uppercase tracking-widest">{row.lang}</span>
        {row.lang === "en" || row.lang === "fr" ? (
          <span className="text-xs text-muted-foreground">
            {row.lang === "en" ? "English" : "French"}
          </span>
        ) : null}
      </div>

      {/* Key numbers */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-muted rounded-md px-3 py-2 text-center">
          <div className="text-lg font-bold">{row.visitor_count.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Visitors</div>
        </div>
        <div className="bg-muted rounded-md px-3 py-2 text-center">
          <div className="text-lg font-bold">{row.session_count.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Sessions</div>
        </div>
        <div className="bg-muted rounded-md px-3 py-2 text-center">
          <div className="text-lg font-bold">
            {row.avg_satisfaction > 0 ? row.avg_satisfaction.toFixed(1) : "—"}
            {row.avg_satisfaction > 0 ? (
              <span className="text-xs text-muted-foreground font-normal">/10</span>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground">Avg satisfaction</div>
        </div>
        <div className="bg-muted rounded-md px-3 py-2 text-center">
          <div className="text-lg font-bold">
            {row.form_submissions}
            <span className="text-xs text-muted-foreground font-normal"> ({conversionPct}%)</span>
          </div>
          <div className="text-xs text-muted-foreground">Tour bookings</div>
        </div>
      </div>

      {/* Sentiment breakdown */}
      {row.analyzed_count > 0 ? (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sentiment ({row.analyzed_count} analyzed)
          </div>
          {sentimentEntries.map(({ key, label }) => {
            const n = row[key];
            const pct = sentimentTotal > 0 ? Math.round((n / sentimentTotal) * 100) : 0;
            const { bar, text } = sentimentColor(key);
            return (
              <div key={key} className="flex items-center gap-2 text-xs">
                <span className={`w-16 text-right font-medium ${text}`}>{label}</span>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-14 text-right text-muted-foreground">
                  {n} ({pct}%)
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">No AI analysis data.</div>
      )}
    </Card>
  );
}

export function LangComparisonSection({ startDate, endDate }: LangComparisonSectionProps) {
  const supabase = useMemo(() => createClient(), []);

  const { data, isLoading, error } = useQuery({
    queryKey: ["analytics-lang-comparison", startDate, endDate],
    queryFn: async (): Promise<LangRow[]> => {
      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        "analytics_lang_comparison",
        {
          p_start: startDate || null,
          p_end: endDate || null,
        },
      );
      if (rpcErr) throw rpcErr;
      return (rpcData as LangRow[]) ?? [];
    },
  });

  const rangeLabel =
    startDate || endDate ? `${startDate || "…"} → ${endDate || "…"}` : "All time";

  // Put en and fr first, then the rest sorted by visitor_count
  const rows = useMemo(() => {
    if (!data) return [];
    const priority = ["en", "fr"];
    const pinned = priority.flatMap((l) => data.filter((r) => r.lang === l));
    const rest = data
      .filter((r) => !priority.includes(r.lang))
      .sort((a, b) => b.visitor_count - a.visitor_count);
    return [...pinned, ...rest];
  }, [data]);

  return (
    <section id="analytics-lang-comparison" className="space-y-4">
      <Card className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Language comparison</h2>
            <InfoDialog
              title="Language comparison"
              summary="Side-by-side breakdown of visitors, satisfaction, sentiment, and conversions by language."
            >
              <p>
                Each visitor is assigned their primary language based on which{" "}
                <span className="font-mono">lang</span> value appears most
                often across their sessions in the selected period. Sessions
                with a null <span className="font-mono">lang</span> are grouped
                under <span className="font-mono">unknown</span>.
              </p>
              <p>
                AI satisfaction and sentiment use the latest{" "}
                <span className="font-mono">chat_visitor_analyses</span> row
                per visitor with no date restriction — matching the same
                pattern used by the booker profile section.
              </p>
              <p>
                Tour booking conversions count{" "}
                <span className="font-mono">chat_bot_book_a_tour</span> form
                submissions within the date range.
              </p>
            </InfoDialog>
          </div>
          <div className="text-xs text-muted-foreground">Range: {rangeLabel}</div>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : null}

        {error ? (
          <div className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load language comparison."}
          </div>
        ) : null}

        {!isLoading && !error ? (
          rows.length > 0 ? (
            <div className="flex flex-wrap gap-4">
              {rows.map((row) => (
                <LangCard key={row.lang} row={row} />
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No session data in this period.</div>
          )
        ) : null}
      </Card>
    </section>
  );
}
