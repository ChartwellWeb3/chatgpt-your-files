/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

type TranscriptItem = {
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: string;
};

const OPENAI_URL = "https://api.openai.com/v1/responses";
const PROMPT_VERSION = "v1";

const MODEL_FALLBACK = "gpt-5.2";

function analyzerInstructions() {
  return `
You are an analyst evaluating a visitor's full chatbot conversation for ANY client/domain.

You MUST use ONLY the transcript. Do NOT assume product features, policies, or company details that are not in the transcript.

Your job:
1) Determine the visitor's primary goal (what they were trying to accomplish).
2) Decide whether the goal was achieved based on evidence in the transcript.
3) Infer sentiment from the visitor's tone + outcome (goal achieved or not).

Return JSON only with exactly these keys:
{
  "satisfaction_1_to_10": number,
  "sentiment": "satisfied" | "neutral" | "angry" | "unknown",
  "improvement": string,
  "summary": string,
  "evidence": {
    "visitor_goal": string,
    "goal_met": "yes" | "partial" | "no" | "unknown",
    "key_quotes": string[]
  }
}

Scoring rubric (be consistent):
- 9–10: Goal clearly achieved AND visitor expresses approval/thanks OR no further help needed.
- 7–8: Goal achieved but minor friction (extra steps, unclear phrasing, minor repetition).
- 5–6: Partial help; visitor still missing something or outcome unclear.
- 3–4: Mostly unhelpful; confusion, wrong direction, repeated failures.
- 1–2: Very bad; visitor is clearly frustrated/angry, bot blocks, or fails completely.

Sentiment rules:
- "satisfied": visitor expresses positive emotion OR goal clearly met with no frustration.
- "angry": explicit frustration/negative tone OR repeated failure AND visitor escalates/complains.
- "neutral": neither satisfied nor angry; or mixed tone with partial resolution.
- "unknown": transcript too short/ambiguous to infer tone or outcome.

Evidence rules:
- visitor_goal: 1 short sentence describing the visitor's main intent.
- goal_met: yes/partial/no/unknown based on transcript outcomes.
- key_quotes: 1–3 short exact quotes (<= 20 words each) from the transcript that justify score/sentiment.
  If transcript is extremely short, provide an empty array.

Output rules:
- JSON only. No markdown.
- "improvement" and "summary" must be in English even if the transcript is French.
- improvement: one line, actionable, start with a verb, and include ONE category label:
  Categories: [clarify], [accuracy], [handoff], [ux], [tone], [policy], [speed], [links]
  Example: "[clarify] Ask one follow-up question to confirm location before recommending options."
- summary: 2–3 short sentences, describing what happened and the outcome.
`.trim();
}

function getResponseText(r: any) {
  if (typeof r?.output_text === "string" && r.output_text.trim()) {
    return r.output_text.trim();
  }

  const parts: string[] = [];
  for (const item of r?.output ?? []) {
    for (const c of item?.content ?? []) {
      if (typeof c?.text === "string") parts.push(c.text);
      if (typeof c?.content === "string") parts.push(c.content);
    }
  }
  return parts.join("\n").trim();
}

function tryParseJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(raw.slice(first, last + 1));
    }
    throw new Error("Invalid JSON returned by model");
  }
}

function clampScore(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) return 5;
  return Math.max(1, Math.min(10, Math.round(value)));
}

function normalizeSentiment(value: unknown) {
  const v = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (v === "satisfied" || v === "neutral" || v === "angry") return v;
  return "unknown";
}

function normalizeGoalMet(value: unknown) {
  const v = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (!v) return "unknown";
  if (v === "yes" || v === "y" || v === "true" || v === "met") return "yes";
  if (v === "partial" || v === "partially") return "partial";
  if (v === "no" || v === "n" || v === "false" || v === "not_met") return "no";
  return "unknown";
}

