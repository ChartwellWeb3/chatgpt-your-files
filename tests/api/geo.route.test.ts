import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authClient: vi.fn(), performanceClient: vi.fn(), environment: vi.fn(), response: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/utils/supabase/server", () => ({ createClient: mocks.authClient }));
vi.mock("@/app/utils/supabase/performance-server", () => ({ createPerformanceClient: mocks.performanceClient, getPerformanceEnvironment: mocks.environment, PerformanceConfigurationError: class extends Error {} }));
vi.mock("openai", () => ({ default: class { responses = { create: mocks.response }; } }));
import { GET, POST } from "@/app/api/geo/route";
import { POST as AI } from "@/app/api/geo/ai/route";

const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function query(result: { data: any; error?: unknown; count?: number }) {
  const q: Record<string, any> = {};
  for (const method of ["select", "eq", "is", "gte", "lt", "lte", "in", "ilike", "order", "range", "limit", "contains", "insert", "update"]) q[method] = vi.fn().mockReturnValue(q);
  q.maybeSingle = vi.fn().mockResolvedValue(result); q.single = vi.fn().mockResolvedValue(result);
  q.then = (resolve: (data: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return q;
}
function setup(level = 2, user: unknown = { id: id(999), email_confirmed_at: "2026-01-01" }, tables: Record<string, any> = {}) {
  const profiles = query({ data: { level } });
  mocks.authClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) }, from: vi.fn().mockReturnValue(profiles) });
  const queries: Record<string, ReturnType<typeof query>[]> = {};
  const db = { from: vi.fn((table: string) => {
    const q = query({ data: table in tables ? tables[table] : table === "geo_worker_runtime" ? { dispatcher_enabled: true, last_seen_at: new Date().toISOString() } : [], error: null, count: 0 });
    (queries[table] ||= []).push(q); return q;
  }), rpc: vi.fn().mockResolvedValue({ data: [], error: null }) };
  mocks.performanceClient.mockReturnValue(db); return { db, queries };
}
const request = (body: unknown, url = "/api/geo", origin = "http://localhost") => new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
const filters = `benchmarkId=${id(10)}&from=2026-11-01&to=2026-11-01`;

