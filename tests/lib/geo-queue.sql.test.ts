// @vitest-environment node
// Added for the queue update; intentionally not executed during implementation.
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
let topic: string; let market: string;
type Enqueued = { batchId: string; runId: string; count: number; existing?: boolean };
type Claimed = { runId: string; stage: string; attemptId: string; leaseToken: string; environment: string };
async function enqueue(kind = "single", key = 50, question: string | null = id(1)) {
  return (await db.query<{ result: Enqueued }>("select geo_enqueue('qa',$1,$2,$3,$4,$5) as result", [id(10), kind, id(key), id(999), question])).rows[0].result;
}
async function claim() {
  return (await db.query<{ result: Claimed | null }>("select geo_worker_claim() as result")).rows[0].result;
}
async function save(job: Claimed) {
  const raw = { id: `response-${job.runId}`, model: "saved-model", status: "completed", output: [{ type: "web_search_call", status: "completed" }] };
  await db.query("select geo_worker_save($1,$2,$3,'An answer with no operator brands.','{}')", [job.runId, job.leaseToken, raw]);
}
async function complete(job: Claimed) {
  await save(job);
  await db.query("select geo_worker_advance($1,$2)", [job.runId, job.leaseToken]);
  const analysis = (await claim())!;
  await db.query("select geo_worker_save($1,$2,'{}',null,'{}')", [analysis.runId, analysis.leaseToken]);
  await db.query("select geo_worker_finish($1,$2,$3,'[]','[]')", [analysis.runId, analysis.leaseToken, { mentions: [] }]);
}

