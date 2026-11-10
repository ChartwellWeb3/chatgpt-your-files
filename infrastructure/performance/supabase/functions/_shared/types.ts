export type Environment = "qa" | "prod";
export type QuestionStatus = "draft" | "active" | "archived";
export type QuestionKind = "unbranded" | "branded";
export type Topic = { id: string; name: string; slug: string };
export type Market = Topic & { scope: "national" | "province" | "city"; country_code: string; province: string | null; city: string | null };
export type Brand = Topic & { aliases: string[]; domains: string[]; is_chartwell: boolean };
export type Question = {
  id: string; environment: Environment; question: string; language: "en" | "fr";
  question_kind: QuestionKind; topic_id: string; market_id: string; status: QuestionStatus;
  revision: number; discovery_source: string; discovery_notes: string | null; updated_at: string;
};
export type Benchmark = { id: string; name: string; model: string; analysis_model: string; schedule_enabled: boolean; schedule_days: number[]; schedule_time: string; schedule_timezone: string; next_scheduled_at: string | null; created_at: string };
export type Snapshot = { question: string; language: string; questionKind: QuestionKind; topicId: string; topic: string; marketId: string; market: string; scope: string; country: string; province: string | null; city: string | null };
export type Run = { id: string; question_id: string; benchmark_id: string; purpose: "monitoring" | "test" | null; batch_id: string | null; question_revision: number; question_snapshot: Snapshot; source: "manual" | "scheduled"; status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "needs_review"; scheduled_for: string; selected_attempt_id: string | null; finished_at: string | null; lease_expires_at?: string | null };
export type Metric = { group_key: string; group_label: string; brand_id: string; brand_name: string; is_chartwell: boolean; samples: number; mentions: number; ranked_mentions: number; top3_mentions: number; visibility_rate: number | null; average_position: number | null; top3_rate: number | null; share_of_voice: number | null };
export type SourceSummary = { domain: string; cited_answers: number; consulted_answers: number; urls: number; example_url: string; title: string | null };
export type Source = { id?: string; source_kind: "cited" | "consulted"; source_index: number; url: string; normalized_url: string; domain: string; title: string | null; owner_brand_id: string | null; source_type: "owned" | "unknown"; annotation: Record<string, unknown>; citation_start: number | null; citation_end: number | null };
export type Mention = { brand_id: string; observed_name: string; is_recommendation: boolean; position: number | null; evidence_quote: string };
export type Attempt = { id: string; status: string; attempt_number: number; response_text: string | null; returned_model: string | null; error_message: string | null; error_stage: string | null; usage: Record<string, unknown>; started_at: string; finished_at: string | null };
export type Evidence = { run: Run; attempts: Attempt[]; attempt: Attempt | null; mentions: Mention[]; sources: Source[]; benchmark: Benchmark };
export type Insight = { id: string; title: string; opportunity: string; status: "new" | "investigating" | "dismissed"; model: string; period_start: string; period_end: string; created_at: string; geo_insight_evidence: { run_id: string }[] };
export type Bootstrap = { environment: Environment; level: 1 | 2 | 3; topics: Topic[]; markets: Market[]; brands: Brand[]; benchmarks: Benchmark[]; models: { monitor: string | null; analysis: string | null; apiKeyConfigured: boolean }; worker: { dispatcher_enabled: boolean; last_seen_at: string | null }; counts: { draft: number; active: number; archived: number } };
export type Filters = { benchmarkId: string; from: string; to: string; topicId: string; marketId: string; language: string; questionKind: string };
export type Dashboard = { overall: Metric[]; previous: Metric[]; topics: Metric[]; markets: Metric[]; trend: Metric[]; sources: SourceSummary[]; counts: { succeeded: number; failed: number; pending: number }; previousFrom: string; previousTo: string };
export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number };

export type Batch = { id: string; environment: Environment; benchmark_id: string; purpose: "monitoring" | "test"; trigger_kind: string; created_at: string; scheduled_for: string; total: number; queued: number; collecting: number; analyzing: number; completed: number; failed: number; cancelled: number; needs_review: number; mapping_review?: number; cancelled_at?: string | null; cancelled_by?: string | null };
