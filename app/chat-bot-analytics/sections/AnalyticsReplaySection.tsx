"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConversationSection } from "./ConversationSection";
import { SessionsSection } from "./SessionsSections";
import { VisitorsSessions } from "./VisitorsSection";
import type { MessageRow, SessionRow, SourceRow, VisitorRow } from "@/app/types/types";

type FormFilter = "all" | "submitted" | "not_submitted";

type BookATourStats = {
  submitted: boolean;
  totalSubmissions: number;
  dynamicSubmissions: number;
  lastSubmittedAt?: string | null;
};

type ReplaySectionProps = {
  isBySession: boolean;
  setModeBySession: () => void;
  setModeFullConversation: () => void;
  loadingVisitors: boolean;
  startDate: string;
  endDate: string;
  setStartDate: (date: string) => void;
  setEndDate: (date: string) => void;
  selectedVisitorId: string;
  setSelectedVisitorId: (id: string) => void;
  hasMoreVisitors: boolean;
  isAdmin: boolean;
  filteredVisitors: VisitorRow[];
  deleteVisitor: (id: string) => void;
  setVisitorPage: (updater: (prev: number) => number) => void;
  deleting: boolean;
  formFilter: FormFilter;
  setFormFilter: (v: FormFilter) => void;
  bookTourStatsByVisitor: Map<string, BookATourStats>;
  sessions: SessionRow[];
  filteredSessions: SessionRow[];
  selectedSessionId: string;
  setSelectedSessionId: (id: string) => void;
  sessionSearch: string;
  setSessionSearch: (search: string) => void;
  loadingSessions: boolean;
  loadingReplay: boolean;
  replay:
    | {
        messages: MessageRow[];
        sourcesByMsg: Map<number, SourceRow[]>;
      }
    | null
    | undefined;
};

export function AnalyticsReplaySection({
  isBySession,
  setModeBySession,
  setModeFullConversation,
  loadingVisitors,
  startDate,
  endDate,
  setStartDate,
  setEndDate,
  selectedVisitorId,
  setSelectedVisitorId,
  hasMoreVisitors,
  isAdmin,
  filteredVisitors,
  deleteVisitor,
  setVisitorPage,
  deleting,
  formFilter,
  setFormFilter,
  bookTourStatsByVisitor,
  sessions,
  filteredSessions,
  selectedSessionId,
  setSelectedSessionId,
  sessionSearch,
  setSessionSearch,
  loadingSessions,
  loadingReplay,
  replay,
}: ReplaySectionProps) {
  return (
    <section id="analytics-replay" className="space-y-4">
      <h2 className="text-lg font-semibold">Visitors and Sessions</h2>
      <div
        className={`grid grid-cols-1 gap-4 ${
          isBySession
            ? "lg:grid-cols-[380px_420px_1fr]"
            : "lg:grid-cols-[380px_220px_1fr]"
        } ease-in-out duration-300`}
      >
        <VisitorsSessions
          loadingVisitors={loadingVisitors}
          startDate={startDate}
          endDate={endDate}
          setStartDate={setStartDate}
          setEndDate={setEndDate}
          selectedVisitorId={selectedVisitorId}
          setSelectedVisitorId={setSelectedVisitorId}
          hasMoreVisitors={hasMoreVisitors}
          isAdmin={isAdmin}
          filteredVisitors={filteredVisitors}
          deleteVisitor={deleteVisitor}
          setVisitorPage={setVisitorPage}
          deleting={deleting}
          formFilter={formFilter}
          setFormFilter={setFormFilter}
          bookTourStatsByVisitor={bookTourStatsByVisitor}
        />

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

        <Card
          id="analytics-conversation"
          className="h-[75vh] flex flex-col overflow-hidden"
        >
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
            selectedSessionId={selectedSessionId}
            isBySession={isBySession}
            loadingReplay={loadingReplay}
            replay={replay}
            setSelectedSessionId={setSelectedSessionId}
            filteredSessions={filteredSessions}
            selectedVisitorId={selectedVisitorId}
          />
        </Card>
      </div>
    </section>
  );
}
