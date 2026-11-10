import { createClient } from "npm:@supabase/supabase-js@2.88.0";
import { EvidenceValidationError, EXTRACTION_SCHEMA, MappingReviewRequired, normalizeMentions, providerEvidence, record } from "../_shared/analysis.ts";
import type { Brand, Snapshot } from "../_shared/types.ts";

class ProviderFailure extends Error {
  constructor(public retryable: boolean, public unknownOutcome: boolean, message: string) { super(message); }
}
async function sameSecret(actual: string, expected: string) {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(actual), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
function usage(response: Record<string, unknown>) {
  return { model: response.model, responseId: response.id, tokens: response.usage,
    searchCalls: Array.isArray(response.output) ? response.output.filter(value => record(value).type === "web_search_call" && record(record(value).action).type === "search").length : 0 };
}
async function ask(apiKey: string, body: Record<string, unknown>) {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(80000),
    });
  } catch { throw new ProviderFailure(false, true, "AI request interrupted; provider outcome unknown. Review before retrying."); }
  if (!response.ok) {
    // Do not persist provider error bodies: they can include submitted data.
    throw new ProviderFailure([429, 500, 502, 503, 504].includes(response.status), false, `AI provider returned HTTP ${response.status}.`);
  }
  try { return record(await response.json()); }
  catch { throw new ProviderFailure(false, true, "AI response could not be read; provider outcome unknown."); }
}

