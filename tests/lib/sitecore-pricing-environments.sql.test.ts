// @vitest-environment node
// Authored for later execution; tests/builds are not run for this task.
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
let db: PGlite; let sql: string;
const actor = "00000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const source = { rowNumber: 10, propertyId: "11295", residence: "Edward", careLevel: "il", suiteTitle: "1bed", values: { regularPrice: "4100" }, errors: [], warnings: [] };
async function upload(environment: string) {
  return (await db.query<{ id: string }>("select sitecore_pricing_upload_environment('tracker.xlsx',$1,'Market Rates and Business Cases',$2,$1,$3,$4,'/sitecore/content/Home',$5) id", [hash, `https://${environment}.test`, actor, [source], environment])).rows[0].id;
}
async function command(id: string, environment: string, action = "run", confirm = false) {
  return db.query("select sitecore_pricing_environment_command($1,$2,$3,$4,$5)", [id, action, actor, environment, confirm]);
}
async function claim(environment: string) { return (await db.query<{ job: { id: string } | null }>("select sitecore_pricing_claim_environment($1,$2) job", [hash, environment])).rows[0].job; }
describe("multi-environment SQL and production authorization", () => {
  beforeAll(async () => {
    db = new PGlite(); await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    sql = await readFile(new URL("../../infrastructure/performance/sql/20261116160000_pricing_environments_complete.sql", import.meta.url), "utf8");
    await db.exec(sql);
  }, 30000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec("truncate sitecore_pricing_catalog,sitecore_pricing_catalog_tasks,sitecore_pricing_rows,sitecore_pricing_imports,sitecore_pricing_runtime;"); });
  it("is a rerunnable complete install that preserves QA/PROD history", async () => {
    const qa = await upload("qa"); const prod = await upload("prod");
    await db.exec(sql); await db.exec(sql);
    expect((await db.query("select id from sitecore_pricing_imports order by id")).rows).toEqual([qa, prod].sort().map(id => ({ id })));
    expect((await db.query<{ setup: unknown }>("select sitecore_pricing_schema_status() setup")).rows[0].setup).toMatchObject({ ready: true, missing: [], environments: ["dev", "qa", "prod"] });
  });
  it("queues explicit blank-promotion clears as real targets without any SQL upgrade", async () => {
    const clear = { ...source, values: { promotionPrice: "" } };
    const id = (await db.query<{ id: string }>("select sitecore_pricing_upload_environment('tracker.xlsx',$1,'Market Rates and Business Cases','https://dev.test',$1,$2,$3,'/sitecore/content/Home','dev') id", [hash, actor, [clear]])).rows[0].id;
    expect((await db.query<{ empty: boolean }>("select sitecore_pricing_is_empty_update($1) empty", [clear])).rows[0].empty).toBe(false);
    expect((await db.query("select status,source->'values' as values from sitecore_pricing_rows where import_id=$1 order by language", [id])).rows).toEqual([{ status: "pending", values: { promotionPrice: "" } }, { status: "pending", values: { promotionPrice: "" } }]);
    await command(id, "dev"); expect(await claim("dev")).toMatchObject({ id });
  });
  it("requires production confirmation and records its actor, timestamp and hash", async () => {
    const id = await upload("prod");
    await expect(command(id, "prod")).rejects.toThrow("Production confirmation required");
    expect(await claim("prod")).toBeNull();
    await command(id, "prod", "run", true);
    expect((await db.query("select production_confirmed_by,production_confirmation_hash,production_confirmed_at is not null confirmed from sitecore_pricing_imports where id=$1", [id])).rows).toEqual([{ production_confirmed_by: actor, production_confirmation_hash: hash, confirmed: true }]);
    expect(await claim("prod")).toMatchObject({ id });
  });
  it("requires fresh confirmation on a production retry", async () => {
    const id = await upload("prod"); await command(id, "prod", "run", true);
    await db.query("update sitecore_pricing_imports set status='failed' where id=$1", [id]);
    await expect(command(id, "prod", "retry")).rejects.toThrow("Production confirmation required");
    await expect(command(id, "prod", "retry", true)).resolves.toBeDefined();
  });
  it("cannot run PROD using a DEV command or either retired entry point", async () => {
    const id = await upload("prod");
    await expect(command(id, "dev", "run", true)).rejects.toThrow();
    await expect(db.query("select sitecore_pricing_edge_command($1,'run',$2)", [id, actor])).rejects.toThrow();
    await expect(db.query("select sitecore_pricing_command($1,'approve',$2)", [id, actor])).rejects.toThrow();
    expect(await claim("prod")).toBeNull();
  });
  it("isolates claims by environment even if configuration hashes match", async () => {
    const dev = await upload("dev"); const qa = await upload("qa");
    await command(dev, "dev"); await command(qa, "qa");
    expect(await claim("prod")).toBeNull();
    expect(await claim("qa")).toMatchObject({ id: qa });
    expect(await claim("dev")).toMatchObject({ id: dev });
  });
  it("does not claim a tampered or missing production confirmation", async () => {
    const id = await upload("prod"); await command(id, "prod", "run", true);
    await db.query("update sitecore_pricing_imports set production_confirmation_hash='wrong' where id=$1", [id]);
    expect(await claim("prod")).toBeNull();
  });
  it("can delete production history without issuing a Sitecore operation", async () => {
    const id = await upload("prod");
    await db.query("select sitecore_pricing_delete_import($1,$2)", [id, actor]);
    expect((await db.query("select id from sitecore_pricing_imports where id=$1", [id])).rows).toEqual([]);
  });
  it.each(["anon", "authenticated"])("denies new RPCs to %s", async role => {
    for (const signature of ["sitecore_pricing_upload_environment(text,text,text,text,text,uuid,jsonb,text,text)", "sitecore_pricing_environment_command(uuid,text,uuid,text,boolean)", "sitecore_pricing_claim_environment(text,text)"]) {
      expect((await db.query<{ allowed: boolean }>("select has_function_privilege($1,$2,'execute') allowed", [role, signature])).rows[0].allowed).toBe(false);
    }
  });
});
