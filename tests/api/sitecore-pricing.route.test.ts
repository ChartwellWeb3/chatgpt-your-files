// @vitest-environment node
// Authored for later execution; tests/builds were not run during implementation.
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), createPerformanceClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/utils/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/app/utils/supabase/performance-server", () => ({ createPerformanceClient: mocks.createPerformanceClient, PerformanceConfigurationError: class extends Error {} }));
import { DELETE, GET, POST } from "@/app/api/sitecore/pricing/route";
import { getPricingConfig } from "@/lib/sitecore-pricing/config";

function auth(level: number | null, verified = true, featureAccess: unknown = { sitecore_pricing: true }) {
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: level === null ? null : { id: "actor", email_confirmed_at: verified ? "2026-01-01" : null } }, error: null }) },
    from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { level, feature_access: featureAccess }, error: null }) }) }) }),
  });
}
describe("pricing authorization", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it.each([null, 3, 99])("denies role %s before constructing the performance secret client", async level => {
    auth(level);
    expect([401, 403]).toContain((await GET(new Request("https://manager.test/api/sitecore/pricing"))).status);
    expect(mocks.createPerformanceClient).not.toHaveBeenCalled();
  });
  it.each([null, {}, [], { sitecore_pricing: false }, { sitecore_pricing: "true" }, { performance: true }])("denies missing or disabled Suite Pricing access %j before opening the performance database", async grant => {
    auth(2, true, grant);
    const requests = [
      GET(new Request("https://manager.test/api/sitecore/pricing")),
      GET(new Request("https://manager.test/api/sitecore/pricing?view=export&id=00000000-0000-4000-8000-000000000001&environment=prod")),
      POST(new Request("https://manager.test/api/sitecore/pricing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run" }) })),
      POST(new Request("https://manager.test/api/sitecore/pricing", { method: "POST", body: new FormData() })),
      DELETE(new Request("https://manager.test/api/sitecore/pricing", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" })),
    ];
    for (const response of await Promise.all(requests)) expect(response.status).toBe(403);
    expect(mocks.createPerformanceClient).not.toHaveBeenCalled();
  });
  it("allows admins with Suite Pricing switched off in the stored JSON", async () => {
    auth(1, true, { sitecore_pricing: false });
    mocks.createPerformanceClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: true, error: null }) });
    const response = await DELETE(new Request("https://manager.test/api/sitecore/pricing", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000001" }) }));
    expect(response.status).toBe(200); expect(mocks.createPerformanceClient).toHaveBeenCalledOnce();
  });
  it("requires verified users", async () => {
    auth(1, false);
    expect((await GET(new Request("https://manager.test/api/sitecore/pricing"))).status).toBe(403);
    expect(mocks.createPerformanceClient).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes before opening the performance database", async () => {
    auth(2);
    const response = await POST(new Request("https://manager.test/api/sitecore/pricing", { method: "POST", headers: { origin: "https://elsewhere.test", "Content-Type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(403);
    expect(mocks.createPerformanceClient).not.toHaveBeenCalled();
  });
  it("requires the explicit server DEV authoring host and rejects Experience Edge", () => {
    vi.stubEnv("SITECORE_PRICING_DEV_CM_URL", "https://edge.sitecorecloud.io");
    expect(() => getPricingConfig()).toThrow("Experience Edge");
    vi.unstubAllEnvs();
  });
  it.each([null, 3])("denies deletion by role %s before constructing the secret client", async level => {
    auth(level);
    const response = await DELETE(new Request("https://manager.test/api/sitecore/pricing", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000001" }) }));
    expect([401, 403]).toContain(response.status);
    expect(mocks.createPerformanceClient).not.toHaveBeenCalled();
  });
  it("rejects cross-origin deletion before opening the database", async () => {
    auth(1);
    const response = await DELETE(new Request("https://manager.test/api/sitecore/pricing", { method: "DELETE", headers: { origin: "https://elsewhere.test", "Content-Type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(403); expect(mocks.createPerformanceClient).not.toHaveBeenCalled();
  });
  it.each([1, 2])("deletes history for role %s without any Sitecore request or pricing configuration", async level => {
    auth(level);
    vi.stubEnv("SITECORE_PRICING_DEV_CM_URL", "");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    mocks.createPerformanceClient.mockReturnValue({ rpc });
    const id = "00000000-0000-4000-8000-000000000001";
    const response = await DELETE(new Request("https://manager.test/api/sitecore/pricing", { method: "DELETE", headers: { origin: "https://manager.test", "Content-Type": "application/json" }, body: JSON.stringify({ id }) }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ deleted: true, id });
    expect(rpc).toHaveBeenCalledWith("sitecore_pricing_delete_import", { p_import_id: id, p_actor: "actor" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("returns a conflict when a batch claims an import before deletion", async () => {
    auth(1);
    mocks.createPerformanceClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "55006" } }) });
    const response = await DELETE(new Request("https://manager.test/api/sitecore/pricing", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000001" }) }));
    expect(response.status).toBe(409); expect((await response.json()).error).toContain("currently processing");
  });
});

describe("production pricing API", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const id = "00000000-0000-4000-8000-000000000001";
  function fixture() {
    auth(2);
    const prefix = "SITECORE_PRICING_PROD_";
    const settings = { CM_URL: "https://prod.test", CLIENT_ID: "prod-id", CLIENT_SECRET: "prod-secret", PROPERTY_TEMPLATE_ID: id, SUITE_TEMPLATE_ID: id, CONTENT_ROOT: "/sitecore/content/Production", TIMEZONE: "America/Toronto" };
    for (const [key, value] of Object.entries(settings)) vi.stubEnv(prefix + key, value);
    vi.stubEnv("SITECORE_PRICING_DISPATCH_SECRET", "x".repeat(40));
    vi.stubEnv("PERFORMANCE_SUPABASE_URL", "https://performance.test");
    const config = getPricingConfig(undefined, "prod");
    const job = { id, environment: "prod", target_host: config.host, config_hash: config.hash, execution_mode: "edge_auto" };
    let environment = "";
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn((key: string, value: string) => { if (key === "environment") environment = value; return query; }), maybeSingle: vi.fn(async () => ({ data: environment === "prod" ? job : null, error: null })) };
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    mocks.createPerformanceClient.mockReturnValue({ from: vi.fn().mockReturnValue(query), rpc });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 202 })); vi.stubGlobal("fetch", fetchMock);
    const request = (extra: Record<string, unknown>) => POST(new Request("https://manager.test/api/sitecore/pricing", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://manager.test" }, body: JSON.stringify({ id, action: "run", environment: "prod", ...extra }) }));
    return { config, rpc, fetchMock, request };
  }
  it.each(["run", "retry"])("rejects unconfirmed PROD %s before queueing or waking Edge", async action => {
    const f = fixture(); expect((await f.request({ action })).status).toBe(409);
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.fetchMock).not.toHaveBeenCalled();
  });
  it("rejects a confirmation for a different target", async () => {
    const f = fixture();
    expect((await f.request({ confirmProduction: true, confirmedHost: "https://dev.test", confirmedConfigHash: f.config.hash })).status).toBe(409);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("cannot run a PROD import through a DEV selection", async () => {
    const f = fixture();
    expect((await f.request({ environment: "dev", confirmProduction: true })).status).toBe(404);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("queues the confirmed environment and privately wakes only PROD", async () => {
    const f = fixture();
    expect((await f.request({ confirmProduction: true, confirmedHost: f.config.host, confirmedConfigHash: f.config.hash })).status).toBe(202);
    expect(f.rpc).toHaveBeenCalledWith("sitecore_pricing_environment_command", { p_import_id: id, p_action: "run", p_actor: "actor", p_environment: "prod", p_production_confirmed: true });
    expect(f.fetchMock).toHaveBeenCalledWith(expect.stringContaining("/functions/v1/sitecore-pricing"), expect.objectContaining({ body: JSON.stringify({ environment: "prod" }) }));
  });
});

describe("pricing results report with actionable issues", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  function row(status: string, index: number, careLevel = "th") {
    return { id: `row-${index}`, import_id: id, row_number: index + 10, language: "en", status,
      source: { propertyId: "11295", residence: `${status}-${index}`, careLevel, suiteTitle: "townhouse-1bed-2beds", values: { regularPrice: "999" }, errors: [], warnings: ["Saved formula warning"] },
      residence_path: "/sitecore/content/Home/edward", item_path: "/sitecore/content/Home/edward/Data/SuitePlans/th/townhouse-1bed-2beds",
      before_values: { regularPrice: "4000", promotionPrice: "3900" }, after_values: { regularPrice: "999", promotionPrice: "" }, message: "Detailed result" };
  }
  function fixture(rows: ReturnType<typeof row>[]) {
    auth(2);
    const ranges = vi.fn(); const predicates = vi.fn();
    mocks.createPerformanceClient.mockReturnValue({ from: vi.fn((table: string) => {
      if (table === "sitecore_pricing_imports") {
        const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id, environment: "dev" }, error: null }) }; return query;
      }
      const equal: Record<string, string> = {}; const unequal: Record<string, string> = {};
      const value = (item: ReturnType<typeof row>, key: string) => key === "source->>careLevel" ? item.source.careLevel : (item as Record<string, unknown>)[key];
      const query = { select: () => query,
        eq: (key: string, input: string) => { equal[key] = input; return query; },
        neq: (key: string, input: string) => { predicates(key, input); unequal[key] = input; return query; }, order: () => query,
        range: async (start: number, end: number) => { ranges(start, end); return { data: rows.filter(item => Object.entries(equal).every(([key, input]) => value(item, key) === input) && Object.entries(unequal).every(([key, input]) => value(item, key) !== input)).slice(start, end + 1), error: null }; } };
      return query;
    }) });
    return { ranges, predicates, request: () => GET(new Request(`https://manager.test/api/sitecore/pricing?view=export&id=${id}&environment=dev`)) };
  }
  it("includes successful, unchanged and unsuccessful updates with detailed messages", async () => {
    const f = fixture(["applied", "unchanged", "skipped", "failed", "invalid", "conflict", "pending", "ready", "applying"].map((status, index) => row(status, index)));
    const response = await f.request(); const csv = await response.text();
    expect(response.status).toBe(200); expect(csv.split("\r\n")).toHaveLength(9);
    for (const status of ["applied", "unchanged", "failed", "invalid", "conflict", "pending", "ready", "applying"]) expect(csv).toContain(`"${status}-`);
    expect(csv).not.toContain('"skipped-'); expect(csv).toContain('"3900",""');
    for (const text of ['"Message"', '"Warnings"', "Detailed result", "Saved formula warning", "Requested regularPrice"]) expect(csv).toContain(text);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("excludes blank Marketing Care Level and expected missing-language skips", async () => {
    const f = fixture([row("invalid", 0, ""), row("skipped", 1), row("failed", 2)]);
    const csv = await (await f.request()).text();
    expect(csv.split("\r\n")).toHaveLength(2); expect(csv).toContain('"failed-2"');
    expect(csv).not.toContain('"invalid-0"'); expect(csv).not.toContain('"skipped-1"');
    expect(f.predicates).toHaveBeenCalledWith("source->>careLevel", "");
  });
  it("paginates included outcomes without dropping entries beyond 1000 rows", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => [row("failed", index), row("skipped", index)]).flat();
    const f = fixture(rows); const csv = await (await f.request()).text();
    expect(csv.split("\r\n")).toHaveLength(1002); expect(csv).toContain('"failed-1000"');
    expect(f.ranges.mock.calls).toEqual([[0, 999], [1000, 1999]]);
  });
});
