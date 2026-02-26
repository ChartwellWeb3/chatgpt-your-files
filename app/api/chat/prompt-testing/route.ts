import OpenAI from "openai";
import { createClient as createServerClient } from "@/app/utils/supabase/server";
import { prompt, type ChatBotData } from "@/lib/chatbot/prompts";

export const runtime = "nodejs";

type SearchDoc = {
  content: string;
  document_section_id: number | null;
  source_type: "vector" | "keyword" | "hybrid";
  rank: number;
  score: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response("Missing OPENAI_API_KEY", { status: 500 });
  }

  const supabase = await createServerClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const message =
    typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return new Response("Message is required", { status: 400 });
  }

  const history = Array.isArray(body?.history) ? body.history : [];
  const data = (isRecord(body?.data) ? body.data : {}) as ChatBotData;
  const lang = body?.lang === "fr" ? "fr" : "en";
  const promptOverride =
    typeof body?.prompt_override === "string" ? body.prompt_override : null;

  const customId =
    typeof data?.customId === "string" && data.customId.trim()
      ? data.customId.trim()
      : null;
  const corporateId =
    typeof data?.corporateId === "string" && data.corporateId.trim()
      ? data.corporateId.trim()
      : null;

  const vecByIdPromise = customId
    ? supabase.functions.invoke("search-vector", {
        body: { message, customId, limit: 7 },
      })
    : Promise.resolve({ data: { documents: [] as any[] }, error: null });

  const vecCorpPromise =
    corporateId && corporateId !== customId
      ? supabase.functions.invoke("search-vector", {
          body: { message, customId: corporateId, limit: 7 },
        })
      : Promise.resolve({ data: { documents: [] as any[] }, error: null });

  const kwByIdPromise = customId
    ? supabase.rpc("search_sections_ml", {
        q: message,
        p_residence_custom_id: customId ?? null,
        p_lang: lang ?? "auto",
        p_limit: 7,
        p_offset: 0,
      })
    : Promise.resolve({ data: [] as any[], error: null });

  const kwCorpPromise =
    corporateId && corporateId !== customId
      ? supabase.rpc("search_sections_ml", {
          q: message,
          p_residence_custom_id: corporateId ?? null,
          p_lang: lang ?? "auto",
          p_limit: 7,
          p_offset: 0,
        })
      : Promise.resolve({ data: [] as any[], error: null });

  const [vecById, vecCorp, kwById, kwCorp] = await Promise.all([
    vecByIdPromise,
    vecCorpPromise,
    kwByIdPromise,
    kwCorpPromise,
  ]);

  const vectorDocs = (vecById.data?.documents || []).map((d: any, i: number) => ({
    content: d.content,
    document_section_id: d.id ?? null,
    source_type: "vector" as const,
    rank: i + 1,
    score: typeof d.score === "number" ? d.score : null,
  })) as SearchDoc[];

  const vectorCorpDocs = (vecCorp.data?.documents || []).map((d: any, i: number) => ({
    content: d.content,
    document_section_id: d.id ?? null,
    source_type: "vector" as const,
    rank: i + 1,
    score: typeof d.score === "number" ? d.score : null,
  })) as SearchDoc[];

  const keywordByIdDocs = (kwById.data || []).map((d: any, i: number) => ({
    content: d.content,
    document_section_id: d.section_id ?? null,
    source_type: "keyword" as const,
    rank: i + 1,
    score: typeof d.rank === "number" ? d.rank : null,
  })) as SearchDoc[];

  const keywordCorpDocs = (kwCorp.data || []).map((d: any, i: number) => ({
    content: d.content,
    document_section_id: d.section_id ?? null,
    source_type: "keyword" as const,
    rank: i + 1,
    score: typeof d.rank === "number" ? d.rank : null,
  })) as SearchDoc[];

  const allDocs = [
    ...vectorDocs,
    ...vectorCorpDocs,
    ...keywordByIdDocs,
    ...keywordCorpDocs,
  ].filter((d) => !!d?.content);

  const uniqueContentMap = new Map<string, SearchDoc>();
  for (const doc of allDocs) {
    if (!uniqueContentMap.has(doc.content)) {
      uniqueContentMap.set(doc.content, doc);
    }
  }

  const uniqueContents = Array.from(uniqueContentMap.keys()).join("\n---\n");
  const rawDataContext = uniqueContents;
  const dataContextBlock = data?.isCorporate
    ? `<data_context>\n${rawDataContext}\n</data_context>`
    : `**Property Data Context**\n\n${rawDataContext}`;

  let baseSystem: string;
  if (promptOverride?.trim()) {
    if (promptOverride.includes("{{data_context_block}}")) {
      baseSystem = promptOverride
        .split("{{data_context_block}}")
        .join(dataContextBlock);
    } else if (promptOverride.includes("{{data_context}}")) {
      baseSystem = promptOverride
        .split("{{data_context}}")
        .join(rawDataContext);
    } else {
      baseSystem = `${promptOverride}\n\n${dataContextBlock}`;
    }
  } else {
    baseSystem = prompt(data, uniqueContents);
  }
  const system = baseSystem.replace(/\s+/g, " ");

  const sanitizedHistory = history.map((m: any) => ({
    role: m?.role === "assistant" ? "assistant" : "user",
    content: typeof m?.content === "string" ? m.content : "",
  }));

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const stream = await openai.responses.create({
    model: "gpt-5.2",
    input: [
      { role: "developer", content: system },
      ...sanitizedHistory,
      { role: "user", content: message },
    ],
    temperature: 0,
    stream: true,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "response.output_text.delta") {
            const delta = event.delta ?? "";
            if (delta) controller.enqueue(encoder.encode(delta));
          }
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
