import "server-only";
import OpenAI from "openai";
import type { Response as AIResponse } from "openai/resources/responses/responses";
import { COLLECTION_PROMPT, EXTRACTION_PROMPT } from "./analysis";
import { record } from "./analysis";
import { GeoError, modelConfig } from "./server";

export function aiClient(monitorRequired = true) {
  const models = modelConfig();
  if (!models.apiKeyConfigured || (monitorRequired && !models.monitor) || !models.analysis) throw new GeoError("GEO AI models are not configured. Ask an administrator to finish AI setup.", 503);
  return { client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 80000 }), models: { monitor: models.monitor || "", analysis: models.analysis } };
}
export async function structured(client: OpenAI, model: string, name: string, schema: Record<string, unknown>, instructions: string, input: unknown, onResponse?: (response: AIResponse) => Promise<void>) {
  const response = await client.responses.create({ model, store: false, max_output_tokens: 5000, instructions,
    input: JSON.stringify(input), text: { format: { type: "json_schema", name, strict: true, schema } } });
  await onResponse?.(response);
  if (response.status !== "completed" || !response.output_text) throw new GeoError("AI analysis was incomplete. No results were approved or counted.", 502);
  let data: unknown; try { data = JSON.parse(response.output_text); } catch { throw new GeoError("AI returned an invalid analysis.", 502); }
  return { data, response };
}
export function usage(response: AIResponse) {
  return { model: response.model, responseId: response.id, tokens: response.usage,
    searchCalls: response.output.filter(item => item.type === "web_search_call" && record(record(item).action).type === "search").length };
}
export const benchmarkValues = (environment: string, actor: string, name: string, models: { monitor: string; analysis: string }) => ({
  environment, name, created_by: actor, model: models.monitor, analysis_model: models.analysis,
  collection_prompt: COLLECTION_PROMPT, extraction_prompt: EXTRACTION_PROMPT,
  measurement_version: "geo-v1", request_settings: { webSearch: true, searchContextSize: "medium", maxOutputTokens: 5000, language: "question", location: "question-market", timezone: "America/Toronto", extractionSchemaVersion: "v1" },
  schedule_enabled: false, schedule_days: [1], schedule_time: "09:00", schedule_timezone: "America/Toronto",
});
