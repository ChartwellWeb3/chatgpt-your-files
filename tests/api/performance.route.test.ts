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
  const result = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) }, from: vi.fn().mockReturnValue(query), query };
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
});
