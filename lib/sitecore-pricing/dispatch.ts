import "server-only";
import { PricingError, type PricingEnvironment } from "./types";

export function pricingDispatchConfig() {
  const url = process.env.PERFORMANCE_SUPABASE_URL?.trim();
  const secret = process.env.SITECORE_PRICING_DISPATCH_SECRET?.trim() || "";
  if (!url || secret.length < 32) throw new PricingError("Configure SITECORE_PRICING_DISPATCH_SECRET (at least 32 random characters) on the app and pricing Edge Function.", 503);
  // The browser cannot select a destination or supply a service credential.
  return { endpoint: `${url.replace(/\/$/, "")}/functions/v1/sitecore-pricing`, secret };
}
export async function wakePricingEdge(environment: PricingEnvironment = "dev") {
  const { endpoint, secret } = pricingDispatchConfig();
  try {
    const response = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10000), cache: "no-store", headers: { "x-pricing-secret": secret, "Content-Type": "application/json" }, body: JSON.stringify({ environment }) });
    if (!response.ok) throw new Error();
    return null;
  } catch {
    return "Run is saved, but the Edge Function could not be started immediately. Check deployment and matching dispatch secrets. The recovery schedule can resume the saved job.";
  }
}
