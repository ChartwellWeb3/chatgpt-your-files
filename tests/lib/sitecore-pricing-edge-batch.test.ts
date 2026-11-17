// @vitest-environment node
// Authored for later execution; tests are intentionally not run in this task.
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SitecoreAuthoring, type SitecoreItem } from "@/lib/sitecore-pricing/authoring";
import { runPricingEdgeBatch } from "@/lib/sitecore-pricing/edge-batch";
import { MissingSuiteVersionError, PricingBatchYield, type PricingConfig, type PricingImport, type PricingRow } from "@/lib/sitecore-pricing/types";

const config: PricingConfig = { environment: "dev", host: "https://dev.test", endpoint: "https://dev.test/authoring", clientId: "id", clientSecret: "secret", root: "/sitecore/content/Home", timezone: "America/Toronto", propertyTemplateId: "property", suiteTemplateId: "suite", hash: "a".repeat(64), fields: { regularPrice: "Regular SuitePrice", promotionPrice: "Promotion Price", startDate: "Start Date", endDate: "End Date" } };
function fixture() {
  const row = { id: "row", status: "ready", language: "en", source: { propertyId: "11295", careLevel: "il" }, residence_item_id: "property-id", residence_path: `${config.root}/edward`,
    item_id: "suite-id", item_path: `${config.root}/edward/Data/SuitePlans/il/1bed`, item_version: 1, revision: "before", before_values: { regularPrice: "4000" }, after_values: { regularPrice: "4100" } } as PricingRow;
  const job = { environment: "dev", id: "job", config_hash: config.hash, target_host: config.host, content_root: config.root, run_requested_at: "2026-11-16T00:00:00Z", lease_token: "token", execution_mode: "edge_auto", edge_stage: "apply", phase: "apply", status: "applying" } as PricingImport;
  const events: string[] = [];
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === "sitecore_pricing_claim_environment") return { data: { ...job }, error: null };
    if (name === "sitecore_pricing_heartbeat") return { data: true, error: null };
    if (name === "sitecore_pricing_save_row") { const result = args!.p_result as Partial<PricingRow>; Object.assign(row, result); events.push(String(result.status)); }
    if (name === "sitecore_pricing_edge_release") events.push("released");
    if (name === "sitecore_pricing_edge_advance") {
      if (!["ready", "applying"].includes(row.status)) job.status = "completed";
      return { data: { ...job }, error: null };
    }
    return { data: null, error: null };
  });
  const db = { rpc, from: vi.fn(() => {
    const query = { select: () => query, eq: () => query, in: () => query, order: () => query,
      limit: async () => ({ data: ["ready", "applying"].includes(row.status) ? [{ ...row }] : [], error: null }) };
    return query;
  }) } as unknown as SupabaseClient;
  const api = new SitecoreAuthoring(config);
  const suite: SitecoreItem = { id: "suite-id", name: "1bed", path: row.item_path!, templateId: "suite", language: "en", version: 1, propertyId: "", revision: "before", locked: false, lockStateKnown: true, fieldsPresent: true, values: { regularPrice: "4000" } };
  const property = { ...suite, id: "property-id", path: row.residence_path!, templateId: "property", propertyId: "11295" };
  vi.spyOn(api, "verifyTemplates").mockResolvedValue({ property, suite });
  const get = vi.spyOn(api, "get").mockImplementation(async id => id === "property-id" ? property : suite);
  const update = vi.spyOn(api, "update").mockImplementation(async () => { events.push("mutation"); suite.values = { regularPrice: "4100" }; suite.revision = "after"; });
  return { db, api, row, suite, property, get, update, events };
}
describe("resumable pricing Edge updates", () => {
  it("reconciles a mutation whose verification crossed the batch deadline without writing twice", async () => {
    const f = fixture(); let interrupt = true;
    f.get.mockImplementation(async id => {
      if (id === "property-id") return f.property;
      if (f.suite.revision === "after" && interrupt) { interrupt = false; throw new PricingBatchYield(); }
      return f.suite;
    });
    await runPricingEdgeBatch(f.db, f.api);
    expect(f.row.status).toBe("applying"); expect(f.events).toEqual(["applying", "mutation", "released"]);
    await runPricingEdgeBatch(f.db, f.api);
    expect(f.row.status).toBe("applied"); expect(f.update).toHaveBeenCalledTimes(1);
  });
  it("verifies a blank-promotion clear and does not write it twice after resuming", async () => {
    const f = fixture();
    f.suite.values = { regularPrice: "4000", promotionPrice: "3900", startDate: "20260101T050000Z", endDate: "20260201T045959Z" };
    f.row.before_values = { ...f.suite.values }; f.row.after_values = { ...f.suite.values, promotionPrice: "" };
    f.update.mockImplementation(async () => { f.events.push("mutation"); f.suite.values = { ...f.row.after_values }; f.suite.revision = "after"; });
    await runPricingEdgeBatch(f.db, f.api);
    expect(f.row.status).toBe("applied"); expect(f.suite.values).toEqual({ ...f.row.before_values, promotionPrice: "" });
    await runPricingEdgeBatch(f.db, f.api); expect(f.update).toHaveBeenCalledTimes(1);
  });
  it("preserves a human edit rather than applying an obsolete snapshot", async () => {
    const f = fixture(); f.suite.values = { regularPrice: "4200" }; f.suite.revision = "human-edit";
    await runPricingEdgeBatch(f.db, f.api);
    expect(f.row.status).toBe("conflict"); expect(f.update).not.toHaveBeenCalled();
  });
  it("keeps removed language versions neutral and does not mutate them", async () => {
    const f = fixture(); f.get.mockImplementation(async id => { if (id === "property-id") return f.property; throw new MissingSuiteVersionError("en"); });
    await runPricingEdgeBatch(f.db, f.api);
    expect(f.row.status).toBe("skipped"); expect(f.update).not.toHaveBeenCalled();
  });
});
