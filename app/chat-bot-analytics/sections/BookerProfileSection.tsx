"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { InfoDialog } from "./InfoDialog";
import { createClient } from "@/app/utils/supabase/client";

type BookerProfileSectionProps = {
  startDate: string;
  endDate: string;
};

type IntentRow = {
  intent: string;
  count: number;
  pct: number;
};

type SentimentSplit = {
  satisfied: number;
  neutral: number;
  angry: number;
  unknown: number;
};

type LangSplit = {
  en: number;
  fr: number;
};


type BookerProfile = {
  total_bookers: number;
  avg_satisfaction_bookers: number;
  avg_satisfaction_all: number;
  sentiment: SentimentSplit;
  top_intents: IntentRow[];
  lang_split: LangSplit;

};

const EMPTY_PROFILE: BookerProfile = {
  total_bookers: 0,
  avg_satisfaction_bookers: 0,
  avg_satisfaction_all: 0,
  sentiment: { satisfied: 0, neutral: 0, angry: 0, unknown: 0 },
  top_intents: [],
  lang_split: { en: 0, fr: 0 },

};

function sentimentColor(key: "satisfied" | "neutral" | "angry" | "unknown") {
  if (key === "satisfied") return "text-green-600";
  if (key === "neutral") return "text-amber-600";
  if (key === "angry") return "text-red-600";
  return "text-muted-foreground";
}

function SentimentBar({ sentiment, total }: { sentiment: SentimentSplit; total: number }) {
  if (total === 0) return <div className="text-xs text-muted-foreground">—</div>;
  const entries: { key: keyof SentimentSplit; label: string }[] = [
    { key: "satisfied", label: "Satisfied" },
    { key: "neutral", label: "Neutral" },
    { key: "angry", label: "Angry" },
    { key: "unknown", label: "Unknown" },
  ];
  return (
    <div className="space-y-1.5">
      {entries.map(({ key, label }) => {
        const n = sentiment[key];
        const pct = total > 0 ? Math.round((n / total) * 100) : 0;
        return (
          <div key={key} className="flex items-center gap-2 text-xs">
            <span className={`w-16 text-right font-medium ${sentimentColor(key)}`}>{label}</span>
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  key === "satisfied"
                    ? "bg-green-500"
                    : key === "neutral"
                    ? "bg-amber-400"
                    : key === "angry"
                    ? "bg-red-500"
                    : "bg-muted-foreground/30"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-10 text-muted-foreground">{n} ({pct}%)</span>
          </div>
        );
      })}
    </div>
  );
}

export function BookerProfileSection({ startDate, endDate }: BookerProfileSectionProps) {
  const supabase = useMemo(() => createClient(), []);

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ["analytics-booker-profile", startDate, endDate],
    queryFn: async (): Promise<BookerProfile> => {
      const { data, error: rpcErr } = await supabase.rpc("analytics_booker_profile", {
        p_start: startDate || null,
        p_end: endDate || null,
      });
      if (rpcErr) throw rpcErr;
      return (data as BookerProfile) ?? EMPTY_PROFILE;
    },
  });

  const rangeLabel =
    startDate || endDate ? `${startDate || "…"} → ${endDate || "…"}` : "All time";

  const p = profile ?? EMPTY_PROFILE;
  const sentimentTotal =
    p.sentiment.satisfied + p.sentiment.neutral + p.sentiment.angry + p.sentiment.unknown;
  const langTotal = p.lang_split.en + p.lang_split.fr;

  const scoreDelta =
    p.avg_satisfaction_all > 0
      ? +(p.avg_satisfaction_bookers - p.avg_satisfaction_all).toFixed(2)
      : null;

  return (
    <section id="analytics-booker-profile" className="space-y-4">
      <Card className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Booker conversion profile</h2>
            <InfoDialog
              title="Booker conversion profile"
              summary="Intent, sentiment, and satisfaction breakdown for visitors who submitted a tour booking form."
            >
              <p>
                Identifies visitors who submitted a{" "}
                <span className="font-mono">chat_bot_book_a_tour</span> form (
                <span className="font-mono">is_submitted = true</span>) within
                the selected date range, then joins their latest AI analysis
                from <span className="font-mono">chat_visitor_analyses</span>.
              </p>
              <p>
                The intent breakdown uses{" "}
                <span className="font-mono">intent_primary</span> — the single
                dominant intent the AI assigned to the conversation. Sentiment
                and satisfaction score are compared against all analyzed
                visitors in the same period to highlight conversion signals.
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
            {error instanceof Error ? error.message : "Failed to load booker profile."}
          </div>
        ) : null}

        {!isLoading && !error ? (
          <div className="space-y-5">
            {/* Summary row */}
            <div className="flex flex-wrap gap-3">
              <div className="bg-muted rounded-lg px-4 py-3 text-center min-w-[120px]">
                <div className="text-2xl font-bold">{p.total_bookers}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Bookers analyzed</div>
              </div>
              <div className="bg-muted rounded-lg px-4 py-3 text-center min-w-[140px]">
                <div className="text-2xl font-bold">
                  {p.avg_satisfaction_bookers > 0
                    ? p.avg_satisfaction_bookers.toFixed(1)
                    : "—"}
                  <span className="text-sm text-muted-foreground font-normal">/10</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Avg satisfaction (bookers)</div>
              </div>
              <div className="bg-muted rounded-lg px-4 py-3 text-center min-w-[140px]">
                <div className="text-2xl font-bold">
                  {p.avg_satisfaction_all > 0 ? p.avg_satisfaction_all.toFixed(1) : "—"}
                  <span className="text-sm text-muted-foreground font-normal">/10</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Avg satisfaction (all visitors)</div>
              </div>
              {scoreDelta !== null ? (
                <div
                  className={`rounded-lg px-4 py-3 text-center min-w-[120px] ${
                    scoreDelta >= 0
                      ? "bg-green-50 dark:bg-green-950/30"
                      : "bg-red-50 dark:bg-red-950/30"
                  }`}
                >
                  <div
                    className={`text-2xl font-bold ${
                      scoreDelta >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {scoreDelta >= 0 ? "+" : ""}
                    {scoreDelta.toFixed(1)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">vs all visitors</div>
                </div>
              ) : null}
            </div>

            {/* Main grid: intents + sentiment */}
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Intent breakdown */}
              <Card className="p-4 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Primary intents of bookers
                </div>
                {p.top_intents.length > 0 ? (
                  <ol className="space-y-1.5">
                    {p.top_intents.map((row, idx) => (
                      <li key={row.intent} className="flex items-center gap-2 text-sm">
                        <span className="text-xs text-muted-foreground w-4 text-right">{idx + 1}.</span>
                        <div className="flex-1 flex items-center gap-2">
                          <span className="font-mono text-xs">{row.intent}</span>
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary/60 rounded-full"
                              style={{ width: `${Math.min(row.pct, 100)}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground w-20 text-right">
                          {row.count} ({row.pct.toFixed(0)}%)
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="text-xs text-muted-foreground">No data</div>
                )}
              </Card>

              {/* Sentiment split */}
              <Card className="p-4 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Sentiment of bookers
                </div>
                <SentimentBar sentiment={p.sentiment} total={sentimentTotal} />
              </Card>
            </div>

            {/* Language */}
            <Card className="p-4 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Language
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                {(["en", "fr"] as const).map((k) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <span className="font-medium uppercase text-xs">{k}</span>
                    <span className="text-muted-foreground">
                      {p.lang_split[k]}
                      {langTotal > 0
                        ? ` (${Math.round((p.lang_split[k] / langTotal) * 100)}%)`
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
