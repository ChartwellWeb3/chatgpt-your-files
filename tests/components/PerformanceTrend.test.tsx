import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PerformanceTrend } from "@/app/chartwell-website-performance/performance-trend";
import { fetchPerformance } from "@/lib/performance-client";
import type { PerformancePayload, PerformanceRun } from "@/lib/performance";

vi.mock("@/lib/performance-client", () => ({ fetchPerformance: vi.fn() }));
vi.mock("recharts", () => ({
  ResponsiveContainer: () => <div aria-label="Performance chart"/>,
  Area: () => null, AreaChart: () => null, CartesianGrid: () => null,
  Tooltip: () => null, XAxis: () => null, YAxis: () => null,
}));
const run: PerformanceRun = { id: "current-run", deployment_id: "3", device: "mobile", status: "complete", upload_status: "ready", profile_fingerprint: "profile", created_at: "2026-10-26T12:00:00Z" };
const payload: PerformancePayload = { deployments: [3, 2, 1].map((n) => ({ id: String(n), environment: "qa", source_build_number: String(n), source_branch: null, source_build_url: null, source_finished_at: null, commit_sha: null, deployment_url: null, deployment_changes: null, created_at: `2026-10-${22 + n}T12:00:00Z` })), deployment: null, runs: [run], historyRuns: [], pages: [], historyPages: [], commits: [] };
const points = [34, 34, 38].map((value, n) => ({ deploymentId: String(n + 1), runId: `run-${n}`, date: `2026-10-${23 + n}T12:00:00Z`, build: String(n + 1), value, includedPages: 1, totalPages: 1 }));
let client: QueryClient;
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PerformanceTrend payload={payload} selectedRuns={{ mobile: run }}/></QueryClientProvider>);
}
afterEach(() => { cleanup(); client?.clear(); });
describe("performance trend presentation", () => {
  it("shows the latest available score and values without trust statuses", async () => {
    vi.mocked(fetchPerformance).mockResolvedValue({ points });
    mount();
    await screen.findByText("38", {}, { timeout: 5000 });
    expect(screen.getByText("3 of 3 deployments · one point per deployment")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View values" }));
    expect(screen.getAllByText("34")).toHaveLength(2);
    expect(screen.queryByText("Trust status")).not.toBeInTheDocument();
    expect(screen.queryByText(/trusted|inconsistent|excluded/i)).not.toBeInTheDocument();
  });
  it("keeps missing results as dashes without a visible status column", async () => {
    vi.mocked(fetchPerformance).mockResolvedValue({ points: [points[0], { ...points[1], value: null, reason: "Audit or ingestion incomplete" }, points[2]] });
    mount();
    await screen.findByText("38", {}, { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: "View values" }));
    expect(screen.getByTitle("Audit or ingestion incomplete")).toHaveTextContent("—");
    expect(screen.queryByText("Audit or ingestion incomplete")).not.toBeInTheDocument();
  });
});
