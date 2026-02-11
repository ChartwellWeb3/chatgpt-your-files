"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InfoDialog } from "./InfoDialog";
import { createClient } from "@/app/utils/supabase/client";
import { fmtDate } from "@/app/helpers/fmtDate";
import { pill } from "@/components/ui/pill";
import { DateRangePicker } from "./DateRangePicker";

type MonthlyInsightsSectionProps = {
  isAdmin: boolean;
};

type InsightSummary = Record<string, unknown> | null;

type InsightRow = {
  id: number;
  month: string;
  page_type: string;
  lang: string;
  source: string;
  model: string;
  prompt_version: string;
  summary: InsightSummary;
  created_at: string;
};

type RunResult = {
  ok: boolean;
  month: string;
  processed: number;
  results: Array<{ page_type: string; ok: boolean; error?: string }>;
};

const promptByVersion: Record<string, string> = {
  v1: `
You are analyzing monthly chatbot questions.

Month: {{month}}
Page type: {{page_type}}

Input list: common user questions with frequency counts.
Use ONLY this list. Do not invent facts or company details.

Return JSON only with keys:
- top_questions: 5-10 most common questions (short, canonical).
- top_intents: 5-10 intent labels.

Rules:
- Keep each item short (<= 12 words).
- If not enough evidence for a list, return an empty array.
- Ignore greetings, acknowledgements, or non-question fragments. Only output clear user questions and intents.
- Do not include extra keys or commentary.

Questions:
1. (12) Example question
2. (9) Another example question
`.trim(),
};

function formatMonthLabel(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return value || "Select month";
  const [y, m] = value.split("-").map(Number);
  const date = new Date(y, m - 1, 1);
  return format(date, "MMMM yyyy");
}

function formatMonthFromDate(value?: string | null) {
  if (!value) return "Unknown month";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (!y || !m) return value;
  const date = new Date(y, m - 1, 1);
  return format(date, "MMMM yyyy");
}

function defaultMonthValue() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthStartDate(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return "";
  return `${value}-01`;
}

function toList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

