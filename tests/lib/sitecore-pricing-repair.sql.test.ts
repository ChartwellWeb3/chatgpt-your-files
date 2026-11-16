// @vitest-environment node
// Authored for later execution. Tests/builds are not run for this task.
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: PGlite; let repair: string;
const actor = "00000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64); const root = "/sitecore/content/Home";
const source = { rowNumber: 10, propertyId: "11295", residence: "Edward", careLevel: "il", suiteTitle: "1bed", values: { regularPrice: "4100" }, errors: [], warnings: [] };
async function upload() {
  return (await db.query<{ id: string }>("select sitecore_pricing_upload('tracker.xlsx',$1,'Market Rates and Business Cases','https://dev.test',$1,$2,$3,$4) id", [hash, actor, [source], root])).rows[0].id;
}
async function readiness() { return (await db.query<{ setup: { ready: boolean; missing: string[] } }>("select sitecore_pricing_schema_status() setup")).rows[0].setup; }
async function remove(id: string) { return db.query("select sitecore_pricing_delete_import($1,$2)", [id, actor]); }

describe("pricing schema repair and permanent history deletion", () => {
  beforeAll(async () => {
    db = new PGlite(); await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    // A brand-new database must work without any earlier pricing scripts.
    repair = await readFile(new URL("../../infrastructure/performance/sql/20261116143000_complete_pricing_install_and_repair.sql", import.meta.url), "utf8");
    await db.exec(repair);
  }, 30000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec("truncate sitecore_pricing_catalog,sitecore_pricing_catalog_tasks,sitecore_pricing_rows,sitecore_pricing_imports,sitecore_pricing_runtime;"); });

  it("repairs missing Edge objects beside existing execution_mode without resetting saved work", async () => {
    const id = await upload();
    await db.query("select sitecore_pricing_edge_command($1,'run',$2)", [id, actor]);
    await db.query("update sitecore_pricing_imports set progress=22,edge_stage='preview' where id=$1", [id]);
    await db.query("update sitecore_pricing_rows set status='ready',before_values=$2,after_values=$3 where import_id=$1 and language='en'", [id, { regularPrice: "3900" }, source.values]);
    await db.exec("drop function sitecore_pricing_edge_release(uuid,uuid); alter table sitecore_pricing_rows drop column developer_attention;");
    const broken = await readiness(); expect(broken.ready).toBe(false);
    expect(broken.missing).toEqual(expect.arrayContaining(["sitecore_pricing_rows.developer_attention", "sitecore_pricing_edge_release(uuid,uuid)"]));
    await db.exec(repair); await db.exec(repair);
    expect(await readiness()).toMatchObject({ ready: true, missing: [] });
    expect((await db.query("select status,progress,run_requested_by from sitecore_pricing_imports where id=$1", [id])).rows).toEqual([{ status: "preview_queued", progress: 22, run_requested_by: actor }]);
    expect((await db.query("select before_values,after_values from sitecore_pricing_rows where import_id=$1 and language='en'", [id])).rows).toEqual([{ before_values: { regularPrice: "3900" }, after_values: source.values }]);
  });
  it("restores the missing shared-ID prerequisites without requiring old scripts or losing history", async () => {
    const id = await upload();
    await db.exec("drop function sitecore_pricing_is_empty_update(jsonb); drop function sitecore_pricing_expand_row(uuid,uuid,uuid,jsonb);");
    expect((await readiness()).ready).toBe(false);
    await db.exec(repair);
    expect(await readiness()).toMatchObject({ ready: true, missing: [] });
    expect((await db.query("select id,status,execution_mode from sitecore_pricing_imports where id=$1", [id])).rows).toEqual([{ id, status: "uploaded", execution_mode: "edge_auto" }]);
    expect((await db.query<{ n: number }>("select count(*)::int n from sitecore_pricing_rows where import_id=$1", [id])).rows[0].n).toBe(2);
  });
  it("removes all children of one import while preserving another import", async () => {
    const id = await upload(); const other = await upload();
    await db.query("insert into sitecore_pricing_catalog(import_id,item_id,path,property_id) values($1,'residence',$2,'11295')", [id, `${root}/edward`]);
    await remove(id);
    for (const table of ["sitecore_pricing_catalog", "sitecore_pricing_catalog_tasks", "sitecore_pricing_rows"]) {
      expect((await db.query<{ n: number }>(`select count(*)::int n from ${table} where import_id=$1`, [id])).rows[0].n).toBe(0);
    }
    expect((await db.query<{ n: number }>("select count(*)::int n from sitecore_pricing_imports where id=$1", [id])).rows[0].n).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int n from sitecore_pricing_rows where import_id=$1", [other])).rows[0].n).toBe(2);
    // Repeating a lost DELETE response is harmless.
    await expect(remove(id)).resolves.toMatchObject({ rows: [{ sitecore_pricing_delete_import: false }] });
  });
  it.each(["previewing", "applying", "uploaded"])("preserves all data when %s has an active lease or running state", async status => {
    const id = await upload();
    await db.query("update sitecore_pricing_imports set status=$2,lease_expires_at=now()+interval '3 minutes' where id=$1", [id, status]);
    await expect(remove(id)).rejects.toThrow("active import");
    expect((await db.query<{ n: number }>("select count(*)::int n from sitecore_pricing_rows where import_id=$1", [id])).rows[0].n).toBe(2);
  });
  it("allows an old completed manual import to be removed", async () => {
    const id = (await db.query<{ id: string }>("select sitecore_pricing_create('old.xlsx',$1,'Market Rates and Business Cases','https://dev.test',$1,$2,$3) id", [hash, actor, [source]])).rows[0].id;
    await db.query("update sitecore_pricing_imports set status='completed' where id=$1", [id]);
    await remove(id); expect((await db.query("select id from sitecore_pricing_imports where id=$1", [id])).rows).toEqual([]);
  });
  it("can delete a stranded manual running state after its lease expired", async () => {
    const id = (await db.query<{ id: string }>("select sitecore_pricing_create('stranded.xlsx',$1,'Market Rates and Business Cases','https://dev.test',$1,$2,$3) id", [hash, actor, [source]])).rows[0].id;
    await db.query("update sitecore_pricing_imports set status='previewing',lease_expires_at=now()-interval '3 minutes' where id=$1", [id]);
    await remove(id); expect((await db.query("select id from sitecore_pricing_imports where id=$1", [id])).rows).toEqual([]);
  });
  it("keeps deletion and readiness RPCs inaccessible to browser database roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      const result = await db.query<{ allowed: boolean }>("select has_function_privilege($1,'public.sitecore_pricing_delete_import(uuid,uuid)','execute') allowed", [role]);
      expect(result.rows[0].allowed).toBe(false);
    }
  });
});
