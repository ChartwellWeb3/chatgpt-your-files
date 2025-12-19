"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../utils/supabase/client";
import { useQuery } from "@tanstack/react-query";
// import type { Database } from "../../../supabase/functions/_lib/database";
import { Button } from "@/components/ui/button";
import { RefreshCcw } from "lucide-react";
import { VisitorsSessions } from "./sections/VisitorsSection";
import { SessionsSection } from "./sections/SessionsSections";
import { ConversationSection } from "./sections/ConversationSection";
import { BotBookedToursSection } from "./sections/BotBookedToursSection";

import { SessionRow, VisitorRow } from "../types/types";
import { Card } from "@/components/ui/card";
import { useReplay } from "../hooks/useReplay";
import { useDeleteVisitor } from "../hooks/useDeleteVisitor";
import { SourceRow, MessageRow } from "../types/types";

export default function ChatAnalyticsPage() {
  const supabase = createClient();

  // Pagination for visitors
  const PAGE_SIZE = 50;
  const [visitorPage, setVisitorPage] = useState(0);

  // Selection
  const [selectedVisitorId, setSelectedVisitorId] = useState<string>("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");

  // Search
  const [visitorSearch, setVisitorSearch] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");

  type FormFilter = "all" | "submitted" | "not_submitted";
  const [formFilter, setFormFilter] = useState<FormFilter>("all");

  // User chat by sessions or entire conversation

  const [isBySession, setIsBySession] = useState(true);

  const { data: replay, isLoading: loadingReplay } = useReplay(
    supabase,
    selectedSessionId
  );

  const { deleting: deletingVisitor, deleteVisitor } =
    useDeleteVisitor(supabase);
  // ---- Visitors (load more) ----
  const {
    data: visitorsData,
    isLoading: loadingVisitors,
    refetch: refetchVisitors,
  } = useQuery<VisitorRow[]>({
    queryKey: ["analytics-visitors", visitorPage],
    queryFn: async () => {
      const from = 0;
      const to = visitorPage * PAGE_SIZE + (PAGE_SIZE - 1);

      const { data, error } = await supabase
        .from("visitors")
        .select("id,created_at")
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;
      return (data ?? []) as VisitorRow[];
    },
  });

  const visitors = visitorsData ?? [];

  const visitorIds = useMemo(() => visitors.map((v) => v.id), [visitors]);

  type BookATourStats = {
    submitted: boolean; // at least one submitted row exists
    totalSubmissions: number; // count of rows (each insert = new submission)
    dynamicSubmissions: number; // submitted_with_button === "dynamic"
    lastSubmittedAt?: string | null;
  };

  const { data: bookTourRows, isLoading: loadingBookTourRows } = useQuery({
    queryKey: ["analytics-visitor-forms", visitorIds],
    enabled: visitorIds.length > 0,
    queryFn: async () => {
      // Pull only what you need for analytics
      const { data, error } = await supabase
        .from("visitor_forms")
        .select("visitor_id,is_submitted,submitted_with_button,submitted_at")
        .in("visitor_id", visitorIds)
        .eq("form_type", "chat_bot_book_a_tour"); //  target type

      if (error) throw error;
      return data ?? [];
    },
  });

  // Build a map: visitor_id -> stats
  const bookTourStatsByVisitor = useMemo(() => {
    const map = new Map<string, BookATourStats>();

    for (const row of bookTourRows ?? []) {
      const vid = row.visitor_id as string;
      const cur = map.get(vid) ?? {
        submitted: false,
        totalSubmissions: 0,
        dynamicSubmissions: 0,
        lastSubmittedAt: null,
      };

      // Each row = one submission attempt/event (your new requirement)
      cur.totalSubmissions += 1;

      if (row.is_submitted) cur.submitted = true;
      if (row.submitted_with_button === "dynamic") cur.dynamicSubmissions += 1;

      // last submitted_at
      const ts = row.submitted_at as string | null;
      if (ts && (!cur.lastSubmittedAt || ts > cur.lastSubmittedAt)) {
        cur.lastSubmittedAt = ts;
      }

      map.set(vid, cur);
    }

    return map;
  }, [bookTourRows]);

  // Filter visitors list in UI
  const filteredVisitors = useMemo(() => {
    const q = visitorSearch.trim().toLowerCase();

    return visitors.filter((v) => {
      // search filter (same as before)
      if (q && !v.id.toLowerCase().includes(q)) return false;

      // form filter for ONLY chat_bot_book_a_tour
      const stats = bookTourStatsByVisitor.get(v.id);
      const isSubmitted = !!stats?.submitted;

      if (formFilter === "submitted") return isSubmitted;
      if (formFilter === "not_submitted") return !isSubmitted;
      return true; // "all"
    });
  }, [visitors, visitorSearch, formFilter, bookTourStatsByVisitor]);

  // Ensure selection stays valid
  useEffect(() => {
    if (!selectedVisitorId && visitors.length > 0) {
      setSelectedVisitorId(visitors[0].id);
    }
  }, [visitors, selectedVisitorId]);

  // ---- Sessions for selected visitor ----
  const {
    data: sessions,
    isLoading: loadingSessions,
    refetch: refetchSessions,
  } = useQuery<SessionRow[]>({
    queryKey: ["analytics-sessions", selectedVisitorId],
    queryFn: async () => {
      if (!selectedVisitorId) return [];
      const { data, error } = await supabase
        .from("chat_sessions")
        .select("id,visitor_id,created_at,page_url,residence_custom_id,lang")
        .eq("visitor_id", selectedVisitorId)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      return (data ?? []) as SessionRow[];
    },
    enabled: !!selectedVisitorId,
  });

  const filteredSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return sessions ?? [];
    return (sessions ?? []).filter((s) => {
      return (
        s.id.toLowerCase().includes(q) ||
        (s.page_url ?? "").toLowerCase().includes(q) ||
        (s.residence_custom_id ?? "").toLowerCase().includes(q) ||
        (s.lang ?? "").toLowerCase().includes(q)
      );
    });
  }, [sessions, sessionSearch]);

  useEffect(() => {
    // If visitor changes, clear session selection
    setSelectedSessionId("");
  }, [selectedVisitorId]);

  // ---- Replay (messages + sources enrichment) ----
  // const { data: replay, isLoading: loadingReplay } = useQuery({
  //   queryKey: ["analytics-replay", selectedSessionId],
  //   queryFn: async () => {
  //     if (!selectedSessionId) return null;

  //     const { data: msgs, error: msgErr } = await supabase
  //       .from("chat_messages")
  //       .select("id,session_id,visitor_id,role,content,created_at")
  //       .eq("session_id", selectedSessionId)
  //       .order("created_at", { ascending: true });

  //     if (msgErr) throw msgErr;

  //     const assistantIds = (msgs ?? [])
  //       .filter((m: any) => m.role === "assistant")
  //       .map((m: any) => m.id);

  //     const sourcesRes = assistantIds.length
  //       ? await supabase
  //           .from("chat_message_sources")
  //           .select(
  //             "id,assistant_message_id,document_section_id,rank,score,source_type,snippet_used,created_at"
  //           )
  //           .in("assistant_message_id", assistantIds)
  //           .order("rank", { ascending: true })
  //       : { data: [] as any[], error: null as any };

  //     if (sourcesRes.error) throw sourcesRes.error;

  //     // Enrich sources with doc names (document_sections -> documents)
  //     const sources = (sourcesRes.data ?? []) as SourceRow[];
  //     const sectionIds = Array.from(
  //       new Set(sources.map((s) => s.document_section_id))
  //     );

  //     const sectionToDoc = new Map<number, number>();
  //     const docMap = new Map<number, string>();

  //     if (sectionIds.length) {
  //       const secRes = await supabase
  //         .from("document_sections")
  //         .select("id,document_id")
  //         .in("id", sectionIds)
  //         .limit(5000);

  //       if (secRes.error) throw secRes.error;

  //       (secRes.data ?? []).forEach((row: any) => {
  //         sectionToDoc.set(row.id, row.document_id);
  //       });

  //       const docIds = Array.from(
  //         new Set((secRes.data ?? []).map((r: any) => r.document_id))
  //       );

  //       if (docIds.length) {
  //         const docsRes = await supabase
  //           .from("documents")
  //           .select("id,name")
  //           .in("id", docIds)
  //           .limit(5000);

  //         if (docsRes.error) throw docsRes.error;
  //         (docsRes.data ?? []).forEach((d: any) => docMap.set(d.id, d.name));
  //       }

  //       sources.forEach((s) => {
  //         const docId = sectionToDoc.get(s.document_section_id);
  //         s.doc_name = docId
  //           ? docMap.get(docId) ?? "Unknown doc"
  //           : "Unknown doc";
  //       });
  //     }

  //     const sourcesByMsg = new Map<number, SourceRow[]>();
  //     sources.forEach((s) => {
  //       const arr = sourcesByMsg.get(s.assistant_message_id) ?? [];
  //       arr.push(s);
  //       sourcesByMsg.set(s.assistant_message_id, arr);
  //     });

  //     return {
  //       messages: (msgs ?? []) as MessageRow[],
  //       sourcesByMsg,
  //     };
  //   },
  //   enabled: !!selectedSessionId,
  // });

  const refreshAll = async () => {
    await Promise.all([refetchVisitors(), refetchSessions()]);
  };

  useEffect(() => {
    if (!isBySession) setSelectedSessionId("");
  }, [isBySession]);

  const visitorOptions = visitors.map((v) => v.id);

  const { data: fullReplay, isLoading: loadingFullReplay } = useQuery({
    queryKey: ["analytics-full-replay", selectedVisitorId],
    enabled: !!selectedVisitorId && !isBySession,
    queryFn: async () => {
      if (!selectedVisitorId) return null;

      // 1) sessions for visitor
      const { data: sess, error: sessErr } = await supabase
        .from("chat_sessions")
        .select("id,visitor_id,created_at,page_url,residence_custom_id,lang")
        .eq("visitor_id", selectedVisitorId)
        .order("created_at", { ascending: false })
        .limit(5000);

      if (sessErr) throw sessErr;

      const sessionIds = (sess ?? []).map((s) => s.id);

      // 2) messages for ALL sessions of this visitor
      // (use visitor_id filter to be safe; session_id filter to keep it scoped)
      const { data: msgs, error: msgErr } = sessionIds.length
        ? await supabase
            .from("chat_messages")
            .select("id,session_id,visitor_id,role,content,created_at")
            .in("session_id", sessionIds)
            .eq("visitor_id", selectedVisitorId)
            .order("created_at", { ascending: true })
        : { data: [] as any[], error: null as any };

      if (msgErr) throw msgErr;

      // 3) sources for assistant messages (with doc_name enrichment)
      const assistantIds = (msgs ?? [])
        .filter((m: any) => m.role === "assistant")
        .map((m: any) => m.id);

      const { data: rawSources, error: sourcesErr } = assistantIds.length
        ? await supabase
            .from("chat_message_sources")
            .select(
              "id,assistant_message_id,document_section_id,rank,score,source_type,snippet_used,created_at"
            )
            .in("assistant_message_id", assistantIds)
            .order("rank", { ascending: true })
        : { data: [] as any[], error: null as any };

      if (sourcesErr) throw sourcesErr;

      const sources = (rawSources ?? []) as SourceRow[];

      // 4) doc_name enrichment (document_sections -> documents)
      if (sources.length) {
        const sectionIds = Array.from(
          new Set(
            sources
              .map((s) => s.document_section_id)
              .filter((x): x is number => typeof x === "number")
          )
        );

        console.log(sources, "sources");
        

        if (sectionIds.length) {
          const { data: secRows, error: secErr } = await supabase
            .from("document_sections")
            .select("id,document_id")
            .in("id", sectionIds)
            .limit(5000);

          if (secErr) throw secErr;

          const sectionToDoc = new Map<number, number>();
          (secRows ?? []).forEach((row: any) =>
            sectionToDoc.set(row.id, row.document_id)
          );

          const docIds = Array.from(
            new Set(
              (secRows ?? []).map((r: any) => r.document_id).filter(Boolean)
            )
          );

          const docMap = new Map<number, string>();
          if (docIds.length) {
            const { data: docRows, error: docErr } = await supabase
              .from("documents")
              .select("id,name")
              .in("id", docIds)
              .limit(5000);

            if (docErr) throw docErr;

            (docRows ?? []).forEach((d: any) => docMap.set(d.id, d.name));
            console.log(docRows, "docRows");
            
          }

          sources.forEach((s) => {
            const docId = sectionToDoc.get(s.document_section_id);
            s.doc_name = docId
              ? docMap.get(docId) ?? "Unknown doc"
              : "Unknown doc";
          });
        }
      }

      // 5) group sources by assistant message
      const sourcesByMsg = new Map<number, SourceRow[]>();
      sources.forEach((s) => {
        const arr = sourcesByMsg.get(s.assistant_message_id) ?? [];
        arr.push(s);
        sourcesByMsg.set(s.assistant_message_id, arr);
      });

      return {
        sessions: (sess ?? []) as SessionRow[],
        messages: (msgs ?? []) as MessageRow[],
        sourcesByMsg,
      };
    },
  });

  const bookTourTotals = useMemo(() => {
    const rows = bookTourRows ?? [];

    const submittedRows = rows.filter((r) => r.is_submitted === true);

    const totalSubmitted = submittedRows.length;

    const dynamicSubmitted = submittedRows.filter(
      (r) => r.submitted_with_button === "dynamic"
    ).length;

    return { totalSubmitted, dynamicSubmitted };
  }, [bookTourRows]);

  console.log("test,", fullReplay);
  
  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Chat Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Pick a visitor to see sessions and replay conversations with
            sources.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={refreshAll}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div
        className={`grid grid-cols-1  gap-4 ${
          isBySession
            ? "lg:grid-cols-[380px_420px_1fr]"
            : "lg:grid-cols-[380px_220px_1fr]"
        } ease-in-out duration-300`}
      >
        {/* ---------------- Visitors ---------------- */}
        <VisitorsSessions
          loadingVisitors={loadingVisitors}
          selectedVisitorId={selectedVisitorId}
          setSelectedVisitorId={setSelectedVisitorId}
          visitorOptions={visitorOptions}
          visitorSearch={visitorSearch}
          setVisitorSearch={setVisitorSearch}
          filteredVisitors={filteredVisitors}
          deleteVisitor={deleteVisitor}
          setSelectedSessionId={setSelectedSessionId}
          visitors={visitors}
          setVisitorPage={setVisitorPage}
          deleting={deletingVisitor}
          formFilter={formFilter}
          setFormFilter={setFormFilter}
          bookTourStatsByVisitor={bookTourStatsByVisitor}
        />
        {/* ---------------- Sessions ---------------- */}
        <SessionsSection
          isBySession={isBySession}
          sessions={sessions}
          filteredSessions={filteredSessions}
          selectedVisitorId={selectedVisitorId}
          selectedSessionId={selectedSessionId}
          setSelectedSessionId={setSelectedSessionId}
          sessionSearch={sessionSearch}
          setSessionSearch={setSessionSearch}
          loadingSessions={loadingSessions}
        />

        {/* ---------------- Conversation ---------------- */}

        <Card className="h-[75vh] flex flex-col overflow-hidden">
          {/* header */}
          <div className="p-2 border-b flex items-center justify-between">
            <div className="text-sm font-semibold">Conversation</div>

            <div className="inline-flex rounded-lg border bg-muted/30 p-1 gap-2">
              <Button
                size="sm"
                variant={isBySession ? "default" : "ghost"}
                className="h-8"
                onClick={() => setIsBySession(true)}
              >
                By session
              </Button>
              <Button
                size="sm"
                variant={!isBySession ? "default" : "ghost"}
                className="h-8"
                onClick={() => setIsBySession(false)}
              >
                Full conversation
              </Button>
            </div>
          </div>
          <ConversationSection
            selectedSessionId={selectedSessionId}
            isBySession={isBySession}
            loadingReplay={isBySession ? loadingReplay : loadingFullReplay}
            replay={isBySession ? replay : fullReplay}
            setSelectedSessionId={setSelectedSessionId}
            filteredSessions={filteredSessions}
            selectedVisitorId={selectedVisitorId}
          />
        </Card>

        <BotBookedToursSection
          loadingBookTourRows={loadingBookTourRows}
          bookTourTotals={bookTourTotals}
        />
      </div>
    </div>
  );
}
