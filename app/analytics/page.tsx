"use client";

import { useEffect, useMemo, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { useQuery } from "@tanstack/react-query";
import type { Database } from "../../../supabase/functions/_lib/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCcw, Search, ChevronDown } from "lucide-react";

type VisitorRow = {
  id: string;
  created_at: string;
};

type SessionRow = {
  id: string;
  visitor_id: string;
  created_at: string;
  page_url: string | null;
  residence_custom_id: string | null;
  lang: string | null;
};

type MessageRow = {
  id: number;
  session_id: string;
  visitor_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

type SourceRow = {
  id: number;
  assistant_message_id: number;
  document_section_id: number;
  rank: number;
  score: number | null;
  source_type: string | null;
  snippet_used: string | null;
  created_at: string;
  doc_name?: string;
};

function fmtDate(s: string) {
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function pill(text: string) {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      {text}
    </span>
  );
}

export default function ChatAnalyticsPage() {
  const supabase = createClientComponentClient<Database>();

  const [deleting, setDeleting] = useState(false);

  // Pagination for visitors
  const PAGE_SIZE = 50;
  const [visitorPage, setVisitorPage] = useState(0);

  // Selection
  const [selectedVisitorId, setSelectedVisitorId] = useState<string>("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");

  // Search
  const [visitorSearch, setVisitorSearch] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");

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

  // Filter visitors list in UI
  const filteredVisitors = useMemo(() => {
    const q = visitorSearch.trim().toLowerCase();
    if (!q) return visitors;
    return visitors.filter((v) => v.id.toLowerCase().includes(q));
  }, [visitors, visitorSearch]);

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
  const { data: replay, isLoading: loadingReplay } = useQuery({
    queryKey: ["analytics-replay", selectedSessionId],
    queryFn: async () => {
      if (!selectedSessionId) return null;

      const { data: msgs, error: msgErr } = await supabase
        .from("chat_messages")
        .select("id,session_id,visitor_id,role,content,created_at")
        .eq("session_id", selectedSessionId)
        .order("created_at", { ascending: true });

      if (msgErr) throw msgErr;

      const assistantIds = (msgs ?? [])
        .filter((m: any) => m.role === "assistant")
        .map((m: any) => m.id);

      const sourcesRes = assistantIds.length
        ? await supabase
            .from("chat_message_sources")
            .select(
              "id,assistant_message_id,document_section_id,rank,score,source_type,snippet_used,created_at"
            )
            .in("assistant_message_id", assistantIds)
            .order("rank", { ascending: true })
        : { data: [] as any[], error: null as any };

      if (sourcesRes.error) throw sourcesRes.error;

      // Enrich sources with doc names (document_sections -> documents)
      const sources = (sourcesRes.data ?? []) as SourceRow[];
      const sectionIds = Array.from(
        new Set(sources.map((s) => s.document_section_id))
      );

      const sectionToDoc = new Map<number, number>();
      const docMap = new Map<number, string>();

      if (sectionIds.length) {
        const secRes = await supabase
          .from("document_sections")
          .select("id,document_id")
          .in("id", sectionIds)
          .limit(5000);

        if (secRes.error) throw secRes.error;

        (secRes.data ?? []).forEach((row: any) => {
          sectionToDoc.set(row.id, row.document_id);
        });

        const docIds = Array.from(
          new Set((secRes.data ?? []).map((r: any) => r.document_id))
        );

        if (docIds.length) {
          const docsRes = await supabase
            .from("documents")
            .select("id,name")
            .in("id", docIds)
            .limit(5000);

          if (docsRes.error) throw docsRes.error;
          (docsRes.data ?? []).forEach((d: any) => docMap.set(d.id, d.name));
        }

        sources.forEach((s) => {
          const docId = sectionToDoc.get(s.document_section_id);
          s.doc_name = docId
            ? docMap.get(docId) ?? "Unknown doc"
            : "Unknown doc";
        });
      }

      const sourcesByMsg = new Map<number, SourceRow[]>();
      sources.forEach((s) => {
        const arr = sourcesByMsg.get(s.assistant_message_id) ?? [];
        arr.push(s);
        sourcesByMsg.set(s.assistant_message_id, arr);
      });

      return {
        messages: (msgs ?? []) as MessageRow[],
        sourcesByMsg,
      };
    },
    enabled: !!selectedSessionId,
  });

  const refreshAll = async () => {
    await Promise.all([refetchVisitors(), refetchSessions()]);
  };

  async function deleteVisitor(visitorId: string) {
    if (!visitorId) return;

    const ok = window.confirm(
      `Delete visitor ${visitorId} and ALL related sessions/messages/sources? This cannot be undone.`
    );
    if (!ok) return;

    setDeleting(true);
    try {
      const { error } = await supabase.rpc("admin_delete_visitor", {
        p_visitor_id: visitorId,
      });
      if (error) throw error;

      // reset selection + refresh lists
      setSelectedSessionId("");
      setSelectedVisitorId("");
      await refreshAll();
    } finally {
      setDeleting(false);
    }
  }

  const visitorOptions = visitors.map((v) => v.id);

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

      <div className="grid grid-cols-1 lg:grid-cols-[380px_420px_1fr] gap-4">
        {/* ---------------- Visitors ---------------- */}
        <div className="rounded-xl border border-border bg-card/40 overflow-hidden flex flex-col h-[75vh]">
          <div className="p-4 border-b border-border space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-sm">Visitors</div>
              {loadingVisitors && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            {/* Dropdown */}
            <div className="relative">
              <ChevronDown className="h-4 w-4 absolute right-3 top-3 text-muted-foreground pointer-events-none" />
              <select
                className="w-full h-10 rounded-md border border-border bg-background px-3 pr-10 text-sm font-mono"
                value={selectedVisitorId}
                onChange={(e) => setSelectedVisitorId(e.target.value)}
              >
                <option value="" disabled>
                  Select visitor…
                </option>
                {visitorOptions.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>

            {/* Paste/search */}
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
              <Input
                value={visitorSearch}
                onChange={(e) => setVisitorSearch(e.target.value)}
                placeholder="Search visitor id…"
                className="pl-9"
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  // If user pasted a full UUID not in list yet, still select it.
                  const val = visitorSearch.trim();
                  if (val) {
                    setSelectedVisitorId(val);
                    setSelectedSessionId("");
                  }
                }}
              >
                Select by search
              </Button>

              <Button
                variant="outline"
                onClick={() => {
                  setVisitorSearch("");
                }}
              >
                Clear
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loadingVisitors ? (
              <div className="flex items-center gap-2 text-muted-foreground p-3">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading visitors…
              </div>
            ) : filteredVisitors.length === 0 ? (
              <div className="text-sm text-muted-foreground p-3">
                No visitors found.
              </div>
            ) : (
              filteredVisitors.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVisitorId(v.id)}
                  className={[
                    "w-full text-left rounded-lg border p-3 transition hover:bg-muted/40",
                    selectedVisitorId === v.id
                      ? "border-primary bg-primary/5"
                      : "border-border",
                  ].join(" ")}
                >
                  <div className="font-mono text-xs truncate">{v.id}</div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    created: {fmtDate(v.created_at)}
                  </div>
                  <Button
                    variant="destructive"
                    className="w-full mt-4"
                    onClick={() => deleteVisitor(selectedVisitorId)}
                    disabled={!selectedVisitorId || deleting}
                  >
                    {deleting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Deleting…
                      </>
                    ) : (
                      "Delete visitor + all data"
                    )}
                  </Button>
                </button>
              ))
            )}

            <div className="pt-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setVisitorPage((p) => p + 1)}
                disabled={loadingVisitors}
              >
                Load more
              </Button>
              <div className="text-xs text-muted-foreground mt-2 text-center">
                Showing {visitors.length} visitors
              </div>
            </div>
          </div>
        </div>

        {/* ---------------- Sessions ---------------- */}
        <div className="rounded-xl border border-border bg-card/40 overflow-hidden flex flex-col h-[75vh]">
          <div className="p-4 border-b border-border space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-sm">Sessions</div>
              {loadingSessions && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              Visitor:{" "}
              <span className="font-mono text-foreground">
                {selectedVisitorId || "—"}
              </span>
            </div>

            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
              <Input
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                placeholder="Search URL / lang / residence…"
                className="pl-9"
                disabled={!selectedVisitorId}
              />
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {sessions ? pill(`Sessions: ${sessions.length}`) : null}
              {selectedSessionId
                ? pill("Session selected")
                : pill("Pick a session")}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {!selectedVisitorId ? (
              <div className="text-sm text-muted-foreground p-3">
                Select a visitor to load sessions.
              </div>
            ) : loadingSessions ? (
              <div className="flex items-center gap-2 text-muted-foreground p-3">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading sessions…
              </div>
            ) : (filteredSessions?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground p-3">
                No sessions found.
              </div>
            ) : (
              filteredSessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSessionId(s.id)}
                  className={[
                    "w-full text-left rounded-lg border p-3 transition hover:bg-muted/40",
                    selectedSessionId === s.id
                      ? "border-primary bg-primary/5"
                      : "border-border",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(s.created_at)}
                    </div>
                    <div className="flex items-center gap-2">
                      {s.lang ? pill(s.lang.toUpperCase()) : null}
                      {s.residence_custom_id
                        ? pill(s.residence_custom_id)
                        : pill("common")}
                    </div>
                  </div>

                  <div className="mt-2 text-sm font-medium line-clamp-2">
                    {s.page_url ?? "—"}
                  </div>

                  <div className="mt-2 text-xs text-muted-foreground font-mono truncate">
                    {s.id}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ---------------- Conversation ---------------- */}
        <div className="rounded-xl border border-border bg-card/40 overflow-hidden flex flex-col h-[75vh]">
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-sm">Conversation</div>
              {loadingReplay && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {selectedSessionId ? (
                <>
                  Session:{" "}
                  <span className="font-mono text-foreground">
                    {selectedSessionId}
                  </span>
                </>
              ) : (
                "Select a session to replay messages and sources."
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {!selectedSessionId ? (
              <div className="text-sm text-muted-foreground">
                Pick a session on the left.
              </div>
            ) : loadingReplay ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading replay…
              </div>
            ) : !replay ? (
              <div className="text-sm text-muted-foreground">
                No replay data.
              </div>
            ) : (
              <div className="space-y-4">
                {replay.messages.map((m) => {
                  const isUser = m.role === "user";
                  const sources =
                    m.role === "assistant"
                      ? replay.sourcesByMsg.get(m.id) ?? []
                      : [];

                  return (
                    <div
                      key={m.id}
                      className={`flex ${
                        isUser ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={[
                          "max-w-[88%] rounded-lg border p-3",
                          isUser
                            ? "bg-primary text-primary-foreground border-primary/30"
                            : "bg-background border-border",
                        ].join(" ")}
                      >
                        <div className="flex items-center justify-between gap-3 text-xs opacity-80 mb-2">
                          <span className="uppercase">{m.role}</span>
                          <span>{fmtDate(m.created_at)}</span>
                        </div>

                        <div className="text-sm whitespace-pre-wrap leading-relaxed">
                          {m.content}
                        </div>

                        {sources.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-border/60">
                            <div className="text-xs font-medium text-muted-foreground mb-2">
                              Sources used
                            </div>

                            <div className="space-y-2">
                              {sources.slice(0, 10).map((s) => (
                                <div
                                  key={s.id}
                                  className="rounded-md border border-border/60 p-2 bg-muted/20"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-xs text-muted-foreground">
                                      #{s.rank}
                                      {s.source_type
                                        ? ` • ${s.source_type}`
                                        : ""}
                                      {typeof s.score === "number"
                                        ? ` • score ${s.score.toFixed(4)}`
                                        : ""}
                                    </div>
                                    {pill(s.doc_name ?? "Unknown doc")}
                                  </div>

                                  <div className="text-xs text-muted-foreground mt-1">
                                    section_id:{" "}
                                    <span className="font-mono">
                                      {s.document_section_id}
                                    </span>
                                  </div>

                                  {s.snippet_used ? (
                                    <div className="text-xs text-muted-foreground mt-2 overflow-y-scroll bg-muted/10 p-2 rounded line-clamp-5  ">
                                      {s.snippet_used}
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-border flex justify-between gap-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setSelectedSessionId("")}
              disabled={!selectedSessionId}
            >
              Back
            </Button>

            <Button
              className="w-full"
              onClick={() => {
                if ((filteredSessions?.length ?? 0) > 0) {
                  setSelectedSessionId(filteredSessions[0].id);
                }
              }}
              disabled={
                !selectedVisitorId || (filteredSessions?.length ?? 0) === 0
              }
            >
              Latest session
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
