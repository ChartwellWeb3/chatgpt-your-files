import { comparisonLabel, isNoisy, pageComparison, type PerformancePage } from "@/lib/performance";

export function statusTone(value?: string | null): "ok" | "muted" | "danger" | "warning" {
  const text = value ?? "";
  if (/fail|error|regress/i.test(text)) return "danger";
  if (/partial|pending|noisy|inconsistent|unavailable|rollback|diverg/i.test(text)) return "warning";
  if (/complete|ready|stable|forward|improv/i.test(text)) return "ok";
  return "muted";
}
export const safeLink = (value?: string | null) => value && /^https?:\/\//i.test(value) ? value : undefined;

export function consistencyLabel(page: PerformancePage) {
  const noisy = isNoisy(page);
  return noisy === true ? "Inconsistent" : noisy === false ? "Consistent" : "Not reported";
}

export function consistencyDescription(page: PerformancePage) {
  const noisy = isNoisy(page);
  if (noisy === true) return "The pipeline flagged large differences between repeated Lighthouse samples. This measurement is excluded from trusted trends and score changes.";
  if (noisy === false) return "The repeated Lighthouse samples passed the pipeline's consistency check.";
  return "The pipeline did not report whether the repeated samples were consistent. This measurement is excluded from trusted trends.";
}

export function comparisonDisplayLabel(page: PerformancePage) {
  if (isNoisy(page) === true) return "Not compared";
  const comparison = pageComparison(page);
  if (comparison?.firstBaseline) return "First baseline";
  if (/insufficient data/i.test(comparison?.classification ?? "")) return "No comparison yet";
  return comparisonLabel(comparison);
}

export function comparisonDescription(page: PerformancePage) {
  const comparison = pageComparison(page);
  if (comparison?.reason) return comparison.reason;
  if (isNoisy(page) === true) return "The samples were flagged as inconsistent. No trusted score change is shown for this measurement. The pipeline did not record a more specific comparison reason.";
  if (comparison?.firstBaseline) return "This measurement establishes the first baseline for this page, device and profile. A later compatible deployment is needed to calculate a change.";
  if (/insufficient data/i.test(comparison?.classification ?? "")) {
    return comparison?.baselineId || comparison?.baselineDeploymentId
      ? "A baseline was recorded, but the pipeline did not produce a trusted comparison. No more specific reason was stored."
      : "No compatible baseline was recorded for this page, device and measurement profile. A score change cannot be calculated yet.";
  }
  return comparison?.classification ? "This is the comparison stored by the pipeline for the recorded baseline." : "The pipeline did not store a comparison for this measurement.";
}
