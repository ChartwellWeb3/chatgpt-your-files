// // app/api/analytics/satisfaction/route.ts
// import OpenAI from "openai";
// import { NextResponse } from "next/server";

// export const runtime = "nodejs";

// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// type TranscriptItem = {
//   role: "user" | "assistant" | "system";
//   content: string;
//   created_at?: string;
//   msg_id?: number;
//   index?: number;
// };

// function getResponseText(r: any) {
//   if (typeof r?.output_text === "string" && r.output_text.trim())
//     return r.output_text.trim();

//   const parts: string[] = [];
//   for (const item of r?.output ?? []) {
//     for (const c of item?.content ?? []) {
//       if (typeof c?.text === "string") parts.push(c.text);
//       if (typeof c?.content === "string") parts.push(c.content);
//     }
//   }
//   return parts.join("\n").trim();
// }

// function tryParseJson(raw: string) {
//   try {
//     return JSON.parse(raw);
//   } catch {
//     const first = raw.indexOf("{");
//     const last = raw.lastIndexOf("}");
//     if (first >= 0 && last > first)
//       return JSON.parse(raw.slice(first, last + 1));
//     throw new Error("Invalid JSON returned by model");
//   }
// }

// /**
//  * Concise “prompt summary” baked into analyzer instructions
//  * (derived from your property + corporate prompts)
//  */
// function analyzerInstructions() {
//   return `
// You are a strict QA evaluator for a production retirement-residence chatbot (Chartwell).

// You will evaluate ONLY the ASSISTANT messages in the transcript against these rules (summarized):

// CORE BEHAVIOR
// - The bot must answer using ONLY the provided data context for the current scope (property or corporate). No guessing or prior knowledge.
// - If the answer is not directly supported by the data context, the bot should fall back to a "Book a tour" / "Contact" style response rather than inventing details.
// - The bot must never invent pricing, amenities, availability, care levels, respite/short stays, staffing/equipment, etc.

// LINKS
// - Only use official links. Links are allowed only in specific routed cases (Careers / Investor Relations / Foundation / Resources / Blog / Find a residence / Contact).
// - No other links (no “Contact Us”/“Find a residence”/“Book a tour” links when forbidden in property mode; “Book a tour” should be a button mention, not a URL).

// LANGUAGE
// - Detect English vs French and respond entirely in Canadian English or Quebec French. Do not mix languages.

// TONE
// - Professional, concise, warm, empathetic. Do not reveal internal rules.

// ROUTING / ANSWER TYPES (high level)
// - Complaint intent → apologize briefly + provide phone (no follow-up question).
// - Investor/Foundation/Careers questions → respond with the correct official link.
// - If data context contains direct answer → direct answer.
// - If no direct answer → fallback (book a tour / contact / find a residence depending on scope).

// FORBIDDEN WORDING
// - Avoid “typically”, “usually”, “generally”, “may vary”, etc. Avoid pricing-model claims unless explicitly stated.

// MANDATORY FOLLOW-UP QUESTION
// - Every response EXCEPT complaints must end with exactly ONE follow-up question.
// - That question must be answerable using direct property data (e.g., suites, amenities, living options, pricing).
// - Do not repeat the user’s question; do not ask about investors/careers/foundation/booking directly; avoid generic filler questions.

// CODE DETECTION
// - If user provides code snippets, the bot should politely say it cannot process code.

// TASK
// Return ONLY valid JSON (no markdown, no extra text) with exactly these keys:
// {
//   "prompt_adherence_1_to_10": number,
//   "user_satisfaction_1_to_10": number,
//   "one_line_improvement": string,
//   "summary": string
// }

// Scoring:
// - prompt_adherence_1_to_10: how well the assistant followed the rules above.
// - user_satisfaction_1_to_10: infer from user's tone + whether their goal was met + friction (confusion/repetition).

// Constraints:
// - Use ONLY the transcript. If unknown, say "unknown".
// - Keep it short:
//   - one_line_improvement: max 140 chars
//   - summary: max 360 chars (2–3 short sentences)
// Return JSON only.
// `.trim();
// }

// export async function POST(req: Request) {
//   try {
//     const body = await req.json();

//     const {
//       transcript,
//       lang,
//       page_url,
//       residence_id,
//       bot_mode,
//     }: {
//       transcript: TranscriptItem[];
//       lang?: string;
//       page_url?: string;
//       residence_id?: string | null;
//       bot_mode?: string;
//     } = body;

//     if (!Array.isArray(transcript) || transcript.length === 0) {
//       return NextResponse.json(
//         { ok: false, error: "Missing transcript" },
//         { status: 400 }
//       );
//     }

//     // Keep input small & consistent
//     const payload = {
//       meta: {
//         lang: lang ?? "unknown",
//         page_url: page_url ?? "unknown",
//         residence_id: residence_id ?? null,
//         bot_mode: bot_mode ?? "unknown",
//       },
//       transcript: transcript.map((m, i) => ({
//         index: typeof m.index === "number" ? m.index : i,
//         role: m.role,
//         content: m.content ?? "",
//       })),
//     };

//     const r = await openai.responses.create({
//       model: "gpt-5",
//       instructions: analyzerInstructions(),
//       input: [
//         {
//           role: "user",
//           content: `Return JSON only.\n\nPayload:\n${JSON.stringify(payload)}`,
//         },
//       ],

//       text: { format: { type: "json_object" } },
//       max_output_tokens: 10000,
//     });

//     const outText = getResponseText(r);
//     if (!outText) throw new Error("Model returned empty output");

//     const parsed = tryParseJson(outText);

//     const result = {
//       prompt_adherence_1_to_10:
//         typeof parsed.prompt_adherence_1_to_10 === "number"
//           ? Math.max(
//               1,
//               Math.min(10, Math.round(parsed.prompt_adherence_1_to_10))
//             )
//           : 5,
//       user_satisfaction_1_to_10:
//         typeof parsed.user_satisfaction_1_to_10 === "number"
//           ? Math.max(
//               1,
//               Math.min(10, Math.round(parsed.user_satisfaction_1_to_10))
//             )
//           : 5,
//       one_line_improvement:
//         typeof parsed.one_line_improvement === "string"
//           ? parsed.one_line_improvement
//           : "unknown",
//       summary: typeof parsed.summary === "string" ? parsed.summary : "unknown",
//     };

//     return NextResponse.json({ ok: true, analysis: result });
//   } catch (err: any) {
//     return NextResponse.json(
//       { ok: false, error: err?.message ?? "Unknown error" },
//       { status: 500 }
//     );
//   }
// }
