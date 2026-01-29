import {
  Loader2,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Sparkles,
  Check,
  Trash2,
  ExternalLink,
  Info,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
// import { Input } from "@/components/ui/input";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import { fmtDate } from "@/app/helpers/fmtDate";
import { pill } from "@/components/ui/pill";
import { useState } from "react";
import { DateRangePicker } from "./DateRangePicker";
import type { ConversationAnalysis, VisitorAnalysisRow } from "@/app/types/types";
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
import { Textarea } from "@/components/ui/textarea";

type VisitorLite = { id: string; created_at: string };

type FilterOption =
  | "all"
  | "submitted"
  | "not_submitted"
  | "requested"
  | "reviewed"
  | "ai_satisfied"
  | "ai_neutral"
  | "ai_angry";
type ReviewFilter = "all" | "requested" | "reviewed";

type BookATourStats = {
  submitted: boolean; // at least one submitted row exists
  totalSubmissions: number; // count of rows for chat_bot_book_a_tour
  dynamicSubmissions: number; // submitted_with_button === "dynamic"
  lastSubmittedAt?: string | null;
};

type ReviewRequestLite = {
  id: number;
  status: "pending" | "reviewed" | "closed";
  requester_email?: string | null;
  requester_comment: string;
  reviewer_comment: string | null;
  created_at: string;
};

interface VisitorsProps {
  loadingVisitors: boolean;
  selectedVisitorId: string;
  setSelectedVisitorId: (id: string) => void;

  // visitorOptions: string[];

  // visitorSearch: string;
  // setVisitorSearch: (search: string) => void;

  filteredVisitors: VisitorLite[];
  // visitors: VisitorLite[];

  // setSelectedSessionId: (id: string) => void;
  setVisitorPage: (updater: (prev: number) => number) => void;
  onLoadMoreVisitors: () => void;

  deleting: boolean;
  deleteVisitor: (id: string) => void;

  // ✅ NEW: form filter controls
  filterOption: FilterOption;
  setFilterOption: (v: FilterOption) => void;
  loadingBookTourRows?: boolean;
  hasMoreVisitors: boolean;

  // ✅ NEW: stats for chat_bot_book_a_tour per visitor
  bookTourStatsByVisitor: Map<string, BookATourStats>;
  reviewRequestsByVisitor: Map<string, ReviewRequestLite>;
  onRequestReview: (visitorId: string, comment: string) => Promise<void>;
  analysisByVisitor: Map<string, VisitorAnalysisRow>;
  analysisLoadingVisitorId: string | null;
  onAnalyzeVisitor: (visitorId: string) => Promise<ConversationAnalysis>;
  isAdmin: boolean;
  // ✅ NEW: date range for visitors
  startDate: string;
  endDate: string;
  setStartDate: (date: string) => void;
  setEndDate: (date: string) => void;
}

export const VisitorsSessions = ({
  hasMoreVisitors,
  loadingVisitors,
  selectedVisitorId,
  setSelectedVisitorId,
  // visitorOptions,
  // visitorSearch,
  // setVisitorSearch,
  filteredVisitors,
  deleteVisitor,
  // setSelectedSessionId,
  // visitors,
  isAdmin,
  setVisitorPage,
  onLoadMoreVisitors,
  deleting,
  filterOption,
  setFilterOption,
  loadingBookTourRows,
  bookTourStatsByVisitor,
  reviewRequestsByVisitor,
  onRequestReview,
  analysisByVisitor,
  analysisLoadingVisitorId,
  onAnalyzeVisitor,
  startDate,
  endDate,
  setStartDate,
  setEndDate,
}: VisitorsProps) => {
  const [collapsed, setCollapsed] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewVisitorId, setReviewVisitorId] = useState<string | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [expandedAnalysisIds, setExpandedAnalysisIds] = useState<Set<string>>(
    new Set()
  );
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [promptVersion, setPromptVersion] = useState("");
  const filterLabels: Record<FilterOption, string> = {
    all: "All",
    submitted: "Submitted",
    not_submitted: "Not submitted",
    requested: "Review requested",
    reviewed: "Reviewed",
    ai_satisfied: "AI satisfied",
    ai_neutral: "AI neutral",
    ai_angry: "AI angry",
  };

  const promptByVersion: Record<string, string> = {
    v1: `
You are an analyst evaluating a visitor's full chatbot conversation for ANY client/domain.

You MUST use ONLY the transcript. Do NOT assume product features, policies, or company details that are not in the transcript.

Your job:
1) Determine the visitor's primary goal (what they were trying to accomplish).
2) Decide whether the goal was achieved based on evidence in the transcript.
3) Infer sentiment from the visitor's tone + outcome (goal achieved or not).

Return JSON only with exactly these keys:
{
  "satisfaction_1_to_10": number,
  "sentiment": "satisfied" | "neutral" | "angry" | "unknown",
  "improvement": string,
  "summary": string,
  "evidence": {
    "visitor_goal": string,
    "goal_met": "yes" | "partial" | "no" | "unknown",
    "key_quotes": string[]
  }
 }

Scoring rubric (be consistent):
- 9–10: Goal clearly achieved AND visitor expresses approval/thanks OR no further help needed.
- 7–8: Goal achieved but minor friction (extra steps, unclear phrasing, minor repetition).
- 5–6: Partial help; visitor still missing something or outcome unclear.
- 3–4: Mostly unhelpful; confusion, wrong direction, repeated failures.
- 1–2: Very bad; visitor is clearly frustrated/angry, bot blocks, or fails completely.

Sentiment rules:
- "satisfied": visitor expresses positive emotion OR goal clearly met with no frustration.
- "angry": explicit frustration/negative tone OR repeated failure AND visitor escalates/complains.
- "neutral": neither satisfied nor angry; or mixed tone with partial resolution.
- "unknown": transcript too short/ambiguous to infer tone or outcome.

Evidence rules:
- visitor_goal: 1 short sentence describing the visitor's main intent.
- goal_met: yes/partial/no/unknown based on transcript outcomes.
- key_quotes: 1–3 short exact quotes (<= 20 words each) from the transcript that justify score/sentiment.
  If transcript is extremely short, provide an empty array.

Output rules:
- JSON only. No markdown.
- "improvement" and "summary" must be in English even if transcript is French.
- improvement: one line, actionable, start with a verb, and include ONE category label:
  Categories: [clarify], [accuracy], [handoff], [ux], [tone], [policy], [speed], [links]
  Example: "[clarify] Ask one follow-up question to confirm location before recommending options."
- summary: 2–3 short sentences, describing what happened and the outcome.
`.trim(),
  };
  const openReviewModal = (visitorId: string) => {
    setReviewVisitorId(visitorId);
    setReviewComment("");
    setReviewError(null);
    setReviewOpen(true);
  };

  const submitReviewRequest = async () => {
    if (!reviewVisitorId) return;
    const comment = reviewComment.trim();
    if (!comment) {
      setReviewError("Please add a comment.");
      return;
    }
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      await onRequestReview(reviewVisitorId, comment);
      setReviewOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Request failed.";
      setReviewError(message);
    } finally {
      setReviewSubmitting(false);
    }
  };

  const toggleAnalysis = (visitorId: string) => {
    setExpandedAnalysisIds((prev) => {
      const next = new Set(prev);
      if (next.has(visitorId)) {
        next.delete(visitorId);
      } else {
        next.add(visitorId);
      }
      return next;
    });
  };

  const openPromptModal = (version: string) => {
    setPromptVersion(version);
    setPromptText(promptByVersion[version] ?? "Prompt not found for this version.");
    setPromptOpen(true);
  };
  return (
    <Card className="bg-card/40 overflow-hidden flex flex-col h-[75vh]">
      <AlertDialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Request review</AlertDialogTitle>
            <AlertDialogDescription>
              Add a short note explaining why this visitor needs review.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Add a comment for the reviewer..."
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
                void submitReviewRequest();
              }}
              disabled={reviewSubmitting}
            >
              {reviewSubmitting ? "Sending..." : "Send request"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={promptOpen} onOpenChange={setPromptOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Analyzer prompt</AlertDialogTitle>
            <AlertDialogDescription>
              Version: {promptVersion || "unknown"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border/60 bg-background p-3 text-xs whitespace-pre-wrap">
            {promptText}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CardHeader className="p-4 border-b border-border space-y-3 relative">
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-0 right-0"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand filters" : "Collapse filters"}
        >
          {collapsed ? (
            <ChevronDown className="h-5 w-5" />
          ) : (
            <ChevronUp className="h-5 w-5" />
          )}
        </Button>
        {!collapsed ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-sm">Visitors</div>
              <DateRangePicker
                // className="w-full"
                startDate={startDate}
                endDate={endDate}
                onChange={(from, to) => {
                  setStartDate(from);
                  setEndDate(to);
                  // optional: reset page when date changes
                  setVisitorPage(() => 0);
                }}
              />

              <div className="flex items-center gap-2">
                {loadingBookTourRows ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : null}
                {loadingVisitors ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : null}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-background p-1 grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => {
                  setFilterOption("all");
                  setVisitorPage(() => 0);
                  setSelectedVisitorId("");
                }}
                className={[
                  "h-9 rounded-md text-sm font-medium transition",
                  filterOption === "all"
                    ? "bg-primary text-primary-foreground shadow"
                    : "hover:bg-muted text-foreground",
                ].join(" ")}
              >
                All
              </button>

              <button
                type="button"
                onClick={() => {
                  setFilterOption("submitted");
                  setVisitorPage(() => 0);
                  setSelectedVisitorId("");
                }}
                disabled={!!loadingBookTourRows}
                className={[
                  "h-9 rounded-md text-sm font-medium transition",
                  "disabled:opacity-50 disabled:pointer-events-none",
                  filterOption === "submitted"
                    ? "bg-primary text-primary-foreground shadow"
                    : "hover:bg-muted text-foreground",
                ].join(" ")}
              >
                Submitted
              </button>

              <button
                type="button"
                onClick={() => {
                  setFilterOption("not_submitted");
                  setVisitorPage(() => 0);
                  setSelectedVisitorId("");
                }}
                disabled={!!loadingBookTourRows}
                className={[
                  "h-9 rounded-md text-sm font-medium transition",
                  "disabled:opacity-50 disabled:pointer-events-none",
                  filterOption === "not_submitted"
                    ? "bg-primary text-primary-foreground shadow"
                    : "hover:bg-muted text-foreground",
                ].join(" ")}
              >
                Not submitted
              </button>
              <button
                type="button"
                onClick={() => {
                  setFilterOption("requested");
                  setVisitorPage(() => 0);
                  setSelectedVisitorId("");
                }}
                className={[
                  "h-9 rounded-md text-sm font-medium transition",
                  filterOption === "requested"
                    ? "bg-primary text-primary-foreground shadow"
                    : "hover:bg-muted text-foreground",
                ].join(" ")}
              >
                Review requested
              </button>

              <button
                type="button"
                onClick={() => {
                  setFilterOption("reviewed");
                  setVisitorPage(() => 0);
                  setSelectedVisitorId("");
                }}
                className={[
                  "h-9 rounded-md text-sm font-medium transition",
                  filterOption === "reviewed"
                    ? "bg-primary text-primary-foreground shadow"
                    : "hover:bg-muted text-foreground",
                ].join(" ")}
              >
                Reviewed
              </button>
              <button
                type="button"
                onClick={() => {
                  setFilterOption("ai_satisfied");
                  setVisitorPage(() => 0);
                  setSelectedVisitorId("");
                }}
                className={[
                  "h-9 rounded-md text-sm font-medium transition",
                  filterOption === "ai_satisfied"
                    ? "bg-primary text-primary-foreground shadow"
                    : "hover:bg-muted text-foreground",
                ].join(" ")}
              >
                AI satisfied
              </button>
              <button
                type="button"
                onClick={() => {
                  setFilterOption("ai_neutral");
                  setVisitorPage(() => 0);
                  setSelectedVisitorId("");
                }}
                className={[
                  "h-9 rounded-md text-sm font-medium transition",
                  filterOption === "ai_neutral"
                    ? "bg-primary text-primary-foreground shadow"
                    : "hover:bg-muted text-foreground",
                ].join(" ")}
              >
                AI neutral
              </button>
              <button
                type="button"
                onClick={() => {
                  setFilterOption("ai_angry");
                  setVisitorPage(() => 0);
                  setSelectedVisitorId("");
                }}
                className={[
                  "h-9 rounded-md text-sm font-medium transition",
                  filterOption === "ai_angry"
                    ? "bg-primary text-primary-foreground shadow"
                    : "hover:bg-muted text-foreground",
                ].join(" ")}
              >
                AI angry
              </button>
            </div>
            {/* Dropdown */}
            {/* <div className="relative">
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
            </div> */}
            {/* Paste/search */}
            {/* <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
              <Input
                value={visitorSearch}
                onChange={(e) => setVisitorSearch(e.target.value)}
                placeholder="Search visitor id…"
                className="pl-9"
              />
            </div> */}
            {/* <div className="flex gap-2">
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  const val = visitorSearch.trim();
                  if (val) {
                    setSelectedVisitorId(val);
                    setSelectedSessionId("");
                  }
                }}
              >
                Select by search
              </Button>

              <Button variant="outline" onClick={() => setVisitorSearch("")}>
                Clear
              </Button>
            </div> */}
          </>
        ) : (
          <div>
            <div className="text-xs text-muted-foreground">
              Filter:{" "}
              <span className="font-medium">
                {filterLabels[filterOption]}
              </span>
              <div className="flex gap-1 mt-1 text-xs">
                <span>{startDate ? `from ${startDate}` : ""}</span>
                <span className="">{endDate ? `to ${endDate}` : ""}</span>
              </div>
            </div>
          </div>
        )}
      </CardHeader>

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
          filteredVisitors.map((v) => {
            const stats = bookTourStatsByVisitor.get(v.id);
            const submitted = !!stats?.submitted;
            const review = reviewRequestsByVisitor.get(v.id);
            const isPending = review?.status === "pending";
            const isReviewed = review?.status === "reviewed";
            const analysis = analysisByVisitor.get(v.id);

            return (
              <Card
                key={v.id}
                onClick={() => setSelectedVisitorId(v.id)}
                className={[
                  `w-full text-left rounded-lg border p-3 transition hover:bg-muted/40 cursor-pointer  relative`,
                  selectedVisitorId === v.id
                    ? "border-primary bg-primary/5"
                    : "border-border",
                ].join(" ")}
              >
                <div className="font-mono text-xs truncate">{v.id}</div>
                {submitted && (
                  <Check className="h-6 w-6 text-green-400 absolute top-2 right-2 " />
                )}

                <div className="mt-2 text-xs text-muted-foreground">
                  created: {fmtDate(v.created_at)}
                </div>

                {/* ✅ Chatbot book-a-tour submission info */}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {submitted ? pill("submitted", "ok") : pill("not submitted")}
                  {pill(`total: ${stats?.totalSubmissions ?? 0}`)}
                  {stats?.lastSubmittedAt
                    ? pill(`last: ${fmtDate(stats.lastSubmittedAt)}`)
                    : null}
                  {review
                    ? pill(
                      review.status === "reviewed"
                          ? "reviewed"
                          : "review requested",
                        review.status === "reviewed"
                          ? "ok"
                          : review.status === "pending"
                            ? "warning"
                            : "muted"
                      )
                    : null}
                  {analysis
                    ? pill(
                        `AI ${analysis.satisfaction_1_to_10}/10`,
                        analysis.satisfaction_1_to_10 >= 7 ? "ok" : "muted"
                      )
                    : null}
                  {analysis
                    ? pill(
                        analysis.sentiment,
                        analysis.sentiment === "satisfied"
                          ? "ok"
                          : analysis.sentiment === "angry"
                            ? "danger"
                            : analysis.sentiment === "neutral"
                              ? "warning"
                            : "muted"
                      )
                    : null}
                </div>

                <div className="mt-3 flex items-center gap-2">
                  {isPending && review ? (
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      asChild
                      title="Go to review"
                      aria-label="Go to review"
                    >
                      <Link
                        href={`/chat-bot-analytics/reviews?request_id=${review.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </Button>
                  ) : !isReviewed ? (
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-8 w-8"
                      title="Request review"
                      aria-label="Request review"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openReviewModal(v.id);
                      }}
                    >
                      <MessageSquare className="h-4 w-4" />
                    </Button>
                  ) : null}

                  {analysis ? (
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      title={
                        expandedAnalysisIds.has(v.id)
                          ? "Hide AI analysis"
                          : "Show AI analysis"
                      }
                      aria-label={
                        expandedAnalysisIds.has(v.id)
                          ? "Hide AI analysis"
                          : "Show AI analysis"
                      }
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleAnalysis(v.id);
                      }}
                    >
                      {expandedAnalysisIds.has(v.id) ? (
                        <X className="h-4 w-4" />
                      ) : (
                        <Info className="h-4 w-4" />
                      )}
                    </Button>
                  ) : null}

                  {isAdmin ? (
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      title={analysis ? "Re-analyze AI" : "Analyze with AI"}
                      aria-label={analysis ? "Re-analyze AI" : "Analyze with AI"}
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                          await onAnalyzeVisitor(v.id);
                        } catch {}
                      }}
                      disabled={analysisLoadingVisitorId === v.id}
                    >
                      {analysisLoadingVisitorId === v.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                    </Button>
                  ) : null}

                  {isAdmin ? (
                    <Button
                      variant="destructive"
                      size="icon"
                      className="h-8 w-8"
                      title="Delete visitor"
                      aria-label="Delete visitor"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void deleteVisitor(v.id);
                      }}
                      disabled={deleting}
                    >
                      {deleting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  ) : null}
                </div>

                {analysis && expandedAnalysisIds.has(v.id) ? (
                  <div className="mt-3 rounded-md border border-border/60 bg-muted/20 p-3 text-xs space-y-2">
                    <div className="font-semibold text-foreground">
                      AI analysis
                    </div>
                    <div className="text-muted-foreground">
                      Summary:{" "}
                      <span className="text-foreground">{analysis.summary}</span>
                    </div>
                    <div className="text-muted-foreground">
                      Improvement:{" "}
                      <span className="text-foreground">
                        {analysis.improvement}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      Goal:{" "}
                      <span className="text-foreground">
                        {analysis.evidence_visitor_goal ?? "unknown"}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      Goal met:{" "}
                      <span className="text-foreground">
                        {analysis.evidence_goal_met ?? "unknown"}
                      </span>
                    </div>
                    <div className="text-muted-foreground">
                      Key quotes:
                      <div className="mt-1 space-y-1 text-foreground">
                        {(analysis.evidence_key_quotes ?? []).length ? (
                          (analysis.evidence_key_quotes ?? []).map(
                            (quote, idx) => (
                              <div key={`${analysis.id}-quote-${idx}`}>
                                {"\""}
                                {quote}
                                {"\""}
                              </div>
                            )
                          )
                        ) : (
                          <div className="text-muted-foreground">None</div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-muted-foreground">
                      <span>Model: {analysis.model}</span>
                      <span>Source: {analysis.source}</span>
                      <span>Prompt: {analysis.prompt_version}</span>
                      <span>Analyzed: {fmtDate(analysis.created_at)}</span>
                      <span>
                        Last msg: {fmtDate(analysis.last_message_at)}
                      </span>
                    </div>
                    <div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openPromptModal(analysis.prompt_version);
                        }}
                      >
                        Watch prompt
                      </Button>
                    </div>
                  </div>
                ) : null}

              </Card>
            );
          })
        )}
      </div>
      <CardFooter className="p-4 border-t border-border flex flex-col ">
        <div className="pt-2">
          {hasMoreVisitors && (
            <Button
              variant="outline"
              className="w-full"
              onClick={onLoadMoreVisitors}
              disabled={loadingVisitors}
            >
              Load more
            </Button>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-2 text-center">
          Showing {filteredVisitors.length} visitors
        </div>
      </CardFooter>
    </Card>
  );
};