async function runAnalysis(opts: {
  apiKey: string;
  model: string;
  transcript: TranscriptItem[];
  meta: Record<string, unknown>;
}) {
  const payload = {
    meta: opts.meta,
    transcript: opts.transcript.map((m, i) => ({
      index: i,
      role: m.role,
      content: m.content ?? "",
      created_at: m.created_at ?? null,
    })),
  };

  const body = {
    model: opts.model,
    instructions: analyzerInstructions(),
    input: [
      {
        role: "user",
        content: `Return JSON only.\n\nPayload:\n${JSON.stringify(payload)}`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "conversation_analysis",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            satisfaction_1_to_10: {
              type: "integer",
              minimum: 1,
              maximum: 10,
            },
            sentiment: {
              type: "string",
              enum: ["satisfied", "neutral", "angry", "unknown"],
            },
            improvement: { type: "string" },
            summary: { type: "string" },
            evidence: {
              type: "object",
              additionalProperties: false,
              properties: {
                visitor_goal: { type: "string" },
                goal_met: {
                  type: "string",
                  enum: ["yes", "partial", "no", "unknown"],
                },
                key_quotes: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["visitor_goal", "goal_met", "key_quotes"],
            },
          },
          required: [
            "satisfaction_1_to_10",
            "sentiment",
            "improvement",
            "summary",
            "evidence",
          ],
        },
      },
    },
    max_output_tokens: 1000,
  };

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message ?? "OpenAI request failed");
  }

  const outText = getResponseText(json);
  if (!outText) throw new Error("Model returned empty output");

  const parsed = tryParseJson(outText);

  const rawEvidence = parsed?.evidence ?? {};
  const rawVisitorGoal =
    (typeof rawEvidence?.visitor_goal === "string" && rawEvidence.visitor_goal) ||
    (typeof parsed?.visitor_goal === "string" && parsed.visitor_goal) ||
    "";
  const rawGoalMet =
    rawEvidence?.goal_met ?? parsed?.goal_met ?? parsed?.goal_status ?? "";
  const rawKeyQuotes =
    (Array.isArray(rawEvidence?.key_quotes) && rawEvidence.key_quotes) ||
    (Array.isArray(parsed?.key_quotes) && parsed.key_quotes) ||
    [];

  const analysis = {
    satisfaction_1_to_10: clampScore(parsed?.satisfaction_1_to_10),
    sentiment: normalizeSentiment(parsed?.sentiment),
    improvement:
      typeof parsed?.improvement === "string" ? parsed.improvement : "unknown",
    summary: typeof parsed?.summary === "string" ? parsed.summary : "unknown",
    evidence: {
      visitor_goal: rawVisitorGoal || "unknown",
      goal_met: normalizeGoalMet(rawGoalMet),
      key_quotes: rawKeyQuotes.filter((q: unknown) => typeof q === "string"),
    },
  };

  return { analysis, raw: parsed, response_id: json?.id ?? null };
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const model = Deno.env.get("OPENAI_ANALYSIS_MODEL") ?? MODEL_FALLBACK;

  if (!supabaseUrl || !serviceRoleKey || !openaiKey) {
    return new Response(
      JSON.stringify({
        error: "Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or OPENAI_API_KEY.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { cutoff_days?: number; limit?: number; force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const cutoffDays = Number.isFinite(body.cutoff_days)
    ? Math.max(1, Math.floor(body.cutoff_days as number))
    : 7;
  const limit = Number.isFinite(body.limit)
    ? Math.max(1, Math.floor(body.limit as number))
    : 25;
  const force = body.force === true;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: targets, error: targetsErr } = await supabase.rpc(
    "chat_visitors_needing_analysis",
    {
      p_cutoff_days: cutoffDays,
      p_limit: limit,
      p_force: force,
    }
  );

  if (targetsErr) {
    return new Response(
      JSON.stringify({ error: targetsErr.message ?? "RPC failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const results: Array<{
    visitor_id: string;
    last_message_at: string;
    ok: boolean;
    error?: string;
  }> = [];

  for (const row of targets ?? []) {
    const visitorId = row.visitor_id as string;
    const lastMessageAt = row.last_message_at as string;

    try {
      const { data: messages, error: msgErr } = await supabase
        .from("chat_messages")
        .select("role,content,created_at")
        .eq("visitor_id", visitorId)
        .order("created_at", { ascending: true });

      if (msgErr) throw msgErr;
      if (!messages || messages.length === 0) {
        throw new Error("No messages found");
      }

      const transcript = messages.map((m) => ({
        role: m.role,
        content: m.content ?? "",
        created_at: m.created_at,
      })) as TranscriptItem[];

      const { analysis, raw, response_id } = await runAnalysis({
        apiKey: openaiKey,
        model,
        transcript,
        meta: {
          visitor_id: visitorId,
          last_message_at: lastMessageAt,
          message_count: messages.length,
        },
      });

      const { error: insertErr } = await supabase
        .from("chat_visitor_analyses")
        .insert({
          visitor_id: visitorId,
          last_message_at: lastMessageAt,
          source: "auto",
          model,
          prompt_version: PROMPT_VERSION,
          satisfaction_1_to_10: analysis.satisfaction_1_to_10,
          sentiment: analysis.sentiment,
          improvement: analysis.improvement,
          summary: analysis.summary,
          evidence_visitor_goal: analysis.evidence.visitor_goal,
          evidence_goal_met: analysis.evidence.goal_met,
          evidence_key_quotes: analysis.evidence.key_quotes,
          raw: {
            response_id,
            output: raw,
          },
        });

      if (insertErr) throw insertErr;

      results.push({ visitor_id: visitorId, last_message_at: lastMessageAt, ok: true });
    } catch (err: any) {
      results.push({
        visitor_id: visitorId,
        last_message_at: lastMessageAt,
        ok: false,
        error: err?.message ?? "Unknown error",
      });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      model,
      cutoff_days: cutoffDays,
      processed: results.length,
      results,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
