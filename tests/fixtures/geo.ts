import type { Bootstrap, Dashboard, OverviewDashboard, Question, ReviewedEvidence, Run } from "@/lib/geo/types";
export const geoId = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const geoBootstrap: Bootstrap = { environment: "qa", level: 2,
  topics: [{ id: geoId(2), slug: "memory-care", name: "Memory Care" }],
  markets: [{ id: geoId(3), slug: "toronto", name: "Toronto", scope: "city", province: "Ontario", city: "Toronto", country_code: "CA" }, { id: geoId(5), slug: "canada", name: "Canada / General", scope: "national", province: null, city: null, country_code: "CA" }],
  brands: [{ id: geoId(4), slug: "chartwell", name: "Chartwell", aliases: [], domains: ["chartwell.com"], is_chartwell: true }],
  benchmarks: [{ id: geoId(10), name: "OpenAI baseline", model: "geo-monitor", analysis_model: "geo-analysis", schedule_enabled: false, schedule_days: [1], schedule_time: "09:00", schedule_timezone: "America/Toronto", next_scheduled_at: null, created_at: "2026-10-01T12:00:00Z" }],
  worker: { dispatcher_enabled: true, last_seen_at: "2026-11-09T14:00:00Z" }, models: { monitor: "geo-monitor", analysis: "geo-analysis", apiKeyConfigured: true }, counts: { active: 1, draft: 2, archived: 0, scheduled: 1 } };
export const geoQuestion: Question = { id: geoId(1), environment: "qa", question: "What are the best memory-care residences in Toronto?", language: "en", question_kind: "unbranded", topic_id: geoId(2), market_id: geoId(3), status: "active", revision: 1, discovery_source: "manual", discovery_notes: null, updated_at: "2026-10-27T12:00:00Z", schedule_included: true };
export const geoRun: Run = { id: geoId(20), question_id: geoId(1), benchmark_id: geoId(10), question_revision: 1,
  question_snapshot: { question: geoQuestion.question, language: "en", questionKind: "unbranded", topicId: geoId(2), topic: "Memory Care", marketId: geoId(3), market: "Toronto", scope: "city", country: "CA", province: "Ontario", city: "Toronto" },
  purpose: "monitoring", batch_id: geoId(40), source: "manual", status: "succeeded", scheduled_for: "2026-10-27T14:00:00Z", selected_attempt_id: geoId(30), finished_at: "2026-10-27T14:01:00Z" };
export const geoDashboard: Dashboard = { overall: [{ group_key: "overall", group_label: "overall", brand_id: geoId(4), brand_name: "Chartwell", is_chartwell: true, samples: 3, mentions: 2, ranked_mentions: 1, top3_mentions: 1, visibility_rate: 2 / 3, average_position: 2, top3_rate: 1 / 3, share_of_voice: 0.4 }],
  previous: [], topics: [], markets: [], trend: [], sources: [], counts: { succeeded: 3, failed: 1, pending: 0 }, previousFrom: "2026-08-29", previousTo: "2026-09-27" };
export const geoOverview: OverviewDashboard = { chartwell: geoDashboard.overall[0], previous: null,
  differences: { mentionRate: null, averageRank: null, top3: null, shareOfMentions: null },
  topics: [], markets: [], trend: [], counts: geoDashboard.counts, previousFrom: geoDashboard.previousFrom, previousTo: geoDashboard.previousTo };
export const geoEvidence: ReviewedEvidence = { run: geoRun, benchmark: geoBootstrap.benchmarks[0], attempts: [], review: null,
  attempt: { id: geoId(30), status: "succeeded", attempt_number: 1, response_text: "Chartwell [1]", returned_model: "geo-monitor-returned", error_message: null, error_stage: null, started_at: "2026-10-27T14:00:00Z", finished_at: "2026-10-27T14:01:00Z" },
  mentions: [{ brand_id: geoId(4), observed_name: "Chartwell", is_recommendation: false, position: null, evidence_quote: "Chartwell" }],
  sources: [{ source_kind: "cited", source_index: 0, url: "https://chartwell.com", normalized_url: "https://chartwell.com/", domain: "chartwell.com", title: "Chartwell website", owner_brand_id: geoId(4), source_type: "owned", annotation: {}, citation_start: 10, citation_end: 13 }] };
