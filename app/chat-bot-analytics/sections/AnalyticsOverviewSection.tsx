"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useState } from "react";
import { MiniBarChart, type ChartItem } from "./MiniBarChart";
import { DateRangePicker } from "./DateRangePicker";
import { InfoDialog } from "./InfoDialog";

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
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [promptVersion, setPromptVersion] = useState("");
  const ai = aiSummary ?? {
    satisfied: 0,
    neutral: 0,
    angry: 0,
    avgScore: 0,
    total: 0,
  };
  const aiTotal = ai.total || 0;
  const pct = (value: number) =>
    aiTotal ? `${Math.round((value / aiTotal) * 100)}%` : "0%";
  const promptByVersion: Record<string, string> = {
    v1: `
You are an analyst evaluating a visitor's full chatbot conversation for ANY client/domain.

You MUST use ONLY the transcript. Do NOT assume product features, policies, or company details that are not in the transcript.

Your job:
1) Determine the visitor's primary goal (what they were trying to accomplish).
2) Decide whether the goal was achieved based on evidence in the transcript.
3) Infer sentiment from the visitor's tone + outcome (goal achieved or not).

Return JSON only with exactly these keys:
{
  "satisfaction_1_to_10": number,
  "sentiment": "satisfied" | "neutral" | "angry" | "unknown",
  "improvement": string,
  "summary": string,
  "evidence": {
    "visitor_goal": string,
    "goal_met": "yes" | "partial" | "no" | "unknown",
    "key_quotes": string[]
  }
 }

Scoring rubric (be consistent):
- 9–10: Goal clearly achieved AND visitor expresses approval/thanks OR no further help needed.
- 7–8: Goal achieved but minor friction (extra steps, unclear phrasing, minor repetition).
- 5–6: Partial help; visitor still missing something or outcome unclear.
- 3–4: Mostly unhelpful; confusion, wrong direction, repeated failures.
- 1–2: Very bad; visitor is clearly frustrated/angry, bot blocks, or fails completely.

Sentiment rules:
- "satisfied": visitor expresses positive emotion OR goal clearly met with no frustration.
- "angry": explicit frustration/negative tone OR repeated failure AND visitor escalates/complains.
- "neutral": neither satisfied nor angry; or mixed tone with partial resolution.
- "unknown": transcript too short/ambiguous to infer tone or outcome.

Evidence rules:
- visitor_goal: 1 short sentence describing the visitor's main intent.
- goal_met: yes/partial/no/unknown based on transcript outcomes.
- key_quotes: 1–3 short exact quotes (<= 20 words each) from the transcript that justify score/sentiment.
  If transcript is extremely short, provide an empty array.

Output rules:
- JSON only. No markdown.
- "improvement" and "summary" must be in English even if transcript is French.
- improvement: one line, actionable, start with a verb, and include ONE category label:
  Categories: [clarify], [accuracy], [handoff], [ux], [tone], [policy], [speed], [links]
  Example: "[clarify] Ask one follow-up question to confirm location before recommending options."
- summary: 2–3 short sentences, describing what happened and the outcome.
`.trim(),
  };

  const openPromptModal = (version: string) => {
    setPromptVersion(version);
    setPromptText(promptByVersion[version] ?? "Prompt not found for this version.");
    setPromptOpen(true);
  };
  return (
    <section id="analytics-overview" className="space-y-4">
      {promptOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl rounded-lg border border-border bg-card shadow-lg">
            <div className="flex items-center justify-between border-b border-border p-4">
              <div>
                <div className="text-sm font-semibold">Analyzer prompt</div>
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Overview</h2>
          <InfoDialog
            title="Overview metrics"
            summary="High-level usage and conversion metrics for the selected date range."
          >
            <p>
              <span className="font-medium text-foreground">What it shows:</span>{" "}
              Visitor counts, interactions, average interactions per visitor,
              form submissions, corporate vs residence split, and multi-message
              engagement.
            </p>
            <p>
              <span className="font-medium text-foreground">How it is collected:</span>{" "}
              Aggregated from <span className="font-medium">visitors</span>,{" "}
              <span className="font-medium">chat_sessions</span>,{" "}
              <span className="font-medium">chat_messages</span>, and{" "}
              <span className="font-medium">visitor_forms</span>. Corporate vs
              residence uses the session residence identifier.
            </p>
            <p>
              <span className="font-medium text-foreground">Update frequency:</span>{" "}
              Calculated on demand when you load, refresh, or change the date
              range.
            </p>
          </InfoDialog>
        </div>
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
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                AI-driven analyzer
              </div>
              <InfoDialog
                title="AI analyzer summary"
                summary="Sentiment and satisfaction scores based on automated conversation analysis."
              >
                <p>
                  <span className="font-medium text-foreground">What it shows:</span>{" "}
                  Counts of satisfied, neutral, and angry visitors plus the
                  average satisfaction score, using the latest analysis per
                  visitor.
                </p>
                <p>
                  <span className="font-medium text-foreground">How it is collected:</span>{" "}
                  A scheduled job sends full chat transcripts to the analyzer
                  and stores results in <span className="font-medium">chat_visitor_analyses</span>.
                </p>
                <p>
                  <span className="font-medium text-foreground">Update frequency:</span>{" "}
                  Runs daily at 02:00 (database time) and processes up to 150
                  visitors per run.
                </p>
              </InfoDialog>
            </div>
            <div className="text-sm text-muted-foreground">
              Sentiment counts and average satisfaction from the latest analysis per visitor.
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openPromptModal("v1")}
          >
            Watch prompt
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Satisfied</div>
            <div className="text-2xl font-semibold text-emerald-400">
              {ai.satisfied}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {pct(ai.satisfied)} of {ai.total} analyzed
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Neutral</div>
            <div className="text-2xl font-semibold text-yellow-400">
              {ai.neutral}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {pct(ai.neutral)} of {ai.total} analyzed
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Angry</div>
            <div className="text-2xl font-semibold text-red-400">
              {ai.angry}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {pct(ai.angry)} of {ai.total} analyzed
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

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Top content</h3>
          <InfoDialog
            title="Top content"
            summary="Most common pages, residences, and languages in chat sessions."
          >
            <p>
              <span className="font-medium text-foreground">What it shows:</span>{" "}
              Top 5 pages, residences, and languages by session count for the
              selected range.
            </p>
            <p>
              <span className="font-medium text-foreground">How it is collected:</span>{" "}
              Aggregated from <span className="font-medium">chat_sessions</span>{" "}
              (page URL, residence id, and language) with residence names
              resolved from <span className="font-medium">residences</span>.
            </p>
            <p>
              <span className="font-medium text-foreground">Update frequency:</span>{" "}
              Calculated on demand when you refresh or change the date range.
            </p>
          </InfoDialog>
        </div>
      </div>
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
