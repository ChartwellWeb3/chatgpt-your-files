import { authorize, body, checked, day, failure, GeoError, json, metricArgs, modelConfig, nextDay, option, pageNumber, text, torontoMidnight, uuid } from "@/lib/geo/server";
import type { Benchmark, LiveStatus, Metric, Run, Source } from "@/lib/geo/types";
import { providerEvidence } from "@/lib/geo/analysis";

const benchmarkColumns = "id,name,model,analysis_model,schedule_enabled,schedule_days,schedule_time,schedule_timezone,next_scheduled_at,created_at";
const questionColumns = "id,environment,question,language,question_kind,topic_id,market_id,status,revision,discovery_source,discovery_notes,updated_at,schedule_included";
const runColumns = "id,question_id,benchmark_id,question_revision,question_snapshot,source,purpose,batch_id,status,scheduled_for,selected_attempt_id,finished_at,lease_expires_at";
const attemptMetadataColumns = "id,status,attempt_number,returned_model,error_message,error_stage,started_at,finished_at";
const attemptColumns = `${attemptMetadataColumns},response_text`;
const sourceColumns = "id,source_kind,source_index,url,normalized_url,domain,title,owner_brand_id,source_type,citation_start,citation_end";
const mappingColumns = "id,environment,run_id,attempt_id,mention_index,observed_name,proposed_brand_id,proposed_brand_name,evidence_quote,status,verified_brand_id,verified_brand_name,reference_url,verification_notes,verified_at,created_at,question_snapshot,purpose,run_status";

