"use client";

import { useMemo, useState } from "react";
import { createClient } from "../utils/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { RefreshCcw } from "lucide-react";
import { VisitorsSessions } from "./sections/VisitorsSection";
import { SessionsSection } from "./sections/SessionsSections";
import { ConversationSection } from "./sections/ConversationSection";
import { BotBookedToursSection } from "./sections/BotBookedToursSection";

import { SessionRow, VisitorRow, SourceRow, MessageRow } from "../types/types";
import { Card } from "@/components/ui/card";
import { useReplay } from "../hooks/useReplay";
import { useDeleteVisitor } from "../hooks/useDeleteVisitor";
// import { DateRangePicker } from "./sections/DateRangePicker";

type FormFilter = "all" | "submitted" | "not_submitted";

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

const EMPTY_VISITORS: VisitorRow[] = [];
const EMPTY_SESSIONS: SessionRow[] = [];
const EMPTY_FORMS: VisitorFormRow[] = [];

export default function ChatAnalyticsPage() {
  const supabase = createClient();

  // Pagination for visitors
  const PAGE_SIZE = 50;
  const [visitorPage, setVisitorPage] = useState(0);

  // Explicit selections (user-made). We’ll derive “effective” selections below.
  const [selectedVisitorId, setSelectedVisitorId] = useState<string>("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");

  // Search
  // const [visitorSearch, setVisitorSearch] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");

  const [formFilter, setFormFilter] = useState<FormFilter>("all");

  // Toggle conversation mode
  const [isBySession, setIsBySession] = useState(true);

  // Date range filter (used to pull visitors + forms from DB)
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // ⭐ NEW: independent date range for "Booked Tours by Date"
  const [bookedStart, setBookedStart] = useState<string>("");
  const [bookedEnd, setBookedEnd] = useState<string>("");

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
        .select("id,created_at", { count: "exact" }) // 👈 ask Supabase for total count
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

  // ✅ stable reference
  const visitors = visitorsQuery.data?.visitors ?? EMPTY_VISITORS;
  const totalVisitors = visitorsQuery.data?.totalCount ?? null;

  const hasMoreVisitors =
    totalVisitors !== null && visitors.length < totalVisitors;

  // ✅ derived “effective” visitor id
  const effectiveVisitorId = useMemo(
    () => selectedVisitorId || visitors[0]?.id || "",
    [selectedVisitorId, visitors]
  );

  const visitorIds = useMemo(() => visitors.map((v) => v.id), [visitors]);

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
    // const q = visitorSearch.trim().toLowerCase();

    // search by visitor id
    // if (q && !v.id.toLowerCase().includes(q)) return false;

    // submission filter
    const stats = bookTourStatsByVisitor.get(v.id);
    const isSubmitted = !!stats?.submitted;

    if (formFilter === "submitted") return isSubmitted;
    if (formFilter === "not_submitted") return !isSubmitted;

    return true;
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

  // ✅ derived “effective” session id
  const effectiveSessionId = useMemo(() => {
    if (!isBySession) return "";
    return selectedSessionId || filteredSessions[0]?.id || "";
  }, [isBySession, selectedSessionId, filteredSessions]);

  const { data: replay, isLoading: loadingReplay } = useReplay(
    supabase,
    effectiveSessionId
  );

  const { deleting: deletingVisitor, deleteVisitor } =
    useDeleteVisitor(supabase);

  // ⭐ NEW: Booked tours across ALL visitors by date (independent from visitorsQuery)
  const bookedToursByDateQuery = useQuery({
    queryKey: ["booked-tours-by-date", bookedStart, bookedEnd],
    queryFn: async (): Promise<VisitorFormRow[]> => {
      let query = supabase
        .from("visitor_forms")
        .select("visitor_id,is_submitted,submitted_with_button,submitted_at")
        .eq("form_type", "chat_bot_book_a_tour")
        .eq("is_submitted", true); // only real submissions

      if (bookedStart) {
        query = query.gte("submitted_at", bookedStart);
      }
      if (bookedEnd) {
        query = query.lte("submitted_at", `${bookedEnd} 23:59:59`);
      }

      const { data, error } = await query;

      if (error) throw error;
      return (data ?? []) as VisitorFormRow[];
    },
  });

  // ⭐ NEW: aggregations for booked tours by date
  const bookedByDateStats = useMemo(() => {
    const rows = bookedToursByDateQuery.data ?? [];

    let total = 0;
    let dynamic = 0;
    const byDay: Record<string, number> = {};

    for (const r of rows) {
      if (!r.submitted_at) continue;
      const day = r.submitted_at.slice(0, 10); // yyyy-mm-dd
      byDay[day] = (byDay[day] ?? 0) + 1;
      total++;
      if (r.submitted_with_button === "dynamic") dynamic++;
    }

    return { total, dynamic, byDay };
  }, [bookedToursByDateQuery.data]);

  const refreshAll = async () => {
    await Promise.all([
      visitorsQuery.refetch(),
      sessionsQuery.refetch(),
      bookTourFormsQuery.refetch(),
      bookedToursByDateQuery.refetch(), // ⭐ NEW: refresh booked-tours-by-date
    ]);
  };

  // const visitorOptions = useMemo(() => visitors.map((v) => v.id), [visitors]);

  // ---- Full replay query (NOT date-filtered) ----
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

  const bookTourTotals = useMemo(() => {
    const submittedRows = bookTourRows.filter((r) => r.is_submitted === true);
    const totalSubmitted = submittedRows.length;
    const dynamicSubmitted = submittedRows.filter(
      (r) => r.submitted_with_button === "dynamic"
    ).length;

    return { totalSubmitted, dynamicSubmitted };
  }, [bookTourRows]);

  // ✅ Toggle handlers that avoid effects
  const setModeBySession = () => setIsBySession(true);
  const setModeFullConversation = () => setIsBySession(false);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Chat Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Pick a visitor to see sessions and replay conversations with
            sources.
          </p>
        </div>

        <div className="flex items-end gap-2 flex-wrap">
          {/* Main date range for visitors + per-visitor forms */}
         

          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={refreshAll}>
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div
        className={`grid grid-cols-1 gap-4 ${
          isBySession
            ? "lg:grid-cols-[380px_420px_1fr]"
            : "lg:grid-cols-[380px_220px_1fr]"
        } ease-in-out duration-300`}
      >
        <VisitorsSessions
          loadingVisitors={visitorsQuery.isLoading}
          startDate={startDate}
          endDate={endDate}
          setStartDate={setStartDate}
          setEndDate={setEndDate}
          // effectiveVisitorId to
          // show effective selection in UI
          selectedVisitorId={effectiveVisitorId}
          // store explicit user choice
          setSelectedVisitorId={(id) => {
            setSelectedVisitorId(id);
            setSelectedSessionId("");
          }}
          hasMoreVisitors={hasMoreVisitors}
          // visitorOptions={visitorOptions}
          // visitorSearch={visitorSearch}
          // setVisitorSearch={setVisitorSearch}
          filteredVisitors={filteredVisitors}
          deleteVisitor={deleteVisitor}
          // setSelectedSessionId={setSelectedSessionId}
          // visitors={visitors}
          setVisitorPage={setVisitorPage}
          deleting={deletingVisitor}
          formFilter={formFilter}
          setFormFilter={setFormFilter}
          bookTourStatsByVisitor={bookTourStatsByVisitor}
        />

        <SessionsSection
          isBySession={isBySession}
          sessions={sessions}
          filteredSessions={filteredSessions}
          selectedVisitorId={effectiveVisitorId}
          selectedSessionId={effectiveSessionId}
          setSelectedSessionId={setSelectedSessionId}
          sessionSearch={sessionSearch}
          setSessionSearch={setSessionSearch}
          loadingSessions={sessionsQuery.isLoading}
        />

        <Card className="h-[75vh] flex flex-col overflow-hidden">
          <div className="p-2 border-b flex items-center justify-between">
            <div className="text-sm font-semibold">Conversation</div>

            <div className="inline-flex rounded-lg border bg-muted/30 p-1 gap-2">
              <Button
                size="sm"
                variant={isBySession ? "default" : "ghost"}
                className="h-8"
                onClick={setModeBySession}
              >
                By session
              </Button>
              <Button
                size="sm"
                variant={!isBySession ? "default" : "ghost"}
                className="h-8"
                onClick={setModeFullConversation}
              >
                Full conversation
              </Button>
            </div>
          </div>

          <ConversationSection
            selectedSessionId={effectiveSessionId}
            isBySession={isBySession}
            loadingReplay={
              isBySession ? loadingReplay : fullReplayQuery.isLoading
            }
            replay={isBySession ? replay : fullReplayQuery.data}
            setSelectedSessionId={setSelectedSessionId}
            filteredSessions={filteredSessions}
            selectedVisitorId={effectiveVisitorId}
          />
        </Card>

        <BotBookedToursSection
          loading={bookTourFormsQuery.isLoading}
          stats={{
            total: bookTourTotals.totalSubmitted,
            dynamic: bookTourTotals.dynamicSubmitted,
          }}
          bookedEnd={bookedEnd}
          bookedStart={bookedStart}
          setBookedEnd={setBookedEnd}
          setBookedStart={setBookedStart}
          title="Book a Tour: Loaded visitors"
        />

        <BotBookedToursSection
          loading={bookedToursByDateQuery.isLoading}
          stats={{
            total: bookedByDateStats.total,
            dynamic: bookedByDateStats.dynamic,
          }}
          bookedEnd={bookedEnd}
          bookedStart={bookedStart}
          setBookedEnd={setBookedEnd}
          setBookedStart={setBookedStart}
          showDatePicker={true}
          title="Booked Tours by Date"
        />
        {/* </Card> */}

        {/* <BotBookedToursSection
          loadingBookTourRows={bookTourFormsQuery.isLoading}
          bookTourTotals={bookTourTotals}
        /> */}
      </div>
    </div>
  );
}
