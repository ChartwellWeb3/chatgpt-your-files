// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const settings = (node = "v24.11.1") => ({
  profile: "mobile-qa-v1", mode: "deployment", deviceProfile: "mobile", schemaVersion: 1,
  measurement: { settings: { formFactor: "mobile", throttling: { cpuSlowdownMultiplier: 4 } }, numberOfRuns: 3 },
  toolchain: { lighthouse: "12.6.1", chromium: "153.0", node, runner: "ubuntu-24.04", platform: "linux-x64" },
  authentication: { mode: "vercel-automation-cookie-v1" },
});
let db: PGlite;
async function run(n: number, deployment: number, summary: unknown = settings(), device = "mobile", status = "complete", upload = "ready") {
  await db.query("insert into performance_runs values ($1,$2,$3,$4,$5,$6,$7,$8)", [id(n), id(deployment), device, status, upload, `fingerprint-${n}`, summary, `2026-10-26T${String(n % 24).padStart(2, "0")}:00:00Z`]);
}
async function page(n: number, score: number | null, pageId = "home-en", noisy: boolean | null = false, status = "complete", result: unknown = {}, locale = "en", path = "/") {
  await db.query("insert into performance_page_results values ($1,$2,$3,$4,$5,$6,$7,$8)", [id(n), pageId, path, locale, status, score, noisy, result]);
}
async function trend(pageId?: string, selected = 13, reference = 13, device = "mobile") {
  const name = pageId === undefined ? "performance_overall_trend" : "performance_page_trend";
  const params: unknown[] = ["qa", [id(1), id(2), id(3), id(4)], device, id(reference), id(selected)];
  if (pageId !== undefined) params.push(pageId);
  const { rows } = await db.query<{ points: { deploymentId: string; runId: string | null; value: number | null; reason: string | null; includedPages: number; totalPages: number }[] }>(`select ${name}(${params.map((_, i) => `$${i + 1}`).join(",")}) as points`, params);
  return rows[0].points;
}

