"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/app/utils/supabase/client";
import { Card } from "@/components/ui/card";
import { InfoDialog } from "./InfoDialog";
import { getSentimentLabel } from "./sentiment";

type MonthStats = {
  visitors: number;
  sessions: number;
  totalForms: number;
  submittedForms: number;
  corporateSessions: number;
  residenceSessions: number;
  multiMessageVisitors: number;
  aiSatisfied: number;
  aiNeutral: number;
  aiAngry: number;
  aiAvgScore: number;
  aiTotal: number;
};

type ComparisonResult = {
  monthA: MonthStats;
  monthB: MonthStats;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatMonthLabel(ym: string): string {
  const [year, month] = ym.split("-");
  return `${MONTH_NAMES[parseInt(month, 10) - 1]} ${year}`;
}

function toMonthStart(ym: string): string {
  return `${ym}-01`;
}

const START_YEAR = 2026;
const START_MONTH = 1; // January 2026

/** Returns all "YYYY-MM" strings from Jan 2026 through one year ahead (newest first). */
function buildMonthOptions(): string[] {
  const now = new Date();
  const end = new Date(now.getFullYear() + 1, now.getMonth(), 1);
  const options: string[] = [];
  for (
    let d = new Date(end);
    d >= new Date(START_YEAR, START_MONTH - 1, 1);
    d.setMonth(d.getMonth() - 1)
  ) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    options.push(`${y}-${m}`);
  }
  return options;
}

/** Returns true if the given "YYYY-MM" is the current month or in the future. */
function isCurrentOrFuture(ym: string): boolean {
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return ym >= current;
}

