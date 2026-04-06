"use client";

import { useState } from "react";
import { createClient } from "../../utils/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { RefreshCcw } from "lucide-react";
import { AnalyticsOverviewSection } from "../sections/AnalyticsOverviewSection";
import { MonthlyComparisonSection } from "../sections/MonthlyComparisonSection";
import { type ChartItem } from "../sections/MiniBarChart";

type OverviewCounts = {
  visitors: number;
  sessions: number;
  totalForms: number;
  submittedForms: number;
};

type OverviewSummary = OverviewCounts & {
  topPages: ChartItem[];
  topResidences: ChartItem[];
  topLangs: ChartItem[];
  corporateSessions: number;
  residenceSessions: number;
  multiMessageVisitors: number;
  multiSessionMessageVisitors: number;
};

type AiSummary = {
  satisfied: number;
  neutral: number;
  angry: number;
  avgScore: number;
  total: number;
};

type DurationSummary = {
  avgSeconds: number;
  total: number;
};

type DurationBySentimentSummary = {
  satisfiedAvgSeconds: number;
  neutralAvgSeconds: number;
  angryAvgSeconds: number;
  satisfiedTotal: number;
  neutralTotal: number;
  angryTotal: number;
};

type DurationBucket = {
  count: number;
  avgSeconds: number;
};

type DurationBucketSummary = {
  overall: Record<string, DurationBucket>;
  satisfied: Record<string, DurationBucket>;
  neutral: Record<string, DurationBucket>;
  angry: Record<string, DurationBucket>;
};

const EMPTY_OVERVIEW: OverviewCounts = {
  visitors: 0,
  sessions: 0,
  totalForms: 0,
  submittedForms: 0,
};

