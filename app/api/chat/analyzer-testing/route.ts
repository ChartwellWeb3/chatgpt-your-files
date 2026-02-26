import OpenAI from "openai";
import { createClient as createServerClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";
import { analyzerInstructions } from "@/lib/chatbot/analyzerPrompt";

export const runtime = "nodejs";

type TranscriptItem = {
  role: "user" | "assistant" | "system";
  content: string;
};


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getResponseText(r: unknown) {
  if (isRecord(r) && typeof r.output_text === "string" && r.output_text.trim()) {
    return r.output_text.trim();
  }

  const parts: string[] = [];
  const output = isRecord(r) && Array.isArray(r.output) ? r.output : [];
  for (const item of output) {
    const content =
      isRecord(item) && Array.isArray(item.content) ? item.content : [];
    for (const c of content) {
      if (isRecord(c) && typeof c.text === "string") parts.push(c.text);
      if (isRecord(c) && typeof c.content === "string") parts.push(c.content);
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
    return null;
  }
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

  const body = await req.json().catch(() => ({}));
  const transcript = Array.isArray(body?.transcript) ? body.transcript : [];
  const promptOverride =
    typeof body?.prompt_override === "string" ? body.prompt_override.trim() : "";
  const sanitized = transcript
    .filter((m: any) => m && typeof m.content === "string")
    .map((m: any) => ({
      role: m.role === "assistant" || m.role === "system" ? m.role : "user",
      content: m.content,
    })) as TranscriptItem[];

  if (!sanitized.length) {
    return NextResponse.json(
      { ok: false, error: "Transcript is required" },
      { status: 400 }
    );
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_ANALYSIS_MODEL ?? "gpt-5.2";

  const payload = {
    transcript: sanitized.map((m, i) => ({
      index: i,
      role: m.role,
      content: m.content,
    })),
  };

  const instructions = promptOverride || analyzerInstructions();

  const r = await openai.responses.create({
    model,
    instructions,
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
    max_output_tokens: 800,
  });

  const outText = getResponseText(r);
  const parsed = outText ? tryParseJson(outText) : null;

  return NextResponse.json({ ok: true, output: outText, parsed });
}