/** Default selection: last two completed months. */
function defaultMonths(): { a: string; b: string } {
  const now = new Date();
  const prevMonth = (offset: number) => {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  return { a: prevMonth(2), b: prevMonth(1) };
}

const COLOR_A = "#38bdf8";
const COLOR_B = "#f59e0b";

const EMPTY_STATS: MonthStats = {
  visitors: 0,
  sessions: 0,
  totalForms: 0,
  submittedForms: 0,
  corporateSessions: 0,
  residenceSessions: 0,
  multiMessageVisitors: 0,
  aiSatisfied: 0,
  aiNeutral: 0,
  aiAngry: 0,
  aiAvgScore: 0,
  aiTotal: 0,
};

function delta(a: number, b: number): string {
  if (a === 0) return b === 0 ? "—" : "+∞";
  const pct = ((b - a) / a) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function deltaColor(a: number, b: number, higherIsBetter = true): string {
  if (a === b) return "text-muted-foreground";
  const better = higherIsBetter ? b > a : b < a;
  return better ? "text-emerald-400" : "text-red-400";
}

export function MonthlyComparisonSection() {
  const supabase = createClient();
  const defaults = defaultMonths();
  const [monthA, setMonthA] = useState<string>(defaults.a);
  const [monthB, setMonthB] = useState<string>(defaults.b);

  const monthOptions = buildMonthOptions();

  const comparisonQuery = useQuery({
    queryKey: ["analytics-monthly-comparison", monthA, monthB],
    queryFn: async (): Promise<ComparisonResult> => {
      const { data, error } = await supabase.rpc(
        "analytics_monthly_comparison",
        {
          p_month_a: toMonthStart(monthA),
          p_month_b: toMonthStart(monthB),
        }
      );
      if (error) throw error;
      const result = (data ?? {}) as ComparisonResult;
      return {
        monthA: { ...EMPTY_STATS, ...(result.monthA ?? {}) },
        monthB: { ...EMPTY_STATS, ...(result.monthB ?? {}) },
      };
    },
  });

  const a = comparisonQuery.data?.monthA ?? EMPTY_STATS;
  const b = comparisonQuery.data?.monthB ?? EMPTY_STATS;
  const loading = comparisonQuery.isLoading;

  const labelA = formatMonthLabel(monthA);
  const labelB = formatMonthLabel(monthB);

  const summaryRows: Array<{
    label: string;
    valA: number | string;
    valB: number | string;
    rawA: number;
    rawB: number;
    higherIsBetter?: boolean;
  }> = [
    { label: "Users", rawA: a.visitors, rawB: b.visitors, valA: a.visitors, valB: b.visitors },
    { label: "Sessions", rawA: a.sessions, rawB: b.sessions, valA: a.sessions, valB: b.sessions },
    { label: "Forms submitted", rawA: a.submittedForms, rawB: b.submittedForms, valA: a.submittedForms, valB: b.submittedForms },
    {
      label: "Form rate",
      rawA: a.visitors > 0 ? (a.submittedForms / a.visitors) * 100 : 0,
      rawB: b.visitors > 0 ? (b.submittedForms / b.visitors) * 100 : 0,
      valA: a.visitors > 0 ? `${((a.submittedForms / a.visitors) * 100).toFixed(1)}%` : "0%",
      valB: b.visitors > 0 ? `${((b.submittedForms / b.visitors) * 100).toFixed(1)}%` : "0%",
    },
    { label: "Corporate sessions", rawA: a.corporateSessions, rawB: b.corporateSessions, valA: a.corporateSessions, valB: b.corporateSessions },
    { label: "Residence sessions", rawA: a.residenceSessions, rawB: b.residenceSessions, valA: a.residenceSessions, valB: b.residenceSessions },
    { label: "2+ msg users", rawA: a.multiMessageVisitors, rawB: b.multiMessageVisitors, valA: a.multiMessageVisitors, valB: b.multiMessageVisitors },
    { label: "Satisfied", rawA: a.aiSatisfied, rawB: b.aiSatisfied, valA: a.aiSatisfied, valB: b.aiSatisfied },
    { label: "Neutral", rawA: a.aiNeutral, rawB: b.aiNeutral, valA: a.aiNeutral, valB: b.aiNeutral, higherIsBetter: false },
    { label: getSentimentLabel("angry"), rawA: a.aiAngry, rawB: b.aiAngry, valA: a.aiAngry, valB: b.aiAngry, higherIsBetter: false },
    { label: "Avg satisfaction", rawA: a.aiAvgScore, rawB: b.aiAvgScore, valA: a.aiAvgScore.toFixed(2), valB: b.aiAvgScore.toFixed(2) },
  ];

  return (
    <section id="monthly-comparison" className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Month-over-month comparison</h2>
        <InfoDialog
          title="Month-over-month comparison"
          summary="Compare key metrics between two full calendar months."
        >
          <p>
            <span className="font-medium text-foreground">What it shows:</span>{" "}
            Side-by-side comparison of users, sessions, form submissions,
            session type split, and AI sentiment between two completed months.
          </p>
          <p>
            <span className="font-medium text-foreground">How to use:</span>{" "}
            Pick any two past months using the selectors below. The current
            month is excluded since it is not yet complete. Defaults to the two
            most recently finished months.
          </p>
          <p>
            <span className="font-medium text-foreground">Delta column:</span>{" "}
            Shows the percentage change from the first selected month to the
            second. Green = improvement, red = decline.
          </p>
        </InfoDialog>
      </div>

      {/* Month pickers */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-sm shrink-0" style={{ background: COLOR_A }} />
          <label className="text-xs text-muted-foreground whitespace-nowrap">Month A</label>
          <select
            className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            value={monthA}
            onChange={(e) => setMonthA(e.target.value)}
          >
            {monthOptions.map((ym) => (
              <option key={ym} value={ym} disabled={isCurrentOrFuture(ym)}>
                {formatMonthLabel(ym)}
                {isCurrentOrFuture(ym) ? " (not yet complete)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-sm shrink-0" style={{ background: COLOR_B }} />
          <label className="text-xs text-muted-foreground whitespace-nowrap">Month B</label>
          <select
            className="rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            value={monthB}
            onChange={(e) => setMonthB(e.target.value)}
          >
            {monthOptions.map((ym) => (
              <option key={ym} value={ym} disabled={isCurrentOrFuture(ym)}>
                {formatMonthLabel(ym)}
                {isCurrentOrFuture(ym) ? " (not yet complete)" : ""}
              </option>
            ))}
          </select>
        </div>

        {loading && (
          <span className="text-xs text-muted-foreground animate-pulse">Loading…</span>
        )}
      </div>

      {comparisonQuery.isError && (
        <div className="text-sm text-destructive">Failed to load comparison data.</div>
      )}

      <Card className="p-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="py-2 text-left font-medium">Metric</th>
              <th className="py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: COLOR_A }} />
                  {labelA}
                </span>
              </th>
              <th className="py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: COLOR_B }} />
                  {labelB}
                </span>
              </th>
              <th className="py-2 text-right font-medium">Delta</th>
            </tr>
          </thead>
          <tbody>
            {summaryRows.map((row) => (
              <tr key={row.label} className="border-b border-border/40 last:border-0">
                <td className="py-2 text-muted-foreground">{row.label}</td>
                <td className="py-2 text-right tabular-nums">{row.valA}</td>
                <td className="py-2 text-right tabular-nums">{row.valB}</td>
                <td className={`py-2 text-right tabular-nums text-xs ${deltaColor(row.rawA, row.rawB, row.higherIsBetter !== false)}`}>
                  {delta(row.rawA, row.rawB)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  );
}
