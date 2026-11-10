export const FEATURES = [
  { key: "performance", label: "Performance", paths: ["/chartwell-website-performance", "/api/performance"] },
  { key: "ai_visibility", label: "AI Visibility", paths: ["/chartwell-geo", "/api/geo"] },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
export type FeatureProfile = { level: number; feature_access?: unknown };

export function isFeatureKey(value: unknown): value is FeatureKey {
  return FEATURES.some((feature) => feature.key === value);
}

// Only an explicit grant enables a feature; admins always retain access.
export function hasFeatureAccess(profile: FeatureProfile | null | undefined, feature: FeatureKey): boolean {
  if (profile?.level === 1) return true;
  const access = profile?.feature_access;
  return typeof access === "object" && access !== null && !Array.isArray(access)
    && (access as Record<string, unknown>)[feature] === true;
}

export function featureForPath(path: string): FeatureKey | undefined {
  return FEATURES.find((feature) => feature.paths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)))?.key;
}
