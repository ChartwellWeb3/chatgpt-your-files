// Production dialog regression cases, supplied for later execution.
// Tests/builds are intentionally not run for this task.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PricingDashboard from "@/app/sitecore-pricing/pricing-dashboard";
let client: QueryClient;
afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals(); });
function setup(options: { diagnostics?: boolean; failed?: boolean; resultPages?: boolean } = {}) {
  const id = "00000000-0000-4000-8000-000000000001";
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://manager.test");
    const environment = url.searchParams.get("environment") || "dev";
    const job = { id, filename: "tracker.xlsx", created_at: "2026-11-17T12:00:00Z", environment, target_host: `https://${environment}.test`, config_hash: "hash", status: options.failed ? "failed" : options.diagnostics || options.resultPages ? "completed" : "uploaded", execution_mode: "edge_auto", error_message: options.diagnostics ? "Private job diagnostic" : null };
    const allRows = options.resultPages ? Array.from({ length: 52 }, (_, index) => ({ id: `row-${index}`, row_number: index + 10, language: "en", status: index % 2 ? "applied" : "invalid", source: { propertyId: "11295", residence: `Residence ${index + 1}`, careLevel: "il", suiteTitle: "1bed", values: {}, warnings: [] }, message: "" })) : options.diagnostics ? [{ id: "row", row_number: 10, language: "en", status: "invalid", source: { propertyId: "11295", residence: "Example residence", careLevel: "th", suiteTitle: "townhouse-1bed-2beds", values: {}, warnings: ["Private row warning"] }, message: "Private row diagnostic" }] : [];
    const filteredRows = url.searchParams.get("status") ? allRows.filter(row => row.status === url.searchParams.get("status")) : allRows;
    const page = Number(url.searchParams.get("page") || 0);
    const rows = filteredRows.slice(page * 25, (page + 1) * 25);
    const value = init?.method === "POST" ? (init.body instanceof FormData ? { id } : { saved: true })
      : url.searchParams.get("view") === "import" ? { job, counts: options.resultPages ? { invalid: 26, applied: 26 } : options.diagnostics ? { invalid: 1 } : {}, rows, developerCount: options.diagnostics ? 1 : 0, total: filteredRows.length, pageSize: 25 }
      : { setup: { ready: true, host: `https://${environment}.test`, configHash: "hash" }, jobs: options.diagnostics || options.resultPages ? [job] : [] };
    return { ok: true, json: async () => value } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  render(<QueryClientProvider client={client}><PricingDashboard /></QueryClientProvider>);
  const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
  return { user: userEvent.setup(), fetchMock, posts };
}
async function selectProduction(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Sitecore environment"), "prod");
  await user.click(await screen.findByRole("button", { name: "Use PROD" }));
  await screen.findByText("Target: https://prod.test");
}
describe("pricing environment selection and production dialogs", () => {
  it.each([false, true])("hides all issue/warning displays while keeping truthful import status (failed=%s)", async failed => {
    setup({ diagnostics: true, failed });
    await screen.findByText("Example residence");
    expect(screen.getByRole("columnheader", { name: "Result" })).toBeInTheDocument();
    expect(screen.getByText("Needs correction")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Developers/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Issue \/ warning|with issues or warnings|Issues or warnings are available/)).not.toBeInTheDocument();
    for (const message of ["Private job diagnostic", "Private row warning", "Private row diagnostic"]) expect(screen.queryByText(message)).not.toBeInTheDocument();
    if (failed) expect(screen.getAllByText("Stopped — needs attention").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Download report" })).toBeInTheDocument();
  });
  it("filters results on the server, resets pagination, and preserves the filter on following pages", async () => {
    const f = setup({ resultPages: true }); await screen.findByText("Residence 1");
    await f.user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Residence 26");
    await f.user.selectOptions(screen.getByLabelText("Filter by result"), "invalid");
    await screen.findByText("Residence 1");
    expect(screen.getByLabelText("Filter by result")).toHaveValue("invalid");
    expect(screen.queryByText("Residence 2")).not.toBeInTheDocument();
    expect(screen.getByText("26 targets · Page 1")).toBeInTheDocument();
    expect(f.fetchMock.mock.calls.some(([url]) => String(url).includes("page=0&status=invalid"))).toBe(true);
    await f.user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Residence 51");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(f.fetchMock.mock.calls.some(([url]) => String(url).includes("page=1&status=invalid"))).toBe(true);
    await f.user.selectOptions(screen.getByLabelText("Filter by result"), "all");
    await screen.findByText("Residence 2"); expect(screen.getByText("52 targets · Page 1")).toBeInTheDocument();
    await f.user.selectOptions(screen.getByLabelText("Filter by result"), "invalid");
    await f.user.selectOptions(screen.getByLabelText("Sitecore environment"), "qa");
    await screen.findByText("Target: https://qa.test");
    await waitFor(() => expect(screen.getByLabelText("Filter by result")).toHaveValue("all"));
    expect(f.posts()).toHaveLength(0);
  });
  it("keeps DEV selected and sends no writes when the production selection is cancelled", async () => {
    const f = setup(); await screen.findByText("Target: https://dev.test");
    await f.user.selectOptions(screen.getByLabelText("Sitecore environment"), "prod");
    const dialog = await screen.findByRole("alertdialog");
    await f.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Sitecore environment")).toHaveValue("dev"); expect(f.posts()).toHaveLength(0);
  });
  it("does not upload or queue PROD work until the workbook run is confirmed", async () => {
    const f = setup(); await screen.findByText("Target: https://dev.test"); await selectProduction(f.user);
    const file = new File(["example"], "tracker.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    await f.user.upload(screen.getByLabelText("Market rate tracker"), file);
    await f.user.click(screen.getByRole("button", { name: "Run" }));
    let dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("tracker.xlsx")).toBeInTheDocument(); expect(f.posts()).toHaveLength(0);
    await f.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(f.posts()).toHaveLength(0);
    await f.user.click(screen.getByRole("button", { name: "Run" }));
    dialog = await screen.findByRole("alertdialog");
    await f.user.click(within(dialog).getByRole("button", { name: "Yes, run on PROD" }));
    await waitFor(() => expect(f.posts()).toHaveLength(2));
    const upload = f.posts()[0][1]?.body as FormData;
    expect(upload.get("environment")).toBe("prod"); expect(upload.get("file")).toBe(file);
    expect(JSON.parse(String(f.posts()[1][1]?.body))).toMatchObject({ environment: "prod", confirmProduction: true, confirmedHost: "https://prod.test", confirmedConfigHash: "hash" });
  });
  it("switches QA history and target without sending any writes", async () => {
    const f = setup(); await screen.findByText("Target: https://dev.test");
    await f.user.selectOptions(screen.getByLabelText("Sitecore environment"), "qa");
    await screen.findByText("Target: https://qa.test");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(); expect(f.posts()).toHaveLength(0);
  });
});
