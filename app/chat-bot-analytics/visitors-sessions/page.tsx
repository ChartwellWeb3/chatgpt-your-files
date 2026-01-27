"use client";

import { useMemo, useState } from "react";
import { createClient } from "../../utils/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { RefreshCcw } from "lucide-react";
import { useReplay } from "../../hooks/useReplay";
import { useDeleteVisitor } from "../../hooks/useDeleteVisitor";
import { useProfileLevel } from "../../hooks/useProfileLevel";
import { AnalyticsReplaySection } from "../sections/AnalyticsReplaySection";
import type {
  ConversationAnalysis,
  MessageRow,
  SessionRow,
  SourceRow,
  VisitorRow,
  VisitorAnalysisRow,
} from "../../types/types";
import { useSearchParams } from "next/navigation";

type FilterOption =
  | "all"
  | "submitted"
  | "not_submitted"
  | "requested"
  | "reviewed";

type VisitorFormRow = {
  visitor_id: string;
  is_submitted: boolean;
  submitted_with_button: "dynamic" | "static" | string | null;
  submitted_at: string | null;
};

type BookATourStats = {
  submitted: boolean;
  totalSubmissions: number;
  dynamicSubmissions: number;
  lastSubmittedAt?: string | null;
};

type DocumentSectionRow = { id: number; document_id: number };

type DocumentRow = { id: number; name: string };
type ReviewRequestRow = {
  id: number;
  visitor_id: string;
  session_id: string | null;
  requester_id: string;
  requester_email: string | null;
  requester_comment: string;
  status: "pending" | "reviewed" | "closed";
  reviewer_id: string | null;
  reviewer_email: string | null;
  reviewer_comment: string | null;
  created_at: string;
  reviewed_at: string | null;
};

const EMPTY_VISITORS: VisitorRow[] = [];
const EMPTY_SESSIONS: SessionRow[] = [];
const EMPTY_FORMS: VisitorFormRow[] = [];

