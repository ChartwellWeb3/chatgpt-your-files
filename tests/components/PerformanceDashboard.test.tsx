import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PerformanceDashboard from "@/app/chartwell-website-performance/performance-dashboard";
import { fetchPerformance } from "@/lib/performance-client";
import type { PerformancePage, PerformancePayload } from "@/lib/performance";

vi.mock("@/lib/performance-client", () => ({ fetchPerformance: vi.fn() }));
vi.mock("@/app/chartwell-website-performance/performance-trend", () => ({ PerformanceTrend: () => <div>Trend</div> }));
vi.mock("@/app/chartwell-website-performance/performance-details", () => ({ PageDetails: () => <div>Page details</div> }));
vi.mock("@/app/chartwell-website-performance/performance-commits", () => ({ DeploymentChangesPanel: () => <div>Commits</div> }));
vi.mock("@/app/chartwell-website-performance/performance-score", () => ({ ScoreRing: ({ value }: { value: number }) => <output aria-label="Device average">{value}</output>, ScoreValue: ({ value }: { value: number }) => <span>{value}</span> }));

const payload: PerformancePayload = {
  deployments: [], deployment: { id: "deployment", environment: "qa", source_build_number: "20261026.2", source_branch: null, source_build_url: null, source_finished_at: null, commit_sha: null, deployment_url: null, deployment_changes: null, created_at: "2026-10-26T12:00:00Z" },
  runs: [{ id: "run", deployment_id: "deployment", device: "mobile", status: "complete", upload_status: "ready", profile_fingerprint: "profile", created_at: "2026-10-26T12:00:00Z" }],
  pages: [], commits: [], historyPages: [], historyRuns: [],
  runSummaries: { run: { total: 20, measured: 20, included: 20, noisy: 0, failures: 0, regressions: 0, score: 72 } },
};
const row: PerformancePage = { run_id: "run", page_id: "home", page_name: "Home", page_path: "/", locale: "en", status: "complete", performance_score: 10, lcp_ms: 1234, tbt_ms: 0, cls: 0, fcp_ms: 1000, speed_index_ms: 1500, noisy: false, available: true, score_delta: -5 };
let client: QueryClient;
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PerformanceDashboard environment="qa"/></QueryClientProvider>);
}
const calls = () => vi.mocked(fetchPerformance).mock.calls.map(([params]) => params);
configure({ asyncUtilTimeout: 5000 });
describe("performance dashboard backend calculations", () => {
  beforeEach(() => {
    vi.mocked(fetchPerformance).mockImplementation(async (params) => {
      if (params.get("view") === "pages") return { pages: [row], total: 20, page: Number(params.get("page")), pageSize: 8 } as never;
      return payload as never;
    });
  });
  afterEach(() => { cleanup(); client?.clear(); });
  it("uses the backend average even though only one low-scoring table row was fetched", async () => {
    mount();
    await screen.findByRole("button", { name: "Open Home mobile details" });
    expect(screen.getAllByLabelText("Device average")[0]).toHaveTextContent("72");
    expect(screen.getByText("-5 pt")).toBeInTheDocument();
    expect(calls().find((params) => params.get("view") === "pages")?.get("runIds")).toBe("run");
  });
  it("requests another backend page and resets pagination when sorting", async () => {
    mount();
    await screen.findByRole("button", { name: "Open Home mobile details" });
    fireEvent.click(screen.getByRole("button", { name: "Next page results" }));
    await waitFor(() => expect(calls().some((params) => params.get("page") === "1")).toBe(true));
    await screen.findByRole("button", { name: "Open Home mobile details" });
    fireEvent.click(screen.getByRole("button", { name: "LCP" }));
    await waitFor(() => expect(calls().some((params) => params.get("sort") === "lcp" && params.get("page") === "0")).toBe(true));
  });
  it("debounces page search and sends it to the backend", async () => {
    mount();
    await screen.findByRole("button", { name: "Open Home mobile details" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search pages" }), { target: { value: "dining" } });
    expect(calls().some((params) => params.get("search") === "dining")).toBe(false);
    await waitFor(() => expect(calls().some((params) => params.get("search") === "dining")).toBe(true));
  });
  it("displays a failed table request as an error rather than an empty table", async () => {
    vi.mocked(fetchPerformance).mockImplementation(async (params) => {
      if (params.get("view") === "pages") throw new Error("Page data unavailable");
      return payload as never;
    });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Page data unavailable");
    expect(screen.queryByText("No pages match these filters")).not.toBeInTheDocument();
  });
});
