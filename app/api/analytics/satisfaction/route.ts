import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/app/utils/supabase/server";

export const runtime = "nodejs";

const PROMPT_VERSION = "v1";
const MODEL_FALLBACK = "gpt-5.2";
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

type TranscriptItem = {
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: string;
};

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
  "intent_primary": "pricing_and_costs" | "waitlist_or_availability" | "tour_booking" | "finding_residence" | "living_and_care_options" | "assisted_living" | "independent_living" | "memory_care" | "respite_short_term" | "amenities_and_services" | "dining_nutrition" | "wellness_healthcare" | "activities_events" | "location_neighborhood" | "transportation" | "move_in_process" | "policies_and_rules" | "pet_policy" | "accessibility" | "caregiver_family_support" | "billing_payments" | "forms_documents" | "careers" | "corporate_information" | "contact_support" | "other" | "unknown",
  "intents": string[],
  "intent_other": string,
  "improvement": string,
  "summary": string,
  "evidence": {
    "visitor_goal": string,
    "goal_met": "yes" | "partial" | "no" | "unknown",
    "key_quotes": string[]
  },
  "missed_or_weak_answers": [
    {
      "visitor_question": string,
      "assistant_response": string,
      "issue_type": "unanswered",
      "why_insufficient": string
    }
  ]
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

Intent rules:
- intent_primary: choose exactly one from the list above.
- intents: 0–3 items from the same list. Include intent_primary if it is not "unknown".
- Use "other" only if none fit; then set intent_other to a short label (<= 4 words). Otherwise intent_other must be "".
- If intent is unclear, set intent_primary to "unknown" and intents to [].

Missed/weak answer rules:
- missed_or_weak_answers: 0–3 items. Use exact wording from the transcript when possible.
- visitor_question: the user's question or request.
- assistant_response: the assistant reply tied to that question.
- issue_type: must be "unanswered".
- why_insufficient: one short sentence explaining the gap.

Output rules:
- JSON only. No markdown.
- "improvement" and "summary" must be in English even if transcript is French.
- improvement: one line, actionable, start with a verb, and include ONE category label:
  Categories: [clarify], [accuracy], [handoff], [ux], [tone], [policy], [speed], [links]
  Example: "[clarify] Ask one follow-up question to confirm location before recommending options."
