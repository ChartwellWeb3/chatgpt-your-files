"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/app/utils/supabase/client";
import { useReplay } from "@/app/hooks/useReplay";
import { fmtDate } from "@/app/helpers/fmtDate";
import type { SessionRow } from "@/app/types/types";

type Props = {
  visitorId: string;
  defaultSessionId: string;
  onClose: () => void;
};

export function VisitorConversationModal({ visitorId, defaultSessionId, onClose }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [selectedSessionId, setSelectedSessionId] = useState(defaultSessionId);

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ["visitor-sessions-modal", visitorId],
    queryFn: async (): Promise<SessionRow[]> => {
      const { data, error } = await supabase
        .from("chat_sessions")
        .select("id,visitor_id,created_at,page_url,residence_custom_id,lang")
        .eq("visitor_id", visitorId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as SessionRow[];
    },
  });

  const { data: replay, isLoading: replayLoading } = useReplay(supabase, selectedSessionId);
  const messages = (replay?.messages ?? []).filter((m) => m.role !== "system");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card border rounded-lg shadow-lg w-full max-w-4xl flex flex-col overflow-hidden"
           style={{ height: "80vh" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div>
            <h3 className="font-semibold text-sm">Visitor Conversation</h3>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{visitorId}</p>
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">

          {/* Sessions sidebar */}
          <div className="w-48 shrink-0 border-r overflow-y-auto">
            <div className="px-2 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Sessions ({sessions.length})
            </div>
            {sessionsLoading ? (
              <div className="px-3 text-xs text-muted-foreground">Loading…</div>
            ) : (
              <div className="space-y-0.5 px-1 pb-2">
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`w-full text-left px-2 py-2 rounded text-xs transition-colors ${
                      s.id === selectedSessionId
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    }`}
                    onClick={() => setSelectedSessionId(s.id)}
                  >
                    <div className="font-medium truncate">{fmtDate(s.created_at)}</div>
                    {s.residence_custom_id ? (
                      <div className={`text-[10px] truncate mt-0.5 ${s.id === selectedSessionId ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {s.residence_custom_id}
                      </div>
                    ) : null}
                    {s.lang ? (
                      <div className={`text-[10px] ${s.id === selectedSessionId ? "text-primary-foreground/60" : "text-muted-foreground/70"}`}>
                        {s.lang}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Messages pane */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {replayLoading ? (
              <div className="text-sm text-muted-foreground">Loading messages…</div>
            ) : messages.length === 0 ? (
              <div className="text-sm text-muted-foreground">No messages in this session.</div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[78%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm"
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">{m.content}</div>
                    <div
                      className={`text-[10px] mt-1 ${
                        m.role === "user" ? "text-primary-foreground/60" : "text-muted-foreground"
                      }`}
                    >
                      {fmtDate(m.created_at)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
