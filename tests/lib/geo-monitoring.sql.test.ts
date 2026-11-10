// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
let sql: string;
let topic: string;
let market: string;
let chartwell: string;

async function question(n = 1, environment = "qa", kind = "unbranded") {
  await db.query(`insert into geo_questions
    (id,environment,question,topic_id,market_id,status,approved_by,question_kind)
    values ($1,$2,'What are the best memory care residences in Toronto?',$3,$4,'active',$5,$6)`,
  [id(n), environment, topic, market, id(999), kind]);
}
async function benchmark(n = 10, environment = "qa") {
  await db.query(`insert into geo_benchmarks
    (id,environment,name,model,analysis_model,collection_prompt,extraction_prompt)
    values ($1,$2,'Test benchmark','test-search-model','test-extractor','Answer neutrally','Extract evidence')`, [id(n), environment]);
}
async function run(n: number, options: { question?: number; benchmark?: number; environment?: string; source?: string; day?: number } = {}) {
  await db.query(`insert into geo_runs
    (id,environment,benchmark_id,question_id,source,scheduled_for,idempotency_key)
    values ($1,$2,$3,$4,$5,$6,$7)`, [id(n), options.environment ?? "qa", id(options.benchmark ?? 10),
    id(options.question ?? 1), options.source ?? "scheduled", `2026-10-${options.day ?? 20}T14:00:00Z`, `run-${n}`]);
}
async function attempt(n: number, runId: number, number = 1) {
  await db.query("insert into geo_run_attempts (id,run_id,attempt_number) values ($1,$2,$3)", [id(n), id(runId), number]);
}
async function mention(attemptId: number, brand: string, position: number | null = null) {
  await db.query(`insert into geo_mentions (attempt_id,brand_id,observed_name,is_recommendation,position,evidence_quote)
    values ($1,$2,'Observed brand',$3,$4,'Exact answer evidence')`, [id(attemptId), brand, position !== null, position]);
}
async function finish(attemptId: number, runId: number) {
  await db.query(`update geo_run_attempts set status='succeeded', provider_response_id=$2,
    returned_model='test-search-model', response_text='The answer',raw_response='{}',extraction='{}',finished_at=now() where id=$1`,
  [id(attemptId), `response-${attemptId}`]);
  await db.query("update geo_runs set status='succeeded',selected_attempt_id=$2,finished_at=now() where id=$1", [id(runId), id(attemptId)]);
}
type Metric = { group_key: string; brand_id: string; samples: number; mentions: number; ranked_mentions: number; visibility_rate: string | null; average_position: string | null; top3_rate: string | null; share_of_voice: string | null };
async function metrics(group = "overall", benchmarkId = 10, start = "2026-10-01T00:00:00Z", end = "2026-11-01T00:00:00Z") {
  const { rows } = await db.query<Metric>("select * from geo_brand_metrics('qa',$1,$2,$3,$4)", [id(benchmarkId), start, end, group]);
  return rows;
}

