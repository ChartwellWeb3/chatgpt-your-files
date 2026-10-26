import { describe, expect, it } from "vitest";
import about from "../fixtures/performance/about.json";
import summary from "../fixtures/performance/summary.json";
import { comparisonLabel, deploymentCommits, formatBytes, formatDate, formatMetric, metricValue, pageRange, runSummary, scoreDelta, type PageResult, type PerformanceDeployment, type PerformancePage, type PerformanceRun } from "@/lib/performance";

const page: PerformancePage = { run_id: "mobile-current", page_id: "about", page_name: "About us", page_path: "/about-us", locale: "en", status: "complete", performance_score: null, lcp_ms: null, tbt_ms: null, cls: null, fcp_ms: null, speed_index_ms: null, noisy: false, result: about as PageResult };
const deployment = (id: string, date: string): PerformanceDeployment => ({ id, created_at: date, source_finished_at: date, source_build_number: id, source_branch: "cw-dev", source_build_url: null, commit_sha: null, deployment_url: null, environment: "dev", deployment_changes: null });
const run = (id: string, deploymentId = "new", overrides: Partial<PerformanceRun> = {}): PerformanceRun => ({ id, deployment_id: deploymentId, device: "mobile", status: "complete", upload_status: "ready", profile_fingerprint: "profile-a", created_at: "2026-10-21T19:00:00Z", ...overrides });

describe("performance dashboard data", () => {
  it("reads the real aggregate keys, ranges, and first baseline without fabricating a delta", () => {
    expect(metricValue(page, "score")).toBe(87);
    expect(formatMetric("lcp", metricValue(page, "lcp"))).toBe("980 ms");
    expect(formatMetric("speedIndex", metricValue(page, "speedIndex"))).toBe("1.41 s");
    expect(formatMetric("cls", metricValue(page, "cls"))).toBe("0.009");
    expect(pageRange(page)?.score).toEqual({ min: 85, max: 88 });
    expect(comparisonLabel(about.comparison)).toBe("First baseline");
    expect(scoreDelta(about.comparison)).toBeNull();
    expect(formatBytes(about.insights[0].estimatedSavingsBytes)).toBe("570.0 KB");
  });
  it("retains real zero values and formats score changes as absolute points", () => {
    expect(formatMetric("tbt", 0)).toBe("0 ms");
    expect(formatMetric("cls", 0)).toBe("0.000");
    expect(formatMetric("score", 0)).toBe("0");
    expect(formatMetric("score", null)).toBe("—");
    expect(scoreDelta({ metrics: { score: { delta: -5, percent: -10 } } })).toBe(-5);
    expect(scoreDelta({ metrics: { score: { percent: 10 } } })).toBeNull();
  });
  it("computes one selected attempt per device, excludes noisy/missing scores, and never averages reruns", () => {
    const current = run("mobile-current");
    const result = runSummary(current, [page, { ...page, run_id: "older-attempt", performance_score: 100 }, { ...page, page_id: "noisy", noisy: true, performance_score: 2 }]);
    expect(result.score).toBe(87);
    expect(result.total).toBe(2);
    expect(result.noisy).toBe(1);
    expect(runSummary({ ...current, status: "failed" }, [page]).score).toBeNull();
    expect(runSummary({ ...current, upload_status: "pending" }, [page]).score).toBeNull();
  });
  it("uses embedded deployment_changes and deduplicates normalized commit rows", () => {
    const dep = { ...deployment("new", "2026-10-21T16:00:00Z"), deployment_changes: summary.deploymentChanges };
    const embedded = deploymentCommits(dep, [], "added");
    expect(embedded).toHaveLength(3);
    expect(embedded[1].short_sha).toBe("c09dc901");
    expect(embedded[1].message).toContain("Co-authored-by");
    expect(deploymentCommits(dep, [embedded[0]], "added")).toHaveLength(3);
    expect(deploymentCommits(dep, [], "removed")).toEqual([]);
  });
  it("shows Toronto dates and handles invalid timestamps gracefully", () => {
    expect(formatDate("2026-10-21T19:23:31Z")).toContain("3:23 p.m.");
    expect(formatDate("invalid")).toBe("—");
  });
});
