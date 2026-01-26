"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "../../utils/supabase/client";
import { useProfileLevel } from "../../hooks/useProfileLevel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/app/helpers/fmtDate";
import { Textarea } from "@/components/ui/textarea";
import { useReplay } from "../../hooks/useReplay";
import { SessionsSection } from "../sections/SessionsSections";
import { ConversationSection } from "../sections/ConversationSection";
import type { MessageRow, SessionRow, SourceRow } from "@/app/types/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

type ReviewFilter = "all" | "pending" | "reviewed";

type DocumentSectionRow = { id: number; document_id: number };
type DocumentRow = { id: number; name: string };

export default function ChatAnalyticsReviewsPage() {
  const supabase = createClient();
  const { isAdmin } = useProfileLevel();
  const searchParams = useSearchParams();
  const requestIdParam = searchParams.get("request_id");
  const requestId = requestIdParam ? Number(requestIdParam) : null;
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<ReviewFilter>("all");

  const requestsQuery = useQuery({
    queryKey: ["analytics-review-requests-all", page],
    queryFn: async (): Promise<{
      rows: ReviewRequestRow[];
      totalCount: number | null;
    }> => {
      const from = 0;
      const to = page * PAGE_SIZE + (PAGE_SIZE - 1);

      const { data, error, count } = await supabase
        .from("chat_review_requests")
        .select(
          "id,visitor_id,session_id,requester_id,requester_email,requester_comment,status,reviewer_id,reviewer_email,reviewer_comment,created_at,reviewed_at",
          { count: "exact" }
        )
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;
      return {
        rows: (data ?? []) as ReviewRequestRow[],
        totalCount: count ?? null,
      };
    },
  });

  const requests = useMemo(
    () => requestsQuery.data?.rows ?? [],
    [requestsQuery.data]
  );
  const filteredRequests = useMemo(() => {
    if (filter === "all") return requests;
    if (filter === "pending") {
      return requests.filter((row) => row.status !== "reviewed");
    }
    return requests.filter((row) => row.status === "reviewed");
  }, [requests, filter]);
  const totalCount = requestsQuery.data?.totalCount ?? null;
  const hasMore =
    totalCount !== null &&
    requests.length < totalCount;

  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(
    null
  );
  const effectiveRequestId =
    selectedRequestId ?? (requestId && !Number.isNaN(requestId) ? requestId : null) ?? requests[0]?.id ?? null;
  const selectedRequest = requests.find((r) => r.id === effectiveRequestId) ?? null;
  const selectedVisitorId = selectedRequest?.visitor_id ?? "";

  const [sessionSearch, setSessionSearch] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [isBySession, setIsBySession] = useState(true);

  const sessionsQuery = useQuery({
    queryKey: ["analytics-review-sessions", selectedVisitorId],
    enabled: !!selectedVisitorId,
    queryFn: async (): Promise<SessionRow[]> => {
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
  });

  const sessions = sessionsQuery.data ?? [];
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

  const fullReplayQuery = useQuery({
    queryKey: ["analytics-review-full-replay", selectedVisitorId],
    enabled: !!selectedVisitorId && !isBySession,
    queryFn: async (): Promise<{
      sessions: SessionRow[];
      messages: MessageRow[];
      sourcesByMsg: Map<number, SourceRow[]>;
    } | null> => {
      if (!selectedVisitorId) return null;

      const { data: sess, error: sessErr } = await supabase
        .from("chat_sessions")
        .select("id,visitor_id,created_at,page_url,residence_custom_id,lang")
        .eq("visitor_id", selectedVisitorId)
        .order("created_at", { ascending: false })
        .limit(5000);

      if (sessErr) throw sessErr;

      const sessionIds = (sess ?? []).map((s) => s.id);

      const { data: msgsRaw, error: msgErr } = sessionIds.length
        ? await supabase
            .from("chat_messages")
            .select("id,session_id,visitor_id,role,content,created_at")
            .in("session_id", sessionIds)
            .eq("visitor_id", selectedVisitorId)
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

          const docIds = Array.from(
            new Set(secRows.map((r) => r.document_id))
          );

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

  const replayData = isBySession ? replay : fullReplayQuery.data;
  const replayLoading = isBySession ? loadingReplay : fullReplayQuery.isLoading;

  const [reviewOpen, setReviewOpen] = useState(false);
  const [selected, setSelected] = useState<ReviewRequestRow | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const openReviewModal = (row: ReviewRequestRow) => {
    setSelected(row);
    setReviewComment(row.reviewer_comment ?? "");
    setReviewError(null);
    setReviewOpen(true);
  };

  const submitReview = async () => {
    if (!selected) return;
    const comment = reviewComment.trim();
    if (!comment) {
      setReviewError("Please add a reviewer comment.");
      return;
    }
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be logged in.");

      const { error } = await supabase
        .from("chat_review_requests")
        .update({
          status: "reviewed",
          reviewer_id: user.id,
          reviewer_email: user.email ?? null,
          reviewer_comment: comment,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", selected.id);

      if (error) throw error;
      setReviewOpen(false);
      await requestsQuery.refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Update failed.";
      setReviewError(message);
    } finally {
      setReviewSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <AlertDialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as reviewed</AlertDialogTitle>
            <AlertDialogDescription>
              Add your reviewer comment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Reviewer comment..."
            value={reviewComment}
            onChange={(e) => setReviewComment(e.target.value)}
            rows={4}
          />
          {reviewError ? (
            <div className="text-sm text-destructive">{reviewError}</div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reviewSubmitting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void submitReview();
              }}
              disabled={reviewSubmitting}
            >
              {reviewSubmitting ? "Saving..." : "Mark reviewed"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div>
        <h1 className="text-2xl font-semibold">Review Requests</h1>
        <p className="text-sm text-muted-foreground">
          All review requests across visitors.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Requests</div>
            <div className="inline-flex rounded-md border border-border bg-muted/30 p-1 text-xs">
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={[
                  "px-2 py-1 rounded",
                  filter === "all"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilter("pending")}
                className={[
                  "px-2 py-1 rounded",
                  filter === "pending"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                Pending
              </button>
              <button
                type="button"
                onClick={() => setFilter("reviewed")}
                className={[
                  "px-2 py-1 rounded",
                  filter === "reviewed"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                Reviewed
              </button>
            </div>
          </div>
          {filteredRequests.map((row) => {
            const statusLabel =
              row.status === "reviewed" ? "Reviewed" : "Pending review";
            const isSelected = row.id === effectiveRequestId;
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedRequestId(row.id)}
                className={[
                  "w-full text-left rounded-lg border p-3 transition hover:bg-muted/40",
                  isSelected ? "border-primary bg-primary/5" : "border-border",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground">Visitor</div>
                  <div className="text-xs text-muted-foreground">
                    {statusLabel}
                  </div>
                </div>
                <div className="font-mono text-xs mt-1 truncate">
                  {row.visitor_id}
                </div>
                <div className="text-xs text-muted-foreground mt-2 line-clamp-2">
                  {row.requester_comment}
                </div>
                <div className="text-[11px] text-muted-foreground mt-2">
                  {fmtDate(row.created_at)}
                </div>
              </button>
            );
          })}
          {filteredRequests.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No {filter === "all" ? "" : `${filter} `}requests yet.
            </div>
          ) : null}
          {hasMore ? (
            <Button
              variant="outline"
              onClick={() => setPage((p) => p + 1)}
              disabled={requestsQuery.isLoading}
            >
              Load more
            </Button>
          ) : null}
        </Card>

        <div className="flex flex-col gap-4 min-h-0">
          <Card className="p-4 space-y-3">
            <div className="text-sm font-semibold">Request details</div>
            {selectedRequest ? (
              <>
                <div className="text-xs text-muted-foreground">Visitor</div>
                <div className="font-mono text-sm">
                  {selectedRequest.visitor_id}
                </div>
                <div className="text-xs text-muted-foreground">
                  Requested by:{" "}
                  <span className="text-foreground">
                    {selectedRequest.requester_email ??
                      selectedRequest.requester_id}
                  </span>
                </div>
                {selectedRequest.reviewer_email ? (
                  <div className="text-xs text-muted-foreground">
                    Reviewed by:{" "}
                    <span className="text-foreground">
                      {selectedRequest.reviewer_email}
                    </span>
                  </div>
                ) : null}

                <div className="text-sm mt-3">
                  <div className="text-xs text-muted-foreground">
                    Requester comment
                  </div>
                  <div className="mt-1">
                    {selectedRequest.requester_comment}
                  </div>
                </div>

                {selectedRequest.reviewer_comment ? (
                  <div className="text-sm">
                    <div className="text-xs text-muted-foreground">
                      Reviewer comment
                    </div>
                    <div className="mt-1">
                      {selectedRequest.reviewer_comment}
                    </div>
                  </div>
                ) : null}

                <div className="text-xs text-muted-foreground">
                  Requested: {fmtDate(selectedRequest.created_at)}
                  {selectedRequest.reviewed_at
                    ? ` • Reviewed: ${fmtDate(selectedRequest.reviewed_at)}`
                    : ""}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" asChild>
                    <Link
                      href={`/chat-bot-analytics/visitors-sessions?visitor_id=${selectedRequest.visitor_id}&mode=session`}
                    >
                      Open in visitors
                    </Link>
                  </Button>
                  {isAdmin ? (
                    <Button
                      variant="secondary"
                      onClick={() => openReviewModal(selectedRequest)}
                      disabled={selectedRequest.status === "reviewed"}
                    >
                      {selectedRequest.status === "reviewed"
                        ? "Reviewed"
                        : "Mark reviewed"}
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                Select a request to view details.
              </div>
            )}
          </Card>

          <Card
            id="analytics-conversation"
            className="flex-1 min-h-0 flex flex-col overflow-hidden"
          >
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

            <div
              className={`grid grid-cols-1 gap-3 p-3 flex-1 min-h-0 ${
                isBySession
                  ? "lg:grid-cols-[300px_minmax(0,1fr)]"
                  : "lg:grid-cols-[300px_minmax(0,1fr)]"
              }`}
            >
              <SessionsSection
                isBySession={isBySession}
                sessions={sessions}
                filteredSessions={filteredSessions}
                selectedVisitorId={selectedVisitorId}
                selectedSessionId={effectiveSessionId}
                setSelectedSessionId={setSelectedSessionId}
                sessionSearch={sessionSearch}
                setSessionSearch={setSessionSearch}
                loadingSessions={sessionsQuery.isLoading}
                compact
              />

              <ConversationSection
                selectedSessionId={effectiveSessionId}
                isBySession={isBySession}
                loadingReplay={replayLoading}
                replay={replayData}
                setSelectedSessionId={setSelectedSessionId}
                filteredSessions={filteredSessions}
                selectedVisitorId={selectedVisitorId}
                compact
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
