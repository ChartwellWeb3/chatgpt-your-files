export type Device = "mobile" | "desktop";
export type PerformanceEnvironment = "qa" | "prod";
export type MetricKey = "score" | "lcp" | "tbt" | "cls" | "fcp" | "speedIndex";
export type Metrics = Partial<Record<MetricKey, number | null>>;
export type MetricRanges = Partial<Record<MetricKey, { min?: number | null; max?: number | null }>>;
export type Insight = { id?: string; title: string; estimatedSavingsMs?: number | null; estimatedSavingsBytes?: number | null };
export type Comparison = {
  classification?: string; baselineId?: string | null; baselineDeploymentId?: string | null;
  firstBaseline?: boolean; reason?: string;
  metrics?: Record<string, unknown>; metricDeltas?: Record<string, unknown>; scoreDelta?: number;
};
export type PageResult = {
  id?: string; name?: string; path?: string; url?: string; locale?: string; status?: string;
  identity?: { path?: string; site?: string; title?: string; itemId?: string; language?: string };
  aggregate?: { metrics?: Metrics; range?: MetricRanges; noisy?: boolean };
  insights?: Insight[]; comparison?: Comparison; representativeRun?: number | string;
  runs?: { metrics?: Metrics; insights?: Insight[]; fetchedAt?: string; htmlPath?: string; jsonPath?: string }[];
};
export type PerformancePage = {
  run_id: string; page_id: string; page_name: string; page_path: string; locale: string | null;
  status: string; performance_score: number | null; lcp_ms: number | null; tbt_ms: number | null;
  cls: number | null; fcp_ms: number | null; speed_index_ms: number | null;
  noisy: boolean | null; error_message?: string | null; result?: PageResult;
  aggregate?: PageResult["aggregate"]; comparison?: Comparison; insights?: Insight[]; identity?: PageResult["identity"];
};
export type PerformanceRun = {
  id: string; deployment_id: string; device: Device; status: string; upload_status: string;
  monitoring_build_id?: string | null; monitoring_build_url?: string | null; report_artifact_name?: string | null;
  profile_fingerprint: string | null; started_at?: string | null; finished_at?: string | null;
  error_message?: string | null; created_at: string;
};
export type DeploymentIdentity = { url?: string; commit?: string; shortSha?: string; buildId?: string; buildNumber?: string; finishedAt?: string };
export type ChangeCommit = { sha: string; shortSha?: string; message: string; author?: string; authoredAt?: string; url?: string };
export type DeploymentChanges = {
  status?: string; reason?: string; relation?: string; current?: DeploymentIdentity; previous?: DeploymentIdentity;
  commits?: ChangeCommit[]; removedCommits?: ChangeCommit[]; comparisonUrl?: string;
  repository?: { id?: string; name?: string; url?: string };
};
export type PerformanceDeployment = {
  id: string; environment: string; source_build_number: string | null; source_branch: string | null;
  source_build_url: string | null; source_finished_at: string | null; commit_sha: string | null;
  vercel_deployment_id?: string | null; deployment_url: string | null; base_url?: string | null;
  deployment_changes: DeploymentChanges | null; created_at: string;
};
export type PerformanceCommit = { deployment_id: string; commit_sha: string; short_sha: string; message: string; author: string | null; authored_at: string | null; azure_url: string | null; direction: string; position: number };
export type RunSummary = {
  mode?: string; status?: string; profile?: string; environment?: string; deviceProfile?: string;
  measurementId?: string; monitoringBuildId?: string; profileFingerprint?: string;
  startedAt?: string; finishedAt?: string; aliasVerifiedAt?: string;
  deployment?: { id?: string; url?: string; alias?: string; commit?: string; buildId?: string; buildUrl?: string };
  toolchain?: Record<string, string>;
  measurement?: {
    numberOfRuns?: number; variability?: { scoreRange?: number; lcpRelativeRange?: number };
    thresholds?: Partial<Record<MetricKey, { absolute?: number; percent?: number }>>;
    settings?: { formFactor?: string; throttlingMethod?: string; maxWaitForLoad?: number; disableStorageReset?: boolean;
      throttling?: { rttMs?: number; throughputKbps?: number; cpuSlowdownMultiplier?: number };
      screenEmulation?: { width?: number; height?: number; deviceScaleFactor?: number; mobile?: boolean };
      onlyCategories?: string[]; blockedUrlPatterns?: string[];
    };
  };
  pageSelection?: { mode?: string; selectedIds?: string[]; configuredCount?: number };
  authentication?: { mode?: string }; storage?: { mode?: string; status?: string };
};
export type PerformancePayload = {
  deployments: PerformanceDeployment[]; deployment: PerformanceDeployment | null; runs: PerformanceRun[];
  pages: PerformancePage[]; commits: PerformanceCommit[]; commitsUnavailable?: boolean;
  historyRuns: PerformanceRun[]; historyPages: PerformancePage[]; warnings?: string[];
};

