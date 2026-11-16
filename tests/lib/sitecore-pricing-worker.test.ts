// @vitest-environment node
// Authored for later execution; tests/builds were not run during implementation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SitecoreAuthoring, type SitecoreItem } from "@/lib/sitecore-pricing/authoring";
import { MissingSuiteFolderError, MissingSuiteVersionError, PricingError, type PricingConfig, type PricingImport, type PricingRow } from "@/lib/sitecore-pricing/types";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getPricingConfig: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/sitecore-pricing/config.ts", () => ({ getPricingConfig: mocks.getPricingConfig }));
import { pricingWorkerTick } from "@/lib/sitecore-pricing/worker";

const config: PricingConfig = { environment: "dev", host: "https://dev.test", endpoint: "https://dev.test/sitecore/api/authoring/graphql/v1/", clientId: "id", clientSecret: "secret", root: "/sitecore/content/Home", timezone: "America/Toronto", propertyTemplateId: "property", suiteTemplateId: "suite", hash: "a".repeat(64), fields: { regularPrice: "Regular SuitePrice", promotionPrice: "Promotion Price", startDate: "Start Date", endDate: "End Date" } };
const itemPath = "/sitecore/content/Home/example/Data/SuitePlans/il/studio";
function current(values = { regularPrice: "4000" }, revision = "before-revision"): SitecoreItem {
  return { id: "suite-id", name: "studio", path: itemPath, templateId: "suite", version: 2, language: "en", propertyId: "", revision, locked: false, values, fieldsPresent: true };
}
function database(phase: "preview" | "apply" = "apply") {
  const row = { id: "row", import_id: "job", row_number: 10, language: "en", source: {}, status: phase === "preview" ? "pending" : "ready", item_id: "suite-id", item_path: itemPath, item_version: 2, revision: "before-revision", before_values: { regularPrice: "4000" }, after_values: { regularPrice: "4100" }, attempts: 0, message: null, residence_item_id: "property-id", residence_path: "/sitecore/content/Home/example" } as PricingRow;
  const rows = [row];
  const job = { id: "job", phase, status: phase === "preview" ? "previewing" : "applying", config_hash: config.hash, target_host: config.host, lease_token: "token" } as PricingImport;
  const events: string[] = [];
  const db = {
    rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === "sitecore_pricing_claim") return { data: job, error: null };
      if (name === "sitecore_pricing_heartbeat") return { data: true, error: null };
      if (name === "sitecore_pricing_save_row") { const result = args!.p_result as Partial<PricingRow>; Object.assign(rows.find(item => item.id === args!.p_row_id)!, result); events.push(String(result.status)); }
      if (name === "sitecore_pricing_expand_row") {
        const targets = args!.p_residences as { id: string; path: string }[];
        const staging = rows.find(item => item.id === args!.p_row_id)!;
        targets.forEach((target, index) => {
          const bound = { ...staging, id: index === 0 ? staging.id : `${staging.id}-${index}`, residence_item_id: target.id, residence_path: target.path };
          if (index === 0) Object.assign(staging, bound); else rows.push(bound);
        });
        events.push("expanded");
      }
      if (name === "sitecore_pricing_finish" && args?.p_error) events.push("job-failed");
      return { data: null, error: null };
    }),
    from: vi.fn(() => {
      const query = { select: () => query, eq: () => query, in: () => query, order: () => query, limit: async () => ({ data: rows.filter(item => (phase === "preview" ? ["pending"] : ["ready", "applying"]).includes(item.status)).slice(0, 1).map(item => ({ ...item })), error: null }) };
      return query;
    }),
  };
  mocks.createClient.mockReturnValue(db);
  return { row, rows, events };
}
describe("pricing worker conflict and uncertain-write recovery", () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  beforeEach(() => {
    mocks.getPricingConfig.mockReturnValue(config);
    vi.stubEnv("PERFORMANCE_SUPABASE_URL", "https://performance.test");
    vi.stubEnv("PERFORMANCE_SUPABASE_SECRET_KEY", "server-secret");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://chatbot.test");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  it("prepares a separate target for every residence sharing the uploaded Yardi ID", async () => {
    const { row, rows, events } = database("preview"); row.residence_item_id = null;
    row.source = { rowNumber: 10, propertyId: "11295", residence: "The Edward", careLevel: "il", suiteTitle: "1bed", values: { regularPrice: "4100" }, errors: [], warnings: [] };
    const properties = ["the-edward-original", "the-edward", "the-edward-boutique"].map(name => ({ ...current(), id: name, path: `/sitecore/content/Home/${name}`, propertyId: "11295" }));
    vi.spyOn(SitecoreAuthoring.prototype, "residences").mockResolvedValue(properties);
    const resolve = vi.spyOn(SitecoreAuthoring.prototype, "resolve").mockImplementation(async (_source, language, targets) => {
      expect(targets).toHaveLength(1);
      return { ...current(), id: `suite-${targets[0].id}`, path: `${targets[0].path}/Data/SuitePlans/il/1bed`, language };
    });
    await pricingWorkerTick();
    expect(rows).toHaveLength(3); expect(rows.every(item => item.status === "ready")).toBe(true);
    expect(rows.map(item => item.residence_path)).toEqual(properties.map(item => item.path));
    expect(resolve).toHaveBeenCalledTimes(3); expect(events).toEqual(["expanded", "ready", "ready", "ready"]);
  });
  it("skips a row with no update inputs before matching suite items", async () => {
    const { row, events } = database("preview");
    row.source = { rowNumber: 10, propertyId: "11295", residence: "The Edward", careLevel: "il", suiteTitle: "1bed", values: {}, errors: [], warnings: [], skipReason: "empty_update" };
    vi.spyOn(SitecoreAuthoring.prototype, "residences").mockResolvedValue([]);
    const resolve = vi.spyOn(SitecoreAuthoring.prototype, "resolve").mockResolvedValue(current());
    await pricingWorkerTick();
    expect(row.status).toBe("skipped"); expect(events).toEqual(["skipped"]); expect(resolve).not.toHaveBeenCalled();
  });
  it.each(["en", "fr"] as const)("skips missing SuitePlans folders for %s without recording a correction", async language => {
    const { row, events } = database("preview"); row.language = language;
    vi.spyOn(SitecoreAuthoring.prototype, "residences").mockResolvedValue([]);
    vi.spyOn(SitecoreAuthoring.prototype, "resolve").mockRejectedValue(new MissingSuiteFolderError("/sitecore/content/home/residence/Data/SuitePlans/al"));
    await pricingWorkerTick();
    expect(row.status).toBe("skipped"); expect(events).toEqual(["skipped"]);
    expect(row.message).toContain("No SuitePlans folder for this care level; skipped.");
  });
  it("keeps genuine preview connection failures visible", async () => {
    const { row, events } = database("preview");
    vi.spyOn(SitecoreAuthoring.prototype, "residences").mockResolvedValue([]);
    vi.spyOn(SitecoreAuthoring.prototype, "resolve").mockRejectedValue(new PricingError("DEV authoring is unavailable.", 503));
    await pricingWorkerTick();
    expect(row.status).toBe("pending"); expect(events).toEqual(["job-failed"]);
  });
  it.each(["en", "fr"] as const)("skips a missing %s version during preview without recording an error", async language => {
    const { row, events } = database("preview"); row.language = language;
    vi.spyOn(SitecoreAuthoring.prototype, "residences").mockResolvedValue([]);
    vi.spyOn(SitecoreAuthoring.prototype, "resolve").mockRejectedValue(new MissingSuiteVersionError(language));
    await pricingWorkerTick();
    expect(row.status).toBe("skipped");
    expect(row.message).toBe(`No ${language === "en" ? "English" : "French"} SuitePlan version; skipped.`);
    expect(events).toEqual(["skipped"]);
  });
  it.each(["en", "fr"] as const)("skips a %s version removed before applying without sending an update", async language => {
    const { row, events } = database(); row.language = language;
    vi.spyOn(SitecoreAuthoring.prototype, "get").mockResolvedValue(null);
    const update = vi.spyOn(SitecoreAuthoring.prototype, "update").mockResolvedValue();
    await pricingWorkerTick();
    expect(row.status).toBe("skipped"); expect(events).toEqual(["skipped"]);
    expect(update).not.toHaveBeenCalled();
  });
  it("still updates and verifies existing French versions", async () => {
    const { row, events } = database(); row.language = "fr";
    vi.spyOn(SitecoreAuthoring.prototype, "get").mockResolvedValueOnce({ ...current(), language: "fr" })
      .mockResolvedValueOnce({ ...current({ regularPrice: "4100" }, "after-revision"), language: "fr" });
    const update = vi.spyOn(SitecoreAuthoring.prototype, "update").mockResolvedValue();
    await pricingWorkerTick();
    expect(row.status).toBe("applied"); expect(events).toEqual(["applying", "applied"]);
    expect(update).toHaveBeenCalledTimes(1);
  });
  it("records an already-applied uncertain write without sending a second mutation", async () => {
    const { row } = database();
    vi.spyOn(SitecoreAuthoring.prototype, "get").mockResolvedValue(current({ regularPrice: "4100" }, "after-revision"));
    const update = vi.spyOn(SitecoreAuthoring.prototype, "update").mockResolvedValue();
    await pricingWorkerTick();
    expect(row.status).toBe("applied"); expect(update).not.toHaveBeenCalled();
  });
  it("does not overwrite an editor's newer revision", async () => {
    const { row } = database();
    vi.spyOn(SitecoreAuthoring.prototype, "get").mockResolvedValue(current({ regularPrice: "4000" }, "editor-revision"));
    const update = vi.spyOn(SitecoreAuthoring.prototype, "update").mockResolvedValue();
    await pricingWorkerTick();
    expect(row.status).toBe("conflict"); expect(update).not.toHaveBeenCalled();
  });
  it("saves intent before a write and verifies returned values", async () => {
    const { row, events } = database();
    vi.spyOn(SitecoreAuthoring.prototype, "get").mockResolvedValueOnce(current()).mockResolvedValueOnce(current({ regularPrice: "4100" }, "after-revision"));
    vi.spyOn(SitecoreAuthoring.prototype, "update").mockImplementation(async () => { events.push("remote-write"); });
    await pricingWorkerTick();
    expect(row.status).toBe("applied"); expect(events).toEqual(["applying", "remote-write", "applied"]);
  });
  it("stops an outage and retries by reconciling Sitecore first", async () => {
    const { row, events } = database();
    const get = vi.spyOn(SitecoreAuthoring.prototype, "get").mockResolvedValue(current());
    const update = vi.spyOn(SitecoreAuthoring.prototype, "update").mockRejectedValue(new PricingError("Timed out after sending the update", 503));
    await pricingWorkerTick();
    expect(row.status).toBe("failed"); expect(events).toEqual(["applying", "failed", "job-failed"]);
    row.status = "ready"; // The explicit SQL Retry operation preserves snapshots.
    get.mockResolvedValue(current({ regularPrice: "4100" }, "after-revision"));
    await pricingWorkerTick();
    expect(row.status).toBe("applied"); expect(update).toHaveBeenCalledTimes(1);
  });
});