- summary: 2–3 short sentences, describing what happened and the outcome.
`.trim();
}

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

type IntentType = (typeof INTENT_ENUM)[number];
const ISSUE_TYPE_ENUM = ["unanswered"] as const;
type IssueType = (typeof ISSUE_TYPE_ENUM)[number];
type MissedAnswer = {
  visitor_question: string;
  assistant_response: string;
  issue_type: IssueType;
  why_insufficient: string;
};

function normalizeIntent(value: unknown): IntentType {
  const v = typeof value === "string" ? value.trim() : "";
  return (INTENT_ENUM as readonly string[]).includes(v)
    ? (v as IntentType)
    : "unknown";
}

function normalizeIntentList(value: unknown): IntentType[] {
  if (!Array.isArray(value)) return [];
  const next: IntentType[] = [];
  for (const entry of value) {
    const intent = normalizeIntent(entry);
    if (intent && !next.includes(intent)) next.push(intent);
  }
  return next;
}

function normalizeIssueType(value: unknown): IssueType {
  const v = typeof value === "string" ? value.trim() : "";
  return (ISSUE_TYPE_ENUM as readonly string[]).includes(v)
    ? (v as IssueType)
    : "unanswered";
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
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
    .select("role,content,created_at,session_id")
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

  const lastMessage = messages[messages.length - 1];
  const lastMessageAt = lastMessage?.created_at;
  const lastSessionId = lastMessage?.session_id ?? null;

  let pageType: "corporate" | "residence" | "find_a_residence" | "unknown" =
    "unknown";
  if (lastSessionId) {
    const { data: sessions, error: sessErr } = await supabase
      .from("chat_sessions")
      .select("page_url,residence_custom_id")
      .eq("id", lastSessionId)
      .limit(1);
    if (!sessErr) {
      const session = sessions?.[0];
      const residenceCustomId =
        typeof session?.residence_custom_id === "string"
          ? session.residence_custom_id
          : "";
      const pageUrl = typeof session?.page_url === "string" ? session.page_url : "";
      const lower = residenceCustomId.toLowerCase();
      if (lower === "corporateen" || lower === "corporatefr") {
        pageType = "corporate";
      } else if (pageUrl.toLowerCase().includes("/find-a-residence")) {
        pageType = "find_a_residence";
      } else if (residenceCustomId) {
        pageType = "residence";
      }
    }
  }

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

  const rawIntents = normalizeIntentList(parsed?.intents);
  let intentPrimary = normalizeIntent(parsed?.intent_primary);
  let intents = rawIntents;
  if (intentPrimary === "unknown" && intents.length > 0) {
    intentPrimary = intents[0];
  }
  if (intentPrimary !== "unknown" && !intents.includes(intentPrimary)) {
    intents = [intentPrimary, ...intents];
  }
  let intentOther = asString(parsed?.intent_other).trim();
  if (!intents.includes("other")) intentOther = "";

  const rawMissed: unknown[] = Array.isArray(parsed?.missed_or_weak_answers)
    ? parsed.missed_or_weak_answers
    : [];
  const missedOrWeak = rawMissed
    .map((entry: unknown): MissedAnswer | null => {
      if (!isRecord(entry)) return null;
      return {
        visitor_question: asString(entry.visitor_question).trim(),
        assistant_response: asString(entry.assistant_response).trim(),
        issue_type: normalizeIssueType(entry.issue_type),
        why_insufficient: asString(entry.why_insufficient).trim(),
      };
    })
    .filter(
      (entry): entry is MissedAnswer =>
        !!entry &&
        (entry.visitor_question || entry.assistant_response || entry.why_insufficient)
    );

  const analysis = {
    satisfaction_1_to_10: clampScore(parsed?.satisfaction_1_to_10),
    sentiment: normalizeSentiment(parsed?.sentiment),
    intent_primary: intentPrimary,
    intents,
    intent_other: intentOther,
    improvement:
      typeof parsed?.improvement === "string" ? parsed.improvement : "unknown",
    summary: typeof parsed?.summary === "string" ? parsed.summary : "unknown",
    evidence: {
      visitor_goal: rawVisitorGoal || "unknown",
      goal_met: normalizeGoalMet(rawGoalMet),
      key_quotes: rawKeyQuotes.filter((q: unknown) => typeof q === "string"),
    },
    missed_or_weak_answers: missedOrWeak,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("chat_visitor_analyses")
    .upsert({
      visitor_id: visitorId,
      last_message_at: lastMessageAt,
      source: "manual",
      model,
      prompt_version: PROMPT_VERSION,
      satisfaction_1_to_10: analysis.satisfaction_1_to_10,
      sentiment: analysis.sentiment,
      intent_primary: analysis.intent_primary,
      intents: analysis.intents,
      intent_other: analysis.intent_other,
      improvement: analysis.improvement,
      summary: analysis.summary,
      evidence_visitor_goal: analysis.evidence.visitor_goal,
      evidence_goal_met: analysis.evidence.goal_met,
      evidence_key_quotes: analysis.evidence.key_quotes,
      missed_or_weak_answers: analysis.missed_or_weak_answers,
      page_type: pageType,
      created_at: new Date().toISOString(),
      raw: {
        response_id: r.id ?? null,
        output: parsed,
      },
    }, { onConflict: "visitor_id,last_message_at,source" })
    .select(
      "id,visitor_id,last_message_at,source,model,prompt_version,satisfaction_1_to_10,sentiment,improvement,summary,evidence_visitor_goal,evidence_goal_met,evidence_key_quotes,created_at"
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
