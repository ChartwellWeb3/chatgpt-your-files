import "server-only";
import { createClient } from "@/app/utils/supabase/server";
import { createPerformanceClient, getPerformanceEnvironment, PerformanceConfigurationError } from "@/app/utils/supabase/performance-server";
import { NextResponse } from "next/server";

export class GeoError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export function failure(error: unknown) {
  if (error instanceof GeoError) return json({ error: error.message }, error.status);
  if (error instanceof PerformanceConfigurationError) return json({ error: error.message }, 503);
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(code)) return json({ error: "GEO database setup is incomplete. Ask an administrator to install the GEO SQL scripts in the performance database.", code: "GEO_SETUP_REQUIRED" }, 503);
  if (code === "40001") return json({ error: "This review or answer changed while you were editing. Refresh the saved details before submitting again." }, 409);
  if (code === "23505") return json({ error: "This item already exists. Refresh to see the latest version." }, 409);
  const mappingMessages = [
    "That brand already exists. Select it from the list.",
    "That brand slug already exists.",
    "This residence is registered to another brand. Resolve the catalog conflict before verifying.",
    "No completed saved analysis is available to recheck for this answer.",
  ];
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  if (code === "22023" && mappingMessages.includes(message)) return json({ error: message }, 400);
  if (code === "22023" || code === "23514" || code === "23503") return json({ error: "The requested GEO change is invalid. Refresh and check the selected items." }, 400);
  console.error("GEO request failed", { code, type: error instanceof Error ? error.name : "DatabaseError" });
  return json({ error: "GEO could not complete this request. Try again or contact an administrator." }, 503);
}
export async function authorize(request?: Request, write = false, admin = false) {
  const auth = await createClient();
  const { data: { user }, error } = await auth.auth.getUser();
  if (error || !user) throw new GeoError("Sign in to use GEO monitoring.", 401);
  if (!user.email_confirmed_at) throw new GeoError("Verify your email to use GEO monitoring.", 403);
  const { data: profile, error: profileError } = await auth.from("profiles").select("level").eq("id", user.id).maybeSingle();
  if (profileError) throw new GeoError("Your access level could not be verified.", 503);
  const level: 1 | 2 | 3 = profile?.level === 1 ? 1 : profile?.level === 2 ? 2 : 3;
  if ((write && level === 3) || (admin && level !== 1)) throw new GeoError("You do not have permission to make this change.", 403);
  if (write && request) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new GeoError("Request origin is not allowed.", 403);
  }
  const environment = getPerformanceEnvironment();
  const db = createPerformanceClient();
  return { db, environment, user, level };
}
type DatabaseResult = { data: unknown; error: unknown };

// Infer the complete response, so heterogeneous PostgREST unions keep each payload type.
// Optional queries and writes without .select() may legitimately return null.
export function checked<R extends DatabaseResult>(result: R): R["data"] {
  if (result.error) throw result.error;
  return result.data;
}
export function requiredData<R extends DatabaseResult>(result: R): NonNullable<R["data"]> {
  const data = checked(result);
  if (data == null) throw new GeoError("Required GEO data is missing. Refresh or ask an administrator to check the setup.", 503);
  return data;
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(value: unknown, label = "ID"): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new GeoError(`Invalid ${label}.`);
  return value;
}
export function text(value: unknown, min = 1, max = 4000): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) throw new GeoError(`Enter text between ${min} and ${max} characters.`);
  return value.trim();
}
export function option<T extends string>(value: unknown, values: readonly T[]): T {
  if (!values.includes(value as T)) throw new GeoError("Invalid selection.");
  return value as T;
}
export function pageNumber(value: string | null) {
  if (value !== null && !/^\d{1,5}$/.test(value)) throw new GeoError("Invalid page.");
  return Number(value || 0);
}
export function day(value: unknown): string {
  const date = typeof value === "string" ? new Date(`${value}T12:00:00Z`) : null;
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value) || !date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new GeoError("Invalid calendar date.");
  return value;
}
export function torontoMidnight(value: string) {
  const offset = new Intl.DateTimeFormat("en", { timeZone: "America/Toronto", timeZoneName: "shortOffset" }).formatToParts(new Date(`${value}T05:00:00Z`)).find(p => p.type === "timeZoneName")?.value;
  const hours = Number(offset?.replace("GMT", "") ?? -5);
  return new Date(Date.parse(`${value}T00:00:00Z`) - hours * 3600000).toISOString();
}
export function nextDay(value: string, count = 1) {
  const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0, 10);
}
export function metricArgs(params: URLSearchParams, environment: string) {
  const from = day(params.get("from")); const to = day(params.get("to"));
  if (to < from || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new GeoError("Choose a date range of up to one year.");
  // Old includeManual parameters never change the monitoring-only reporting scope.
  return { p_environment: environment, p_benchmark_id: uuid(params.get("benchmarkId"), "benchmark"),
    p_start: torontoMidnight(from), p_end: torontoMidnight(nextDay(to)),
    p_topic_id: params.get("topicId") ? uuid(params.get("topicId")) : null,
    p_market_id: params.get("marketId") ? uuid(params.get("marketId")) : null,
    p_language: params.get("language") ? option(params.get("language"), ["en", "fr"]) : null,
    p_question_kind: params.get("questionKind") === "all" ? null : option(params.get("questionKind") || "unbranded", ["unbranded", "branded"]),
    p_include_manual: false };
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") || 0) > 60000) throw new GeoError("Request is too large.", 413);
  const raw = await request.text();
  if (raw.length > 60000) throw new GeoError("Request is too large.", 413);
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new GeoError("Invalid request."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GeoError("Invalid request.");
  return value as Record<string, unknown>;
}
export function modelConfig() {
  return { monitor: process.env.OPENAI_GEO_MONITOR_MODEL?.trim() || null, analysis: process.env.OPENAI_GEO_ANALYSIS_MODEL?.trim() || null, apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()) };
}
