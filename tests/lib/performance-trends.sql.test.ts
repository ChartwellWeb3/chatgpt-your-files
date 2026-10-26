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
  await db.query("insert into performance_page_results (run_id,page_id,page_path,locale,status,performance_score,noisy,result,page_name) values ($1,$2,$3,$4,$5,$6,$7,$8,$2)", [id(n), pageId, path, locale, status, score, noisy, result]);
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
      create table performance_page_results (run_id uuid references performance_runs, page_id text, page_name text, page_path text, locale text, status text, performance_score numeric, lcp_ms numeric, tbt_ms numeric, cls numeric, fcp_ms numeric, speed_index_ms numeric, noisy boolean, error_message text, result jsonb, primary key(run_id, page_id));
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
  async function summaries(runIds = [13]) {
    const { rows } = await db.query<{ data: Record<string, { total: number; included: number; noisy: number; failures: number; score: number | null }> }>("select performance_run_summaries('qa',$1) as data", [runIds.map(id)]);
    return rows[0].data;
  }
  type PageList = { total: number; page: number; pageSize: number; pages: { page_id: string; performance_score: number | null; lcp_ms: number | null; score_delta: number | null; available: boolean }[] };
  async function pageList(options: { runs?: number[]; search?: string; device?: string; sort?: string; asc?: boolean; page?: number } = {}) {
    const { rows } = await db.query<{ data: PageList }>("select performance_page_results_page('qa',$1,$2,$3,$4,$5,$6,8) as data", [(options.runs ?? [13]).map(id), options.device ?? "all", options.search ?? "", options.sort ?? "score", options.asc ?? true, options.page ?? 0]);
    return rows[0].data;
  }
  it("computes device summaries from every stored row independently of the paginated table", async () => {
    for (let n = 0; n < 25; n++) await page(13, 20, `page-${n}`);
    await page(13, 100, "noisy", true); await page(13, 100, "failed", false, "failed");
    const summary = (await summaries())[id(13)];
    expect(summary).toMatchObject({ total: 28, included: 26, noisy: 1, failures: 1 });
    expect(summary.score).toBeCloseTo(560 / 26);
    expect((await pageList()).pages).toHaveLength(8);
    expect((await pageList()).total).toBe(28);
  });
  it("keeps summaries for partial runs, but excludes failed runs and unready uploads", async () => {
    await db.query("update performance_runs set status='partial' where id=$1", [id(13)]);
    expect((await summaries())[id(13)].score).toBe(60);
    await db.query("update performance_runs set upload_status='pending' where id=$1", [id(13)]);
    expect((await summaries())[id(13)].score).toBeNull();
    await db.query("update performance_runs set status='failed',upload_status='ready' where id=$1", [id(13)]);
    expect((await summaries())[id(13)].score).toBeNull();
  });
  it("paginates deterministically, sorts over all rows, and keeps missing values last in both directions", async () => {
    for (let n = 0; n < 18; n++) await page(13, n * 3, `page-${String(n).padStart(2, "0")}`);
    await page(13, null, "missing");
    const first = await pageList(); const second = await pageList({ page: 1 }); const last = await pageList({ page: 999 });
    expect(first.pages.map((p) => p.performance_score)).toEqual([0, 3, 6, 9, 12, 15, 18, 21]);
    expect(second.pages[0].performance_score).toBe(24);
    expect(new Set([...first.pages, ...second.pages].map((p) => p.page_id)).size).toBe(16);
    expect(last).toMatchObject({ page: 2, total: 20 });
    expect(last.pages.at(-1)?.performance_score).toBeNull();
    expect((await pageList({ asc: false })).pages[0].performance_score).toBe(60);
    expect((await pageList({ asc: false, page: 2 })).pages.at(-1)?.performance_score).toBeNull();
  });
  it("filters all rows by literal search text and device without treating wildcard input as SQL", async () => {
    await page(13, 1, "Search_100%", false, "complete", {}, "fr", "/fr/special");
    expect((await pageList({ search: "SEARCH_100%" })).total).toBe(1);
    expect((await pageList({ search: "fr/special" })).pages[0].page_id).toBe("Search_100%");
    expect((await pageList({ search: "' OR true --" })).total).toBe(0);
    await run(23, 3, settings(), "desktop"); await page(23, 99);
    expect((await pageList({ runs: [13, 23], device: "desktop" })).pages[0].performance_score).toBe(99);
  });
  it("normalizes JSON metrics and returns only eligible stored score deltas without full report JSON", async () => {
    await page(13, null, "json", false, "complete", { aggregate: { metrics: { score: 0, lcp: 1234 } }, comparison: { metrics: { score: { delta: -5 } } }, runs: [{ content: "large" }] });
    const row = (await pageList({ search: "json" })).pages[0];
    expect(row).toMatchObject({ performance_score: 0, lcp_ms: 1234, score_delta: -5, available: true });
    expect(row).not.toHaveProperty("result");
    await db.query("update performance_page_results set noisy=true where run_id=$1", [id(13)]);
    expect((await pageList({ search: "json" })).pages[0].score_delta).toBeNull();
    await db.query("update performance_runs set status='failed' where id=$1", [id(13)]);
    expect((await pageList({ search: "json" })).pages[0]).toMatchObject({ available: false, performance_score: null, lcp_ms: null, score_delta: null });
  });
  it("keeps summaries and page searches inside the requested environment, with clean empty results", async () => {
    await run(14, 4); await page(14, 100);
    expect(await summaries([14])).toEqual({});
    expect(await pageList({ runs: [14], page: 10 })).toEqual({ total: 0, page: 0, pageSize: 8, pages: [] });
    await expect(pageList({ sort: "score; drop table performance_runs" })).rejects.toThrow(/Invalid page/);
    await expect(pageList({ runs: [11, 12, 13] })).rejects.toThrow(/Invalid page/);
  });
});
