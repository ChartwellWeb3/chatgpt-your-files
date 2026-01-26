import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { pill } from "@/components/ui/pill";
import { SessionRow } from "@/app/types/types";
import { fmtDate } from "@/app/helpers/fmtDate";
interface SessionsProps {
  selectedVisitorId: string;
  setSelectedSessionId: (id: string) => void;
  sessions: Array<SessionRow> | undefined;
  selectedSessionId: string;
  sessionSearch: string;
  setSessionSearch: (search: string) => void;
  filteredSessions: Array<SessionRow> | undefined;
  loadingSessions: boolean;
  isBySession: boolean;
  compact?: boolean;
}
export const SessionsSection = ({
    isBySession,
  selectedVisitorId,
  setSelectedSessionId,
  sessions,
  selectedSessionId,
  sessionSearch,
  setSessionSearch,
  filteredSessions,
  loadingSessions,
  compact = false,
}: SessionsProps) => {
  return (
    <Card
      className={`rounded-xl border border-border bg-card/40 overflow-hidden flex flex-col ${compact ? "h-full" : "h-[75vh]"} ${isBySession ? '' : 'bg-card/95 pointer-events-none opacity-30'}`}
    >
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

        <Card className="relative">
          <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
          <Input
            value={sessionSearch}
            onChange={(e) => setSessionSearch(e.target.value)}
            placeholder="Search URL / lang / residence…"
            className="pl-9"
            disabled={!selectedVisitorId}
          />
        </Card>

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
          filteredSessions?.map((s) => (
            <Card
              key={s.id}
              onClick={() => setSelectedSessionId(s.id)}
              className={[
                "w-full text-left p-3 transition hover:bg-muted/40 hover:cursor-pointer",
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
            </Card>
          ))
        )}
      </div>
    </Card>
  );
};