describe("GEO monitoring SQL Editor installation", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table performance_sentinel (id integer primary key, result jsonb);
      insert into performance_sentinel values (1,'{"score":75}');`);
    sql = await readFile(new URL("../../infrastructure/performance/sql/geo-monitoring.sql", import.meta.url), "utf8");
    await db.exec(sql);
    await db.exec(sql);
    const { rows } = await db.query<{ topic: string; market: string; chartwell: string }>(`select
      (select id from geo_topics where slug='memory-care') as topic,
      (select id from geo_markets where slug='toronto') as market,
      (select id from geo_brands where is_chartwell) as chartwell`);
    ({ topic, market, chartwell } = rows[0]);
  }, 30000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec(`truncate geo_insight_evidence,geo_insights,geo_sources,geo_mentions,geo_run_attempts,geo_runs,geo_questions,geo_benchmarks;
      delete from geo_brands where not is_chartwell;`);
    await question(); await benchmark();
  });

  it("installs twice without changing existing performance data or duplicating seeds", async () => {
    expect((await db.query("select result from performance_sentinel")).rows).toEqual([{ result: { score: 75 } }]);
    expect((await db.query("select count(*)::int as n from geo_topics")).rows[0]).toEqual({ n: 10 });
    expect((await db.query("select count(*)::int as n from geo_markets")).rows[0]).toEqual({ n: 9 });
    expect((await db.query("select count(*)::int as n from geo_brands")).rows[0]).toEqual({ n: 1 });
    expect((await db.query("select schedule_enabled from geo_benchmarks")).rows[0]).toEqual({ schedule_enabled: false });
  });

  it("preserves question snapshots, increments edits, and requires reapproval", async () => {
    await run(20);
    await db.query("update geo_questions set question='Which retirement homes are best for memory care in Toronto?' where id=$1", [id(1)]);
    expect((await db.query("select revision,status,approved_by,approved_at from geo_questions")).rows[0])
      .toEqual({ revision: 2, status: "draft", approved_by: null, approved_at: null });
    expect((await db.query<{ question_revision: number; question_snapshot: { question: string } }>("select question_revision,question_snapshot from geo_runs")).rows[0])
      .toMatchObject({ question_revision: 1, question_snapshot: { question: "What are the best memory care residences in Toronto?" } });
    await expect(run(21, { day: 21 })).rejects.toThrow(/approved question/);
    await expect(db.query("delete from geo_questions where id=$1", [id(1)])).rejects.toThrow(/Archive/);
    await expect(db.query("update geo_questions set status='active' where id=$1", [id(1)])).rejects.toThrow(/Approval/);
  });

  it("archives and reactivates questions while retaining history", async () => {
    await run(20); await attempt(30, 20); await finish(30, 20);
    await db.query("update geo_questions set status='archived' where id=$1", [id(1)]);
    await expect(run(21, { day: 21 })).rejects.toThrow(/approved question/);
    expect((await metrics())[0].samples).toBe(1);
    await db.query("update geo_questions set status='active' where id=$1", [id(1)]);
    await run(21, { day: 21 });
  });

  it("keeps environments, sampling slots, and benchmark settings separate", async () => {
    await question(2, "prod"); await benchmark(11, "prod");
    await expect(run(20, { question: 2 })).rejects.toThrow(/same environment/);
    await run(20);
    await expect(run(21)).rejects.toThrow(/geo_one_scheduled_sample/);
    await expect(db.query("update geo_benchmarks set model='changed' where id=$1", [id(10)])).rejects.toThrow(/new benchmark/);
    await db.query("update geo_benchmarks set schedule_enabled=true where id=$1", [id(10)]);
    await expect(db.query("update geo_runs set question_snapshot='{}' where id=$1", [id(20)])).rejects.toThrow(/immutable/);
  });

  it("counts one selected retry per sample, excludes failures/manual/branded runs, and keeps null ranks", async () => {
    await db.query("insert into geo_brands (id,slug,name) values ($1,'competitor','Competitor')", [id(500)]);
    for (let n = 20; n <= 22; n++) {
      await run(n, { day: n }); await attempt(n + 10, n);
      await mention(n + 10, id(500), 1);
      if (n <= 21) await mention(n + 10, chartwell, n === 20 ? 2 : null);
      if (n === 20) {
        await db.query("update geo_run_attempts set status='failed',error_stage='extraction',error_message='Invalid extraction',finished_at=now() where id=$1", [id(30)]);
        await attempt(40, 20, 2); await mention(40, chartwell, 2); await mention(40, id(500), 1);
        await finish(40, 20);
      } else await finish(n + 10, n);
    }
    await run(23, { day: 23 }); // no successful response; must not count as absence
    await run(24, { day: 24, source: "manual" }); await attempt(44, 24); await mention(44, chartwell, 1); await finish(44, 24);
    await question(2, "qa", "branded"); await run(25, { question: 2, day: 25 }); await attempt(45, 25); await mention(45, chartwell, 1); await finish(45, 25);
    const row = (await metrics()).find((r) => r.brand_id === chartwell)!;
    expect(row).toMatchObject({ samples: 3, mentions: 2, ranked_mentions: 1 });
    expect(Number(row.visibility_rate)).toBeCloseTo(2 / 3, 5);
    expect(Number(row.average_position)).toBe(2);
    expect(Number(row.top3_rate)).toBeCloseTo(1 / 3, 5);
    expect(Number(row.share_of_voice)).toBe(0.4);
    expect((await metrics("topic"))[0].group_key).toBe(topic);
    expect((await metrics("market"))[0].group_key).toBe(market);
    expect((await metrics("week"))[0].group_key).toBe("2026-10-19");
    expect((await metrics("month"))[0].group_key).toBe("2026-10");
  });

  it("requires a complete selected attempt from the same run and protects finalized evidence", async () => {
    await run(20); await run(21, { day: 21 }); await attempt(30, 20); await attempt(31, 21);
    await expect(db.query("update geo_runs set status='succeeded',selected_attempt_id=$2,finished_at=now() where id=$1", [id(20), id(31)]))
      .rejects.toThrow(/fully extracted/);
    await expect(db.query("update geo_run_attempts set status='succeeded' where id=$1", [id(30)]))
      .rejects.toThrow(/check constraint/);
    await mention(30, chartwell, 2); await finish(30, 20);
    await expect(db.query("update geo_mentions set position=1 where attempt_id=$1", [id(30)])).rejects.toThrow(/immutable/);
    await expect(db.query("update geo_run_attempts set response_text='Changed' where id=$1", [id(30)])).rejects.toThrow(/immutable/);
    await expect(db.query("update geo_runs set status='failed' where id=$1", [id(20)])).rejects.toThrow(/immutable/);
    await expect(attempt(32, 20, 2)).rejects.toThrow(/immutable/);
  });

  it("stores cited and consulted sources separately with provider annotations", async () => {
    await run(20); await attempt(30, 20);
    for (const kind of ["cited", "consulted"]) {
      await db.query(`insert into geo_sources
        (attempt_id,source_kind,source_index,url,normalized_url,domain,annotation)
        values ($1,$2,0,'https://chartwell.com/a','https://chartwell.com/a','chartwell.com',$3)`,
      [id(30), kind, { type: kind === "cited" ? "url_citation" : "url" }]);
    }
    expect((await db.query("select source_kind from geo_sources order by source_kind")).rows).toEqual([{ source_kind: "cited" }, { source_kind: "consulted" }]);
    await expect(db.query("update geo_sources set citation_start=0 where source_kind='cited'")).rejects.toThrow(/check constraint/);
    await finish(30, 20);
    await expect(db.exec("update geo_sources set domain='different.example'")).rejects.toThrow(/immutable/);
  });

  it("returns null percentages without data, uses exclusive end dates, and rejects mixed benchmarks", async () => {
    expect((await metrics())[0]).toMatchObject({ samples: 0, mentions: 0, visibility_rate: null, average_position: null, top3_rate: null });
    await run(20); await attempt(30, 20); await mention(30, chartwell, 1); await finish(30, 20);
    expect((await metrics("overall", 10, "2026-10-01T00:00:00Z", "2026-10-20T14:00:00Z"))[0].samples).toBe(0);
    await benchmark(11); expect((await metrics("overall", 11))[0].samples).toBe(0);
    await expect(metrics("invalid")).rejects.toThrow(/Invalid GEO/);
    await expect(metrics("overall", 99)).rejects.toThrow(/Invalid GEO/);
  });

  it("blocks direct browser roles and grants only server reads/writes without deletion", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await expect(db.exec("select * from public.geo_questions")).rejects.toThrow(/permission denied/);
        await expect(metrics()).rejects.toThrow(/permission denied/);
      } finally { await db.exec("reset role"); }
    }
    await db.exec("set role service_role");
    try {
      expect((await db.query("select id from public.geo_questions")).rows).toHaveLength(1);
      await db.query("update geo_questions set discovery_notes='Reviewed' where id=$1", [id(1)]);
      await expect(db.exec("delete from geo_questions")).rejects.toThrow(/permission denied/);
      expect((await metrics())[0].samples).toBe(0);
    } finally { await db.exec("reset role"); }
    expect((await db.query("select count(*)::int as n from pg_policies where tablename like 'geo_%'")).rows[0]).toEqual({ n: 0 });
  });
});