Deno.serve(async request => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("GEO_WORKER_SECRET") || "";
  if (secret.length < 32 || !await sameSecret(request.headers.get("x-geo-worker-secret") || "", secret)) return new Response("Unauthorized", { status: 401 });
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !url || !key) return new Response("Worker setup incomplete", { status: 503 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  async function rpc(name: string, args: Record<string, unknown> = {}) {
    const result = await db.rpc(name, args);
    if (result.error) throw new Error(`Database operation failed: ${name}`);
    return result.data;
  }
  let job: Record<string, unknown> | null = null;
  let collectionSaved = false;
  try {
    job = await rpc("geo_worker_claim");
    if (!job) return Response.json({ idle: true });
    const ids = { p_run_id: job.runId, p_token: job.leaseToken };
    const benchmark = record(job.benchmark);
    const snapshot = job.snapshot as Snapshot;
    const attempt = record(job.attempt);
    const catalog = await db.from("geo_brands").select("id,slug,name,aliases,domains,is_chartwell");
    if (catalog.error) throw new Error("Brand catalog unavailable.");
    const brands = catalog.data as Brand[];
    if (job.stage === "collection") {
      const settings = record(benchmark.request_settings);
      if (settings.webSearch !== true || settings.searchContextSize !== "medium" || settings.maxOutputTokens !== 5000 || settings.extractionSchemaVersion !== "v1") {
        throw new ProviderFailure(false, false, "Unsupported benchmark settings. Create a compatible benchmark.");
      }
      const response = await ask(apiKey, {
        model: benchmark.model, store: false, max_output_tokens: settings.maxOutputTokens, instructions: benchmark.collection_prompt,
        input: `${snapshot.question}\n\nAnswer in ${snapshot.language === "fr" ? "French" : "English"}. Geographic scope: ${snapshot.market}, ${snapshot.country}.`,
        tools: [{ type: "web_search", search_context_size: settings.searchContextSize, user_location: {
          type: "approximate", country: snapshot.country, ...(snapshot.province ? { region: snapshot.province } : {}),
          ...(snapshot.city ? { city: snapshot.city } : {}), timezone: "America/Toronto",
        } }], tool_choice: "required", include: ["web_search_call.action.sources"],
      });
      const evidence = providerEvidence(response, brands);
      try {
        await rpc("geo_worker_save", { ...ids, p_response: response, p_text: evidence.text, p_usage: usage(response) });
        collectionSaved = true;
      } catch { throw new ProviderFailure(false, true, "AI answered but saving failed. Review this run before retrying collection."); }
      if (response.status !== "completed" || !evidence.searched || !evidence.text.trim()) throw new ProviderFailure(false, false, "AI did not complete a web search and answer. Saved response is excluded from statistics.");
      await rpc("geo_worker_advance", ids);
    } else {
      const response = job.reuseExtraction === true ? record(record(attempt.extraction).rawResponse) : await ask(apiKey, {
        model: benchmark.analysis_model, store: false, max_output_tokens: 5000,
        instructions: `${benchmark.extraction_prompt}\nFor a ranked mention, the evidence quote MUST include the numbered line, including its leading number and punctuation.`,
        input: JSON.stringify({ answer: attempt.response_text, brands: brands.map(({ id, name, aliases }) => ({ id, name, aliases })) }),
        text: { format: { type: "json_schema", name: "geo_mentions", strict: true, schema: EXTRACTION_SCHEMA } },
      });
      if (job.reuseExtraction !== true) await rpc("geo_worker_save", { ...ids, p_response: response, p_usage: usage(response) });
      const evidence = providerEvidence(attempt.raw_response, brands);
      const extracted = providerEvidence(response, []).text;
      if (response.status !== "completed" || !extracted.trim()) throw new ProviderFailure(false, false, "AI analysis was incomplete. Saved answer is excluded until analysis succeeds.");
      let data: unknown;
      let mentions: ReturnType<typeof normalizeMentions>;
      try {
        data = JSON.parse(extracted);
      } catch { throw new ProviderFailure(false, false, "AI analysis returned invalid JSON. Review saved evidence before retrying."); }
      const originalData = data;
      const verifiedIds: string[] = [];
      try {
        if (job.reuseExtraction === true) {
          const verified = await db.from("geo_mapping_reviews").select("id,mention_index,verified_brand_id,raw_mention")
            .eq("run_id", job.runId).eq("attempt_id", job.attemptId).eq("analysis_response_id", response.id).eq("status", "verified").order("verified_at", { ascending: false });
          if (verified.error) throw new Error("Verified mappings unavailable.");
          const parsed = record(data);
          if (Array.isArray(parsed.mentions)) data = { ...parsed, mentions: parsed.mentions.map((value, index) => {
            const approval = verified.data.find(row => row.mention_index === index);
            if (!approval) return value;
            const ordered = (input: unknown) => JSON.stringify(Object.entries(record(input)).sort(([a], [b]) => a.localeCompare(b)));
            if (ordered(value) !== ordered(approval.raw_mention)) throw new EvidenceValidationError("Saved extraction changed after mapping verification.");
            const brand = brands.find(row => row.id === approval.verified_brand_id);
            if (!brand) throw new EvidenceValidationError("Verified parent brand is unavailable.");
            verifiedIds.push(approval.id);
            return { ...record(value), name: brand.name, brand_id: brand.id };
          }) };
        }
        mentions = normalizeMentions(data, String(attempt.response_text), brands);
      } catch (error) {
        if (error instanceof MappingReviewRequired) {
          const originals = record(originalData).mentions;
          const issues = error.issues.map(issue => ({ ...issue, raw_mention: Array.isArray(originals) ? originals[issue.mention_index] : issue.raw_mention }));
          await rpc("geo_worker_needs_mapping_review", { ...ids, p_extraction: originalData, p_issues: issues });
          return Response.json({ runId: job.runId, stage: job.stage, status: "needs_review" });
        }
        const reason = error instanceof EvidenceValidationError ? error.message : "An unexpected evidence-validation error occurred.";
        throw new ProviderFailure(false, false, `AI analysis validation failed: ${reason} Review before retrying.`);
      }
      await rpc("geo_worker_finish", { ...ids, p_extraction: { ...record(data), rawResponse: response, verifiedMappingIds: verifiedIds }, p_mentions: mentions, p_sources: evidence.sources });
    }
    return Response.json({ runId: job.runId, stage: job.stage, saved: true });
  } catch (error) {
    if (job) {
      const provider = error instanceof ProviderFailure;
      const unknown = job.stage === "collection" && provider && error.unknownOutcome;
      try {
        await rpc("geo_worker_fail", { p_run_id: job.runId, p_token: job.leaseToken,
          p_message: provider ? error.message : `Worker ${job.stage} failed. Review saved evidence before retrying.`,
          p_retryable: provider ? error.retryable || (job.stage === "extraction" && error.unknownOutcome) : job.stage === "extraction",
          p_unknown: unknown || (job.stage === "collection" && collectionSaved && !provider) });
      } catch { /* Lease expiry recovery is handled by the next worker claim. */ }
    }
    console.error("GEO worker failed", { runId: job?.runId, stage: job?.stage });
    return Response.json({ error: "Worker stage failed; inspect batch status and saved evidence." }, { status: 500 });
  }
});
