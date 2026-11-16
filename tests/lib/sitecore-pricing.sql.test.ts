// @vitest-environment node
// Authored for later execution; tests/builds were not run during implementation.
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: PGlite;
const actor = "00000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const source = { rowNumber: 10, propertyId: "11263", residence: "Example", careLevel: "il", suiteTitle: "studio", values: { regularPrice: "4000" }, errors: [], warnings: [] };
type Claim = { id: string; lease_token: string; status: string };
async function create() { return (await db.query<{ id: string }>("select sitecore_pricing_create('tracker.xlsx',$1,'Market Rates and Business Cases','https://dev.test',$1,$2,$3) id", [hash, actor, [source]])).rows[0].id; }
async function claim() { return (await db.query<{ job: Claim | null }>("select sitecore_pricing_claim($1) job", [hash])).rows[0].job; }
async function save(job: Claim, rowId: string, result: Record<string, unknown>) { await db.query("select sitecore_pricing_save_row($1,$2,$3,$4)", [job.id, job.lease_token, rowId, result]); }
describe("durable DEV pricing queue", () => {
  beforeAll(async () => {
    db = new PGlite(); await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    await db.exec(await readFile(new URL("../../infrastructure/performance/sql/20261113120000_sitecore_pricing_imports.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../infrastructure/performance/sql/20261113213000_skip_missing_suite_versions.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../../infrastructure/performance/sql/20261113223000_pricing_empty_rows_and_shared_property_ids.sql", import.meta.url), "utf8"));
  }, 30000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec("truncate sitecore_pricing_rows,sitecore_pricing_imports,sitecore_pricing_runtime;"); });
  it("creates separate EN/FR targets and serializes imports for one DEV host", async () => {
    const first = await create(); await create();
    expect((await db.query("select language from sitecore_pricing_rows where import_id=$1 order by language", [first])).rows).toEqual([{ language: "en" }, { language: "fr" }]);
    expect((await claim())?.id).toBe(first); expect(await claim()).toBeNull();
  });
  it("creates all-empty uploads as skipped without queuing Sitecore work", async () => {
    const empty = { ...source, values: {}, errors: [], skipReason: "empty_update" };
    const id = (await db.query<{ id: string }>("select sitecore_pricing_create('empty.xlsx',$1,'Market Rates and Business Cases','https://dev.test',$1,$2,$3) id", [hash, actor, [empty]])).rows[0].id;
    expect((await db.query<{ counts: Record<string, number> }>("select sitecore_pricing_counts($1) counts", [id])).rows[0].counts).toEqual({ skipped: 2 });
    expect(await claim()).toBeNull();
    expect((await db.query("select sitecore_pricing_is_empty_update($1) empty", [{ ...source, values: {}, errors: ["Regular SuitePrice must be a positive price with at most two decimal places.", "No price or date values to update."] }])).rows).toEqual([{ empty: false }]);
  });
  it("expands shared property IDs atomically and does not duplicate targets on retry", async () => {
    const id = await create(); const job = (await claim())!;
    const en = (await db.query<{ id: string }>("select id from sitecore_pricing_rows where import_id=$1 and language='en'", [id])).rows[0];
    const targets = [1, 2, 3].map(n => ({ id: `00000000-0000-4000-8000-00000000000${n}`, path: `/sitecore/content/Home/edward-${n}` }));
    await db.query("select sitecore_pricing_expand_row($1,$2,$3,$4)", [id, job.lease_token, en.id, targets]);
    await db.query("select sitecore_pricing_expand_row($1,$2,$3,$4)", [id, job.lease_token, en.id, targets]);
    expect((await db.query("select residence_path from sitecore_pricing_rows where import_id=$1 and language='en' order by residence_path", [id])).rows).toEqual(targets.map(target => ({ residence_path: target.path })));
    expect((await db.query<{ counts: Record<string, number> }>("select sitecore_pricing_counts($1) counts", [id])).rows[0].counts).toEqual({ pending: 4 });
    await expect(db.query("select sitecore_pricing_expand_row($1,$2,$3,$4)", [id, actor, en.id, targets])).rejects.toThrow("lease lost");
  });
  it("reclassifies older empty updates while preserving malformed price errors", async () => {
    const id = await create();
    const empty = { ...source, values: {}, errors: ["Missing or unsupported Marketing Care Level.", "No price or date values to update."] };
    const malformed = { ...source, values: {}, errors: ["Regular SuitePrice must be a positive price with at most two decimal places.", "No price or date values to update."] };
    await db.query("update sitecore_pricing_rows set status='invalid',source=$2,message='No price or date values to update.' where import_id=$1 and language='en'", [id, empty]);
    await db.query("update sitecore_pricing_rows set status='invalid',source=$2,message='Invalid price.' where import_id=$1 and language='fr'", [id, malformed]);
    await db.exec(await readFile(new URL("../../infrastructure/performance/sql/20261113223000_pricing_empty_rows_and_shared_property_ids.sql", import.meta.url), "utf8"));
    expect((await db.query("select language,status from sitecore_pricing_rows where import_id=$1 order by language", [id])).rows).toEqual([{ language: "en", status: "skipped" }, { language: "fr", status: "invalid" }]);
  });
  it("counts missing French versions as skipped and only queues ready English updates", async () => {
    const id = await create(); const preview = (await claim())!;
    const rows = (await db.query<{ id: string; language: string }>("select id,language from sitecore_pricing_rows where import_id=$1", [id])).rows;
    const en = rows.find(row => row.language === "en")!; const fr = rows.find(row => row.language === "fr")!;
    await save(preview, en.id, { status: "ready", item_id: "suite", item_path: "/sitecore/content/Home/suite", item_version: 1, revision: "before", before_values: { regularPrice: "3900" }, after_values: { regularPrice: "4000" } });
    await save(preview, fr.id, { status: "skipped", message: "No French SuitePlan version; skipped." });
    await db.query("select sitecore_pricing_finish($1,$2)", [id, preview.lease_token]);
    expect((await db.query<{ counts: Record<string, number> }>("select sitecore_pricing_counts($1) counts", [id])).rows[0].counts).toEqual({ ready: 1, skipped: 1 });
    await db.query("select sitecore_pricing_ping($1)", [hash]);
    await db.query("select sitecore_pricing_command($1,'approve',$2)", [id, actor]);
    const applying = (await claim())!;
    await save(applying, en.id, { status: "applying" }); await save(applying, en.id, { status: "applied" });
    await db.query("select sitecore_pricing_finish($1,$2)", [id, applying.lease_token]);
    expect((await db.query("select status,attempts from sitecore_pricing_rows where id=$1", [fr.id])).rows).toEqual([{ status: "skipped", attempts: 0 }]);
  });
  it("supports old workers and backfills only the exact missing-French-version error", async () => {
    const id = await create(); const job = (await claim())!;
    const rows = (await db.query<{ id: string; language: string }>("select id,language from sitecore_pricing_rows where import_id=$1", [id])).rows;
    const fr = rows.find(row => row.language === "fr")!;
    await save(job, fr.id, { status: "invalid", message: "No existing FR SuitePlan version. Language fallback is not eligible for updating." });
    expect((await db.query("select status from sitecore_pricing_rows where id=$1", [fr.id])).rows).toEqual([{ status: "skipped" }]);
    await db.query("update sitecore_pricing_rows set status='invalid',message=$2 where id=$1", [fr.id, "No existing FR SuitePlan version. Language fallback is not eligible for updating."]);
    await db.query("update sitecore_pricing_rows set status='invalid',message='The SuitePlan is locked.' where import_id=$1 and language='en'", [id]);
    await db.exec(await readFile(new URL("../../infrastructure/performance/sql/20261113213000_skip_missing_suite_versions.sql", import.meta.url), "utf8"));
    expect((await db.query<{ counts: Record<string, number> }>("select sitecore_pricing_counts($1) counts", [id])).rows[0].counts).toEqual({ invalid: 1, skipped: 1 });
  });
  it("fences expired workers and preserves preview snapshots across retries", async () => {
    await create(); const old = (await claim())!;
    await db.query("update sitecore_pricing_imports set lease_expires_at=now()-interval '1 second' where id=$1", [old.id]);
    const replacement = (await claim())!;
    expect(replacement.lease_token).not.toBe(old.lease_token);
    const rows = (await db.query<{ id: string }>("select id from sitecore_pricing_rows where import_id=$1 order by language", [old.id])).rows;
    await expect(save(old, rows[0].id, { status: "ready" })).rejects.toThrow("lease lost");
    const preview = { status: "ready", item_id: "suite-id", item_path: "/sitecore/content/Home/residence/Data/SuitePlans/il/studio", item_version: 2, revision: "revision-before", before_values: { regularPrice: "3900" }, after_values: { regularPrice: "4000" } };
    for (const row of rows) await save(replacement, row.id, preview);
    await db.query("select sitecore_pricing_finish($1,$2)", [replacement.id, replacement.lease_token]);
    await expect(db.query("select sitecore_pricing_command($1,'approve',$2)", [replacement.id, actor])).rejects.toThrow("worker first");
    await db.query("select sitecore_pricing_ping($1)", [hash]);
    await db.query("select sitecore_pricing_command($1,'approve',$2)", [replacement.id, actor]);
    const applying = (await claim())!;
    await save(applying, rows[0].id, { status: "applying" }); await save(applying, rows[0].id, { status: "applied" });
    await save(applying, rows[1].id, { status: "failed", message: "Uncertain response" });
    await db.query("select sitecore_pricing_finish($1,$2)", [applying.id, applying.lease_token]);
    await db.query("select sitecore_pricing_command($1,'retry',$2)", [applying.id, actor]);
    const persisted = (await db.query("select status,before_values,after_values from sitecore_pricing_rows where import_id=$1 order by language", [applying.id])).rows;
    expect(persisted).toEqual([{ status: "applied", before_values: preview.before_values, after_values: preview.after_values }, { status: "ready", before_values: preview.before_values, after_values: preview.after_values }]);
  });
  it("accepts English skips from new and older workers without correction counts", async () => {
    const id = await create(); const job = (await claim())!;
    const rows = (await db.query<{ id: string; language: string }>("select id,language from sitecore_pricing_rows where import_id=$1", [id])).rows;
    await save(job, rows.find(row => row.language === "en")!.id, { status: "invalid", message: "No existing EN SuitePlan version. Language fallback is not eligible for updating." });
    await save(job, rows.find(row => row.language === "fr")!.id, { status: "skipped", message: "No French SuitePlan version; skipped." });
    await db.query("select sitecore_pricing_finish($1,$2)", [id, job.lease_token]);
    expect((await db.query<{ counts: Record<string, number> }>("select sitecore_pricing_counts($1) counts", [id])).rows[0].counts).toEqual({ skipped: 2 });
  });
  it("backfills old English version errors while retaining their snapshots", async () => {
    const id = await create();
    await db.query("update sitecore_pricing_rows set status='invalid',message='No existing EN SuitePlan version. Language fallback is not eligible for updating.',before_values=$2,after_values=$3 where import_id=$1 and language='en'", [id, { regularPrice: "3900" }, { regularPrice: "4000" }]);
    await db.exec(await readFile(new URL("../../infrastructure/performance/sql/20261113213000_skip_missing_suite_versions.sql", import.meta.url), "utf8"));
    expect((await db.query("select status,message,before_values,after_values from sitecore_pricing_rows where import_id=$1 and language='en'", [id])).rows).toEqual([
      { status: "skipped", message: "No English SuitePlan version; skipped.", before_values: { regularPrice: "3900" }, after_values: { regularPrice: "4000" } },
    ]);
  });
  it("reclassifies old missing-folder rows without hiding root/setup failures", async () => {
    const id = await create();
    const path = "/sitecore/content/sxastarter/sxastarter/home/qc/terrebonne/des-mille-iles/Data/SuitePlans/al";
    await db.query("update sitecore_pricing_rows set status='invalid',message=$2 where import_id=$1 and language='en'", [id, `Content folder not found: ${path}.`]);
    await db.query("update sitecore_pricing_rows set status='conflict',message='Content folder not found' where import_id=$1 and language='fr'", [id]);
    await db.query("update sitecore_pricing_imports set status='failed',error_message='Content folder not found: /sitecore/content/incorrect-root.' where id=$1", [id]);
    await db.exec(await readFile(new URL("../../infrastructure/performance/sql/20261113220000_skip_missing_suite_folders.sql", import.meta.url), "utf8"));
    expect((await db.query<{ counts: Record<string, number> }>("select sitecore_pricing_counts($1) counts", [id])).rows[0].counts).toEqual({ skipped: 2 });
    expect((await db.query("select message from sitecore_pricing_rows where import_id=$1 and language='en'", [id])).rows).toEqual([{ message: `No SuitePlans folder for this care level; skipped. Path: ${path}` }]);
    expect((await db.query("select status,error_message from sitecore_pricing_imports where id=$1", [id])).rows).toEqual([{ status: "failed", error_message: "Content folder not found: /sitecore/content/incorrect-root." }]);
  });
  it("does not expose import data or RPCs to browser database roles", async () => {
    await create(); await db.exec("set role anon;");
    try {
      await expect(db.query("select * from sitecore_pricing_imports")).rejects.toThrow("permission denied");
      await expect(db.query("select sitecore_pricing_claim($1)", [hash])).rejects.toThrow("permission denied");
    } finally { await db.exec("reset role;"); }
  });
});
