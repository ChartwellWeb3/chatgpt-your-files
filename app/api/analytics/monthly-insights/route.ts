import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/app/utils/supabase/server";

export const runtime = "nodejs";

const PROMPT_VERSION = "v1";
const MODEL_FALLBACK = "gpt-5.2";
const PAGE_TYPES = ["corporate", "residence"] as const;

type PageType = (typeof PAGE_TYPES)[number];

type QuestionRow = {
  page_type: string;
  question: string | null;
  example: string | null;
  freq: number | null;
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
    throw new Error("Invalid JSON returned by model");
  }
}

function formatDateUTC(date: Date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return null;
  const [y, m] = value.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return {
    label: value,
    startDate: formatDateUTC(start),
    endDate: formatDateUTC(end),
  };
}

function buildPrompt(params: {
  monthLabel: string;
  pageType: PageType;
  questions: Array<{ text: string; freq: number }>;
}) {
  const lines = params.questions
    .slice(0, 120)
    .map((q, idx) => `${idx + 1}. (${q.freq}) ${q.text}`)
    .join("\n");

  return `
You are analyzing monthly chatbot questions.

Month: ${params.monthLabel}
Page type: ${params.pageType}

Input list: common user questions with frequency counts.
Use ONLY this list. Do not invent facts or company details.

  Return JSON only with keys:
  - top_questions: 5-10 most common questions (short, canonical).
  - top_intents: 5-10 intent labels.

Rules:
- Keep each item short (<= 12 words).
- If not enough evidence for a list, return an empty array.
- Ignore greetings, acknowledgements, or non-question fragments. Only output clear user questions and intents.
- Do not include extra keys or commentary.

Questions:
${lines}
`.trim();
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
  const month = typeof body?.month === "string" ? body.month.trim() : "";
  const langRaw = typeof body?.lang === "string" ? body.lang.trim() : "";
  const lang = langRaw.toLowerCase();
  const parsedMonth = parseMonth(month);
  if (!parsedMonth) {
    return NextResponse.json(
      { ok: false, error: "Invalid month. Use YYYY-MM." },
      { status: 400 }
    );
  }
  if (lang !== "en" && lang !== "fr") {
    return NextResponse.json(
      { ok: false, error: "Invalid language. Use 'en' or 'fr'." },
      { status: 400 }
    );
  }

  const { data: existingRows, error: existingErr } = await supabase
    .from("chat_monthly_insights")
    .select("id")
    .eq("month", parsedMonth.startDate)
    .eq("lang", lang)
    .limit(1);

  if (existingErr) {
    return NextResponse.json({ ok: false, error: existingErr.message }, { status: 500 });
  }

  if ((existingRows ?? []).length > 0) {
    return NextResponse.json(
      { ok: false, error: "Insights already exist for this month and language." },
      { status: 409 }
    );
  }

  const { data: rows, error: rowsErr } = await supabase.rpc(
    "chat_monthly_common_questions",
    {
      p_start: parsedMonth.startDate,
      p_end: parsedMonth.endDate,
      p_lang: lang,
      p_limit: 200,
    }
  );

  if (rowsErr) {
    return NextResponse.json({ ok: false, error: rowsErr.message }, { status: 500 });
  }

  const grouped = new Map<PageType, Array<{ text: string; freq: number }>>();
  for (const row of (rows ?? []) as QuestionRow[]) {
    const pageType = row.page_type as PageType;
    if (!PAGE_TYPES.includes(pageType)) continue;
    const text = (row.example || row.question || "").trim();
    if (!text) continue;
    const freq = Number(row.freq ?? 0);
    const list = grouped.get(pageType) ?? [];
    list.push({ text, freq });
    grouped.set(pageType, list);
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_ANALYSIS_MODEL ?? MODEL_FALLBACK;

  const results: Array<{
    page_type: PageType;
    ok: boolean;
    error?: string;
    row?: unknown;
  }> = [];

  for (const pageType of PAGE_TYPES) {
    const questions = (grouped.get(pageType) ?? []).sort(
      (a, b) => b.freq - a.freq
    );
    if (!questions.length) {
      results.push({
        page_type: pageType,
        ok: false,
        error: "No questions found for this page type.",
      });
      continue;
    }

    try {
      const prompt = buildPrompt({
        monthLabel: parsedMonth.label,
        pageType,
        questions,
      });

      const r = await openai.responses.create({
        model,
        instructions: "Return JSON only.",
        input: [{ role: "user", content: prompt }],
        text: {
          format: {
            type: "json_schema",
            name: "monthly_chat_insights",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                top_questions: { type: "array", items: { type: "string" } },
                top_intents: { type: "array", items: { type: "string" } },
              },
              required: ["top_questions", "top_intents"],
            },
          },
        },
        max_output_tokens: 900,
      });

      const outText = getResponseText(r);
      if (!outText) {
        throw new Error("Model returned empty output");
      }

      const parsed = tryParseJson(outText);

      const { data: inserted, error: insertErr } = await supabase
        .from("chat_monthly_insights")
        .upsert(
          {
            month: parsedMonth.startDate,
            page_type: pageType,
            lang,
            source: "manual",
            model,
            prompt_version: PROMPT_VERSION,
            summary: parsed,
            raw: {
              response_id: r.id ?? null,
              input_count: questions.length,
            },
            created_by: user.id,
          },
          { onConflict: "month,page_type,lang,source" }
        )
        .select("id,month,page_type,lang,source,created_at")
        .single();

      if (insertErr) throw insertErr;

      results.push({ page_type: pageType, ok: true, row: inserted ?? null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to run insights.";
      results.push({ page_type: pageType, ok: false, error: message });
    }
  }

  return NextResponse.json({
    ok: true,
    month: parsedMonth.label,
    lang,
    processed: results.filter((r) => r.ok).length,
    results,
  });
}

export async function DELETE(req: Request) {
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
  const month = typeof body?.month === "string" ? body.month.trim() : "";
  const langRaw = typeof body?.lang === "string" ? body.lang.trim() : "";
  const lang = langRaw.toLowerCase();
  const parsedMonth = parseMonth(month);
  if (!parsedMonth) {
    return NextResponse.json(
      { ok: false, error: "Invalid month. Use YYYY-MM." },
      { status: 400 }
    );
  }
  if (lang !== "en" && lang !== "fr") {
    return NextResponse.json(
      { ok: false, error: "Invalid language. Use 'en' or 'fr'." },
      { status: 400 }
    );
  }

  const { error: deleteErr, count } = await supabase
    .from("chat_monthly_insights")
    .delete({ count: "exact" })
    .eq("month", parsedMonth.startDate)
    .eq("lang", lang);

  if (deleteErr) {
    return NextResponse.json({ ok: false, error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    month: parsedMonth.label,
    lang,
    deleted: count ?? 0,
  });
}