describe("Supabase performance trend SQL", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table performance_deployments (id uuid primary key, environment text, source_finished_at timestamptz, created_at timestamptz, source_build_number text, commit_sha text);
      create table performance_runs (id uuid primary key, deployment_id uuid references performance_deployments, device text, status text, upload_status text, profile_fingerprint text, summary jsonb, created_at timestamptz);
      create table performance_page_results (run_id uuid references performance_runs, page_id text, page_path text, locale text, status text, performance_score numeric, noisy boolean, result jsonb, primary key(run_id, page_id));
    `);
    const sql = await readFile(new URL("../../infrastructure/performance/sql/performance-trends.sql", import.meta.url), "utf8");
    await db.exec(sql);
    // SQL Editor execution is repeatable, without dropping measurements.
    await db.exec(sql);
  }, 30000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("truncate performance_page_results, performance_runs, performance_deployments");
    for (let n = 1; n <= 4; n++) {
      await db.query("insert into performance_deployments values ($1,$2,$3,$3,$4,null)", [id(n), n === 4 ? "prod" : "qa", `2026-10-${22 + n}T16:00:00Z`, `build-${n}`]);
    }
    await run(11, 1); await run(12, 2); await run(13, 3, settings("v24.22.1"));
    await page(11, 40); await page(12, 50); await page(13, 60);
  });
  it("includes all three deployments across Node minor/patch changes while keeping environments separate", async () => {
    expect((await trend()).map((p) => p.value)).toEqual([40, 50, 60]);
    expect((await trend("home-en")).map((p) => p.value)).toEqual([40, 50, 60]);
  });
  it("averages complete consistent pages exactly once, retaining zero and JSON-only scores", async () => {
    await page(13, 0, "zero");
    await page(13, null, "fallback", false, "complete", { aggregate: { metrics: { score: 90 } } });
    await page(13, 100, "noisy", true); await page(13, 100, "failed", false, "failed");
    await page(13, null, "missing"); await page(13, 100, "unknown", null);
    await page(13, null, "bad-json", false, "complete", { aggregate: { metrics: { score: "bad" } } });
    expect((await trend())[2]).toMatchObject({ value: 50, includedPages: 3, totalPages: 8 });
  });
  it.each(["pending", "failed"])("keeps gaps for %s ingestion", async (status) => {
    await db.query("update performance_runs set upload_status=$1 where id=$2", [status, id(12)]);
    expect((await trend())[1]).toMatchObject({ value: null, reason: "Audit or ingestion incomplete" });
  });
  it("uses the latest failed rerun as a gap and honors an explicitly selected older attempt", async () => {
    await run(22, 2, settings(), "mobile", "failed");
    await page(22, 99);
    expect((await trend())[1]).toMatchObject({ runId: id(22), value: null });
    expect((await trend(undefined, 12))[1]).toMatchObject({ runId: id(12), value: 50 });
  });
  it("never mixes mobile and desktop attempts", async () => {
    await run(23, 3, settings(), "desktop"); await page(23, 99);
    expect((await trend())[2].value).toBe(60);
    expect((await trend(undefined, 23, 23, "desktop")).map((p) => p.value)).toEqual([null, null, 99]);
  });
  it.each(["lighthouse", "chromium", "node"])("keeps a gap when the material %s version changes", async (tool) => {
    const changed = settings(); changed.toolchain[tool as keyof typeof changed.toolchain] = tool === "node" ? "v25.0.0" : "changed";
    await db.query("update performance_runs set summary=$1 where id=$2", [changed, id(12)]);
    expect((await trend())[1]).toMatchObject({ value: null, reason: "Different or unknown measurement settings" });
  });
  it("keeps different throttling, authentication, and sampling configurations separate", async () => {
    const changed = settings(); changed.measurement.settings.throttling.cpuSlowdownMultiplier = 6;
    await db.query("update performance_runs set summary=$1 where id=$2", [changed, id(12)]);
    expect((await trend())[1].value).toBeNull();
    changed.measurement.settings.throttling.cpuSlowdownMultiplier = 4; changed.authentication.mode = "different";
    await db.query("update performance_runs set summary=$1 where id=$2", [changed, id(12)]);
    expect((await trend())[1].value).toBeNull();
    changed.authentication.mode = "vercel-automation-cookie-v1"; changed.measurement.numberOfRuns = 5;
    await db.query("update performance_runs set summary=$1 where id=$2", [changed, id(12)]);
    expect((await trend())[1].value).toBeNull();
  });
  it.each(["path", "locale", "site", "itemId"])("does not merge a page whose %s changed", async (field) => {
    if (field === "path") await db.query("update performance_page_results set page_path='/different' where run_id=$1", [id(12)]);
    else if (field === "locale") await db.query("update performance_page_results set locale='fr' where run_id=$1", [id(12)]);
    else await db.query("update performance_page_results set result=$1 where run_id=$2", [{ identity: { [field]: "different" } }, id(12)]);
    expect((await trend("home-en"))[1]).toMatchObject({ value: null, reason: "Page identity not measured in this attempt" });
    expect((await trend())[1].value).toBe(50);
  });
  it("shows noisy pages as gaps and uses JSON consistency when the scalar flag is missing", async () => {
    await db.query("update performance_page_results set noisy=true where run_id=$1", [id(12)]);
    expect((await trend("home-en"))[1]).toMatchObject({ value: null, reason: "Inconsistent samples" });
    await db.query("update performance_page_results set noisy=null, result=$1 where run_id=$2", [{ aggregate: { noisy: false } }, id(12)]);
    expect((await trend("home-en"))[1].value).toBe(50);
  });
  it("falls back to exact fingerprints when measurement settings are incomplete", async () => {
    await db.exec("update performance_runs set summary='{}', profile_fingerprint='same'");
    expect((await trend()).map((p) => p.value)).toEqual([40, 50, 60]);
    await db.query("update performance_runs set profile_fingerprint=null where id=$1", [id(12)]);
    expect((await trend())[1].value).toBeNull();
  });
  it("returns explicit gaps when page data is absent", async () => {
    await db.query("delete from performance_page_results where run_id=$1", [id(12)]);
    expect((await trend())[1]).toMatchObject({ value: null, reason: "Page measurements unavailable" });
  });
  it("rejects attempts in a different environment or device and absent target pages", async () => {
    await run(14, 4);
    await expect(trend(undefined, 14)).rejects.toThrow(/Selected measurement/);
    await expect(trend(undefined, 13, 14)).rejects.toThrow(/Reference measurement/);
    await expect(trend("missing-page")).rejects.toThrow(/Selected page/);
  });
  it("restricts RPC execution to the service role", async () => {
    const { rows } = await db.query<{ allowed: boolean }>("select has_function_privilege('anon', 'public.performance_overall_trend(text,uuid[],text,uuid,uuid)', 'execute') as allowed union all select has_function_privilege('authenticated', 'public.performance_page_trend(text,uuid[],text,uuid,uuid,text)', 'execute') union all select has_function_privilege('service_role', 'public.performance_page_trend(text,uuid[],text,uuid,uuid,text)', 'execute')");
    expect(rows.map((r) => r.allowed)).toEqual([false, false, true]);
  });
});