describe("GEO queue and reporting separation", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    for (const file of ["geo-monitoring.sql", "20261027190000_geo_dashboard_operations.sql", "20261109120000_geo_queue.sql", "20261109130000_geo_cancel_batches.sql"]) {
      await db.exec(await readFile(new URL(`../../infrastructure/performance/sql/${file}`, import.meta.url), "utf8"));
    }
    topic = (await db.query<{ id: string }>("select id from geo_topics limit 1")).rows[0].id;
    market = (await db.query<{ id: string }>("select id from geo_markets limit 1")).rows[0].id;
  }, 30000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("truncate geo_retry_requests,geo_run_jobs,geo_batches,geo_insight_evidence,geo_insights,geo_sources,geo_mentions,geo_run_attempts,geo_runs,geo_questions,geo_benchmarks;");
    await db.query("insert into geo_benchmarks(id,environment,name,model,analysis_model,collection_prompt,extraction_prompt) values($1,'qa','Queue baseline','monitor','analysis','Neutral','Extract')", [id(10)]);
    await db.query("insert into geo_questions(id,environment,question,topic_id,market_id,status,approved_by) values($1,'qa','Which retirement options are available?',$2,$3,'active',$4)", [id(1), topic, market, id(999)]);
  });
  it("allows draft tests, excludes completed tests even with the legacy filter, and counts Run now", async () => {
    await db.query("update geo_questions set status='draft' where id=$1", [id(1)]);
    const test = await enqueue("test");
    await complete((await claim())!);
    expect((await db.query("select count(*)::int as n from geo_test_runs")).rows[0]).toEqual({ n: 1 });
    const summary = () => db.query<{ result: { counts: { succeeded: number } } }>("select geo_dashboard_summary('qa',$1,now()-interval '1 day',now()+interval '1 day',null,null,null,null,true) as result", [id(10)]);
    expect((await summary()).rows[0].result.counts.succeeded).toBe(0);
    await expect(enqueue("single", 51)).rejects.toThrow(/No eligible/);
    await db.query("update geo_questions set status='active',approved_by=$2 where id=$1", [id(1), id(999)]);
    await enqueue("single", 52); await complete((await claim())!);
    expect((await summary()).rows[0].result.counts.succeeded).toBe(1);
    await expect(db.query("update geo_runs set purpose='monitoring' where id=$1", [test.runId])).rejects.toThrow(/immutable/);
  });
  it("queues the whole approved library once per request and cancels obsolete snapshots", async () => {
    for (let n = 2; n <= 13; n++) await db.query("insert into geo_questions(id,environment,question,topic_id,market_id,status,approved_by) values($1,'qa','Which residences should a family consider?',$2,$3,'active',$4)", [id(n + 100), topic, market, id(999)]);
    const first = await enqueue("all", 50, null);
    expect(first.count).toBe(13);
    expect(await enqueue("all", 50, null)).toMatchObject({ batchId: first.batchId, existing: true });
    await db.exec("update geo_questions set status='archived'");
    expect(await claim()).toBeNull();
    expect((await db.query("select cancelled from geo_batch_progress")).rows[0]).toEqual({ cancelled: 13 });
  });
  it("limits concurrent stages, fences expired leases, and flags unknown collections", async () => {
    await enqueue("single", 50); await enqueue("single", 51); await enqueue("single", 52);
    const first = (await claim())!; await claim();
    expect(await claim()).toBeNull();
    await db.query("update geo_run_jobs set lease_expires_at=now()-interval '1 second' where run_id=$1", [first.runId]);
    await claim();
    await expect(save(first)).rejects.toThrow(/Stale worker/);
    expect((await db.query("select status,needs_review from geo_run_jobs where run_id=$1", [first.runId])).rows[0]).toEqual({ status: "failed", needs_review: true });
  });
  it("retries extraction on the original answer and original run", async () => {
    const batch = await enqueue(); const collecting = (await claim())!; await save(collecting);
    await db.query("select geo_worker_advance($1,$2)", [collecting.runId, collecting.leaseToken]);
    const extracting = (await claim())!;
    await db.query("select geo_worker_fail($1,$2,'Analysis failed',false,false)", [extracting.runId, extracting.leaseToken]);
    await db.query("select geo_retry_batch('qa',$1,$2)", [batch.batchId, id(70)]);
    const retried = (await claim())!;
    expect(retried).toMatchObject({ stage: "extraction", attemptId: collecting.attemptId, runId: collecting.runId });
  });
  it("cancels queued and active work while retaining completed answers and rejecting late writes", async () => {
    for (const n of [2, 3]) await db.query("insert into geo_questions(id,environment,question,topic_id,market_id,status,approved_by) values($1,'qa','Which residences should a family consider?',$2,$3,'active',$4)", [id(n), topic, market, id(999)]);
    const batch = await enqueue("all", 50, null);
    await complete((await claim())!);
    const active = (await claim())!;
    await expect(db.query("select geo_cancel_batch('prod',$1,$2)", [batch.batchId, id(999)])).rejects.toThrow(/Unknown collection/);
    const result = (await db.query<{ result: { cancelled: number } }>("select geo_cancel_batch('qa',$1,$2) as result", [batch.batchId, id(999)])).rows[0].result;
    expect(result.cancelled).toBe(2);
    expect((await db.query("select completed,cancelled,queued,collecting,analyzing from geo_batch_progress where id=$1", [batch.batchId])).rows[0]).toEqual({ completed: 1, cancelled: 2, queued: 0, collecting: 0, analyzing: 0 });
    expect(await claim()).toBeNull();
    await expect(save(active)).rejects.toThrow(/Stale worker/);
    expect((await db.query<{ result: { existing: boolean } }>("select geo_cancel_batch('qa',$1,$2) as result", [batch.batchId, id(999)])).rows[0].result.existing).toBe(true);
    await expect(db.query("select geo_retry_batch('qa',$1,$2)", [batch.batchId, id(70)])).rejects.toThrow(/cancelled/);
  });
  it("fences an active analysis from completing after cancellation", async () => {
    const batch = await enqueue(); const collecting = (await claim())!;
    await save(collecting);
    await db.query("select geo_worker_advance($1,$2)", [collecting.runId, collecting.leaseToken]);
    const analyzing = (await claim())!;
    await db.query("select geo_cancel_batch('qa',$1,$2)", [batch.batchId, id(999)]);
    await expect(db.query("select geo_worker_finish($1,$2,$3,'[]','[]')", [analyzing.runId, analyzing.leaseToken, { mentions: [] }])).rejects.toThrow(/Stale worker/);
    await db.query("select geo_worker_fail($1,$2,'Late provider error',true,false)", [analyzing.runId, analyzing.leaseToken]);
    expect((await db.query("select status from geo_runs where id=$1", [analyzing.runId])).rows[0]).toEqual({ status: "cancelled" });
    expect((await db.query("select count(*)::int as n from geo_reporting_runs where status='succeeded'")).rows[0]).toEqual({ n: 0 });
  });
  it("keeps Monday at 9 AM local through DST and never enables scheduling during installation", async () => {
    const rows = (await db.query<{ local: string }>("select to_char(geo_next_monday(d) at time zone 'America/Toronto','ID HH24:MI') as local from (values('2026-10-30T12:00:00Z'::timestamptz),('2027-03-12T12:00:00Z'::timestamptz)) x(d)")).rows;
    expect(rows.map(row => row.local)).toEqual(["1 09:00", "1 09:00"]);
    expect((await db.query("select schedule_enabled from geo_benchmarks")).rows[0]).toEqual({ schedule_enabled: false });
    await expect(db.query("select geo_enqueue('prod',$1,'single',$2,$3,$4)", [id(10), id(50), id(999), id(1)])).rejects.toThrow(/Unknown benchmark/);
  });
});