export default function ChatAnalyticsOverviewPage() {
  const supabase = createClient();

  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const overviewSummaryQuery = useQuery({
    queryKey: ["analytics-overview-summary", startDate, endDate],
    queryFn: async (): Promise<OverviewSummary> => {
      const { data, error } = await supabase.rpc("analytics_overview_summary", {
        p_start: startDate ? startDate : null,
        p_end: endDate ? endDate : null,
      });

      if (error) throw error;
      const summary = (data ?? {}) as OverviewSummary;
      return {
        visitors: summary.visitors ?? 0,
        sessions: summary.sessions ?? 0,
        totalForms: summary.totalForms ?? 0,
        submittedForms: summary.submittedForms ?? 0,
        corporateSessions: summary.corporateSessions ?? 0,
        residenceSessions: summary.residenceSessions ?? 0,
        topPages: summary.topPages ?? [],
        topResidences: summary.topResidences ?? [],
        topLangs: summary.topLangs ?? [],
        multiMessageVisitors: summary.multiMessageVisitors ?? 0,
        multiSessionMessageVisitors: summary.multiSessionMessageVisitors ?? 0,
      };
    },
  });

  const aiSummaryQuery = useQuery({
    queryKey: ["analytics-ai-summary", startDate, endDate],
    queryFn: async (): Promise<AiSummary> => {
      const { data, error } = await supabase.rpc("analytics_ai_summary", {
        p_start: startDate ? startDate : null,
        p_end: endDate ? endDate : null,
      });

      if (error) throw error;
      const summary = (data ?? {}) as AiSummary;
      return {
        satisfied: summary.satisfied ?? 0,
        neutral: summary.neutral ?? 0,
        angry: summary.angry ?? 0,
        avgScore: summary.avgScore ?? 0,
        total: summary.total ?? 0,
      };
    },
  });

  const durationSummaryQuery = useQuery({
    queryKey: ["analytics-duration-summary", startDate, endDate],
    queryFn: async (): Promise<DurationSummary> => {
      const { data, error } = await supabase.rpc("analytics_duration_summary", {
        p_start: startDate ? startDate : null,
        p_end: endDate ? endDate : null,
      });

      if (error) throw error;
      const summary = (data ?? {}) as DurationSummary;
      return {
        avgSeconds: summary.avgSeconds ?? 0,
        total: summary.total ?? 0,
      };
    },
  });

  const durationBySentimentQuery = useQuery({
    queryKey: ["analytics-duration-by-sentiment", startDate, endDate],
    queryFn: async (): Promise<DurationBySentimentSummary> => {
      const { data, error } = await supabase.rpc(
        "analytics_duration_by_sentiment",
        {
          p_start: startDate ? startDate : null,
          p_end: endDate ? endDate : null,
        }
      );

      if (error) throw error;
      const summary = (data ?? {}) as DurationBySentimentSummary;
      return {
        satisfiedAvgSeconds: summary.satisfiedAvgSeconds ?? 0,
        neutralAvgSeconds: summary.neutralAvgSeconds ?? 0,
        angryAvgSeconds: summary.angryAvgSeconds ?? 0,
        satisfiedTotal: summary.satisfiedTotal ?? 0,
        neutralTotal: summary.neutralTotal ?? 0,
        angryTotal: summary.angryTotal ?? 0,
      };
    },
  });

  const durationBucketQuery = useQuery({
    queryKey: ["analytics-duration-buckets", startDate, endDate],
    queryFn: async (): Promise<DurationBucketSummary> => {
      const { data, error } = await supabase.rpc(
        "analytics_duration_bucket_summary",
        {
          p_start: startDate ? startDate : null,
          p_end: endDate ? endDate : null,
        }
      );

      if (error) throw error;
      return (data ?? {}) as DurationBucketSummary;
    },
  });

  const refreshAll = async () => {
    await Promise.all([
      overviewSummaryQuery.refetch(),
      aiSummaryQuery.refetch(),
      durationSummaryQuery.refetch(),
      durationBySentimentQuery.refetch(),
      durationBucketQuery.refetch(),
    ]);
  };

  const overviewSummary = overviewSummaryQuery.data ?? {
    ...EMPTY_OVERVIEW,
    topPages: [],
    topResidences: [],
    topLangs: [],
    corporateSessions: 0,
    residenceSessions: 0,
    multiMessageVisitors: 0,
    multiSessionMessageVisitors: 0,
  };
  const corporateSessionPct =
    overviewSummary.corporateSessions + overviewSummary.residenceSessions > 0
      ? (overviewSummary.corporateSessions /
          (overviewSummary.corporateSessions +
            overviewSummary.residenceSessions)) *
        100
      : 0;
  const multiMessageVisitorPct =
    overviewSummary.visitors > 0
      ? (overviewSummary.multiMessageVisitors / overviewSummary.visitors) * 100
      : 0;
  const multiSessionMessageVisitorPct =
    overviewSummary.visitors > 0
      ? (overviewSummary.multiSessionMessageVisitors /
          overviewSummary.visitors) *
        100
      : 0;
  const formCompletionPct =
    overviewSummary.visitors > 0
      ? (overviewSummary.submittedForms / overviewSummary.visitors) * 100
      : 0;

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Key metrics, engagement stats, and month-over-month trends.
          </p>
        </div>

        <div className="flex items-end gap-2 flex-wrap">
          <Button variant="outline" className="gap-2" onClick={refreshAll}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <AnalyticsOverviewSection
        startDate={startDate}
        endDate={endDate}
        setStartDate={setStartDate}
        setEndDate={setEndDate}
        overviewCounts={overviewSummary}
        formCompletionPct={formCompletionPct}
        corporateSessions={overviewSummary.corporateSessions}
        residenceSessions={overviewSummary.residenceSessions}
        corporateSessionPct={corporateSessionPct}
        multiMessageVisitors={overviewSummary.multiMessageVisitors}
        multiMessageVisitorPct={multiMessageVisitorPct}
        multiSessionMessageVisitors={
          overviewSummary.multiSessionMessageVisitors
        }
        multiSessionMessageVisitorPct={multiSessionMessageVisitorPct}
        topPages={overviewSummary.topPages}
        topResidences={overviewSummary.topResidences}
        topLangs={overviewSummary.topLangs}
        aiSummary={aiSummaryQuery.data ?? null}
        durationSummary={durationSummaryQuery.data ?? null}
        durationBySentiment={durationBySentimentQuery.data ?? null}
        durationBuckets={durationBucketQuery.data ?? null}
      />

      <MonthlyComparisonSection />
    </div>
  );
}
