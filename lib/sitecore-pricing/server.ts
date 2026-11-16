import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/app/utils/supabase/server";
import { createPerformanceClient, PerformanceConfigurationError } from "@/app/utils/supabase/performance-server";
import { PricingError } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasFeatureAccess } from "@/lib/feature-access";

export const PRICING_REPAIR_SCRIPT = "20261116160000_pricing_environments_complete.sql";
export type PricingSchemaStatus = { ready: boolean; missing: string[]; version?: string; environments?: string[] };
export async function pricingSchemaStatus(db: SupabaseClient): Promise<PricingSchemaStatus> {
  const result = await db.rpc("sitecore_pricing_schema_status");
  if (result.error) {
    if (["42883", "PGRST202", "PGRST204"].includes(result.error.code)) return { ready: false, missing: ["sitecore_pricing_schema_status()"] };
    throw result.error;
  }
  const value = result.data as PricingSchemaStatus | null;
  if (!value || !Array.isArray(value.missing) || typeof value.ready !== "boolean") throw new PricingError("The pricing database readiness response is invalid.", 503);
  if (!["dev", "qa", "prod"].every(environment => value.environments?.includes(environment))) return { ...value, ready: false, missing: [...value.missing, "DEV/QA/PROD pricing support"] };
  return value;
}
export function pricingSchemaMessage(status: PricingSchemaStatus) {
  return `Run ${PRICING_REPAIR_SCRIPT} in the performance project's SQL Editor (the project configured by PERFORMANCE_SUPABASE_URL), then refresh. Do not rerun the old Edge installation script. Missing: ${status.missing.join(", ")}.`;
}

export async function requirePricingUser(request?: Request) {
  const auth = await createClient();
  const { data: { user }, error } = await auth.auth.getUser();
  if (error || !user) throw new PricingError("Sign in to manage suite pricing.", 401);
  if (!user.email_confirmed_at) throw new PricingError("Verify your email to manage suite pricing.", 403);
  const { data: profile, error: profileError } = await auth.from("profiles").select("level, feature_access").eq("id", user.id).maybeSingle();
  if (profileError) throw new PricingError("Your access level could not be verified.", 503);
  if (profile?.level !== 1 && profile?.level !== 2) throw new PricingError("Suite pricing requires an administrator or Content Team account.", 403);
  if (!hasFeatureAccess(profile, "sitecore_pricing")) throw new PricingError("Suite Pricing access is disabled for your account. Contact an administrator.", 403);
  if (request) {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new PricingError("Request origin is not allowed.", 403);
  }
  return user;
}
export async function authorizePricing(request?: Request) {
  const user = await requirePricingUser(request);
  // Never construct the secret client until chatbot authentication succeeds.
  return { user, db: createPerformanceClient() };
}
export const pricingJson = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export function pricingFailure(error: unknown) {
  if (error instanceof PricingError) return pricingJson({ error: error.message }, error.status);
  if (error instanceof PerformanceConfigurationError) return pricingJson({ error: error.message }, 503);
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (["42P01", "42883", "42703", "42501", "PGRST202", "PGRST204", "PGRST205"].includes(code)) return pricingJson({ error: `Suite pricing database setup or permissions are incomplete. Run ${PRICING_REPAIR_SCRIPT} in the performance project configured by PERFORMANCE_SUPABASE_URL, then refresh. Do not rerun the old Edge installation script.` }, 503);
  if (code === "55006") return pricingJson({ error: "This import is currently processing. Wait for it to finish, or cancel remaining work between batches, before deleting it." }, 409);
  if (code === "55000") return pricingJson({ error: "Deploy the pricing Edge Function and upload a new automatic import." }, 503);
  if (["22023", "40001", "23505"].includes(code)) return pricingJson({ error: "The import changed or this action is no longer available. Refresh the preview." }, 409);
  console.error("Suite pricing request failed", { code });
  return pricingJson({ error: "Suite pricing could not complete the request. Check setup and try again." }, 503);
}
export function checked<T>(result: { data: T; error: unknown }): T { if (result.error) throw result.error; return result.data; }
export function pricingUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new PricingError("Invalid import ID.");
  return value;
}
export async function limitedBody(request: Request, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length") || 0) > limit) throw new PricingError("The upload or request is too large.", 413);
  const reader = request.body?.getReader(); if (!reader) throw new PricingError("The request is empty.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new PricingError("The upload or request is too large.", 413); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
