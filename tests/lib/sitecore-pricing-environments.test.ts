// @vitest-environment node
// Supplied for later execution; tests/builds are intentionally not run.
import { describe, expect, it } from "vitest";
import { getPricingConfig, pricingEnvironment } from "@/lib/sitecore-pricing/config";
import { PRICING_ENVIRONMENTS, type PricingEnvironment } from "@/lib/sitecore-pricing/types";
const guid = "00000000-0000-4000-8000-000000000001";
function settings(environment: PricingEnvironment) {
  const prefix = `SITECORE_PRICING_${environment.toUpperCase()}_`;
  return Object.fromEntries(Object.entries({ CM_URL: `https://${environment}.test`, CLIENT_ID: `${environment}-client`, CLIENT_SECRET: `${environment}-secret`, PROPERTY_TEMPLATE_ID: guid, SUITE_TEMPLATE_ID: guid, CONTENT_ROOT: `/sitecore/content/${environment}`, TIMEZONE: "America/Toronto" }).map(([key, value]) => [prefix + key, value]));
}
describe("pricing environment isolation", () => {
  it.each(PRICING_ENVIRONMENTS)("uses only the selected %s settings", environment => {
    const env = Object.assign({}, ...PRICING_ENVIRONMENTS.map(settings));
    expect(getPricingConfig(env, environment)).toMatchObject({ environment, host: `https://${environment}.test`, clientId: `${environment}-client`, clientSecret: `${environment}-secret`, root: `/sitecore/content/${environment}` });
  });
  const shared = {
    SITECORE_PRICING_PROPERTY_TEMPLATE_ID: guid,
    SITECORE_PRICING_SUITE_TEMPLATE_ID: guid,
    SITECORE_PRICING_CONTENT_ROOT: "/sitecore/content/Shared",
    SITECORE_PRICING_TIMEZONE: "America/Toronto",
  };
  function sharedSettings(environment: PricingEnvironment): Record<string, string> {
    const env: Record<string, string> = { ...settings(environment), ...shared };
    for (const name of ["PROPERTY_TEMPLATE_ID", "SUITE_TEMPLATE_ID", "CONTENT_ROOT", "TIMEZONE"]) delete env[`SITECORE_PRICING_${environment.toUpperCase()}_${name}`];
    return env;
  }
  it.each(PRICING_ENVIRONMENTS)("uses shared templates, root and timezone in %s", environment => {
    expect(getPricingConfig(sharedSettings(environment), environment)).toMatchObject({
      environment, propertyTemplateId: guid, suiteTemplateId: guid, root: shared.SITECORE_PRICING_CONTENT_ROOT,
      timezone: shared.SITECORE_PRICING_TIMEZONE, host: `https://${environment}.test`, clientId: `${environment}-client`, clientSecret: `${environment}-secret`,
    });
  });
  it.each(PRICING_ENVIRONMENTS)("keeps the %s hash unchanged when resolved settings move to shared variables", environment => {
    const explicit = { ...sharedSettings(environment), ...settings(environment) };
    const common = sharedSettings(environment);
    common.SITECORE_PRICING_CONTENT_ROOT = `/sitecore/content/${environment}`;
    expect(getPricingConfig(common, environment).hash).toBe(getPricingConfig(explicit, environment).hash);
  });
  it.each(PRICING_ENVIRONMENTS)("prefers nonblank %s overrides without changing the shared defaults", environment => {
    const env = sharedSettings(environment); const prefix = `SITECORE_PRICING_${environment.toUpperCase()}_`;
    const overrideId = "00000000-0000-4000-8000-000000000002";
    Object.assign(env, { [prefix + "PROPERTY_TEMPLATE_ID"]: overrideId, [prefix + "SUITE_TEMPLATE_ID"]: overrideId, [prefix + "CONTENT_ROOT"]: `/sitecore/content/${environment}`, [prefix + "TIMEZONE"]: "UTC" });
    expect(getPricingConfig(env, environment)).toMatchObject({ propertyTemplateId: overrideId, suiteTemplateId: overrideId, root: `/sitecore/content/${environment}`, timezone: "UTC" });
    for (const name of ["PROPERTY_TEMPLATE_ID", "SUITE_TEMPLATE_ID", "CONTENT_ROOT", "TIMEZONE"]) env[prefix + name] = "  ";
    expect(getPricingConfig(env, environment)).toMatchObject({ propertyTemplateId: guid, suiteTemplateId: guid, root: shared.SITECORE_PRICING_CONTENT_ROOT, timezone: shared.SITECORE_PRICING_TIMEZONE });
  });
  it.each(["qa", "prod"] as const)("never shares CM URLs or automation credentials in %s", environment => {
    for (const name of ["CM_URL", "CLIENT_ID", "CLIENT_SECRET"]) {
      const env = { ...settings("dev"), ...sharedSettings(environment), [`SITECORE_PRICING_${name}`]: "must-not-be-used" };
      delete env[`SITECORE_PRICING_${environment.toUpperCase()}_${name}`];
      expect(() => getPricingConfig(env, environment)).toThrow(name === "CM_URL" ? `${environment.toUpperCase()}_CM_URL` : "CLIENT_ID");
    }
  });
  it.each(["PROPERTY_TEMPLATE_ID", "SUITE_TEMPLATE_ID", "CONTENT_ROOT", "TIMEZONE"])("validates shared %s values", name => {
    const env = sharedSettings("prod"); env[`SITECORE_PRICING_${name}`] = "invalid";
    expect(() => getPricingConfig(env, "prod")).toThrow();
  });
  it("rejects environments mapped to the same host", () => {
    const env = { ...settings("dev"), ...settings("prod"), SITECORE_PRICING_PROD_CM_URL: "https://dev.test" };
    expect(() => getPricingConfig(env, "prod")).toThrow("different Content Management hosts");
  });
  it.each(["stage", "PROD", false, {}, ""])("rejects invalid environment %j", value => { expect(() => pricingEnvironment(value)).toThrow(); });
  it("preserves the existing DEV configuration hash when moving to prefixed settings", () => {
    const env = settings("dev");
    const legacy = { SITECORE_PRICING_DEV_CM_URL: "https://dev.test", SITECORE_PRICING_DEV_CLIENT_ID: "dev-client", SITECORE_PRICING_DEV_CLIENT_SECRET: "dev-secret", SITECORE_PRICING_PROPERTY_TEMPLATE_ID: guid, SITECORE_PRICING_SUITE_TEMPLATE_ID: guid, SITECORE_PRICING_CONTENT_ROOT: "/sitecore/content/dev", SITECORE_PRICING_TIMEZONE: "America/Toronto" };
    expect(getPricingConfig(env).hash).toBe(getPricingConfig(legacy).hash);
  });
});
