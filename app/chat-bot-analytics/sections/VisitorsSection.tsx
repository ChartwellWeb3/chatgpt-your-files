import { Loader2, ChevronDown, ChevronUp, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
// import { Input } from "@/components/ui/input";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import { fmtDate } from "@/app/helpers/fmtDate";
import { pill } from "@/components/ui/pill";
import { Check } from "lucide-react";
import { useState } from "react";
import { DateRangePicker } from "./DateRangePicker";
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
  | "reviewed";
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
  deleting,
  filterOption,
  setFilterOption,
  loadingBookTourRows,
  bookTourStatsByVisitor,
  reviewRequestsByVisitor,
  onRequestReview,
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
                {filterOption.replace("_", " ")}
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
                        review.status === "reviewed" ? "ok" : "muted"
                      )
                    : null}
                </div>

                <div className="mt-3 flex items-center gap-2">
                  {isPending && review ? (
                    <Button variant="outline" className="w-full" asChild>
                      <Link
                        href={`/chat-bot-analytics/reviews?request_id=${review.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        Go to review
                      </Link>
                    </Button>
                  ) : !isReviewed ? (
                    <Button
                      variant="secondary"
                      className="w-full"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openReviewModal(v.id);
                      }}
                    >
                      <MessageSquare className="h-4 w-4 mr-2" />
                      Request review
                    </Button>
                  ) : null}
                </div>

                {/* ✅ FIX: delete correct visitor + prevent selecting on click */}
                {isAdmin && (
                  <Button
                    variant="destructive"
                    className="w-full mt-4"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void deleteVisitor(v.id);
                    }}
                    disabled={deleting}
                  >
                    {deleting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Deleting…
                      </>
                    ) : (
                      "Delete visitor"
                    )}
                  </Button>
                )}
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
              onClick={() => setVisitorPage((p) => p + 1)}
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
