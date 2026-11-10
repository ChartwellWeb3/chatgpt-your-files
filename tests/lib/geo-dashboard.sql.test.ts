// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
let topic: string; let market: string; let brand: string;
type Started = { created: boolean; runId: string; attemptId: string; leaseToken: string; status?: string };
async function start(n = 20, environment = "qa") {
  const result = await db.query<{ data: Started }>("select geo_begin_manual_run($1,$2,$3,$4,$5) as data", [environment, id(10), id(1), id(n), id(999)]);
  return result.rows[0].data;
}
const mention = (brandId: string | null = brand) => ({ brand_id: brandId, slug: "competitor", name: "Competitor", observed_name: "Observed", is_recommendation: true, position: 2, evidence_quote: "2. Chartwell is recommended." });
async function save(run: Started) {
  await db.query("update geo_run_attempts set status='extracting',provider_response_id=$2,returned_model='test-model',response_text='2. Chartwell is recommended.',raw_response='{}' where id=$1", [run.attemptId, `response-${run.attemptId}`]);
}
async function finish(run: Started, mentions = [mention()], sources: unknown[] = []) {
  await db.query("select geo_finish_manual_run('qa',$1,$2,$3,'{}',$4,$5,'{}')", [run.runId, run.attemptId, run.leaseToken, mentions, sources]);
}
describe("GEO dashboard update SQL", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    await db.exec(await readFile(new URL("../../infrastructure/performance/sql/geo-monitoring.sql", import.meta.url), "utf8"));
    const update = await readFile(new URL("../../infrastructure/performance/sql/20261027190000_geo_dashboard_operations.sql", import.meta.url), "utf8");
    await db.exec(update); await db.exec(update);
    topic = (await db.query<{ id: string }>("select id from geo_topics limit 1")).rows[0].id;
    market = (await db.query<{ id: string }>("select id from geo_markets limit 1")).rows[0].id;
    brand = (await db.query<{ id: string }>("select id from geo_brands where is_chartwell")).rows[0].id;
  }, 30000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("truncate geo_ai_jobs,geo_insight_evidence,geo_insights,geo_sources,geo_mentions,geo_run_attempts,geo_runs,geo_questions,geo_benchmarks;");
    await db.query("insert into geo_questions(id,environment,question,topic_id,market_id,status,approved_by) values($1,'qa','What retirement options are available?',$2,$3,'active',$4)", [id(1), topic, market, id(999)]);
    await db.query("insert into geo_benchmarks(id,environment,name,model,analysis_model,collection_prompt,extraction_prompt) values($1,'qa','Test','test-model','test-analysis','Neutral','Extract')", [id(10)]);
  });
  it("deduplicates HTTP retries and limits concurrent collections", async () => {
    const first = await start(); const duplicate = await start();
    expect(first.created).toBe(true); expect(duplicate).toMatchObject({ created: false, runId: first.runId, status: "running" });
    await start(21); await expect(start(22)).rejects.toThrow(/Two monitoring runs/);
    await expect(start(23, "prod")).rejects.toThrow(/Unknown benchmark/);
    expect((await db.query("select count(*)::int as n from geo_run_attempts")).rows[0]).toEqual({ n: 2 });
  });
  it("atomically records evidence and finalizes one selected attempt", async () => {
    const run = await start(); await save(run);
    const source = { source_kind: "cited", source_index: 0, url: "https://chartwell.com", normalized_url: "https://chartwell.com/", domain: "chartwell.com", title: "Chartwell", owner_brand_id: brand, source_type: "owned", annotation: {} };
    await finish(run, [mention()], [source]); await finish(run, [mention()], [source]);
    expect((await db.query("select status,selected_attempt_id from geo_runs")).rows[0]).toEqual({ status: "succeeded", selected_attempt_id: run.attemptId });
    expect((await db.query("select count(*)::int as n from geo_sources")).rows[0]).toEqual({ n: 1 });
    const summary = (await db.query<{ data: { counts: { succeeded: number }; sources: { cited_answers: number }[] } }>("select geo_dashboard_summary('qa',$1,now()-interval '1 day',now()+interval '1 day',null,null,null,'unbranded',true) as data", [id(10)])).rows[0].data;
    expect(summary.counts.succeeded).toBe(1); expect(summary.sources[0].cited_answers).toBe(1);
    const withoutManual = (await db.query<{ data: { counts: { succeeded: number } } }>("select geo_dashboard_summary('qa',$1,now()-interval '1 day',now()+interval '1 day') as data", [id(10)])).rows[0].data;
    expect(withoutManual.counts.succeeded).toBe(0);
  });
  it("rolls back partial evidence on invalid extraction and rejects expired leases", async () => {
    const run = await start(); await save(run);
    await expect(finish(run, [mention(), { ...mention(), evidence_quote: "Fabricated quote" }])).rejects.toThrow(/saved answer/);
    expect((await db.query("select count(*)::int as n from geo_mentions")).rows[0]).toEqual({ n: 0 });
    await db.exec("update geo_runs set lease_expires_at=now()-interval '1 minute'");
    await expect(finish(run)).rejects.toThrow(/lease has expired/);
    expect((await db.query("select status from geo_runs")).rows[0]).toEqual({ status: "running" });
  });
  it("stores opportunities and supporting runs together and makes retries idempotent", async () => {
    const run = await start(); await save(run); await finish(run);
    await db.query("insert into geo_ai_jobs(id,environment,kind,model,created_by,input,raw_response,usage) values($1,'qa','opportunities','test-analysis',$2,'{}','{}','{}')", [id(70), id(999)]);
    const rows = [{ title: "Investigate coverage", opportunity: "Test clearer information for families.", run_ids: [run.runId] }];
    const query = () => db.query<{ data: { created: number } }>("select geo_save_opportunities($1,'qa',$2,now()-interval '1 day',now()+interval '1 day','{}',$3) as data", [id(70), id(10), rows]);
    expect((await query()).rows[0].data.created).toBe(1); expect((await query()).rows[0].data.created).toBe(1);
    expect((await db.query("select count(*)::int as n from geo_insights")).rows[0]).toEqual({ n: 1 });
    expect((await db.query("select count(*)::int as n from geo_insight_evidence")).rows[0]).toEqual({ n: 1 });
  });
  it("rejects opportunities with evidence from another benchmark atomically", async () => {
    const run = await start(); await save(run); await finish(run);
    await db.query("insert into geo_benchmarks(id,environment,name,model,analysis_model,collection_prompt,extraction_prompt) values($1,'qa','Other','model','analysis','Neutral','Extract')", [id(11)]);
    await db.query("insert into geo_ai_jobs(id,environment,kind,model,created_by,input,raw_response,usage) values($1,'qa','opportunities','analysis',$2,'{}','{}','{}')", [id(70), id(999)]);
    await expect(db.query("select geo_save_opportunities($1,'qa',$2,now(),now()+interval '1 day','{}',$3)", [id(70), id(11), [{ title: "Invalid", opportunity: "Wrong cohort", run_ids: [run.runId] }]])).rejects.toThrow(/same benchmark/);
    expect((await db.query("select count(*)::int as n from geo_insights")).rows[0]).toEqual({ n: 0 });
  });
  it("closes all new tables and functions to browser roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await expect(db.exec("select * from geo_ai_jobs")).rejects.toThrow(/permission denied/);
        await expect(start()).rejects.toThrow(/permission denied/);
      } finally { await db.exec("reset role"); }
    }
  });
});
