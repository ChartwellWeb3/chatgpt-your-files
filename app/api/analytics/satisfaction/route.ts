import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/app/utils/supabase/server";

export const runtime = "nodejs";

const PROMPT_VERSION = "v1";
const MODEL_FALLBACK = "gpt-5.2";

type TranscriptItem = {
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: string;
};

function analyzerInstructions() {
  return `
You are an analyst evaluating a visitor's full chatbot conversation.

Use ONLY the transcript. Infer satisfaction from tone and whether the visitor's goal was met.

Return JSON only with keys:
{
  "satisfaction_1_to_10": number,
  "sentiment": "satisfied" | "neutral" | "angry" | "unknown",
  "improvement": string,
  "summary": string
}

Rules:
- If you cannot infer, use "unknown" for sentiment.
- Always write "improvement" and "summary" in English, even if the transcript is French.
- improvement: short, actionable, one line.
- summary: 2-3 short sentences.
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

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "Missing OPENAI_API_KEY" },
      { status: 500 }
    );
  }

  const supabase = await createServerClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: isAdmin, error: adminErr } = await supabase.rpc("is_admin");
  if (adminErr) {
    return NextResponse.json({ ok: false, error: adminErr.message }, { status: 500 });
  }
  if (!isAdmin) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const visitorId = body?.visitor_id as string | undefined;
  if (!visitorId) {
    return NextResponse.json(
      { ok: false, error: "Missing visitor_id" },
      { status: 400 }
    );
  }

  const { data: messages, error: msgErr } = await supabase
    .from("chat_messages")
    .select("role,content,created_at")
    .eq("visitor_id", visitorId)
    .order("created_at", { ascending: true });

  if (msgErr) {
    return NextResponse.json({ ok: false, error: msgErr.message }, { status: 500 });
  }
  if (!messages || messages.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No messages found" },
      { status: 404 }
    );
  }

  const lastMessageAt = messages[messages.length - 1]?.created_at;

  const transcript = messages.map((m) => ({
    role: m.role,
    content: m.content ?? "",
    created_at: m.created_at,
  })) as TranscriptItem[];

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_ANALYSIS_MODEL ?? MODEL_FALLBACK;

  const payload = {
    meta: {
      visitor_id: visitorId,
      last_message_at: lastMessageAt ?? null,
      message_count: transcript.length,
    },
    transcript: transcript.map((m, i) => ({
      index: i,
      role: m.role,
      content: m.content,
      created_at: m.created_at ?? null,
    })),
  };

  const r = await openai.responses.create({
    model,
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
          },
          required: [
            "satisfaction_1_to_10",
            "sentiment",
            "improvement",
            "summary",
          ],
        },
      },
    },
    max_output_tokens: 1000,
  });

  const outText = getResponseText(r);
  if (!outText) {
    return NextResponse.json(
      { ok: false, error: "Model returned empty output" },
      { status: 500 }
    );
  }

  const parsed = tryParseJson(outText);

  const analysis = {
    satisfaction_1_to_10: clampScore(parsed?.satisfaction_1_to_10),
    sentiment: normalizeSentiment(parsed?.sentiment),
    improvement:
      typeof parsed?.improvement === "string" ? parsed.improvement : "unknown",
    summary: typeof parsed?.summary === "string" ? parsed.summary : "unknown",
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("chat_visitor_analyses")
    .insert({
      visitor_id: visitorId,
      last_message_at: lastMessageAt,
      source: "manual",
      model,
      prompt_version: PROMPT_VERSION,
      satisfaction_1_to_10: analysis.satisfaction_1_to_10,
      sentiment: analysis.sentiment,
      improvement: analysis.improvement,
      summary: analysis.summary,
      raw: {
        response_id: r.id ?? null,
        output: parsed,
      },
    })
    .select(
      "id,visitor_id,last_message_at,source,model,prompt_version,satisfaction_1_to_10,sentiment,improvement,summary,created_at"
    )
    .single();

  if (insertErr) {
    return NextResponse.json(
      { ok: false, error: insertErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, analysis, row: inserted ?? null });
}
