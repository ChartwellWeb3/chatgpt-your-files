"use client";

import { useMemo, useState } from "react";
import { createClient } from "../../utils/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { RefreshCcw } from "lucide-react";
import { AnalyticsOverviewSection } from "../sections/AnalyticsOverviewSection";
import { CommonWordsSection } from "../sections/CommonWordsSection";
import { StopwordsSection } from "../sections/StopwordsSection";
import { MonthlyInsightsSection } from "../sections/MonthlyInsightsSection";
import { useProfileLevel } from "@/app/hooks/useProfileLevel";
// import { AnalyticsFormsSection } from "../sections/AnalyticsFormsSection";
import { type ChartItem } from "../sections/MiniBarChart";

type OverviewCounts = {
  visitors: number;
  sessions: number;
  // messages: number;
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

type CommonWordRow = {
  word: string;
  freq: number;
  lang: string;
};

type StopwordRow = {
  id: number;
  word: string;
  lang: "en" | "fr";
};

const EMPTY_OVERVIEW: OverviewCounts = {
  visitors: 0,
  sessions: 0,
  // messages: 0,
  totalForms: 0,
  submittedForms: 0,
};

export default function ChatAnalyticsOverviewPage() {
  const supabase = createClient();
  const { isAdmin } = useProfileLevel();

  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  // const [bookedStart, setBookedStart] = useState<string>("");
  // const [bookedEnd, setBookedEnd] = useState<string>("");

  const overviewSummaryQuery = useQuery({
    queryKey: ["analytics-overview-summary", startDate, endDate],
    queryFn: async (): Promise<OverviewSummary> => {
      const { data, error } = await supabase.rpc(
        "analytics_overview_summary",
        {
          p_start: startDate ? startDate : null,
          p_end: endDate ? endDate : null,
        },
      );

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

  const commonWordsQuery = useQuery({
    queryKey: ["analytics-common-words"],
    queryFn: async (): Promise<CommonWordRow[]> => {
      const { data, error } = await supabase
        .from("chat_common_words")
        .select("word,freq,lang")
        .in("lang", ["en", "fr"])
        .order("freq", { ascending: false });

      if (error) throw error;
      return (data ?? []) as CommonWordRow[];
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

  const stopwordsQuery = useQuery({
    queryKey: ["analytics-stopwords"],
    queryFn: async (): Promise<StopwordRow[]> => {
      const { data, error } = await supabase
        .from("chat_stopwords")
        .select("id,word,lang")
        .in("lang", ["en", "fr"])
        .order("word", { ascending: true });

      if (error) throw error;
      return (data ?? []) as StopwordRow[];
    },
    enabled: isAdmin,
  });

  // const bookedToursByDateQuery = useQuery({
  //   queryKey: ["booked-tours-by-date", bookedStart, bookedEnd],
  //   queryFn: async (): Promise<VisitorFormRow[]> => {
  //     let query = supabase
  //       .from("visitor_forms")
  //       .select("is_submitted,submitted_with_button,submitted_at")
  //       .eq("form_type", "chat_bot_book_a_tour")
  //       .eq("is_submitted", true);

  //     if (bookedStart) {
  //       query = query.gte("submitted_at", bookedStart);
  //     }
  //     if (bookedEnd) {
  //       query = query.lte("submitted_at", `${bookedEnd} 23:59:59`);
  //     }

  //     const { data, error } = await query;
  //     if (error) throw error;
  //     return (data ?? []) as VisitorFormRow[];
  //   },
  // });

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

  // const bookTourRows = bookTourFormsQuery.data ?? [];
  // // const bookTourTotals = useMemo(() => {
  // //   const totalSubmitted = bookTourRows.length;
  // //   const dynamicSubmitted = bookTourRows.filter(
  // //     (r) => r.submitted_with_button === "dynamic"
  // //   ).length;

  // //   return { totalSubmitted, dynamicSubmitted };
  // // }, [bookTourRows]);

  // const bookedByDateStats = useMemo(() => {
  //   const rows = bookedToursByDateQuery.data ?? [];

  //   let total = 0;
  //   let dynamic = 0;

  //   for (const r of rows) {
  //     total++;
  //     if (r.submitted_with_button === "dynamic") dynamic++;
  //   }

  //   return { total, dynamic };
  // }, [bookedToursByDateQuery.data]);

  const refreshAll = async () => {
    await Promise.all([
      overviewSummaryQuery.refetch(),
      commonWordsQuery.refetch(),
      stopwordsQuery.refetch(),
      aiSummaryQuery.refetch(),
      durationSummaryQuery.refetch(),
      durationBySentimentQuery.refetch(),
      durationBucketQuery.refetch(),
      // bookedToursByDateQuery.refetch(),
    ]);
  };

  const [refreshingWords, setRefreshingWords] = useState(false);
  const [refreshWordsError, setRefreshWordsError] = useState<string | null>(
    null,
  );

  const refreshCommonWords = async () => {
    setRefreshingWords(true);
    setRefreshWordsError(null);
    try {
      const res = await fetch("/api/analytics/refresh-common-words", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Refresh failed");
      }
      await commonWordsQuery.refetch();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Refresh failed";
      setRefreshWordsError(message);
    } finally {
      setRefreshingWords(false);
    }
  };

  const commonWords = commonWordsQuery.data ?? [];
  const enWords = useMemo(
    () =>
      commonWords
        .filter((row) => row.lang === "en")
        .sort((a, b) => b.freq - a.freq)
        .slice(0, 50),
    [commonWords],
  );
  const frWords = useMemo(
    () =>
      commonWords
        .filter((row) => row.lang === "fr")
        .sort((a, b) => b.freq - a.freq)
        .slice(0, 50),
    [commonWords],
  );

  const stopwords = stopwordsQuery.data ?? [];
  const stopwordsEn = useMemo(
    () => stopwords.filter((row) => row.lang === "en"),
    [stopwords],
  );
  const stopwordsFr = useMemo(
    () => stopwords.filter((row) => row.lang === "fr"),
    [stopwords],
  );
  const stopwordSet = useMemo(() => {
    return new Set(stopwords.map((row) => `${row.lang}:${row.word}`));
  }, [stopwords]);

  const [stopwordError, setStopwordError] = useState<string | null>(null);

  const addStopword = async (word: string, lang: "en" | "fr") => {
    setStopwordError(null);
    const { error } = await supabase
      .from("chat_stopwords")
      .insert({ word, lang });

    if (error) {
      setStopwordError(error.message);
      throw error;
    }
    await stopwordsQuery.refetch();
    await refreshCommonWords();
  };

  const deleteStopword = async (id: number) => {
    setStopwordError(null);
    const { error } = await supabase
      .from("chat_stopwords")
      .delete()
      .eq("id", id);

    if (error) {
      setStopwordError(error.message);
      throw error;
    }
    await stopwordsQuery.refetch();
  };

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Chat Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Track visitor behavior, sessions, and bot performance.
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
        multiSessionMessageVisitors={overviewSummary.multiSessionMessageVisitors}
        multiSessionMessageVisitorPct={multiSessionMessageVisitorPct}
        topPages={overviewSummary.topPages}
        topResidences={overviewSummary.topResidences}
        topLangs={overviewSummary.topLangs}
        aiSummary={aiSummaryQuery.data ?? null}
        durationSummary={durationSummaryQuery.data ?? null}
        durationBySentiment={durationBySentimentQuery.data ?? null}
        durationBuckets={durationBucketQuery.data ?? null}
      />

      <MonthlyInsightsSection isAdmin={isAdmin} />

      <CommonWordsSection
        isAdmin={isAdmin}
        refreshCommonWords={refreshCommonWords}
        refreshingWords={refreshingWords}
        loading={commonWordsQuery.isLoading}
        enWords={enWords}
        frWords={frWords}
        onAddStopword={addStopword}
        stopwordSet={stopwordSet}
      />
      {refreshWordsError ? (
        <div className="text-sm text-destructive">{refreshWordsError}</div>
      ) : null}

      {isAdmin ? (
        <StopwordsSection
          loading={stopwordsQuery.isLoading}
          error={stopwordError}
          enWords={stopwordsEn}
          frWords={stopwordsFr}
          onAdd={addStopword}
          onDelete={deleteStopword}
        />
      ) : null}

      {/* <AnalyticsFormsSection
        loadingBookTourForms={bookTourFormsQuery.isLoading}
        loadingBookedByDate={bookedToursByDateQuery.isLoading}
        bookTourTotals={bookTourTotals}
        bookedByDateStats={bookedByDateStats}
        bookedStart={bookedStart}
        bookedEnd={bookedEnd}
        setBookedStart={setBookedStart}
        setBookedEnd={setBookedEnd}
      /> */}
    </div>
  );
}
