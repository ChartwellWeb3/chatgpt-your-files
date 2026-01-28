"use client";

import { Card } from "@/components/ui/card";
import { MiniBarChart, type ChartItem } from "./MiniBarChart";
import { DateRangePicker } from "./DateRangePicker";

type OverviewCounts = {
  visitors: number;
  sessions: number;
  // messages: number;
  totalForms: number;
  submittedForms: number;
};

type OverviewProps = {
  startDate: string;
  endDate: string;
  setStartDate: (date: string) => void;
  setEndDate: (date: string) => void;
  overviewCounts: OverviewCounts;
  formCompletionPct: number;
  corporateSessions: number;
  residenceSessions: number;
  corporateSessionPct: number;
  multiMessageVisitors: number;
  multiMessageVisitorPct: number;
  multiSessionMessageVisitors: number;
  multiSessionMessageVisitorPct: number;
  topPages: ChartItem[];
  topResidences: ChartItem[];
  topLangs: ChartItem[];
  aiSummary?: {
    satisfied: number;
    neutral: number;
    angry: number;
    avgScore: number;
    total: number;
  } | null;
};

export function AnalyticsOverviewSection({
  startDate,
  endDate,
  setStartDate,
  setEndDate,
  overviewCounts,
  // formCompletionPct,
  corporateSessions,
  residenceSessions,
  corporateSessionPct,
  multiMessageVisitors,
  multiMessageVisitorPct,
  multiSessionMessageVisitors,
  multiSessionMessageVisitorPct,
  topPages,
  topResidences,
  topLangs,
  aiSummary,
}: OverviewProps) {
  const ai = aiSummary ?? {
    satisfied: 0,
    neutral: 0,
    angry: 0,
    avgScore: 0,
    total: 0,
  };
  return (
    <section id="analytics-overview" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Overview</h2>
        <div className="w-[260px]">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onChange={(from, to) => {
              setStartDate(from);
              setEndDate(to);
            }}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Visitors</div>
          <div className="text-2xl font-semibold">
            {overviewCounts.visitors}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Interactions</div>
          <div className="text-2xl font-semibold">
            {overviewCounts.sessions}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">
            Avg interactions per visitor
          </div>
          <div className="text-2xl font-semibold">
            {(overviewCounts.visitors
              ? overviewCounts.sessions / overviewCounts.visitors
              : 0
            ).toFixed(2)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Forms submitted</div>
          <div className="text-2xl font-semibold">
            {overviewCounts.submittedForms}
          </div>
          {/* <div className="text-xs text-muted-foreground mt-1">
            Completion: {formCompletionPct.toFixed(0)}%
          </div> */}
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">
            Corporate vs residence sessions
          </div>
          <div className="text-2xl font-semibold">
            {corporateSessions} / {residenceSessions}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Corporate {corporateSessionPct.toFixed(0)}%
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">
            Visitors with 2+ messages
          </div>
          <div className="text-2xl font-semibold">{multiMessageVisitors}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {multiMessageVisitorPct.toFixed(0)}% of visitors
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">
            Visitors with messages in 2+ interactions
          </div>
          <div className="text-2xl font-semibold">
            {multiSessionMessageVisitors}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {multiSessionMessageVisitorPct.toFixed(0)}% of visitors
          </div>
        </Card>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              AI-driven analyzer
            </div>
            <div className="text-sm text-muted-foreground">
              Sentiment counts and average satisfaction from the latest analysis per visitor.
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Satisfied</div>
            <div className="text-2xl font-semibold text-emerald-400">
              {ai.satisfied}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              of {ai.total} analyzed
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Neutral</div>
            <div className="text-2xl font-semibold text-yellow-400">
              {ai.neutral}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              of {ai.total} analyzed
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Angry</div>
            <div className="text-2xl font-semibold text-red-400">
              {ai.angry}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              of {ai.total} analyzed
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">
              Avg satisfaction
            </div>
            <div className="text-2xl font-semibold">
              {ai.avgScore.toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              based on latest per visitor
            </div>
          </Card>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 space-y-4">
          <MiniBarChart title="Top pages" items={topPages} />
          <MiniBarChart title="Top residences" items={topResidences} />
        </Card>
        <Card className="p-4">
          <MiniBarChart title="Top languages" items={topLangs} />
        </Card>
      </div>
    </section>
  );
}
