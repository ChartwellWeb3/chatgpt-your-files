"use client";

import { useMemo, useState } from "react";
import { createClient } from "../../utils/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { RefreshCcw } from "lucide-react";
import { AnalyticsOverviewSection } from "../sections/AnalyticsOverviewSection";
// import { AnalyticsFormsSection } from "../sections/AnalyticsFormsSection";
import { type ChartItem } from "../sections/MiniBarChart";

type SessionLite = {
  created_at: string;
  page_url: string | null;
  residence_custom_id: string | null;
  lang: string | null;
};

type ResidenceRow = {
  name: string;
  custom_id: string;
};

type OverviewCounts = {
  visitors: number;
  sessions: number;
  // messages: number;
  totalForms: number;
  submittedForms: number;
};

type VisitorFormRow = {
  is_submitted: boolean;
  submitted_with_button: "dynamic" | "static" | string | null;
  submitted_at: string | null;
};

const EMPTY_OVERVIEW: OverviewCounts = {
  visitors: 0,
  sessions: 0,
  // messages: 0,
  totalForms: 0,
  submittedForms: 0,
};

function buildTopList(
  rows: SessionLite[],
  key: (row: SessionLite) => string | null,
  limit = 5
): ChartItem[] {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const value = key(row)?.trim() || "Unknown";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }));
}

export default function ChatAnalyticsOverviewPage() {
  const supabase = createClient();

  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  // const [bookedStart, setBookedStart] = useState<string>("");
  // const [bookedEnd, setBookedEnd] = useState<string>("");

  const overviewCountsQuery = useQuery({
    queryKey: ["analytics-overview-counts", startDate, endDate],
    queryFn: async (): Promise<OverviewCounts> => {
      const applyDate = <T extends {
        gte: (column: string, value: string) => T;
        lte: (column: string, value: string) => T;
      }>(
        query: T,
        column: string
      ): T => {
        let q = query;
        if (startDate) q = q.gte(column, startDate);
        if (endDate) q = q.lte(column, `${endDate} 23:59:59`);
        return q;
      };

      const visitorsQ = applyDate(
        supabase.from("visitors").select("id", { count: "exact", head: true }),
        "created_at"
      );
      const sessionsQ = applyDate(
        supabase
          .from("chat_sessions")
          .select("id", { count: "exact", head: true }),
        "created_at"
      );
      // const messagesQ = applyDate(
      //   supabase
      //     .from("chat_messages")
      //     .select("id", { count: "exact", head: true }),
      //   "created_at"
      // );
      const totalFormsQ = applyDate(
        supabase
          .from("visitor_forms")
          .select("id", { count: "exact", head: true }),
        "created_at"
      );
      const submittedFormsQ = applyDate(
        supabase
          .from("visitor_forms")
          .select("id", { count: "exact", head: true })
          .eq("is_submitted", true),
        "submitted_at"
      );

      const [
        visitorsRes,
        sessionsRes,
        // messagesRes,
        totalFormsRes,
        submittedFormsRes,
      ] = await Promise.all([
        visitorsQ,
        sessionsQ,
        // messagesQ,
        totalFormsQ,
        submittedFormsQ,
      ]);

      return {
        visitors: visitorsRes.count ?? 0,
        sessions: sessionsRes.count ?? 0,
        // messages: messagesRes.count ?? 0,
        totalForms: totalFormsRes.count ?? 0,
        submittedForms: submittedFormsRes.count ?? 0,
      };
    },
  });

  const sessionsBreakdownQuery = useQuery({
    queryKey: ["analytics-session-breakdown", startDate, endDate],
    queryFn: async (): Promise<SessionLite[]> => {
      let query = supabase
        .from("chat_sessions")
        .select("created_at,page_url,residence_custom_id,lang")
        .order("created_at", { ascending: false })
        .limit(5000);

      if (startDate) {
        query = query.gte("created_at", startDate);
      }
      if (endDate) {
        query = query.lte("created_at", `${endDate} 23:59:59`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as SessionLite[];
    },
  });

  const residencesQuery = useQuery({
    queryKey: ["analytics-residences-map"],
    queryFn: async (): Promise<ResidenceRow[]> => {
      const { data, error } = await supabase
        .from("residences")
        .select("name,custom_id");

      if (error) throw error;
      return (data ?? []) as ResidenceRow[];
    },
  });

  const bookTourFormsQuery = useQuery({
    queryKey: ["analytics-book-tour-overview", startDate, endDate],
    queryFn: async (): Promise<VisitorFormRow[]> => {
      let query = supabase
        .from("visitor_forms")
        .select("is_submitted,submitted_with_button,submitted_at")
        .eq("form_type", "chat_bot_book_a_tour")
        .eq("is_submitted", true);

      if (startDate) {
        query = query.gte("submitted_at", startDate);
      }
      if (endDate) {
        query = query.lte("submitted_at", `${endDate} 23:59:59`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as VisitorFormRow[];
    },
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

  const overviewCounts = overviewCountsQuery.data ?? EMPTY_OVERVIEW;
  const sessionBreakdownRows = useMemo(
    () => sessionsBreakdownQuery.data ?? [],
    [sessionsBreakdownQuery.data]
  );
  const residences = useMemo(
    () => residencesQuery.data ?? [],
    [residencesQuery.data]
  );
  const residenceNameMap = useMemo(() => {
    const map = new Map<string, string>();
    residences.forEach((row) => map.set(row.custom_id, row.name));
    return map;
  }, [residences]);
  const topPages = useMemo(
    () => buildTopList(sessionBreakdownRows, (row) => row.page_url, 5),
    [sessionBreakdownRows]
  );
  const topResidences = useMemo(
    () =>
      buildTopList(
        sessionBreakdownRows,
        (row) => {
          const customId = row.residence_custom_id || "common";
          return residenceNameMap.get(customId) || customId;
        },
        5
      ),
    [sessionBreakdownRows, residenceNameMap]
  );
  const topLangs = useMemo(
    () => buildTopList(sessionBreakdownRows, (row) => row.lang, 5),
    [sessionBreakdownRows]
  );
  const formCompletionPct =
    overviewCounts.totalForms > 0
      ? (overviewCounts.submittedForms / overviewCounts.totalForms) * 100
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
      overviewCountsQuery.refetch(),
      sessionsBreakdownQuery.refetch(),
      bookTourFormsQuery.refetch(),
      // bookedToursByDateQuery.refetch(),
    ]);
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
        overviewCounts={overviewCounts}
        formCompletionPct={formCompletionPct}
        topPages={topPages}
        topResidences={topResidences}
        topLangs={topLangs}
      />

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
