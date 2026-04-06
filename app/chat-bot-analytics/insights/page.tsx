"use client";

import { useMemo, useState } from "react";
import { createClient } from "../../utils/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { RefreshCcw } from "lucide-react";
import { AnalyzerInsightsSection } from "../sections/AnalyzerInsightsSection";
import { ContactMentionsSection } from "../sections/ContactMentionsSection";
import { CommonWordsSection } from "../sections/CommonWordsSection";
import { StopwordsSection } from "../sections/StopwordsSection";
import { DateRangePicker } from "../sections/DateRangePicker";
import { useProfileLevel } from "@/app/hooks/useProfileLevel";

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

export default function ChatAnalyticsInsightsPage() {
  const supabase = createClient();
  const { isAdmin } = useProfileLevel();

  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

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

  const [refreshingWords, setRefreshingWords] = useState(false);
  const [refreshWordsError, setRefreshWordsError] = useState<string | null>(null);
  const [stopwordError, setStopwordError] = useState<string | null>(null);

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
      const message = err instanceof Error ? err.message : "Refresh failed";
      setRefreshWordsError(message);
    } finally {
      setRefreshingWords(false);
    }
  };

  const addStopword = async (word: string, lang: "en" | "fr") => {
    setStopwordError(null);
    const { error } = await supabase.from("chat_stopwords").insert({ word, lang });
    if (error) {
      setStopwordError(error.message);
      throw error;
    }
    await stopwordsQuery.refetch();
    await refreshCommonWords();
  };

  const deleteStopword = async (id: number) => {
    setStopwordError(null);
    const { error } = await supabase.from("chat_stopwords").delete().eq("id", id);
    if (error) {
      setStopwordError(error.message);
      throw error;
    }
    await stopwordsQuery.refetch();
  };

  const commonWords = commonWordsQuery.data ?? [];
  const enWords = useMemo(
    () => commonWords.filter((r) => r.lang === "en").sort((a, b) => b.freq - a.freq).slice(0, 50),
    [commonWords],
  );
  const frWords = useMemo(
    () => commonWords.filter((r) => r.lang === "fr").sort((a, b) => b.freq - a.freq).slice(0, 50),
    [commonWords],
  );
  const stopwords = stopwordsQuery.data ?? [];
  const stopwordsEn = useMemo(() => stopwords.filter((r) => r.lang === "en"), [stopwords]);
  const stopwordsFr = useMemo(() => stopwords.filter((r) => r.lang === "fr"), [stopwords]);
  const stopwordSet = useMemo(
    () => new Set(stopwords.map((r) => `${r.lang}:${r.word}`)),
    [stopwords],
  );

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Insights & Content</h1>
          <p className="text-sm text-muted-foreground">
            AI-analyzed sentiment, intents, contact mentions, and word frequency.
          </p>
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

      <AnalyzerInsightsSection startDate={startDate} endDate={endDate} />

      <ContactMentionsSection startDate={startDate} endDate={endDate} />

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
    </div>
  );
}
