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

export default function ChatAnalyticsReviewsPage() {
  const supabase = createClient();
  const { isAdmin } = useProfileLevel();
  const searchParams = useSearchParams();
  const requestIdParam = searchParams.get("request_id");
  const requestId = requestIdParam ? Number(requestIdParam) : null;
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);

  const requestsQuery = useQuery({
    queryKey: ["analytics-review-requests-all", page, requestId],
    queryFn: async (): Promise<{
      rows: ReviewRequestRow[];
      totalCount: number | null;
    }> => {
      const base = supabase
        .from("chat_review_requests")
        .select(
          "id,visitor_id,session_id,requester_id,requester_email,requester_comment,status,reviewer_id,reviewer_email,reviewer_comment,created_at,reviewed_at",
          { count: "exact" }
        )
        .order("created_at", { ascending: false });

      const query =
        requestId && !Number.isNaN(requestId)
          ? base.eq("id", requestId)
          : base.range(0, page * PAGE_SIZE + (PAGE_SIZE - 1));

      const { data, error, count } = await query;

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
  const totalCount = requestsQuery.data?.totalCount ?? null;
  const hasMore =
    !requestId &&
    totalCount !== null &&
    requests.length < totalCount;

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

      <div className="space-y-3">
        {requests.map((row) => {
          const statusLabel =
            row.status === "reviewed" ? "Reviewed" : "Pending review";
          return (
            <Card key={row.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">
                    Visitor
                  </div>
                  <div className="font-mono text-sm">{row.visitor_id}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Requested by:{" "}
                    <span className="text-foreground">
                      {row.requester_email ?? row.requester_id}
                    </span>
                  </div>
                  {row.reviewer_email ? (
                    <div className="text-xs text-muted-foreground mt-1">
                      Reviewed by:{" "}
                      <span className="text-foreground">
                        {row.reviewer_email}
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {statusLabel}
                </div>
              </div>

              <div className="text-sm">
                <div className="text-xs text-muted-foreground">
                  Requester comment
                </div>
                <div className="mt-1">{row.requester_comment}</div>
              </div>

              {row.reviewer_comment ? (
                <div className="text-sm">
                  <div className="text-xs text-muted-foreground">
                    Reviewer comment
                  </div>
                  <div className="mt-1">{row.reviewer_comment}</div>
                </div>
              ) : null}

              <div className="text-xs text-muted-foreground">
                Requested: {fmtDate(row.created_at)}
                {row.reviewed_at ? ` • Reviewed: ${fmtDate(row.reviewed_at)}` : ""}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" asChild>
                  <Link
                    href={`/chat-bot-analytics/visitors-sessions?visitor_id=${row.visitor_id}&mode=session`}
                  >
                    Open by session
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link
                    href={`/chat-bot-analytics/visitors-sessions?visitor_id=${row.visitor_id}&mode=full`}
                  >
                    Open full conversation
                  </Link>
                </Button>
                {isAdmin ? (
                  <Button
                    variant="secondary"
                    onClick={() => openReviewModal(row)}
                    disabled={row.status === "reviewed"}
                  >
                    {row.status === "reviewed"
                      ? "Reviewed"
                      : "Mark reviewed"}
                  </Button>
                ) : null}
              </div>
            </Card>
          );
        })}
        {requests.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {requestId
              ? "Review request not found."
              : "No review requests yet."}
          </div>
        ) : null}
      </div>
      {hasMore ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => setPage((p) => p + 1)}
            disabled={requestsQuery.isLoading}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
