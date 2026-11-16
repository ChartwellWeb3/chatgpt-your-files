// @vitest-environment node
// Regression cases supplied for later execution; tests/builds are not run.
import { describe, expect, it } from "vitest";
import { FEATURES, featureAllowsLevel, featureForPath, hasFeatureAccess, isFeatureKey } from "@/lib/feature-access";

describe("Suite Pricing feature access", () => {
  it("registers a team switch and page/API boundaries", () => {
    expect(FEATURES.find(feature => feature.key === "sitecore_pricing")?.label).toBe("Suite Pricing");
    expect(isFeatureKey("sitecore_pricing")).toBe(true);
    for (const path of ["/sitecore-pricing", "/sitecore-pricing/history", "/api/sitecore/pricing", "/api/sitecore/pricing/export"]) expect(featureForPath(path)).toBe("sitecore_pricing");
    expect(featureForPath("/api/sitecore/residence-selector")).toBeUndefined();
    expect(featureForPath("/sitecore-pricing-other")).toBeUndefined();
  });
  it.each([undefined, null, {}, [], false, { sitecore_pricing: false }, { sitecore_pricing: "true" }, { performance: true }])("requires an explicit Content Team grant: %j", feature_access => {
    expect(hasFeatureAccess({ level: 2, feature_access }, "sitecore_pricing")).toBe(false);
  });
  it("permits granted Content Team users and always permits admins", () => {
    expect(hasFeatureAccess({ level: 2, feature_access: { sitecore_pricing: true } }, "sitecore_pricing")).toBe(true);
    expect(hasFeatureAccess({ level: 1, feature_access: { sitecore_pricing: false } }, "sitecore_pricing")).toBe(true);
    expect(hasFeatureAccess({ level: 1 }, "sitecore_pricing")).toBe(true);
  });
  it("keeps Basic users ineligible even with a stored grant", () => {
    expect(featureAllowsLevel("sitecore_pricing", 3)).toBe(false);
    expect(hasFeatureAccess({ level: 3, feature_access: { sitecore_pricing: true } }, "sitecore_pricing")).toBe(false);
    expect(hasFeatureAccess(null, "sitecore_pricing")).toBe(false);
  });
  it("keeps other features independent", () => {
    const profile = { level: 3, feature_access: { performance: true, ai_visibility: true, sitecore_pricing: false } };
    expect(hasFeatureAccess(profile, "performance")).toBe(true); expect(hasFeatureAccess(profile, "ai_visibility")).toBe(true);
    expect(featureForPath("/api/performance")).toBe("performance"); expect(featureForPath("/chartwell-geo")).toBe("ai_visibility");
  });
});
