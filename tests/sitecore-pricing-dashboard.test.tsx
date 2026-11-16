// Production dialog regression cases, supplied for later execution.
// Tests/builds are intentionally not run for this task.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PricingDashboard from "@/app/sitecore-pricing/pricing-dashboard";
let client: QueryClient;
afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals(); });
function setup() {
  const id = "00000000-0000-4000-8000-000000000001";
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://manager.test");
    const environment = url.searchParams.get("environment") || "dev";
    const value = init?.method === "POST" ? (init.body instanceof FormData ? { id } : { saved: true })
      : url.searchParams.get("view") === "import" ? { job: { id, filename: "tracker.xlsx", environment, target_host: `https://${environment}.test`, config_hash: "hash", status: "uploaded", execution_mode: "edge_auto" }, counts: {}, rows: [], developerCount: 0, total: 0, pageSize: 25 }
      : { setup: { ready: true, host: `https://${environment}.test`, configHash: "hash" }, jobs: [] };
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
