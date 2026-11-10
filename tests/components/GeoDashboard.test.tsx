import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { geoFetch, geoWrite } from "@/lib/geo/client";
import GeoDashboard from "@/app/chartwell-geo/geo-dashboard";
import { AnswerText } from "@/app/chartwell-geo/geo-evidence";
import { MappingReviewPanel } from "@/app/chartwell-geo/geo-mapping-review";
import type { MappingReview, ReviewedEvidence } from "@/lib/geo/types";
import { geoBootstrap, geoDashboard, geoEvidence, geoId, geoOverview, geoQuestion, geoRun } from "../fixtures/geo";

vi.mock("@/lib/geo/client", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/geo/client")>(), geoFetch: vi.fn(), geoWrite: vi.fn() }));
vi.mock("recharts", () => ({ ResponsiveContainer: () => <div aria-label="chart"/>, LineChart: () => null, Line: () => null, CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null }));
let bootstrap = structuredClone(geoBootstrap);
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><GeoDashboard environment="qa"/></QueryClientProvider>);
}
async function tab(name: string) {
  const button = await screen.findByRole("tab", { name }); fireEvent.mouseDown(button, { button: 0, ctrlKey: false });
}
describe("GEO dashboard workflows", () => {
  beforeEach(() => {
    bootstrap = structuredClone(geoBootstrap);
    vi.mocked(geoFetch).mockImplementation(async (params = {}) => {
      if (params.view === "catalogs") return bootstrap as never;
      if (params.view === "live") return { level: bootstrap.level, counts: bootstrap.counts, worker: bootstrap.worker, schedules: bootstrap.benchmarks.map(({ id, schedule_enabled, next_scheduled_at }) => ({ id, schedule_enabled, next_scheduled_at })), activity: { monitoring: false, tests: false } } as never;
      if (params.view === "schedule") return { lastBatch: null } as never;
      if (params.view === "dashboard") return geoDashboard as never;
      if (params.view === "overview") return geoOverview as never;
      if (params.view === "competitors") return { rows: geoDashboard.overall, samples: 3 } as never;
      if (params.view === "sources") return { sources: [] } as never;
      if (params.view === "questionMetrics") return { rows: [{ ...geoQuestion, metrics: { samples: 4, mentions: 3, all_mentions: 12, visibility_rate: 0.75, share_of_voice: 0.25 } }], total: 1, page: 0, pageSize: 10 } as never;
      if (params.view === "runs") return { rows: [geoRun], total: 1, page: 0, pageSize: 10 } as never;
      if (params.view === "evidence") return geoEvidence as never;
      if (["opportunities", "batches", "tests", "validation", "reviews", "mappingReviews"].includes(String(params.view))) return { rows: [], total: 0, page: 0, pageSize: 10, answerCount: 3 } as never;
      return {} as never;
    });
    vi.mocked(geoWrite).mockResolvedValue({});
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
  });
  afterEach(() => cleanup());
  it("browses question topics and markets and displays server-calculated metrics", async () => {
    const user = userEvent.setup(); mount(); await tab("Questions");
    expect(await screen.findByText("75.0%")).toBeInTheDocument();
    expect(screen.getByText("25.0%")).toBeInTheDocument();
    expect(screen.getByText("3 of 4 completed answers mention Chartwell.")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Question topic" }), geoId(2));
    await user.selectOptions(screen.getByRole("combobox", { name: "Question market" }), geoId(3));
    await waitFor(() => expect(geoFetch).toHaveBeenCalledWith(expect.objectContaining({ view: "questionMetrics", topicId: geoId(2), marketId: geoId(3), page: 0, questionKind: "all" }), expect.any(AbortSignal)));
    expect(screen.getByRole("button", { name: "Run all approved questions (1)" })).toBeInTheDocument();
  });
  it("lets a basic user view a question's completed answers and open saved evidence", async () => {
    bootstrap.level = 3;
    const user = userEvent.setup(); mount(); await tab("Questions");
    await user.click(await screen.findByRole("button", { name: `View answers for ${geoQuestion.question}` }));
    await waitFor(() => expect(geoFetch).toHaveBeenCalledWith(expect.objectContaining({ view: "runs", questionId: geoQuestion.id, questionRevision: geoQuestion.revision, status: "succeeded", benchmarkId: geoId(10) }), expect.any(AbortSignal)));
    expect(screen.getByRole("region", { name: "Selected question answers" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "View answer" }));
    expect(await screen.findByRole("dialog", { name: "Answer details" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close evidence" }));
    await user.click(screen.getByRole("button", { name: "Clear question filter" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Selected question answers" })).not.toBeInTheDocument());
  });
  it("opens the question library from an Overview topic", async () => {
    const original = vi.mocked(geoFetch).getMockImplementation()!;
    vi.mocked(geoFetch).mockImplementation(async (params, signal) => params?.view === "overview"
      ? { ...geoOverview, topics: [{ ...geoDashboard.overall[0], key: geoId(2), label: "Memory Care" }] } as never
      : original(params, signal));
    const user = userEvent.setup(); mount();
    await user.click(await screen.findByRole("button", { name: "View questions for Memory Care" }));
    await waitFor(() => expect(geoFetch).toHaveBeenCalledWith(expect.objectContaining({ view: "questionMetrics", topicId: geoId(2), marketId: "" }), expect.any(AbortSignal)));
    expect(screen.getByRole("combobox", { name: "Question topic" })).toHaveValue(geoId(2));
  });
  it.each([false, true])("shows paused test evidence and gates ownership verification to admins (%s)", async isAdmin => {
    const item: MappingReview = { id: geoId(60), environment: "qa", run_id: geoRun.id, attempt_id: geoId(30), mention_index: 0,
      observed_name: "Example House", proposed_brand_id: geoId(4), proposed_brand_name: "Chartwell", evidence_quote: "Example House",
      status: "pending", verified_brand_id: null, verified_brand_name: null, reference_url: null, verification_notes: null, verified_at: null,
      created_at: "2026-11-10T14:00:00Z", question_snapshot: geoRun.question_snapshot, purpose: "test", run_status: "needs_review" };
    const data: ReviewedEvidence = { ...geoEvidence, run: { ...geoRun, status: "needs_review", purpose: "test", selected_attempt_id: null }, mappingReviews: [item] };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MappingReviewPanel data={data} environment="qa" brands={bootstrap.brands} isAdmin={isAdmin}/></QueryClientProvider>);
    expect(screen.getByText("This test remains excluded from reporting.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Example House", { selector: "dd" })).toBeInTheDocument();
    if (!isAdmin) {
      expect(screen.queryByRole("button", { name: "Verify relationship" })).not.toBeInTheDocument();
      expect(screen.getByText("Administrator verification required.")).toBeInTheDocument();
      expect(geoWrite).not.toHaveBeenCalled();
    } else {
      const user = userEvent.setup();
      const button = screen.getByRole("button", { name: "Verify relationship" });
      expect(button).toBeDisabled();
      await user.type(screen.getByRole("textbox", { name: "Ownership reference URL for Example House" }), "https://operator.example/community");
      await user.click(screen.getByRole("checkbox"));
      await user.click(button);
      await waitFor(() => expect(geoWrite).toHaveBeenCalledWith(expect.objectContaining({ action: "verifyMapping", reviewId: geoId(60), brandId: geoId(4), confirmed: true })));
    }
  });
  it("shows a single reporting dataset without the old source switch", async () => {
    mount(); expect(await screen.findByText("66.7%")).toBeInTheDocument();
    expect(screen.queryByText("#2.0")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Average rank" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "In the top 3" })).not.toBeInTheDocument();
    expect(geoFetch).toHaveBeenCalledWith(expect.objectContaining({ view: "overview", questionKind: "unbranded" }), expect.any(AbortSignal));
    expect(screen.queryByRole("radio", { name: "Scheduled answers only" })).not.toBeInTheDocument();
  });
  it("keeps discovery metrics separate from the answer validation workflow", async () => {
    const user = userEvent.setup(); mount();
    expect(await screen.findByText("66.7%")).toBeInTheDocument();
    expect(screen.queryByText("Chartwell mention rate in branded answers")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Question type filter" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Answer validation" })).toBeInTheDocument();
    await waitFor(() => expect(geoFetch).toHaveBeenCalledWith(expect.objectContaining({ view: "validation", questionKind: "branded", reviewStatus: "unreviewed" }), expect.any(AbortSignal)));
    expect(screen.queryByRole("combobox", { name: "Questions to validate" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View discovery answers" }));
    await waitFor(() => expect(geoFetch).toHaveBeenCalledWith(expect.objectContaining({ view: "runs", questionKind: "unbranded" }), expect.any(AbortSignal)));
  });
  it("lets the content team exclude an approved question from Monday collection", async () => {
    const user = userEvent.setup(); mount(); await tab("Questions");
    const checkbox = await screen.findByRole("checkbox", { name: `Include in Monday collection: ${geoQuestion.question}` });
    expect(checkbox).toBeChecked();
    vi.mocked(geoFetch).mockClear();
    await user.click(checkbox);
    await waitFor(() => expect(geoWrite).toHaveBeenCalledWith(expect.objectContaining({ action: "questionSchedule", id: geoQuestion.id, revision: geoQuestion.revision, enabled: false }), false));
    await waitFor(() => expect(geoFetch).toHaveBeenCalledWith(expect.objectContaining({ view: "live" }), expect.any(AbortSignal)));
    expect(vi.mocked(geoFetch).mock.calls.some(([params]) => ["catalogs", "overview", "competitors", "sources"].includes(String(params?.view)))).toBe(false);
  });
  it("fetches only the visible reporting tab's response", async () => {
    mount(); await screen.findByText("66.7%");
    vi.mocked(geoFetch).mockClear();
    await tab("Competitors");
    await waitFor(() => expect(geoFetch).toHaveBeenCalledWith(expect.objectContaining({ view: "competitors" }), expect.any(AbortSignal)));
    expect(vi.mocked(geoFetch).mock.calls.some(([params]) => ["catalogs", "overview", "dashboard", "sources"].includes(String(params?.view)))).toBe(false);
    await tab("Sources");
    await waitFor(() => expect(geoFetch).toHaveBeenCalledWith(expect.objectContaining({ view: "sources" }), expect.any(AbortSignal)));
    expect(vi.mocked(geoFetch).mock.calls.some(([params]) => params?.view === "dashboard")).toBe(false);
  });
  it("allows basic users to inspect questions while hiding management actions", async () => {
    bootstrap.level = 3; mount(); await tab("Questions");
    expect(await screen.findByText(geoQuestion.question)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add question" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Setup" })).not.toBeInTheDocument();
  });
  it("saves a new question as a draft with selected tags", async () => {
    const user = userEvent.setup(); mount(); await tab("Questions");
    await user.click(await screen.findByRole("button", { name: "Add question" }));
    await user.type(screen.getByRole("textbox", { name: /^Question$/ }), "How can I compare retirement homes in Ontario?");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(geoWrite).toHaveBeenCalledWith(expect.objectContaining({ action: "saveQuestion", question: "How can I compare retirement homes in Ontario?", language: "en", topic_id: geoId(2), market_id: geoId(5) }), false));
  });
  it("runs an approved question and opens its saved evidence", async () => {
    const user = userEvent.setup(); vi.mocked(geoWrite).mockResolvedValue({ runId: geoId(20), status: "succeeded" });
    mount(); await tab("Questions"); await user.click(await screen.findByRole("button", { name: "Run now" }));
    expect(await screen.findByRole("dialog", { name: "Answer details" })).toBeInTheDocument();
    expect(geoWrite).toHaveBeenCalledWith(expect.objectContaining({ action: "runNow", benchmarkId: geoId(10), questionId: geoId(1), requestKey: expect.any(String) }), true);
    expect(screen.getByText("No numbered rank")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Factual answer review" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close evidence" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("prevents queue submission until the dispatcher is activated", async () => {
    bootstrap.worker.dispatcher_enabled = false; mount();
    await tab("Questions");
    expect(await screen.findByRole("button", { name: "Run now" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Test" })).toBeDisabled();
  });
  it("queues a preview as a test rather than a reporting answer", async () => {
    const user = userEvent.setup(); vi.mocked(geoWrite).mockResolvedValue({ runId: geoId(20), purpose: "test", status: "queued" });
    mount(); await tab("Questions"); await user.click(await screen.findByRole("button", { name: /^Test$/ }));
    await waitFor(() => expect(geoWrite).toHaveBeenCalledWith(expect.objectContaining({ action: "test", questionId: geoId(1) }), true));
    expect(await screen.findByRole("dialog", { name: "Answer details" })).toBeInTheDocument();
  });
  it("shows API failures without replacing them with fake metrics", async () => {
    vi.mocked(geoFetch).mockRejectedValue(new Error("GEO database setup is incomplete.")); mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("GEO database setup is incomplete.");
    expect(screen.queryByText("66.7%")).not.toBeInTheDocument();
  });
  it("renders provider citations as safe clickable inline links", () => {
    render(<AnswerText text="Chartwell [1]" sources={geoEvidence.sources}/>);
    expect(screen.getByRole("link", { name: "[1]" })).toHaveAttribute("href", "https://chartwell.com/");
    cleanup(); render(<AnswerText text="Chartwell [1]" sources={[{ ...geoEvidence.sources[0], url: "javascript:alert(1)" }]}/>);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
