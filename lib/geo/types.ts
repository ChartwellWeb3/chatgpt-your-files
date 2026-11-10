export type * from "../../infrastructure/performance/supabase/functions/_shared/types";

import type { Attempt, Batch, Bootstrap as BaseBootstrap, Evidence as BaseEvidence, Metric, Question as BaseQuestion, Run, Source as BaseSource } from "../../infrastructure/performance/supabase/functions/_shared/types";

export type SummaryMetric = Pick<Metric, "samples" | "mentions" | "ranked_mentions" | "top3_mentions" | "visibility_rate" | "average_position" | "top3_rate" | "share_of_voice">;
export type BreakdownMetric = SummaryMetric & { key: string; label: string };
export type OverviewDashboard = {
  chartwell: SummaryMetric | null; previous: SummaryMetric | null;
  differences: { mentionRate: number | null; averageRank: number | null; top3: number | null; shareOfMentions: number | null };
  topics: BreakdownMetric[]; markets: BreakdownMetric[];
  trend: { week: string; visibility: number | null; samples: number }[];
  counts: { succeeded: number; failed: number; pending: number; needs_review?: number }; previousFrom: string; previousTo: string;
};
export type Question = BaseQuestion & { schedule_included: boolean };
export type QuestionMetrics = {
  samples: number; mentions: number; all_mentions: number;
  visibility_rate: number | null; share_of_voice: number | null;
};
export type QuestionWithMetrics = Question & { metrics: QuestionMetrics | null };
export type QuestionScope = { topicId: string; marketId: string };
export type Bootstrap = BaseBootstrap & { counts: BaseBootstrap["counts"] & { scheduled: number } };
export type Catalogs = Omit<Bootstrap, "counts" | "worker" | "level">;
export type LiveStatus = Pick<Bootstrap, "counts" | "worker" | "level"> & {
  schedules: { id: string; schedule_enabled: boolean; next_scheduled_at: string | null }[];
  activity: { monitoring: boolean; tests: boolean };
  mappingReviews?: number;
};
export type Source = Omit<BaseSource, "annotation"> & { annotation?: BaseSource["annotation"] };
export type AttemptSummary = Omit<Attempt, "response_text" | "usage">;
export type AnswerAttempt = Omit<Attempt, "usage">;
export type Evidence = Omit<BaseEvidence, "attempts" | "attempt" | "sources"> & { attempts: AttemptSummary[]; attempt: AnswerAttempt | null; sources: Source[] };
export type AttemptDetails = { attempt: AnswerAttempt; sources: Source[] };
export type ScheduleStatus = { lastBatch: Batch | null };
export type ReviewVerdict = "correct" | "partially_correct" | "incorrect" | "unverifiable";
export type AnswerReview = {
  id: string; environment: "qa" | "prod"; run_id: string; attempt_id: string; review_version: number;
  verdict: ReviewVerdict; expected_answer: string | null; ground_truth_url: string | null;
  severity: "high" | "medium" | "low" | null; notes: string | null; reviewed_by: string; created_at: string;
};
export type MappingReview = {
  id: string; environment: "qa" | "prod"; run_id: string; attempt_id: string; mention_index: number;
  observed_name: string; proposed_brand_id: string | null; proposed_brand_name: string; evidence_quote: string;
  status: "pending" | "verified"; verified_brand_id: string | null; verified_brand_name: string | null;
  reference_url: string | null; verification_notes: string | null; verified_at: string | null; created_at: string;
  question_snapshot: Run["question_snapshot"]; purpose: "monitoring" | "test"; run_status: Run["status"];
};
export type ExtractedMention = { name: string; observed_name: string; position: number | null; evidence_quote: string; is_recommendation: boolean };
export type ReviewedEvidence = Evidence & { review: AnswerReview | null; mappingReviews?: MappingReview[]; extractedMentions?: ExtractedMention[] };
export type ValidationAnswer = Pick<Run, "id" | "question_snapshot" | "source" | "scheduled_for" | "finished_at"> & {
  response_preview: string; review_status: ReviewVerdict | "unreviewed"; review: AnswerReview | null;
};
