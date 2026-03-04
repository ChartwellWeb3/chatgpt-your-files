import OpenAI from "openai";
import { createClient as createServerClient } from "@/app/utils/supabase/server";
import { NextResponse } from "next/server";
import { analyzerInstructions } from "@/lib/chatbot/analyzerPrompt";

export const runtime = "nodejs";

type TranscriptItem = {
  role: "user" | "assistant" | "system";
  content: string;
};

const INTENT_ENUM = [
  "pricing_and_costs",
  "waitlist_or_availability",
  "tour_booking",
  "finding_residence",
  "living_and_care_options",
  "assisted_living",
  "independent_living",
  "memory_care",
  "respite_short_term",
  "amenities_and_services",
  "dining_nutrition",
  "wellness_healthcare",
  "activities_events",
  "location_neighborhood",
  "transportation",
  "move_in_process",
  "policies_and_rules",
  "pet_policy",
  "accessibility",
  "caregiver_family_support",
  "billing_payments",
  "forms_documents",
  "careers",
  "corporate_information",
  "contact_support",
  "other",
  "unknown",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasStringContent(
  value: unknown,
): value is { role?: unknown; content: string } {
  return isRecord(value) && typeof value.content === "string";
}

function normalizeRole(value: unknown): TranscriptItem["role"] {
  return value === "assistant" || value === "system" ? value : "user";
}

function getResponseText(r: unknown) {
  if (
    isRecord(r) &&
    typeof r.output_text === "string" &&
    r.output_text.trim()
  ) {
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
      { status: 500 },
    );
  }

  const supabase = await createServerClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const transcript = Array.isArray(body?.transcript) ? body.transcript : [];
  const promptOverride =
    typeof body?.prompt_override === "string"
      ? body.prompt_override.trim()
      : "";
  const responseFormat = body?.response_format === "text" ? "text" : "json";
  const sanitized: TranscriptItem[] = transcript
    .filter(hasStringContent)
    .map((m: { role: unknown; content: unknown; }) => ({
      role: normalizeRole(m.role),
      content: m.content,
    }));

  if (!sanitized.length) {
    return NextResponse.json(
      { ok: false, error: "Transcript is required" },
      { status: 400 },
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
  const inputContent =
    responseFormat === "json"
      ? `Return JSON only.\n\nPayload:\n${JSON.stringify(payload)}`
      : `Payload:\n${JSON.stringify(payload)}`;

  const request: Parameters<typeof openai.responses.create>[0] = {
    model,
    instructions,
    input: [
      {
        role: "user",
        content: inputContent,
      },
    ],
    max_output_tokens: 1600,
  };

  if (responseFormat === "json") {
    request.text = {
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
            intent_primary: {
              type: "string",
              enum: INTENT_ENUM,
            },
            intents: {
              type: "array",
              items: {
                type: "string",
                enum: INTENT_ENUM,
              },
            },
            intent_other: { type: "string" },
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
            missed_or_weak_answers: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  visitor_question: { type: "string" },
                  assistant_response: { type: "string" },
                  issue_type: {
                    type: "string",
                    enum: ["unanswered"],
                  },
                  why_insufficient: { type: "string" },
                },
                required: [
                  "visitor_question",
                  "assistant_response",
                  "issue_type",
                  "why_insufficient",
                ],
              },
            },
          },
          required: [
            "satisfaction_1_to_10",
            "sentiment",
            "intent_primary",
            "intents",
            "intent_other",
            "improvement",
            "summary",
            "evidence",
            "missed_or_weak_answers",
          ],
        },
      },
    };
  }

  const r = await openai.responses.create(request);

  const outText = getResponseText(r);
  const parsed =
    responseFormat === "json" && outText ? tryParseJson(outText) : null;

  return NextResponse.json({
    ok: true,
    output: outText,
    parsed,
    format: responseFormat,
  });
}