export function MonthlyInsightsSection({ isAdmin }: MonthlyInsightsSectionProps) {
  const supabase = useMemo(() => createClient(), []);
  const [month, setMonth] = useState(() => defaultMonthValue());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [existingInsights, setExistingInsights] = useState<InsightRow[]>([]);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [existingError, setExistingError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [promptVersion, setPromptVersion] = useState("");
  const [lang, setLang] = useState<"en" | "fr">("en");

  const pageOrder = ["corporate", "residence"] as const;

  const hasExisting = existingInsights.length > 0;

  useEffect(() => {
    let active = true;
    const loadExisting = async () => {
      const startDate = monthStartDate(month);
      if (!startDate) {
        if (active) {
          setExistingInsights([]);
          setExistingError(null);
        }
        return;
      }
      setLoadingExisting(true);
      setExistingError(null);
      setResult(null);
      try {
        const { data, error: fetchErr } = await supabase
          .from("chat_monthly_insights")
          .select(
            "id,month,page_type,lang,source,model,prompt_version,summary,created_at"
          )
          .eq("month", startDate)
          .eq("lang", lang)
          .order("page_type", { ascending: true });

        if (fetchErr) throw fetchErr;
        if (active) {
          setExistingInsights((data ?? []) as InsightRow[]);
        }
      } catch (err: unknown) {
        if (!active) return;
        const message =
          err instanceof Error ? err.message : "Failed to load insights.";
        setExistingError(message);
        setExistingInsights([]);
      } finally {
        if (active) {
          setLoadingExisting(false);
        }
      }
    };

    loadExisting();
    return () => {
      active = false;
    };
  }, [month, lang, supabase]);

  const runInsights = async () => {
    if (!month) {
      setError("Select a month.");
      return;
    }
    if (hasExisting) {
      setError(`Insights already exist for this month (${lang.toUpperCase()}).`);
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/analytics/monthly-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, lang }),
      });
      const data = (await res.json()) as RunResult & { error?: string };
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to run monthly insights.");
      }
      setResult(data);
      const startDate = monthStartDate(month);
      if (startDate) {
        const { data: refreshed } = await supabase
          .from("chat_monthly_insights")
          .select(
            "id,month,page_type,lang,source,model,prompt_version,summary,created_at"
          )
          .eq("month", startDate)
          .eq("lang", lang)
          .order("page_type", { ascending: true });
        setExistingInsights((refreshed ?? []) as InsightRow[]);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to run.";
      setError(message);
    } finally {
      setRunning(false);
    }
  };

  const deleteInsights = async () => {
    if (!month) {
      setError("Select a month.");
      return;
    }
    if (!hasExisting) return;
    const confirmed = window.confirm(
      `Delete monthly insights for ${formatMonthLabel(month)} (${lang.toUpperCase()})?`
    );
    if (!confirmed) return;
    setDeleting(true);
    setError(null);
    setResult(null);
    setExistingError(null);
    try {
      const res = await fetch("/api/analytics/monthly-insights", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, lang }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to delete monthly insights.");
      }
      setExistingInsights([]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to delete.";
      setError(message);
    } finally {
      setDeleting(false);
    }
  };

  const processed = result?.processed ?? 0;
  const existingByType = useMemo(() => {
    const map = new Map<string, InsightRow>();
    for (const row of existingInsights) {
      map.set(row.page_type, row);
    }
    return map;
  }, [existingInsights]);

  return (
    <section id="analytics-monthly-insights" className="space-y-4">
      {promptOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl rounded-lg border border-border bg-card shadow-lg">
            <div className="flex items-center justify-between border-b border-border p-4">
              <div>
                <div className="text-sm font-semibold">Monthly insights prompt</div>
                <div className="text-xs text-muted-foreground">
                  Version: {promptVersion || "unknown"}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPromptOpen(false)}
              >
                Close
              </Button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-4 text-xs whitespace-pre-wrap">
              {promptText}
            </div>
          </div>
        </div>
      ) : null}
      <Card className="p-5 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Monthly insights</h2>
            <InfoDialog
              title="Monthly insights"
              summary="Run a month-based OpenAI summary for corporate and residence pages."
            >
              <p>
                <span className="font-medium text-foreground">What it does:</span>{" "}
                Uses common user questions for the selected month and asks OpenAI to
                produce the top questions and intents.
              </p>
              <p>
                <span className="font-medium text-foreground">When to use:</span>{" "}
                At month-end to capture trends for the previous month.
              </p>
              <p>
                <span className="font-medium text-foreground">Access:</span>{" "}
                Admins only.
              </p>
            </InfoDialog>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const version = "v1";
              setPromptVersion(version);
              setPromptText(
                promptByVersion[version] ?? "Prompt not found for this version."
              );
              setPromptOpen(true);
            }}
          >
            Watch prompt
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <DateRangePicker variant="month" value={month} onChange={setMonth} />
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Language
            </div>
            <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-1">
              <Button
                type="button"
                variant={lang === "en" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 px-3"
                onClick={() => setLang("en")}
              >
                EN
              </Button>
              <Button
                type="button"
                variant={lang === "fr" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 px-3"
                onClick={() => setLang("fr")}
              >
                FR
              </Button>
            </div>
          </div>
          <Button
            onClick={runInsights}
            disabled={!isAdmin || running || !month || hasExisting || loadingExisting}
          >
            {running ? "Running..." : "Run monthly insights"}
          </Button>
          {hasExisting ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={deleteInsights}
              disabled={!isAdmin || deleting || loadingExisting}
            >
              {deleting ? "Deleting..." : "Delete records"}
            </Button>
          ) : null}
          {hasExisting ? <span>{pill("Generated", "ok")}</span> : null}
          {loadingExisting ? <span>{pill("Loading…", "warning")}</span> : null}
          {!isAdmin ? (
            <div className="text-xs text-muted-foreground">
              Admin access required to run insights.
            </div>
          ) : null}
        </div>

        <div className="space-y-1">
          {hasExisting ? (
            <div className="text-xs text-muted-foreground">
              Insights already exist for {formatMonthLabel(month)} (
              {lang.toUpperCase()}). Delete records to rerun.
            </div>
          ) : null}
          {existingError ? (
            <div className="text-sm text-destructive">{existingError}</div>
          ) : null}
          {error ? <div className="text-sm text-destructive">{error}</div> : null}
          {result ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              <div>
                Saved insights for {formatMonthLabel(result.month)}. Processed{" "}
                {processed} page type{processed === 1 ? "" : "s"}.
              </div>
              <div className="space-y-1 text-xs">
                {result.results.map((row) => (
                  <div key={row.page_type}>
                    {row.page_type}: {row.ok ? "ok" : row.error}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {hasExisting ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {pageOrder.map((pageType) => {
              const row = existingByType.get(pageType);
              if (!row) {
                return (
                  <Card key={pageType} className="p-5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold capitalize">
                        {pageType.replace(/_/g, " ")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatMonthLabel(month)}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      No insights saved for this page type.
                    </div>
                  </Card>
                );
              }

              const summary = row.summary ?? {};
              const topQuestions = toList(
                (summary as Record<string, unknown>).top_questions
              );
              const topIntents = toList(
                (summary as Record<string, unknown>).top_intents
              );
              return (
                <Card key={pageType} className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold capitalize">
                        {pageType.replace(/_/g, " ")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatMonthFromDate(row.month)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2 text-[11px]">
                      {pill(`Model: ${row.model}`)}
                      {pill(`Prompt: ${row.prompt_version}`)}
                      {pill(`Created: ${fmtDate(row.created_at)}`, "muted")}
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Top questions
                      </div>
                      {topQuestions.length ? (
                        <ol className="text-sm space-y-1">
                          {topQuestions.map((item, idx) => (
                            <li key={`q-${idx}`} className="flex gap-2">
                              <span className="text-xs text-muted-foreground w-5 text-right">
                                {idx + 1}.
                              </span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <div className="text-xs text-muted-foreground">—</div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Top intents
                      </div>
                      {topIntents.length ? (
                        <ol className="text-sm space-y-1">
                          {topIntents.map((item, idx) => (
                            <li key={`i-${idx}`} className="flex gap-2">
                              <span className="text-xs text-muted-foreground w-5 text-right">
                                {idx + 1}.
                              </span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <div className="text-xs text-muted-foreground">—</div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
