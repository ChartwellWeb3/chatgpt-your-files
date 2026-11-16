// @vitest-environment node
// Authored for later execution. Do not run without reversing the no-tests rule.
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PricingSource } from "@/lib/sitecore-pricing/types";

let db: PGlite;
const actor = "00000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const root = "/sitecore/content/Home";
const source: PricingSource = { rowNumber: 10, propertyId: "11295", residence: "Edward", careLevel: "il", suiteTitle: "1bed", values: { regularPrice: "4100" }, errors: [], warnings: ["Saved formula result used."] };
type Job = { id: string; lease_token: string; status: string; edge_stage: string; progress: number; approved_by: string | null; run_requested_by: string | null };
async function upload(rows = [source]) {
  return (await db.query<{ id: string }>("select sitecore_pricing_upload('tracker.xlsx',$1,'Market Rates and Business Cases','https://dev.test',$1,$2,$3,$4) id", [hash, actor, rows, root])).rows[0].id;
}
async function claim(config = hash) { return (await db.query<{ job: Job | null }>("select sitecore_pricing_edge_claim($1) job", [config])).rows[0].job; }
async function command(id: string, action: string) { await db.query("select sitecore_pricing_edge_command($1,$2,$3)", [id, action, actor]); }
async function advance(job: Job) { return (await db.query<{ job: Job }>("select sitecore_pricing_edge_advance($1,$2) job", [job.id, job.lease_token])).rows[0].job; }
async function save(job: Job, row: string, result: Record<string, unknown>) { await db.query("select sitecore_pricing_save_row($1,$2,$3,$4)", [job.id, job.lease_token, row, result]); }

describe("automatic pricing Edge lifecycle", () => {
  beforeAll(async () => {
    db = new PGlite(); await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    for (const name of ["20261113120000_sitecore_pricing_imports", "20261113213000_skip_missing_suite_versions", "20261113223000_pricing_empty_rows_and_shared_property_ids", "20261116120000_pricing_edge_auto_imports"]) {
      await db.exec(await readFile(new URL(`../../infrastructure/performance/sql/${name}.sql`, import.meta.url), "utf8"));
    }
  }, 30000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec("truncate sitecore_pricing_catalog,sitecore_pricing_catalog_tasks,sitecore_pricing_rows,sitecore_pricing_imports,sitecore_pricing_runtime;"); });
  it("requires Run, persists catalog/expansion, auto-applies, and rejects stale leases", async () => {
    const id = await upload();
    expect(await claim()).toBeNull();
    await command(id, "run"); await command(id, "run");
    expect(await claim("b".repeat(64))).toBeNull();
    let job = (await claim())!; expect(await claim()).toBeNull();
    const targets = [1, 2].map(n => ({ id: `00000000-0000-4000-8000-00000000000${n}`, path: `${root}/edward-${n}`, propertyId: "11295" }));
    await db.query("select sitecore_pricing_catalog_page($1,$2,$3,null,null,$4,$5)", [id, job.lease_token, root, [], targets]);
    job = await advance(job); expect(job.edge_stage).toBe("expand");
    const staging = (await db.query<{ id: string }>("select id from sitecore_pricing_rows where import_id=$1", [id])).rows;
    for (const row of staging) await db.query("select sitecore_pricing_expand_row($1,$2,$3,$4)", [id, job.lease_token, row.id, targets]);
    job = await advance(job); expect(job.edge_stage).toBe("preview"); expect(job.progress).toBe(20);
    const rows = (await db.query<{ id: string; language: string }>("select id,language from sitecore_pricing_rows where import_id=$1", [id])).rows;
    expect(rows).toHaveLength(4);
    for (const row of rows) await save(job, row.id, row.language === "fr" ? { status: "skipped", message: "No French SuitePlan version; skipped." }
      : { status: "ready", item_id: row.id, item_path: `${root}/suite`, item_version: 1, revision: "before", before_values: { regularPrice: "4000" }, after_values: source.values });
    job = await advance(job); expect(job.status).toBe("applying"); expect(job.approved_by).toBeNull(); expect(job.run_requested_by).toBe(actor);
    const en = rows.filter(row => row.language === "en");
    await save(job, en[0].id, { status: "applying" });
    await db.query("select sitecore_pricing_edge_release($1,$2)", [id, job.lease_token]);
    const previous = job; job = (await claim())!;
    expect(job.lease_token).not.toBe(previous.lease_token);
    await expect(save(previous, en[0].id, { status: "applied" })).rejects.toThrow("lease lost");
    // The next invocation reconciles the uncertain write before saving applied.
    for (const row of en) await save(job, row.id, { status: "applied" });
    job = await advance(job); expect(job.status).toBe("completed"); expect(job.progress).toBe(100);
    expect((await db.query<{ n: number }>("select count(*)::int n from sitecore_pricing_rows where import_id=$1 and developer_attention", [id])).rows[0].n).toBe(2);
  });
  it("finishes empty uploads without claiming external work and hides skipped warnings", async () => {
    const id = await upload([{ ...source, values: {}, skipReason: "empty_update" }]);
    await command(id, "run");
    const result = (await db.query<{ status: string; progress: number }>("select status,progress from sitecore_pricing_imports where id=$1", [id])).rows[0];
    expect(result).toEqual({ status: "completed", progress: 100 }); expect(await claim()).toBeNull();
    expect((await db.query<{ n: number }>("select count(*)::int n from sitecore_pricing_rows where developer_attention")).rows[0].n).toBe(0);
  });
  it("never claims a historical manual import, even when its config matches", async () => {
    await db.query("select sitecore_pricing_create('legacy.xlsx',$1,'Market Rates and Business Cases','https://dev.test',$1,$2,$3)", [hash, actor, [source]]);
    expect(await claim()).toBeNull();
    await expect(db.query("select sitecore_pricing_claim($1)", [hash])).rejects.toThrow("retired");
  });
});
