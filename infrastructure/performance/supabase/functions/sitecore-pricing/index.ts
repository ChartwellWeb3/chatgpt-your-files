import { createClient } from "npm:@supabase/supabase-js@2.88.0";
import { getPricingConfig, pricingEnvironment } from "../_shared/sitecore-pricing/config.ts";
import { SitecoreAuthoring } from "../_shared/sitecore-pricing/authoring.ts";
import { runPricingEdgeBatch } from "../_shared/sitecore-pricing/edge-batch.ts";
import { PRICING_ENVIRONMENTS, type PricingConfig } from "../_shared/sitecore-pricing/types.ts";

async function matchingSecret(actual: string, expected: string) {
  const hash = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([hash(actual), hash(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

Deno.serve(async request => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("SITECORE_PRICING_DISPATCH_SECRET") || "";
  if (secret.length < 32 || !await matchingSecret(request.headers.get("x-pricing-secret") || "", secret)) return new Response("Unauthorized", { status: 401 });
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return new Response("Pricing setup incomplete", { status: 503 });
  let requested;
  try {
    const body = await request.text();
    if (body.length > 1000) return new Response("Invalid request", { status: 400 });
    const input = body ? JSON.parse(body) : {};
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
    requested = input.environment === undefined ? undefined : pricingEnvironment(input.environment);
  } catch { return new Response("Invalid environment", { status: 400 }); }
  const configs: PricingConfig[] = [];
  for (const environment of requested ? [requested] : PRICING_ENVIRONMENTS) {
    try { configs.push(getPricingConfig(Deno.env.toObject(), environment)); }
    catch { if (requested) return new Response("Pricing environment configuration incomplete", { status: 503 }); }
  }
  if (!configs.length) return new Response("Pricing configuration incomplete", { status: 503 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal || AbortSignal.timeout(10000) }) } });
  // Respond quickly to the authenticated app or cron. Work still has a bounded
  // lifetime; every page/row is durable and cron recovers killed invocations.
  EdgeRuntime.waitUntil((async () => {
    try {
      // Separate hosts can progress together within one bounded wall-clock
      // window. A failure in one environment never interrupts another.
      const batches = await Promise.allSettled(configs.map(config => runPricingEdgeBatch(db, new SitecoreAuthoring(config))));
      const worked = batches.some(batch => batch.status === "fulfilled" && batch.value);
      if (batches.some(batch => batch.status === "rejected")) console.error("A pricing environment batch was interrupted; cron will recover its saved lease.");
      if (worked) {
        // Continue after releasing the lease. A failed wake is recovered by cron.
        // Batches do network work, so chaining stays well below the platform's
        // request recursion rate; cron is the independent recovery path.
        await fetch(`${url}/functions/v1/sitecore-pricing`, { method: "POST", headers: { "x-pricing-secret": secret, "Content-Type": "application/json" }, body: JSON.stringify(requested ? { environment: requested } : {}), signal: AbortSignal.timeout(10000) }).catch(() => {});
      }
    } catch { console.error("Pricing batch interrupted; saved work resumes after lease expiration."); }
  })());
  return Response.json({ accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
});
