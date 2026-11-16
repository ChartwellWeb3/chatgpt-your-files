import { createHash } from "node:crypto";
import { PricingError, PRICING_ENVIRONMENTS, SUITE_ALIASES, type PricingConfig, type PricingEnvironment } from "./types.ts";

export function pricingEnvironment(value: unknown): PricingEnvironment {
  if (typeof value !== "string" || !PRICING_ENVIRONMENTS.includes(value as PricingEnvironment)) throw new PricingError("Select DEV, QA, or PROD.");
  return value as PricingEnvironment;
}

// Independent of PERFORMANCE_ENVIRONMENT and delivery credentials. Template,
// root and timezone settings are shared defaults, with per-environment overrides.
// CM hosts and automation credentials must always be environment-specific.
export function getPricingConfig(env: Record<string, string | undefined> = process.env, environment: PricingEnvironment = "dev"): PricingConfig {
  pricingEnvironment(environment);
  const label = environment.toUpperCase();
  const prefix = `SITECORE_PRICING_${label}_`;
  const setting = (name: string) => env[prefix + name]?.trim() || env[`SITECORE_PRICING_${name}`]?.trim();
  const cmUrl = env[prefix + "CM_URL"]?.trim();
  if (!cmUrl) throw new PricingError(`Set ${prefix}CM_URL to the ${label} Content Management host, not Experience Edge.`, 503);
  let url: URL;
  try { url = new URL(cmUrl); } catch { throw new PricingError(`The ${label} Content Management URL is invalid.`, 503); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)
    || ["edge.sitecorecloud.io", "auth.sitecorecloud.io", "api.sitecorecloud.io", "xmclouddeploy-api.sitecorecloud.io"].includes(url.hostname)) {
    throw new PricingError(`Use the HTTPS origin of the ${label} Content Management host. Experience Edge and API URLs are not authoring hosts.`, 503);
  }
  for (const other of PRICING_ENVIRONMENTS) {
    if (other === environment) continue;
    const otherUrl = env[`SITECORE_PRICING_${other.toUpperCase()}_CM_URL`]?.trim();
    if (otherUrl) {
      let origin: string | undefined;
      try { origin = new URL(otherUrl).origin; } catch { /* The other environment reports its own invalid configuration. */ }
      if (origin === url.origin) throw new PricingError(`${label} and ${other.toUpperCase()} must use different Content Management hosts.`, 503);
    }
  }
  const clientId = env[prefix + "CLIENT_ID"]?.trim();
  const clientSecret = env[prefix + "CLIENT_SECRET"]?.trim();
  if (!clientId || !clientSecret) throw new PricingError(`Configure ${prefix}CLIENT_ID and ${prefix}CLIENT_SECRET on the app and Edge Function.`, 503);
  const propertyTemplateId = setting("PROPERTY_TEMPLATE_ID") || "";
  const suiteTemplateId = setting("SUITE_TEMPLATE_ID") || "";
  const guid = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;
  if (!guid.test(propertyTemplateId) || !guid.test(suiteTemplateId)) throw new PricingError(`Configure shared SITECORE_PRICING_PROPERTY_TEMPLATE_ID and SITECORE_PRICING_SUITE_TEMPLATE_ID, or ${prefix}PROPERTY_TEMPLATE_ID and ${prefix}SUITE_TEMPLATE_ID overrides, with GUIDs verified in ${label}.`, 503);
  const configuredRoot = setting("CONTENT_ROOT");
  if (!configuredRoot && environment !== "dev") throw new PricingError(`Set SITECORE_PRICING_CONTENT_ROOT or ${prefix}CONTENT_ROOT to the intended ${label} import scope.`, 503);
  const root = (configuredRoot || "/sitecore/content/sxastarter/sxastarter/home").replace(/\/$/, "");
  if (!root.startsWith("/sitecore/content/") || root.includes("..")) throw new PricingError("The pricing content root must be below /sitecore/content/.", 503);
  const timezone = setting("TIMEZONE") || "America/Toronto";
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { throw new PricingError("The pricing timezone is invalid.", 503); }
  const fields = { regularPrice: "Regular SuitePrice", promotionPrice: "Promotion Price", startDate: "Start Date", endDate: "End Date" };
  // Retain the DEV hash for already queued DEV jobs. QA/PROD include their
  // environment explicitly; no existing import can be retargeted by the UI.
  const hash = createHash("sha256").update(JSON.stringify({ execution: "edge-auto-v1", ...(environment === "dev" ? {} : { environment }), host: url.origin, root, timezone, propertyTemplateId, suiteTemplateId, fields, suiteAliases: SUITE_ALIASES, residenceMatches: "all", languages: ["en", "fr"], blanks: "preserve", endDate: "inclusive" })).digest("hex");
  return { environment, host: url.origin, endpoint: `${url.origin}/sitecore/api/authoring/graphql/v1/`, clientId, clientSecret, root, timezone, propertyTemplateId, suiteTemplateId, fields, hash };
}