describe("GEO API authorization and database boundaries", () => {
  it("rejects missing worker runtime for collection and schedule activation", async () => {
    const { db } = setup(1, undefined, { geo_worker_runtime: null });
    expect((await AI(request({ action: "runNow", questionId: id(1), benchmarkId: id(10), requestKey: id(50) }, "/api/geo/ai"))).status).toBe(503);
    expect((await POST(request({ action: "schedule", benchmarkId: id(10), enabled: true }))).status).toBe(503);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(mocks.response).not.toHaveBeenCalled();
  });
  it("rejects missing required catalog data while preserving optional not-found responses", async () => {
    setup(3, undefined, { geo_topics: null });
    expect((await GET(new Request("http://localhost/api/geo?view=catalogs"))).status).toBe(503);
    setup(3, undefined, { geo_runs: null });
    expect((await GET(new Request(`http://localhost/api/geo?view=evidence&runId=${id(20)}`))).status).toBe(404);
  });
  it("requests a compact paginated question metric result with server-controlled environment", async () => {
    const { db } = setup(3);
    db.rpc.mockResolvedValue({ data: { rows: [], total: 0, page: 2, pageSize: 10 }, error: null });
    const response = await GET(new Request(`http://localhost/api/geo?view=questionMetrics&${filters}&topicId=${id(2)}&marketId=${id(3)}&questionKind=all&page=2&environment=prod&includeManual=true`));
    expect(response.status).toBe(200);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith("geo_question_metrics_page", {
      p_environment: "qa", p_benchmark_id: id(10), p_from: "2026-11-01", p_to: "2026-11-01",
      p_topic_id: id(2), p_market_id: id(3), p_question_kind: null, p_language: null, p_status: null, p_search: "", p_page: 2, p_page_size: 10,
    });
    expect(db.from).not.toHaveBeenCalled();
  });
  it("allows question browsing before a benchmark exists without mixing all benchmarks", async () => {
    const { db } = setup(3);
    expect((await GET(new Request("http://localhost/api/geo?view=questionMetrics&from=2026-11-01&to=2026-11-10"))).status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith("geo_question_metrics_page", expect.objectContaining({ p_benchmark_id: null, p_environment: "qa" }));
  });
  it("filters question answer history by identity and revision before pagination", async () => {
    const { queries, db } = setup(3);
    const response = await GET(new Request(`http://localhost/api/geo?view=runs&${filters}&questionId=${id(1)}&questionRevision=2&status=succeeded&page=1&includeManual=true`));
    expect(response.status).toBe(200);
    const history = queries.geo_reporting_runs[0];
    expect(history.eq).toHaveBeenCalledWith("question_id", id(1));
    expect(history.eq).toHaveBeenCalledWith("question_revision", 2);
    expect(history.eq).toHaveBeenCalledWith("environment", "qa");
    expect(history.eq).toHaveBeenCalledWith("status", "succeeded");
    expect(history.range).toHaveBeenCalledWith(10, 19);
    expect(db.from).not.toHaveBeenCalledWith("geo_test_runs");
    expect((await GET(new Request(`http://localhost/api/geo?view=runs&${filters}&questionRevision=2`))).status).toBe(400);
  });
  it("validates question-metric filters before calling the database", async () => {
    const { db } = setup(3);
    for (const invalid of ["topicId=invalid", "questionKind=other", "language=es", "status=other", "page=-1", "to=2026-02-30"]) {
      const url = new URL(`http://localhost/api/geo?view=questionMetrics&${filters}`);
      const [key, value] = invalid.split("="); url.searchParams.set(key, value);
      expect((await GET(new Request(url))).status).toBe(400);
    }
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("returns the environment-wide mapping queue without reporting filters", async () => {
    const { queries } = setup(3);
    const response = await GET(new Request("http://localhost/api/geo?view=mappingReviews&page=1&environment=prod"));
    expect(response.status).toBe(200);
    expect(queries.geo_mapping_review_queue[0].eq).toHaveBeenCalledWith("environment", "qa");
    expect(queries.geo_mapping_review_queue[0].range).toHaveBeenCalledWith(10, 19);
    expect(queries.geo_mapping_review_queue[0].select.mock.calls[0][0]).not.toContain("raw_mention");
  });
  it.each([2, 3])("blocks level %s from verifying or rechecking mappings", async level => {
    const { db } = setup(level);
    for (const action of ["verifyMapping", "recheckMapping"]) {
      expect((await POST(request({ action, runId: id(20), reviewId: id(60) }))).status).toBe(403);
    }
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("verifies a mapping with the authenticated admin and server environment", async () => {
    const { db } = setup(1);
    const input = { action: "verifyMapping", reviewId: id(60), brandId: id(4), referenceUrl: "https://operator.example/community", notes: "Official community page", confirmed: true, environment: "prod", actor: id(1) };
    expect((await POST(request({ ...input, confirmed: false }))).status).toBe(400);
    expect((await POST(request({ ...input, referenceUrl: "javascript:alert(1)" }))).status).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
    expect((await POST(request(input))).status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith("geo_verify_mapping", { p_environment: "qa", p_review_id: id(60), p_actor: id(999), p_brand_id: id(4), p_brand_name: null, p_reference_url: input.referenceUrl, p_notes: input.notes });
    expect(mocks.response).not.toHaveBeenCalled();
  });
  it("queues an admin recheck of saved analysis without calling AI", async () => {
    const { db } = setup(1);
    expect((await POST(request({ action: "recheckMapping", runId: id(20) }))).status).toBe(202);
    expect(db.rpc).toHaveBeenCalledWith("geo_recheck_mapping", { p_environment: "qa", p_run_id: id(20) });
    expect(mocks.response).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    mocks.environment.mockReturnValue("qa");
    vi.stubEnv("OPENAI_API_KEY", "test-secret-never-return");
    vi.stubEnv("OPENAI_GEO_MONITOR_MODEL", "geo-monitor"); vi.stubEnv("OPENAI_GEO_ANALYSIS_MODEL", "geo-analysis");
    vi.stubEnv("OPENAI_ANALYSIS_MODEL", "chatbot-model");
  });
  afterEach(() => vi.unstubAllEnvs());
  it("authenticates before initializing the privileged client for every handler", async () => {
    setup(3, null);
    expect((await GET(new Request("http://localhost/api/geo"))).status).toBe(401);
    expect((await POST(request({ action: "saveQuestion" }))).status).toBe(401);
    expect((await AI(request({ action: "run" }, "/api/geo/ai"))).status).toBe(401);
    expect(mocks.performanceClient).not.toHaveBeenCalled(); expect(mocks.response).not.toHaveBeenCalled();
  });
  it("rejects unverified users and level-three mutations before database access", async () => {
    setup(2, { id: id(999) }); expect((await GET(new Request("http://localhost/api/geo"))).status).toBe(403);
    setup(3); expect((await POST(request({ action: "saveQuestion" }))).status).toBe(403);
    expect((await AI(request({ action: "discover" }, "/api/geo/ai"))).status).toBe(403);
    expect(mocks.performanceClient).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes and non-admin benchmark creation", async () => {
    setup(); expect((await POST(request({ action: "saveQuestion" }, "/api/geo", "https://elsewhere.test"))).status).toBe(403);
    expect((await AI(request({ action: "createBenchmark", name: "Test" }, "/api/geo/ai"))).status).toBe(403);
    expect(mocks.response).not.toHaveBeenCalled();
  });
  it("uses the configured environment and Toronto DST boundaries for metrics", async () => {
    const { db } = setup(3);
    db.rpc.mockImplementation(async (name: string) => ({ data: name === "geo_dashboard_summary" ? { counts: { succeeded: 0, failed: 0, pending: 0 }, sources: [] } : [], error: null }));
    const response = await GET(new Request(`http://localhost/api/geo?view=dashboard&${filters}&environment=prod`));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(db.rpc).toHaveBeenCalledWith("geo_brand_metrics", expect.objectContaining({ p_environment: "qa", p_start: "2026-11-01T04:00:00.000Z", p_end: "2026-11-02T05:00:00.000Z", p_include_manual: false, p_question_kind: "unbranded" }));
  });
  it("rejects malformed dates, UUIDs and view options before querying tables", async () => {
    const { db } = setup();
    for (const suffix of ["view=dashboard&benchmarkId=bad&from=2026-10-01&to=2026-10-02", `view=dashboard&${filters.replace("2026-11-01", "2026-99-99")}`, "view=questions&page=bad", "view=unknown"]) {
      expect((await GET(new Request(`http://localhost/api/geo?${suffix}`))).status).toBe(400);
    }
    expect(db.from).not.toHaveBeenCalled(); expect(db.rpc).not.toHaveBeenCalled();
  });
  it("loads one compact SQL overview with a fixed unbranded cohort", async () => {
    const { db } = setup(3);
    db.rpc.mockResolvedValue({ data: { chartwell: { samples: 10 }, counts: { succeeded: 10 }, trend: [] }, error: null });
    for (const kind of ["all", "branded"]) {
      db.rpc.mockClear();
      const response = await GET(new Request(`http://localhost/api/geo?view=overview&${filters}&questionKind=${kind}&includeManual=true&environment=prod&topicId=${id(2)}&marketId=${id(3)}&language=fr`));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ chartwell: { samples: 10 }, counts: { succeeded: 10 } });
      expect(db.rpc).toHaveBeenCalledTimes(1);
      expect(db.rpc).toHaveBeenCalledWith("geo_overview", { p_environment: "qa", p_benchmark_id: id(10), p_from: "2026-11-01", p_to: "2026-11-01", p_topic_id: id(2), p_market_id: id(3), p_language: "fr" });
    }
  });
  it("keeps static catalogs separate from frequently refreshed live data", async () => {
    const { db } = setup(3);
    const catalogs = await GET(new Request("http://localhost/api/geo?view=catalogs"));
    expect(catalogs.status).toBe(200);
    expect(await catalogs.json()).not.toHaveProperty("worker");
    expect(db.rpc).not.toHaveBeenCalled();
    const tablesBefore = db.from.mock.calls.length;
    await GET(new Request("http://localhost/api/geo?view=live&environment=prod"));
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith("geo_live_status", { p_environment: "qa" });
    expect(db.from.mock.calls.length).toBe(tablesBefore);
  });
  it("returns only the calculation requested by each reporting tab", async () => {
    const { db } = setup(3);
    db.rpc.mockResolvedValueOnce({ data: [{ is_chartwell: true, mentions: 0, samples: 3 }, { is_chartwell: false, mentions: 0, samples: 3 }], error: null });
    const competitors = await GET(new Request(`http://localhost/api/geo?view=competitors&${filters}`));
    expect(await competitors.json()).toMatchObject({ samples: 3, rows: [{ is_chartwell: true }] });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith("geo_brand_metrics", expect.objectContaining({ p_group_by: "overall" }));
    db.rpc.mockClear();
    db.rpc.mockResolvedValueOnce({ data: { sources: [], counts: { succeeded: 3 } }, error: null });
    const sources = await GET(new Request(`http://localhost/api/geo?view=sources&${filters}`));
    expect(await sources.json()).toEqual({ sources: [] });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith("geo_dashboard_summary", expect.any(Object));
    db.rpc.mockClear(); db.rpc.mockResolvedValueOnce({ data: 3, error: null });
    const opportunities = await GET(new Request(`http://localhost/api/geo?view=opportunities&${filters}`));
    expect(await opportunities.json()).toMatchObject({ answerCount: 3, rows: [] });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith("geo_reporting_count", expect.objectContaining({ p_environment: "qa", p_include_manual: false }));
  });
  it("loads one full selected answer with metadata only for other attempts", async () => {
    const run = { id: id(20), environment: "qa", benchmark_id: id(10), selected_attempt_id: id(30), status: "succeeded", purpose: "monitoring", question_snapshot: { questionKind: "unbranded" } };
    const { db } = setup(3, undefined, { geo_runs: run, geo_benchmarks: { id: id(10) } });
    const metadata = query({ data: [{ id: id(30), status: "succeeded", attempt_number: 1 }] });
    const full = query({ data: { id: id(30), status: "succeeded", response_text: "One selected answer" } });
    const originalFrom = db.from.getMockImplementation()!;
    db.from.mockImplementation((table: string) => table === "geo_run_attempts"
      ? { select: vi.fn((fields: string) => fields.includes("response_text") ? full : metadata) } as any
      : originalFrom(table));
    const response = await GET(new Request(`http://localhost/api/geo?view=evidence&runId=${id(20)}`));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.attempt.response_text).toBe("One selected answer");
    expect(body.attempts[0]).not.toHaveProperty("response_text");
    expect(body).not.toHaveProperty("reviewHistory");
    expect(full.eq).toHaveBeenCalledWith("id", id(30));
    expect(full.eq).toHaveBeenCalledWith("run_id", id(20));
  });
  it("ignores submitted environments and approval fields when creating drafts", async () => {
    const { queries } = setup(2, undefined, { geo_questions: { id: id(1), status: "draft" } });
    const response = await POST(request({ action: "saveQuestion", question: "What are good retirement options?", language: "en", question_kind: "unbranded", topic_id: id(2), market_id: id(3), environment: "prod", approved_by: "attacker", status: "active" }));
    expect(response.status).toBe(201);
    expect(queries.geo_questions[0].insert).toHaveBeenCalledWith(expect.objectContaining({ environment: "qa", status: "draft", created_by: id(999) }));
    expect(queries.geo_questions[0].insert.mock.calls[0][0].approved_by).toBeUndefined();
  });
  it("guards concurrent edits with a question revision", async () => {
    const { queries } = setup(2, undefined, { geo_questions: null });
    const response = await POST(request({ action: "saveQuestion", id: id(1), revision: 2, question: "Which retirement options should we consider?", language: "fr", question_kind: "unbranded", topic_id: id(2), market_id: id(3) }));
    expect(response.status).toBe(409); expect(queries.geo_questions[0].eq).toHaveBeenCalledWith("revision", 2);
  });
  it("restricts factual validation to branded answers even when legacy requests ask for other question types", async () => {
    const { queries } = setup(3);
    for (const kind of ["branded", "unbranded", "all"]) {
      const response = await GET(new Request(`http://localhost/api/geo?view=validation&${filters}&environment=prod&questionKind=${kind}&reviewStatus=unreviewed&includeManual=true`));
      expect(response.status).toBe(200);
      const q = queries.geo_answer_validation.at(-1)!;
      expect(q.eq).toHaveBeenCalledWith("environment", "qa");
      expect(q.eq).toHaveBeenCalledWith("question_snapshot->>questionKind", "branded");
      expect(q.eq).toHaveBeenCalledWith("review_status", "unreviewed");
      expect(q.range).toHaveBeenCalledWith(0, 9);
    }
    expect(queries.geo_test_runs).toBeUndefined();
  });
  it("updates only schedule selection with the original-project actor and question revision", async () => {
    const { queries } = setup(2, undefined, { geo_questions: { id: id(1), schedule_included: false } });
    const response = await POST(request({ action: "questionSchedule", id: id(1), revision: 2, enabled: false, environment: "prod", updated_by: "attacker" }));
    expect(response.status).toBe(200);
    expect(queries.geo_questions[0].update).toHaveBeenCalledWith({ schedule_included: false, updated_by: id(999) });
    expect(queries.geo_questions[0].eq).toHaveBeenCalledWith("environment", "qa");
    expect(queries.geo_questions[0].eq).toHaveBeenCalledWith("revision", 2);
  });
  it("validates human reference evidence and uses the server actor for review writes", async () => {
    const { db } = setup(2, undefined, { geo_reporting_runs: { id: id(20), selected_attempt_id: id(30), question_snapshot: { questionKind: "branded" } } });
    const input = { action: "reviewAnswer", runId: id(20), attemptId: id(30), verdict: "incorrect", expectedAnswer: "The residence offers memory care.", groundTruthUrl: "https://chartwell.com/residence", notes: "The answer incorrectly says that memory care is unavailable.", severity: "high", expectedReviewId: null, confirmed: true, reviewed_by: "attacker", environment: "prod" };
    expect((await POST(request({ ...input, confirmed: false }))).status).toBe(400);
    expect((await POST(request({ ...input, groundTruthUrl: "javascript:alert(1)" }))).status).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
    expect((await POST(request(input))).status).toBe(201);
    expect(db.rpc).toHaveBeenCalledWith("geo_review_answer", expect.objectContaining({ p_environment: "qa", p_actor: id(999), p_run_id: id(20), p_attempt_id: id(30), p_expected_review_id: null, p_verdict: "incorrect", p_severity: "high" }));
  });
  it("blocks review writes for answers without brand names before calling the review RPC", async () => {
    const { db } = setup(2, undefined, { geo_reporting_runs: { id: id(20), selected_attempt_id: id(30), question_snapshot: { questionKind: "unbranded" } } });
    expect((await POST(request({ action: "reviewAnswer", runId: id(20), attemptId: id(30), verdict: "unverifiable", notes: "No objective reference for this answer." }))).status).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("rejects concurrent review edits and level-three review or schedule mutations", async () => {
    const { db } = setup(2, undefined, { geo_reporting_runs: { id: id(20), selected_attempt_id: id(30), question_snapshot: { questionKind: "branded" } } });
    db.rpc.mockResolvedValue({ data: null, error: { code: "40001" } });
    expect((await POST(request({ action: "reviewAnswer", runId: id(20), attemptId: id(30), verdict: "unverifiable", notes: "The reference could not establish this service." }))).status).toBe(409);
    vi.mocked(mocks.performanceClient).mockClear();
    setup(3);
    expect((await POST(request({ action: "reviewAnswer" }))).status).toBe(403);
    expect((await POST(request({ action: "questionSchedule" }))).status).toBe(403);
    expect(mocks.performanceClient).not.toHaveBeenCalled();
  });
  it("returns setup errors for absent SQL and never returns provider keys", async () => {
    const { db } = setup(); db.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "missing" } });
    const response = await GET(new Request(`http://localhost/api/geo?view=dashboard&${filters}`));
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "GEO_SETUP_REQUIRED" });
    setup(3); const bootstrap = await GET(new Request("http://localhost/api/geo")); const result = await bootstrap.json();
    expect(result.models).toEqual({ monitor: "geo-monitor", analysis: "geo-analysis", apiKeyConfigured: true });
    expect(JSON.stringify(result)).not.toContain("test-secret");
  });
  it("does not expose raw attempts for runs outside the current environment", async () => {
    const { queries } = setup(3, undefined, { geo_runs: null });
    expect((await GET(new Request(`http://localhost/api/geo?view=raw&runId=${id(20)}&attemptId=${id(30)}`))).status).toBe(404);
    expect(queries.geo_runs[0].eq).toHaveBeenCalledWith("environment", "qa");
    expect(queries.geo_run_attempts).toBeUndefined();
  });
  it("uses dedicated model settings and never falls back to chatbot models", async () => {
    setup(1); vi.stubEnv("OPENAI_GEO_MONITOR_MODEL", "");
    expect((await AI(request({ action: "createBenchmark", name: "Test" }, "/api/geo/ai"))).status).toBe(503);
    expect(mocks.response).not.toHaveBeenCalled();
    vi.stubEnv("OPENAI_GEO_MONITOR_MODEL", "geo-monitor"); const { queries } = setup(1);
    expect((await AI(request({ action: "createBenchmark", name: "October baseline" }, "/api/geo/ai"))).status).toBe(201);
    expect(queries.geo_benchmarks[0].insert).toHaveBeenCalledWith(expect.objectContaining({ model: "geo-monitor", analysis_model: "geo-analysis", schedule_enabled: false }));
  });
  it("queues reporting work with a durable request key and never calls OpenAI in the website", async () => {
    const { db } = setup();
    db.rpc.mockResolvedValue({ data: { existing: true, batchId: id(40), runId: id(20), purpose: "monitoring" }, error: null });
    const response = await AI(request({ action: "runNow", questionId: id(1), benchmarkId: id(10), requestKey: id(50) }, "/api/geo/ai"));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ existing: true, runId: id(20) });
    expect(db.rpc).toHaveBeenCalledWith("geo_enqueue", expect.objectContaining({ p_kind: "single", p_environment: "qa", p_request_key: id(50) }));
    expect(mocks.response).not.toHaveBeenCalled();
  });
  it("queues Test and Run all with server-controlled purposes and question scopes", async () => {
    const { db } = setup();
    for (const [action, kind, questionId] of [["test", "test", id(1)], ["runAll", "all", null]]) {
      const response = await AI(request({ action, questionId, benchmarkId: id(10), requestKey: id(50), purpose: "attacker" }, "/api/geo/ai"));
      expect(response.status).toBe(202);
      expect(db.rpc).toHaveBeenCalledWith("geo_enqueue", expect.objectContaining({ p_kind: kind, p_question_id: questionId, p_actor: id(999) }));
    }
    expect(mocks.response).not.toHaveBeenCalled();
  });
  it("ignores legacy includeManual and reads reporting-only history", async () => {
    const { db, queries } = setup(3);
    await GET(new Request(`http://localhost/api/geo?view=dashboard&${filters}&includeManual=true`));
    expect(db.rpc).toHaveBeenCalledWith("geo_brand_metrics", expect.objectContaining({ p_include_manual: false }));
    expect((await GET(new Request(`http://localhost/api/geo?view=runs&${filters}&includeManual=true`))).status).toBe(200);
    expect(queries.geo_reporting_runs).toHaveLength(1);
    expect(queries.geo_runs).toBeUndefined();
  });
  it("allows test history without reporting dates and blocks non-admin schedule changes", async () => {
    const { queries } = setup();
    expect((await GET(new Request("http://localhost/api/geo?view=tests"))).status).toBe(200);
    expect(queries.geo_test_runs[0].eq).toHaveBeenCalledWith("environment", "qa");
    expect((await POST(request({ action: "schedule", benchmarkId: id(10), enabled: true }))).status).toBe(403);
  });
  it("authorizes cancellation and supplies the server environment and actor", async () => {
    const { db } = setup(2);
    db.rpc.mockResolvedValue({ data: { batchId: id(40), cancelled: 12 }, error: null });
    const response = await POST(request({ action: "cancelBatch", batchId: id(40), environment: "prod", actor: id(1) }));
    expect(response.status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith("geo_cancel_batch", { p_environment: "qa", p_batch_id: id(40), p_actor: id(999) });
    setup(3);
    expect((await POST(request({ action: "cancelBatch", batchId: id(40) }))).status).toBe(403);
  });
  it("prevents retrying a cancelled collection", async () => {
    const { db } = setup(2, undefined, { geo_batches: { id: id(40), cancelled_at: "2026-11-09T17:00:00Z" } });
    expect((await POST(request({ action: "retryBatch", batchId: id(40), requestKey: id(50) }))).status).toBe(409);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("excludes cancelled collections before pagination while retaining schedule history on request", async () => {
    const { queries } = setup(3);
    expect((await GET(new Request(`http://localhost/api/geo?view=batches&benchmarkId=${id(10)}`))).status).toBe(200);
    expect(queries.geo_batch_progress[0].is).toHaveBeenCalledWith("cancelled_at", null);
    expect(queries.geo_batch_progress[0].range).toHaveBeenCalledWith(0, 9);
    expect((await GET(new Request(`http://localhost/api/geo?view=batches&benchmarkId=${id(10)}&kind=scheduled&includeCancelled=true`))).status).toBe(200);
    expect(queries.geo_batch_progress[1].is).not.toHaveBeenCalled();
  });
});