export default function ChatAnalyticsVisitorsSessionsPage() {
  const supabase = createClient();

  const { isAdmin } = useProfileLevel();
  const searchParams = useSearchParams();

  // Pagination for visitors
  const PAGE_SIZE = 50;
  const [visitorPage, setVisitorPage] = useState(0);

  // Explicit selections (user-made). We derive effective selections below.
  const [selectedVisitorId, setSelectedVisitorId] = useState<string>("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");

  // Search
  const [sessionSearch, setSessionSearch] = useState("");

  const [filterOption, setFilterOption] = useState<FilterOption>("all");

  const [analysisLoadingVisitorId, setAnalysisLoadingVisitorId] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<{ visitorId: string; message: string } | null>(null);
  const [analysisOverrides, setAnalysisOverrides] = useState<Map<string, VisitorAnalysisRow>>(new Map());

  // Toggle conversation mode (seed from URL if provided)
  const modeParam = searchParams.get("mode");
  const [isBySession, setIsBySession] = useState(modeParam !== "full");

  // Date range filter (used to pull visitors + forms from DB)
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const visitorIdFromUrl = searchParams.get("visitor_id") ?? "";

  // ---- Visitors (pulled from DB based on date) ----
  const visitorsQuery = useQuery({
    queryKey: ["analytics-visitors", visitorPage, startDate, endDate],
    queryFn: async (): Promise<{
      visitors: VisitorRow[];
      totalCount: number | null;
    }> => {
      const from = 0;
      const to = visitorPage * PAGE_SIZE + (PAGE_SIZE - 1);

      let query = supabase
        .from("visitors")
        .select("id,created_at", { count: "exact" })
        .order("created_at", { ascending: false });

      if (startDate) {
        query = query.gte("created_at", startDate);
      }
      if (endDate) {
        query = query.lte("created_at", `${endDate} 23:59:59`);
      }

      const { data, error, count } = await query.range(from, to);

      if (error) throw error;

      return {
        visitors: (data ?? []) as VisitorRow[],
        totalCount: count ?? null,
      };
    },
  });

  // stable reference
  const visitors = visitorsQuery.data?.visitors ?? EMPTY_VISITORS;
  const totalVisitors = visitorsQuery.data?.totalCount ?? null;

  const hasMoreVisitors =
    totalVisitors !== null && visitors.length < totalVisitors;

  // derived effective visitor id
  const effectiveVisitorId = useMemo(
    () => selectedVisitorId || visitorIdFromUrl || visitors[0]?.id || "",
    [selectedVisitorId, visitorIdFromUrl, visitors]
  );

  const visitorIds = useMemo(() => visitors.map((v) => v.id), [visitors]);
  const analysisVisitorIds = useMemo(() => {
    const set = new Set(visitorIds);
    if (effectiveVisitorId) set.add(effectiveVisitorId);
    return Array.from(set);
  }, [visitorIds, effectiveVisitorId]);

  const reviewRequestsQuery = useQuery({
    queryKey: ["analytics-review-requests", visitorIds],
    enabled: visitorIds.length > 0,
    queryFn: async (): Promise<ReviewRequestRow[]> => {
      const { data, error } = await supabase
        .from("chat_review_requests")
        .select(
          "id,visitor_id,session_id,requester_id,requester_email,requester_comment,status,reviewer_id,reviewer_email,reviewer_comment,created_at,reviewed_at"
        )
        .in("visitor_id", visitorIds)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as ReviewRequestRow[];
    },
  });

  const reviewRequestsByVisitor = useMemo(() => {
    const map = new Map<string, ReviewRequestRow>();
    (reviewRequestsQuery.data ?? []).forEach((row) => {
      if (!map.has(row.visitor_id)) {
        map.set(row.visitor_id, row);
      }
    });
    return map;
  }, [reviewRequestsQuery.data]);

  const analysesQuery = useQuery({
    queryKey: ["analytics-visitor-analyses", analysisVisitorIds],
    enabled: analysisVisitorIds.length > 0,
    queryFn: async (): Promise<VisitorAnalysisRow[]> => {
      const { data, error } = await supabase
        .from("chat_visitor_analyses")
        .select(
          "id,visitor_id,last_message_at,source,model,prompt_version,satisfaction_1_to_10,sentiment,improvement,summary,created_at"
        )
        .in("visitor_id", analysisVisitorIds)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as VisitorAnalysisRow[];
    },
  });

  const analysisByVisitor = useMemo(() => {
    const map = new Map<string, VisitorAnalysisRow>();
    (analysesQuery.data ?? []).forEach((row) => {
      if (!map.has(row.visitor_id)) {
        map.set(row.visitor_id, row);
      }
    });
    analysisOverrides.forEach((row, visitorId) => {
      map.set(visitorId, row);
    });
    return map;
  }, [analysesQuery.data, analysisOverrides]);

  // ---- Forms / booked tours per visitor (date-filtered by submitted_at) ----
  const bookTourFormsQuery = useQuery({
    queryKey: ["analytics-visitor-forms", visitorIds, startDate, endDate],
    enabled: visitorIds.length > 0,
    queryFn: async (): Promise<VisitorFormRow[]> => {
      const base = supabase
        .from("visitor_forms")
        .select("visitor_id,is_submitted,submitted_with_button,submitted_at")
        .in("visitor_id", visitorIds)
        .eq("form_type", "chat_bot_book_a_tour");

      let query = base;
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

  const bookTourRows = bookTourFormsQuery.data ?? EMPTY_FORMS;

  const bookTourStatsByVisitor = useMemo(() => {
    const map = new Map<string, BookATourStats>();

    for (const row of bookTourRows) {
      const vid = row.visitor_id;
      const cur = map.get(vid) ?? {
        submitted: false,
        totalSubmissions: 0,
        dynamicSubmissions: 0,
        lastSubmittedAt: null,
      };

      cur.totalSubmissions += 1;
      if (row.is_submitted) cur.submitted = true;
      if (row.submitted_with_button === "dynamic") cur.dynamicSubmissions += 1;

      const ts = row.submitted_at;
      if (ts && (!cur.lastSubmittedAt || ts > cur.lastSubmittedAt)) {
        cur.lastSubmittedAt = ts;
      }

      map.set(vid, cur);
    }

    return map;
  }, [bookTourRows]);

  // ---- Filter visitors list in UI (search + form filter only) ----
  const filteredVisitors = visitors.filter((v) => {
    const stats = bookTourStatsByVisitor.get(v.id);
    const isSubmitted = !!stats?.submitted;
    const review = reviewRequestsByVisitor.get(v.id);
    const isPending = review?.status === "pending";
    const isReviewed = review?.status === "reviewed";

    switch (filterOption) {
      case "submitted":
        return isSubmitted;
      case "not_submitted":
        return !isSubmitted;
      case "requested":
        return isPending;
      case "reviewed":
        return isReviewed;
      default:
        return true;
    }
  });

  // ---- Sessions for selected visitor (NOT date-filtered) ----
  const sessionsQuery = useQuery({
    queryKey: ["analytics-sessions", effectiveVisitorId],
    enabled: !!effectiveVisitorId,
    queryFn: async (): Promise<SessionRow[]> => {
      if (!effectiveVisitorId) return EMPTY_SESSIONS;

      const { data, error } = await supabase
        .from("chat_sessions")
        .select("id,visitor_id,created_at,page_url,residence_custom_id,lang")
        .eq("visitor_id", effectiveVisitorId)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      return (data ?? []) as SessionRow[];
    },
  });

  const sessions = sessionsQuery.data ?? EMPTY_SESSIONS;

  const filteredSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return sessions;

    return sessions.filter((s) => {
      return (
        s.id.toLowerCase().includes(q) ||
        (s.page_url ?? "").toLowerCase().includes(q) ||
        (s.residence_custom_id ?? "").toLowerCase().includes(q) ||
        (s.lang ?? "").toLowerCase().includes(q)
      );
    });
  }, [sessions, sessionSearch]);

  // derived effective session id
  const effectiveSessionId = useMemo(() => {
    if (!isBySession) return "";
    if (selectedSessionId) {
      const exists = filteredSessions.some((s) => s.id === selectedSessionId);
      if (exists) return selectedSessionId;
    }
    return filteredSessions[0]?.id || "";
  }, [isBySession, selectedSessionId, filteredSessions]);

  const { data: replay, isLoading: loadingReplay } = useReplay(
    supabase,
    effectiveSessionId
  );

  const { deleting: deletingVisitor, deleteVisitor } =
    useDeleteVisitor(supabase);

  const handleDeleteVisitor = async (visitorId: string) => {
    const res = await deleteVisitor(visitorId);
    if (!res.ok) return;

    if (res.visitorId === effectiveVisitorId) {
      setSelectedVisitorId("");
      setSelectedSessionId("");
    }

    setVisitorPage(0);
    await refreshAll();
  };

  const requestReview = async (visitorId: string, comment: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("You must be logged in to request a review.");
    }

    const { error } = await supabase.from("chat_review_requests").insert({
      visitor_id: visitorId,
      requester_id: user.id,
      requester_email: user.email ?? null,
      requester_comment: comment,
      status: "pending",
    });

    if (error) throw error;
    await reviewRequestsQuery.refetch();
  };

  const analyzeVisitor = async (
    visitorId: string
  ): Promise<ConversationAnalysis> => {
    setAnalysisError(null);
    setAnalysisLoadingVisitorId(visitorId);
    try {
      const res = await fetch("/api/analytics/satisfaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitor_id: visitorId }),
      });

      const contentType = res.headers.get("content-type") || "";
      const raw = await res.text();

      if (!res.ok) {
        throw new Error(
          `API ${res.status} ${res.statusText}. Body starts with: ${raw.slice(
            0,
            120
          )}`
        );
      }

      if (
        raw.trim().startsWith("<!DOCTYPE") ||
        contentType.includes("text/html")
      ) {
        throw new Error(
          `Expected JSON but got HTML. Check route path/middleware. Body starts with: ${raw.slice(
            0,
            120
          )}`
        );
      }

      let data: any;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(
          `Response was not valid JSON. Body starts with: ${raw.slice(0, 120)}`
        );
      }

      if (!data?.ok) throw new Error(data?.error || "Analysis failed");

      const analysis = data.analysis as ConversationAnalysis;
      const row = data.row as VisitorAnalysisRow | null;

      if (row) {
        setAnalysisOverrides((prev) => {
          const next = new Map(prev);
          next.set(visitorId, row);
          return next;
        });
      }

      await analysesQuery.refetch();
      return analysis;
    } catch (e: any) {
      setAnalysisError({
        visitorId,
        message: e?.message ?? "Failed to analyze",
      });
      throw e;
    } finally {
      setAnalysisLoadingVisitorId(null);
    }
  };

  // Full replay query (NOT date-filtered)
  const fullReplayQuery = useQuery({
    queryKey: ["analytics-full-replay", effectiveVisitorId],
    enabled: !!effectiveVisitorId && !isBySession,
    queryFn: async (): Promise<{
      sessions: SessionRow[];
      messages: MessageRow[];
      sourcesByMsg: Map<number, SourceRow[]>;
    } | null> => {
      if (!effectiveVisitorId) return null;

      const { data: sess, error: sessErr } = await supabase
        .from("chat_sessions")
        .select("id,visitor_id,created_at,page_url,residence_custom_id,lang")
        .eq("visitor_id", effectiveVisitorId)
        .order("created_at", { ascending: false })
        .limit(5000);

      if (sessErr) throw sessErr;

      const sessionIds = (sess ?? []).map((s) => s.id);

      const { data: msgsRaw, error: msgErr } = sessionIds.length
        ? await supabase
            .from("chat_messages")
            .select("id,session_id,visitor_id,role,content,created_at")
            .in("session_id", sessionIds)
            .eq("visitor_id", effectiveVisitorId)
            .order("created_at", { ascending: true })
        : { data: [] as MessageRow[], error: null as unknown };

      if (msgErr) throw msgErr;

      const msgs = (msgsRaw ?? []) as MessageRow[];

      const assistantIds = msgs
        .filter((m) => m.role === "assistant")
        .map((m) => m.id);

      const { data: rawSources, error: sourcesErr } = assistantIds.length
        ? await supabase
            .from("chat_message_sources")
            .select(
              "id,assistant_message_id,document_section_id,rank,score,source_type,snippet_used,created_at"
            )
            .in("assistant_message_id", assistantIds)
            .order("rank", { ascending: true })
        : { data: [] as SourceRow[], error: null as unknown };

      if (sourcesErr) throw sourcesErr;

      const sources = (rawSources ?? []) as SourceRow[];

      // doc_name enrichment
      if (sources.length) {
        const sectionIds = Array.from(
          new Set(
            sources
              .map((s) => s.document_section_id)
              .filter((x): x is number => typeof x === "number")
          )
        );

        if (sectionIds.length) {
          const { data: secRowsRaw, error: secErr } = await supabase
            .from("document_sections")
            .select("id,document_id")
            .in("id", sectionIds)
            .limit(5000);

          if (secErr) throw secErr;

          const secRows = (secRowsRaw ?? []) as DocumentSectionRow[];

          const sectionToDoc = new Map<number, number>();
          secRows.forEach((row) => sectionToDoc.set(row.id, row.document_id));

          const docIds = Array.from(new Set(secRows.map((r) => r.document_id)));

          const docMap = new Map<number, string>();
          if (docIds.length) {
            const { data: docRowsRaw, error: docErr } = await supabase
              .from("documents")
              .select("id,name")
              .in("id", docIds)
              .limit(5000);

            if (docErr) throw docErr;

            const docRows = (docRowsRaw ?? []) as DocumentRow[];
            docRows.forEach((d) => docMap.set(d.id, d.name));
          }

          sources.forEach((s) => {
            const docId = sectionToDoc.get(s.document_section_id);
            s.doc_name = docId
              ? docMap.get(docId) ?? "Unknown doc"
              : "Unknown doc";
          });
        }
      }

      const sourcesByMsg = new Map<number, SourceRow[]>();
      sources.forEach((s) => {
        const arr = sourcesByMsg.get(s.assistant_message_id) ?? [];
        arr.push(s);
        sourcesByMsg.set(s.assistant_message_id, arr);
      });

      return {
        sessions: (sess ?? []) as SessionRow[],
        messages: msgs,
        sourcesByMsg,
      };
    },
  });

  const refreshAll = async () => {
    await Promise.all([
      visitorsQuery.refetch(),
      sessionsQuery.refetch(),
      reviewRequestsQuery.refetch(),
      analysesQuery.refetch(),
    ]);
  };

  const replayData = isBySession ? replay : fullReplayQuery.data;
  const replayLoading = isBySession ? loadingReplay : fullReplayQuery.isLoading;

  // Toggle handlers that avoid effects
  const setModeBySession = () => setIsBySession(true);
  const setModeFullConversation = () => setIsBySession(false);

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Chat Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Browse visitors, sessions, and conversation replays.
          </p>
        </div>

        <div className="flex items-end gap-2 flex-wrap">
          <Button variant="outline" className="gap-2" onClick={refreshAll}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <AnalyticsReplaySection
        isBySession={isBySession}
        setModeBySession={setModeBySession}
        setModeFullConversation={setModeFullConversation}
        loadingVisitors={visitorsQuery.isLoading}
        startDate={startDate}
        endDate={endDate}
        setStartDate={setStartDate}
        setEndDate={setEndDate}
        selectedVisitorId={effectiveVisitorId}
        setSelectedVisitorId={(id) => {
          setSelectedVisitorId(id);
          setSelectedSessionId("");
        }}
        hasMoreVisitors={hasMoreVisitors}
        isAdmin={isAdmin}
        filteredVisitors={filteredVisitors}
        deleteVisitor={handleDeleteVisitor}
        setVisitorPage={setVisitorPage}
        deleting={deletingVisitor}
        filterOption={filterOption}
        setFilterOption={setFilterOption}
        bookTourStatsByVisitor={bookTourStatsByVisitor}
        reviewRequestsByVisitor={reviewRequestsByVisitor}
        onRequestReview={requestReview}
        analysisByVisitor={analysisByVisitor}
        analysisLoadingVisitorId={analysisLoadingVisitorId}
        analysisError={analysisError}
        onAnalyzeVisitor={analyzeVisitor}
        sessions={sessions}
        filteredSessions={filteredSessions}
        selectedSessionId={effectiveSessionId}
        setSelectedSessionId={setSelectedSessionId}
        sessionSearch={sessionSearch}
        setSessionSearch={setSessionSearch}
        loadingSessions={sessionsQuery.isLoading}
        loadingReplay={replayLoading}
        replay={replayData}
      />
    </div>
  );
}
