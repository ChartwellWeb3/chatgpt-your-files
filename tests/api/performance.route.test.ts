import { beforeEach, describe, expect, it, vi } from "vitest";
import summary from "../fixtures/performance/summary.json";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), createPerformanceClient: vi.fn(), getPerformanceEnvironment: vi.fn() }));
vi.mock("@/app/utils/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/app/utils/supabase/performance-server", () => ({
  createPerformanceClient: mocks.createPerformanceClient,
  getPerformanceEnvironment: mocks.getPerformanceEnvironment,
  PerformanceConfigurationError: class extends Error {},
}));
import { GET } from "@/app/api/performance/route";

function client(user: { id: string } | null = { id: "viewer" }, data: unknown = [], error: unknown = null) {
  const query: Record<string, any> = {};
  for (const method of ["select", "eq", "is", "gte", "lt", "order", "limit", "in"]) query[method] = vi.fn().mockReturnValue(query);
  query.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve);
  const result = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) }, from: vi.fn().mockReturnValue(query), rpc: vi.fn().mockResolvedValue({ data: [], error: null }), query };
  mocks.createClient.mockResolvedValue({ auth: result.auth });
  mocks.createPerformanceClient.mockReturnValue(result);
  return result;
}
describe("performance API", () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.createPerformanceClient.mockReset();
    mocks.getPerformanceEnvironment.mockReturnValue("qa");
  });
  it("does not query company data for signed-out users", async () => {
    const db = client(null);
    expect((await GET(new Request("http://localhost/api/performance"))).status).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("returns an honest empty state for an authenticated viewer", async () => {
    client();
    const response = await GET(new Request("http://localhost/api/performance?environment=qa"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deployment: null, deployments: [], pages: [], historyPages: [] });
  });
  it("fetches one summary on demand, omitting duplicated pages and commit history", async () => {
    const db = client({ id: "viewer" }, { summary });
    const response = await GET(new Request(`http://localhost/api/performance?view=summary&runId=${summary.measurementId}`));
    const body = await response.json();
    expect(db.from).toHaveBeenCalledWith("performance_runs");
    expect(db.query.eq).toHaveBeenCalledWith("id", summary.measurementId);
    expect(body.summary.measurement.numberOfRuns).toBe(3);
    expect(body.summary.pages).toBeUndefined();
    expect(body.summary.deploymentChanges).toBeUndefined();
  });
  it("surfaces schema and permission errors rather than displaying fixture measurements", async () => {
    client({ id: "viewer" }, null, { message: "permission denied for table performance_deployments", code: "42501" });
    const response = await GET(new Request("http://localhost/api/performance"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "42501", kind: "database" });
  });
  it("uses Toronto calendar boundaries across daylight saving changes", async () => {
    const db = client();
    await GET(new Request("http://localhost/api/performance?from=2026-11-01&to=2026-11-01"));
    expect(db.query.gte).toHaveBeenCalledWith("source_finished_at", "2026-11-01T04:00:00.000Z");
    expect(db.query.lt).toHaveBeenCalledWith("source_finished_at", "2026-11-02T05:00:00.000Z");
  });
  it("rejects invalid dates and IDs before querying performance tables", async () => {
    const db = client();
    expect((await GET(new Request("http://localhost/api/performance?from=2026-02-30"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/performance?deploymentId=bad"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/performance?view=page&runId=bad"))).status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });
  const deploymentId = "00000000-0000-4000-8000-000000000001";
  const runId = "00000000-0000-4000-8000-000000000002";
  const trendUrl = `http://localhost/api/performance?view=trend&device=mobile&deploymentIds=${deploymentId}&referenceRunId=${runId}&selectedRunId=${runId}`;
  it("authenticates before allowing any trend RPC", async () => {
    const db = client(null);
    expect((await GET(new Request(trendUrl))).status).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(mocks.createPerformanceClient).not.toHaveBeenCalled();
  });
  it("delegates overall averages to Supabase and enforces the configured environment", async () => {
    const db = client();
    const points = [{ deploymentId, value: 49.25, includedPages: 8, totalPages: 10 }];
    db.rpc.mockResolvedValue({ data: points, error: null });
    const response = await GET(new Request(trendUrl + "&environment=prod"));
    expect(db.rpc).toHaveBeenCalledWith("performance_overall_trend", {
      p_environment: "qa", p_deployment_ids: [deploymentId], p_device: "mobile", p_reference_run_id: runId, p_selected_run_id: runId,
    });
    expect(await response.json()).toEqual({ points });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(db.from).not.toHaveBeenCalled();
  });
  it("uses the page RPC with the selected attempt and page identity", async () => {
    const db = client();
    await GET(new Request(trendUrl + "&pageId=home-en"));
    expect(db.rpc).toHaveBeenCalledWith("performance_page_trend", expect.objectContaining({ p_page_id: "home-en", p_selected_run_id: runId }));
  });
  it("rejects malformed trend requests without calling the database", async () => {
    const db = client();
    for (const url of [trendUrl.replace("device=mobile", "device=tablet"), trendUrl.replace(runId, "bad"), trendUrl + "&pageId=", trendUrl.replace(`&selectedRunId=${runId}`, "") + "&pageId=home-en", trendUrl.replace(deploymentId, "bad")]) {
      expect((await GET(new Request(url))).status).toBe(400);
    }
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("shows a setup error until the SQL has been installed", async () => {
    const db = client();
    db.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Function missing" } });
    const response = await GET(new Request(trendUrl));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "PERFORMANCE_FUNCTIONS_NOT_INSTALLED", kind: "configuration" });
  });
  it("returns validation and database failures without fabricating points", async () => {
    const db = client();
    db.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "Reference measurement not found" } });
    expect((await GET(new Request(trendUrl))).status).toBe(400);
    db.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Permission denied" } });
    expect((await GET(new Request(trendUrl))).status).toBe(503);
  });
  const pagesUrl = `http://localhost/api/performance?view=pages&runIds=${runId}`;
  it("authenticates before page searches", async () => {
    const db = client(null);
    expect((await GET(new Request(pagesUrl))).status).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("delegates page filtering, sorting, and pagination to the performance database", async () => {
    const db = client();
    const data = { pages: [{ page_id: "home" }], total: 25, page: 1, pageSize: 8 };
    db.rpc.mockResolvedValue({ data, error: null });
    const response = await GET(new Request(pagesUrl + "&device=desktop&search=home&sort=lcp&direction=desc&page=1&environment=prod"));
    expect(db.rpc).toHaveBeenCalledWith("performance_page_results_page", {
      p_environment: "qa", p_run_ids: [runId], p_device: "desktop", p_search: "home", p_sort: "lcp", p_ascending: false, p_page: 1, p_page_size: 8,
    });
    expect(await response.json()).toEqual(data);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("validates table filters before calling SQL", async () => {
    const db = client();
    for (const suffix of ["&device=tablet", "&sort=invalid", "&direction=up", "&page=-1", "&page=1.5", `&search=${"x".repeat(201)}`]) {
      expect((await GET(new Request(pagesUrl + suffix))).status).toBe(400);
    }
    expect((await GET(new Request(pagesUrl.replace(runId, "bad")))).status).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("loads run summaries instead of downloading all page results for the overview", async () => {
    const db = client({ id: "viewer" }, [{ id: deploymentId }]);
    const runSummaries = { [deploymentId]: { total: 80, included: 75, score: 70 } };
    db.rpc.mockResolvedValue({ data: runSummaries, error: null });
    const response = await GET(new Request("http://localhost/api/performance"));
    expect(db.rpc).toHaveBeenCalledWith("performance_run_summaries", { p_environment: "qa", p_run_ids: [deploymentId] });
    expect(db.from).not.toHaveBeenCalledWith("performance_page_results");
    expect(await response.json()).toMatchObject({ runSummaries, pages: [], historyPages: [] });
  });
});