export async function GET(request: Request) {
  try {
    const { db, environment, level } = await authorize();
    const params = new URL(request.url).searchParams;
    const view = params.get("view") || "bootstrap";
    if (view === "questionMetrics") {
      const from = day(params.get("from")); const to = day(params.get("to"));
      if (to<from || Date.parse(to)-Date.parse(from)>366*86400000) throw new GeoError("Choose a date range of up to one year.");
      const search = params.get("search")?.trim() || "";
      if (search.length>200) throw new GeoError("Search must be under 200 characters.");
      return json(checked(await db.rpc("geo_question_metrics_page", {
        p_environment: environment, p_benchmark_id: params.get("benchmarkId") ? uuid(params.get("benchmarkId")) : null,
        p_from: from, p_to: to, p_topic_id: params.get("topicId") ? uuid(params.get("topicId")) : null,
        p_market_id: params.get("marketId") ? uuid(params.get("marketId")) : null,
        p_language: params.get("language") ? option(params.get("language"), ["en", "fr"]) : null,
        p_question_kind: params.get("questionKind") && params.get("questionKind") !== "all" ? option(params.get("questionKind"), ["unbranded", "branded"]) : null,
        p_status: params.get("status") ? option(params.get("status"), ["draft", "active", "archived"]) : null,
        p_search: search, p_page: pageNumber(params.get("page")), p_page_size: 10,
      })));
    }
    if (view === "mappingReviews") {
      const page = pageNumber(params.get("page")); const pageSize = 10;
      const result = await db.from("geo_mapping_review_queue").select(mappingColumns, { count: "exact" }).eq("environment", environment)
        .order("created_at", { ascending: false }).order("id").range(page * pageSize, (page + 1) * pageSize - 1);
      return json({ rows: checked(result), total: result.count || 0, page, pageSize });
    }
    if (view === "catalogs" || view === "bootstrap") {
      const [topics, markets, brands, benchmarks] = await Promise.all([
        db.from("geo_topics").select("id,slug,name").order("name"),
        db.from("geo_markets").select("id,slug,name,scope,country_code,province,city").order("name"),
        db.from("geo_brands").select("id,slug,name,aliases,domains,is_chartwell").order("name"),
        db.from("geo_benchmarks").select(benchmarkColumns).eq("environment", environment).order("created_at", { ascending: false }).limit(100),
      ]);
      for (const result of [topics, markets, brands, benchmarks]) checked(result);
      const catalogs = { environment, topics: topics.data, markets: markets.data, brands: brands.data, benchmarks: benchmarks.data, models: modelConfig() };
      if (view === "catalogs") return json(catalogs);
      // Compatibility for older clients; the new page loads catalogs and live data separately.
      const live = checked(await db.rpc("geo_live_status", { p_environment: environment })) as LiveStatus;
      return json({ ...catalogs, ...live, level });
    }
    if (view === "live") return json({ ...checked(await db.rpc("geo_live_status", { p_environment: environment })), level });
    if (view === "schedule") {
      return json({ lastBatch: checked(await db.rpc("geo_last_scheduled_batch", { p_environment: environment, p_benchmark_id: uuid(params.get("benchmarkId")) })) });
    }
    if (view === "overview") {
      const args = metricArgs(params, environment);
      return json(checked(await db.rpc("geo_overview", {
        p_environment: environment, p_benchmark_id: args.p_benchmark_id, p_from: day(params.get("from")), p_to: day(params.get("to")),
        p_topic_id: args.p_topic_id, p_market_id: args.p_market_id, p_language: args.p_language,
      })));
    }
    if (view === "competitors") {
      const rows = checked(await db.rpc("geo_brand_metrics", { ...metricArgs(params, environment), p_group_by: "overall" })) as Metric[];
      return json({ rows: rows.filter(row => row.mentions > 0 || row.is_chartwell), samples: rows[0]?.samples || 0 });
    }
    if (view === "sources") {
      const summary = checked(await db.rpc("geo_dashboard_summary", metricArgs(params, environment)));
      return json({ sources: summary.sources });
    }
    if (view === "dashboard") {
      const args = metricArgs(params, environment);
      const from = day(params.get("from")); const to = day(params.get("to"));
      const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
      const previousFrom = nextDay(from, -days); const previousTo = nextDay(from, -1);
      const [overall, topics, markets, trend, previous, summary] = await Promise.all([
        db.rpc("geo_brand_metrics", { ...args, p_group_by: "overall" }),
        db.rpc("geo_brand_metrics", { ...args, p_group_by: "topic" }),
        db.rpc("geo_brand_metrics", { ...args, p_group_by: "market" }),
        db.rpc("geo_brand_metrics", { ...args, p_group_by: "week" }),
        db.rpc("geo_brand_metrics", { ...args, p_start: torontoMidnight(previousFrom), p_end: torontoMidnight(from), p_group_by: "overall" }),
        db.rpc("geo_dashboard_summary", args),
      ]);
      for (const result of [overall, topics, markets, trend, previous, summary]) checked(result);
      return json({ overall: overall.data, topics: topics.data, markets: markets.data, trend: trend.data, previous: previous.data,
        ...summary.data, previousFrom, previousTo });
    }
    if (view === "validation") {
      // Legacy questionKind=all/unbranded requests cannot broaden factual validation.
      const args = { ...metricArgs(params, environment), p_question_kind: "branded" }; const page = pageNumber(params.get("page")); const pageSize = 10;
      let query = db.from("geo_answer_validation").select("id,question_snapshot,source,scheduled_for,finished_at,response_preview,review_status,review", { count: "exact" })
        .eq("environment", environment).eq("benchmark_id", args.p_benchmark_id).gte("scheduled_for", args.p_start).lt("scheduled_for", args.p_end);
      if (args.p_topic_id) query = query.eq("question_snapshot->>topicId", args.p_topic_id);
      if (args.p_market_id) query = query.eq("question_snapshot->>marketId", args.p_market_id);
      if (args.p_language) query = query.eq("question_snapshot->>language", args.p_language);
      if (args.p_question_kind) query = query.eq("question_snapshot->>questionKind", args.p_question_kind);
      if (params.get("reviewStatus")) query = query.eq("review_status", option(params.get("reviewStatus"), ["unreviewed", "correct", "partially_correct", "incorrect", "unverifiable"]));
      const result = await query.order("scheduled_for", { ascending: false }).order("id").range(page * pageSize, (page + 1) * pageSize - 1);
      return json({ rows: checked(result), total: result.count || 0, page, pageSize });
    }
    if (view === "questions") {
      const page = pageNumber(params.get("page")); const pageSize = 10;
      let query = db.from("geo_questions").select(questionColumns, { count: "exact" }).eq("environment", environment);
      const search = params.get("search")?.trim() || "";
      if (search.length > 200) throw new GeoError("Search must be under 200 characters.");
      if (search) query = query.ilike("question", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
      if (params.get("status")) query = query.eq("status", option(params.get("status"), ["draft", "active", "archived"]));
      if (params.get("topicId")) query = query.eq("topic_id", uuid(params.get("topicId")));
      if (params.get("marketId")) query = query.eq("market_id", uuid(params.get("marketId")));
      const result = await query.order("updated_at", { ascending: false }).order("id").range(page * pageSize, (page + 1) * pageSize - 1);
      return json({ rows: checked(result), total: result.count || 0, page, pageSize });
    }
    if (view === "batches") {
      const page = pageNumber(params.get("page")); const pageSize = 10;
      let query = db.from("geo_batch_progress").select("*", { count: "exact" }).eq("environment", environment);
      if (params.get("benchmarkId")) query = query.eq("benchmark_id", uuid(params.get("benchmarkId")));
      query = query.eq("purpose", params.get("purpose") === "test" ? "test" : "monitoring");
      const includeCancelled = option(params.get("includeCancelled") ?? "false", ["true", "false"]);
      if (includeCancelled === "false") query = query.is("cancelled_at", null);
      if (params.get("kind")) query = query.eq("trigger_kind", option(params.get("kind"), ["scheduled", "single", "all", "test"]));
      const result = await query.order("created_at", { ascending: false }).order("id").range(page * pageSize, (page + 1) * pageSize - 1);
      return json({ rows: checked(result), total: result.count || 0, page, pageSize });
    }
    if (view === "tests") {
      const page = pageNumber(params.get("page")); const pageSize = 10;
      let query = db.from("geo_test_runs").select(runColumns, { count: "exact" }).eq("environment", environment);
      if (params.get("benchmarkId")) query = query.eq("benchmark_id", uuid(params.get("benchmarkId")));
      const result = await query.order("scheduled_for", { ascending: false }).order("id").range(page * pageSize, (page + 1) * pageSize - 1);
      return json({ rows: checked(result), total: result.count || 0, page, pageSize });
    }
    if (view === "runs") {
      const args = metricArgs(params, environment); const page = pageNumber(params.get("page")); const pageSize = 10;
      const questionId = params.get("questionId") ? uuid(params.get("questionId"), "question") : null;
      const revision = params.get("questionRevision");
      if (revision !== null && (!questionId || !/^[1-9]\d{0,8}$/.test(revision))) throw new GeoError("Choose a valid question version.");
      let query = db.from("geo_reporting_runs").select(runColumns, { count: "exact" }).eq("environment", environment)
        .eq("benchmark_id", args.p_benchmark_id).gte("scheduled_for", args.p_start).lt("scheduled_for", args.p_end);
      if (questionId) query = query.eq("question_id", questionId);
      if (revision) query = query.eq("question_revision", Number(revision));
      if (args.p_topic_id) query = query.eq("question_snapshot->>topicId", args.p_topic_id);
      if (args.p_market_id) query = query.eq("question_snapshot->>marketId", args.p_market_id);
      if (args.p_language) query = query.eq("question_snapshot->>language", args.p_language);
      if (args.p_question_kind) query = query.eq("question_snapshot->>questionKind", args.p_question_kind);
      // Reporting history always excludes test runs, including legacy manual history.
      if (params.get("status")) query = query.eq("status", option(params.get("status"), ["queued", "running", "succeeded", "failed", "cancelled", "needs_review"]));
      const result = await query.order("scheduled_for", { ascending: false }).order("id").range(page * pageSize, (page + 1) * pageSize - 1);
      return json({ rows: checked(result), total: result.count || 0, page, pageSize });
    }
    if (["evidence", "raw", "attempt", "reviews"].includes(view)) {
      const run = checked(await db.from("geo_runs").select(runColumns).eq("environment", environment).eq("id", uuid(params.get("runId"))).maybeSingle()) as Run | null;
      if (!run) throw new GeoError("Monitoring run not found.", 404);
      if (view === "raw") {
        const attemptId = uuid(params.get("attemptId"));
        return json(checked(await db.from("geo_run_attempts").select("raw_response,extraction,usage").eq("id", attemptId).eq("run_id", run.id).maybeSingle()));
      }
      const reviewable = (run.purpose || (run.source === "scheduled" ? "monitoring" : "test")) === "monitoring"
        && run.question_snapshot.questionKind === "branded" && run.status === "succeeded" && run.selected_attempt_id;
      if (view === "reviews") {
        if (!reviewable) throw new GeoError("Only completed branded reporting answers have review history.", 404);
        const page = pageNumber(params.get("page")); const pageSize = 10;
        const result = await db.from("geo_answer_reviews").select("*", { count: "exact" }).eq("environment", environment)
          .eq("run_id", run.id).eq("attempt_id", run.selected_attempt_id).order("review_version", { ascending: false }).range(page * pageSize, (page + 1) * pageSize - 1);
        return json({ rows: checked(result), total: result.count || 0, page, pageSize });
      }
      if (view === "attempt") {
        const attempt = checked(await db.from("geo_run_attempts").select(attemptColumns).eq("id", uuid(params.get("attemptId"))).eq("run_id", run.id).maybeSingle());
        if (!attempt) throw new GeoError("Saved attempt not found.", 404);
        const sources = checked(await db.from("geo_sources").select(sourceColumns).eq("attempt_id", attempt.id).order("source_index").limit(500));
        return json({ attempt, sources });
      }
      const [attemptResult, benchmarkResult] = await Promise.all([
        db.from("geo_run_attempts").select(attemptMetadataColumns).eq("run_id", run.id).order("attempt_number", { ascending: false }).limit(10),
        db.from("geo_benchmarks").select(benchmarkColumns).eq("id", run.benchmark_id).eq("environment", environment).single(),
      ]);
      const attempts = checked(attemptResult); const benchmark = checked(benchmarkResult) as Benchmark;
      const attemptId = run.selected_attempt_id || attempts?.[0]?.id;
      const attempt = attemptId ? checked(await db.from("geo_run_attempts").select(attemptColumns).eq("id", attemptId).eq("run_id", run.id).maybeSingle()) : null;
      const [mentions, sources, reviewResult, mappingResult, extractedResult] = await Promise.all([
        attempt ? db.from("geo_mentions").select("brand_id,observed_name,is_recommendation,position,evidence_quote").eq("attempt_id", attempt.id).order("position", { nullsFirst: false }) : Promise.resolve({ data: [], error: null }),
        attempt ? db.from("geo_sources").select(sourceColumns).eq("attempt_id", attempt.id).order("source_index").limit(500) : Promise.resolve({ data: [], error: null }),
        reviewable ? db.from("geo_answer_reviews").select("*").eq("environment", environment).eq("run_id", run.id).eq("attempt_id", run.selected_attempt_id).order("review_version", { ascending: false }).limit(1) : Promise.resolve({ data: [], error: null }),
        attempt ? db.from("geo_mapping_review_context").select(mappingColumns).eq("environment", environment).eq("run_id", run.id).eq("attempt_id", attempt.id).order("mention_index").limit(100) : Promise.resolve({ data: [], error: null }),
        attempt && run.status === "needs_review" ? db.from("geo_run_attempts").select("mentions:extraction->mentions").eq("run_id", run.id).eq("id", attempt.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ]);
      let savedSources: Source[] = checked(sources) || [];
      if (attempt && run.status !== "succeeded" && !savedSources.length) {
        const saved = checked(await db.from("geo_run_attempts").select("raw_response").eq("id", attempt.id).eq("run_id", run.id).maybeSingle());
        if (saved?.raw_response) savedSources = providerEvidence(saved.raw_response, []).sources.map(({ annotation: _annotation, ...source }) => source);
      }
      return json({ run, benchmark, attempts, attempt, mentions: checked(mentions), sources: savedSources, review: checked(reviewResult)?.[0] || null,
        mappingReviews: checked(mappingResult) || [], extractedMentions: checked(extractedResult)?.mentions || [] });
    }
    if (view === "opportunities") {
      const args = metricArgs(params, environment); const page = pageNumber(params.get("page")); const pageSize = 10;
      const [result, count] = await Promise.all([
        db.from("geo_reporting_insights").select("id,title,opportunity,status,model,period_start,period_end,created_at,filters,geo_insight_evidence(run_id)", { count: "exact" })
          .eq("environment", environment).eq("benchmark_id", args.p_benchmark_id)
          .gte("period_start", args.p_start).lte("period_end", args.p_end)
          .contains("filters", { topicId: args.p_topic_id, marketId: args.p_market_id, language: args.p_language, questionKind: args.p_question_kind })
          .order("created_at", { ascending: false }).range(page * pageSize, (page + 1) * pageSize - 1),
        db.rpc("geo_reporting_count", args),
      ]);
      return json({ rows: checked(result), total: result.count || 0, page, pageSize, answerCount: Number(checked(count)) });
    }
    throw new GeoError("Unknown GEO view.");
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const { db, environment, user, level } = await authorize(request, true);
    const input = await body(request);
    if (input.action === "verifyMapping" || input.action === "recheckMapping") {
      if (level !== 1) throw new GeoError("Only an administrator can verify brand ownership mappings.", 403);
      if (input.action === "recheckMapping") return json(checked(await db.rpc("geo_recheck_mapping", { p_environment: environment, p_run_id: uuid(input.runId) })), 202);
      if (input.confirmed !== true) throw new GeoError("Confirm that the reference source establishes the residence-to-brand relationship.");
      const reference = text(input.referenceUrl, 1, 2000);
      let url: URL;
      try { url = new URL(reference); } catch { throw new GeoError("Enter a complete reference URL."); }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length>2000) throw new GeoError("Use an http or https reference URL without embedded credentials.");
      return json(checked(await db.rpc("geo_verify_mapping", {
        p_environment: environment, p_review_id: uuid(input.reviewId), p_actor: user.id,
        p_brand_id: input.brandId == null ? null : uuid(input.brandId),
        p_brand_name: input.brandId == null ? text(input.brandName, 1, 160) : null,
        p_reference_url: url.href, p_notes: text(input.notes ?? "", 0, 4000),
      })));
    }
    if (input.action === "schedule") {
      if (level !== 1) throw new GeoError("Only an administrator can change the schedule.", 403);
      if (typeof input.enabled !== "boolean") throw new GeoError("Choose whether the schedule is enabled.");
      if (input.enabled) {
        const worker = checked(await db.from("geo_worker_runtime").select("dispatcher_enabled,last_seen_at").eq("id", true).single());
        if (!worker.dispatcher_enabled || !worker.last_seen_at || Date.parse(worker.last_seen_at) < Date.now() - 5 * 60000) throw new GeoError("Deploy the worker and activate Cron first. A recent worker heartbeat is required.", 503);
      }
      checked(await db.rpc("geo_set_schedule", { p_environment: environment, p_benchmark_id: uuid(input.benchmarkId), p_enabled: input.enabled }));
      return json({ saved: true });
    }
    if (input.action === "cancelBatch") {
      const result = checked(await db.rpc("geo_cancel_batch", { p_environment: environment, p_batch_id: uuid(input.batchId), p_actor: user.id }));
      return json(result);
    }
    if (input.action === "retryBatch") {
      const batch = checked(await db.from("geo_batches").select("id,cancelled_at").eq("id", uuid(input.batchId)).eq("environment", environment).maybeSingle());
      if (!batch) throw new GeoError("Collection batch not found.", 404);
      if (batch.cancelled_at) throw new GeoError("This collection was cancelled. Start a new collection to run these questions again.", 409);
      const result = checked(await db.rpc("geo_retry_batch", { p_environment: environment, p_batch_id: uuid(input.batchId), p_request_key: uuid(input.requestKey) }));
      return json({ ...result, status: "queued" }, 202);
    }
    if (input.action === "saveQuestion") {
      const values = { question: text(input.question, 10), language: option(input.language, ["en", "fr"]),
        question_kind: option(input.question_kind, ["unbranded", "branded"]), topic_id: uuid(input.topic_id), market_id: uuid(input.market_id),
        discovery_notes: typeof input.discovery_notes === "string" ? text(input.discovery_notes || " ", 0, 4000) : null, updated_by: user.id };
      if (input.id) {
        const revision = Number(input.revision);
        if (!Number.isInteger(revision) || revision < 1) throw new GeoError("Invalid question revision.");
        const result = checked(await db.from("geo_questions").update(values).eq("environment", environment).eq("id", uuid(input.id)).eq("revision", revision).select(questionColumns).maybeSingle());
        if (!result) throw new GeoError("This question changed while you were editing. Refresh before saving.", 409);
        return json(result);
      }
      return json(checked(await db.from("geo_questions").insert({ ...values, environment, status: "draft", created_by: user.id, discovery_source: "manual" }).select(questionColumns).single()), 201);
    }
    if (input.action === "questionSchedule") {
      if (typeof input.enabled !== "boolean") throw new GeoError("Choose whether this question is included in scheduled collection.");
      const revision = Number(input.revision);
      if (!Number.isInteger(revision) || revision < 1) throw new GeoError("Invalid question revision.");
      const result = checked(await db.from("geo_questions").update({ schedule_included: input.enabled, updated_by: user.id })
        .eq("environment", environment).eq("id", uuid(input.id)).eq("revision", revision).select(questionColumns).maybeSingle());
      if (!result) throw new GeoError("This question changed. Refresh before changing its schedule selection.", 409);
      return json(result);
    }
    if (input.action === "reviewAnswer") {
      const verdict = option(input.verdict, ["correct", "partially_correct", "incorrect", "unverifiable"]);
      if (verdict !== "unverifiable" && input.confirmed !== true) throw new GeoError("Confirm that you checked the answer against the reference source.");
      const issue = verdict === "partially_correct" || verdict === "incorrect";
      const expectedAnswer = text(input.expectedAnswer ?? "", verdict === "unverifiable" ? 0 : 1);
      const notes = text(input.notes ?? "", verdict === "correct" ? 0 : 1);
      const reference = text(input.groundTruthUrl ?? "", verdict === "unverifiable" ? 0 : 1, 2000);
      let groundTruthUrl: string | null = null;
      if (reference) {
        let url: URL;
        try { url = new URL(reference); } catch { throw new GeoError("Enter a complete reference URL starting with https:// or http://."); }
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new GeoError("Use an http or https reference URL without embedded credentials.");
        groundTruthUrl = url.href;
        if (groundTruthUrl.length > 2000) throw new GeoError("Reference URL must be under 2000 characters.");
      }
      const runId = uuid(input.runId); const attemptId = uuid(input.attemptId);
      const target = checked(await db.from("geo_reporting_runs").select("id,question_snapshot,selected_attempt_id")
        .eq("environment", environment).eq("id", runId).eq("status", "succeeded").maybeSingle());
      if (!target) throw new GeoError("Completed reporting answer not found.", 404);
      if (target.question_snapshot?.questionKind !== "branded") throw new GeoError("Only answers to questions with brand names can be reviewed.");
      if (target.selected_attempt_id !== attemptId) throw new GeoError("This answer changed. Refresh before reviewing it.", 409);
      const result = checked(await db.rpc("geo_review_answer", {
        p_environment: environment, p_run_id: runId, p_attempt_id: attemptId, p_actor: user.id,
        p_expected_review_id: input.expectedReviewId == null ? null : uuid(input.expectedReviewId),
        p_verdict: verdict, p_expected_answer: expectedAnswer || null, p_ground_truth_url: groundTruthUrl,
        p_severity: issue ? option(input.severity, ["high", "medium", "low"]) : null, p_notes: notes || null,
      }));
      return json(result, 201);
    }
    if (input.action === "questionStatus") {
      const status = option(input.status, ["draft", "active", "archived"]);
      const revision = Number(input.revision); if (!Number.isInteger(revision) || revision < 1) throw new GeoError("Invalid question revision.");
      const result = checked(await db.from("geo_questions").update({ status, updated_by: user.id,
        ...(status === "active" ? { approved_by: user.id, approved_at: new Date().toISOString() } : {}) })
        .eq("id", uuid(input.id)).eq("environment", environment).eq("revision", revision).select(questionColumns).maybeSingle());
      if (!result) throw new GeoError("This question changed. Refresh before updating its status.", 409);
      return json(result);
    }
    if (input.action === "insightStatus") {
      const result = checked(await db.from("geo_insights").update({ status: option(input.status, ["new", "investigating", "dismissed"]) })
        .eq("environment", environment).eq("id", uuid(input.id)).select("id,status").maybeSingle());
      if (!result) throw new GeoError("Opportunity not found.", 404);
      return json(result);
    }
    throw new GeoError("Unknown GEO action.");
  } catch (error) { return failure(error); }
}