export const METRICS: { key: MetricKey; label: string; column: keyof PerformancePage; description: string }[] = [
  { key: "score", label: "Score", column: "performance_score", description: "Lighthouse performance score" },
  { key: "lcp", label: "LCP", column: "lcp_ms", description: "Largest contentful paint" },
  { key: "tbt", label: "TBT", column: "tbt_ms", description: "Total blocking time" },
  { key: "cls", label: "CLS", column: "cls", description: "Cumulative layout shift · unitless" },
  { key: "fcp", label: "FCP", column: "fcp_ms", description: "First contentful paint" },
  { key: "speedIndex", label: "Speed index", column: "speed_index_ms", description: "Speed index" },
];
export const finite = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
export function metricValue(page: PerformancePage, key: MetricKey) {
  const column = METRICS.find((metric) => metric.key === key)!.column;
  return finite(page[column]) ?? finite((page.aggregate ?? page.result?.aggregate)?.metrics?.[key]);
}
export function formatMetric(key: MetricKey, value: unknown, signed = false) {
  const n = finite(value);
  if (n === null) return "—";
  const prefix = signed && n > 0 ? "+" : "";
  if (key === "score") return prefix + n.toLocaleString("en-CA", { maximumFractionDigits: signed ? 1 : 0 });
  if (key === "cls") return prefix + n.toFixed(3);
  return prefix + (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`);
}
export function formatBytes(value: unknown) { const n = finite(value); return n === null ? "—" : n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${Math.round(n)} B`; }
export function formatDate(value?: string | null, dateOnly = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("en-CA", dateOnly ? { month: "short", day: "numeric", timeZone: "America/Toronto" } : { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date(value)) + (dateOnly ? "" : " ET");
}
export function pageIdentity(page: PerformancePage) {
  const identity = page.identity ?? page.result?.identity;
  return JSON.stringify([page.page_id, page.page_path, page.locale ?? "", identity?.site ?? "", identity?.itemId ?? ""]);
}
export const pageRowId = (page: PerformancePage) => JSON.stringify([page.run_id, page.page_id, page.page_path, page.locale]);
export const pageComparison = (page: PerformancePage) => page.comparison ?? page.result?.comparison;
export const pageRange = (page: PerformancePage) => (page.aggregate ?? page.result?.aggregate)?.range;
export const isNoisy = (page: PerformancePage) => page.noisy ?? (page.aggregate ?? page.result?.aggregate)?.noisy;
export function comparisonLabel(comparison?: Comparison) {
  if (comparison?.firstBaseline) return "First baseline";
  return comparison?.classification || "Not compared";
}
export function scoreDelta(comparison?: Comparison) {
  const metric = comparison?.metrics?.score;
  const explicit = metric && typeof metric === "object" ? finite((metric as Record<string, unknown>).delta) : null;
  return explicit ?? finite(comparison?.metricDeltas?.score) ?? finite(comparison?.metricDeltas?.performance_score) ?? finite(comparison?.scoreDelta);
}
export function isRegression(page: PerformancePage) { return /regress/i.test(pageComparison(page)?.classification ?? ""); }
export function runSummary(run: PerformanceRun | undefined, pages: PerformancePage[]) {
  const rows = run ? pages.filter((p) => p.run_id === run.id) : [];
  const complete = rows.filter((p) => p.status === "complete");
  const valid = run?.upload_status === "ready" && run.status !== "failed" ? complete.filter((p) => isNoisy(p) === false && metricValue(p, "score") !== null) : [];
  return { rows, measured: complete.length, total: rows.length, noisy: rows.filter(isNoisy).length, failures: rows.filter((p) => p.status === "failed").length,
    regressions: rows.filter(isRegression).length, score: valid.length ? valid.reduce((sum, p) => sum + metricValue(p, "score")!, 0) / valid.length : null };
}
export type TrendPoint = { deploymentId: string; runId?: string; date: string; build: string; value: number | null; reason?: string };
export function buildTrend(payload: PerformancePayload, target: PerformancePage, device: Device, fingerprint: string, metric: MetricKey, selectedRun?: PerformanceRun): TrendPoint[] {
  const identity = pageIdentity(target);
  return [...payload.deployments].reverse().map((deployment) => {
    const candidates = payload.historyRuns.filter((r) => r.deployment_id === deployment.id && r.device === device).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const run = selectedRun?.deployment_id === deployment.id && selectedRun.device === device ? selectedRun : candidates[0];
    const point: TrendPoint = { deploymentId: deployment.id, runId: run?.id, date: deployment.source_finished_at ?? deployment.created_at, build: deployment.source_build_number ?? deployment.commit_sha?.slice(0, 8) ?? deployment.id.slice(0, 8), value: null };
    if (!run) return { ...point, reason: "No measurement" };
    if (!fingerprint || run.profile_fingerprint !== fingerprint) return { ...point, reason: "Different or unknown measurement profile" };
    if (run.upload_status !== "ready" || run.status !== "complete") return { ...point, reason: "Audit or ingestion incomplete" };
    const page = payload.historyPages.find((p) => p.run_id === run.id && pageIdentity(p) === identity);
    if (!page || page.status !== "complete") return { ...point, reason: "Page not measured successfully" };
    if (isNoisy(page) !== false) return { ...point, reason: isNoisy(page) ? "Inconsistent samples" : "Sample consistency not reported" };
    return { ...point, value: metricValue(page, metric) };
  }).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}
export function deploymentCommits(deployment: PerformanceDeployment, rows: PerformanceCommit[], direction: "added" | "removed"): PerformanceCommit[] {
  const embedded = direction === "added" ? deployment.deployment_changes?.commits : deployment.deployment_changes?.removedCommits;
  const normalized = (embedded ?? []).map((c, position) => ({ deployment_id: deployment.id, commit_sha: c.sha, short_sha: c.shortSha ?? c.sha.slice(0, 8), message: c.message, author: c.author ?? null, authored_at: c.authoredAt ?? null, azure_url: c.url ?? null, direction, position }));
  return Array.from(new Map([...normalized, ...rows.filter((c) => c.direction === direction)].map((c) => [c.commit_sha, c])).values()).sort((a, b) => a.position - b.position);
}
