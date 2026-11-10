"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, BookOpen, CheckCircle2, ExternalLink, Loader2, Radar, RefreshCw, Settings2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { geoFetch, geoWrite, initialDates, percentage, safeUrl } from "@/lib/geo/client";
import type { Bootstrap, Catalogs, Environment, Filters, Insight, LiveStatus, Metric, OverviewDashboard, Page, Question, Run, SourceSummary } from "@/lib/geo/types";
import { Overview } from "./geo-overview";
import { Guide } from "./geo-guide";
import { Questions } from "./geo-questions";
import { EvidenceDialog } from "./geo-evidence";
import { AnswerValidation } from "./geo-answer-validation";
import { MappingReviewQueue } from "./geo-mapping-review";
import { ResultFilters } from "./geo-filters";
import { BatchProgress, ScheduleControl } from "./geo-monitoring-controls";
import { GettingStarted, MonitoringSetup } from "./geo-setup";
import { GeoMetricLabel, type GeoMetricKey } from "./geo-metric-help";
import { GeoRefreshProvider, invalidateGeoAction, invalidateGeoCompletion, useGeoRefresh, usePageVisible } from "./geo-refresh";
import { dateTime, Empty, ErrorMessage, Loading, Pager, Panel, QuestionKindBadge, runState, SelectField, StateBadge } from "./geo-ui";

const tableHead = "px-5 py-3 text-left text-xs font-medium text-muted-foreground";
const tableCell = "px-5 py-4 text-sm";
const competitorColumns: { label: string; metric?: GeoMetricKey }[] = [
  { label: "Brand" }, { label: "Mention rate", metric: "mentionRate" },
  { label: "Share of mentions", metric: "shareOfMentions" }, { label: "Answers mentioning it", metric: "answersMentioning" },
];
const sourceColumns: { label: string; metric?: GeoMetricKey }[] = [
  { label: "Website" }, { label: "Answers citing it", metric: "cited" },
  { label: "Answers consulting it", metric: "consulted" }, { label: "Unique pages", metric: "pages" },
];
const tabs = [["overview", "Overview"], ["questions", "Questions"], ["runs", "Answers"], ["tests", "Test history"], ["mapping-review", "Mapping review"], ["competitors", "Competitors"], ["sources", "Sources"], ["opportunities", "Opportunities"], ["guide", "Guide"]];

export default function GeoDashboard({ environment }: { environment: Environment }) {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [tab, setTab] = useState("overview");
  const [questionScope, setQuestionScope] = useState({ topicId: "", marketId: "" });
  const [answerQuestion, setAnswerQuestion] = useState<Question | null>(null);
  const [selection, setSelection] = useState<Filters>(() => ({ ...initialDates(), benchmarkId: "", topicId: "", marketId: "", language: "", questionKind: "unbranded" }));
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const visible = usePageVisible();
  const catalogs = useQuery({ queryKey: ["geo", environment, "catalogs"], queryFn: ({ signal }) => geoFetch<Catalogs>({ view: "catalogs" }, signal), staleTime: 300000 });
  const live = useQuery({ queryKey: ["geo", environment, "live"], queryFn: ({ signal }) => geoFetch<LiveStatus>({ view: "live" }, signal),
    refetchInterval: query => !visible ? false : query.state.data?.activity.monitoring || query.state.data?.activity.tests ? 5000 : 60000,
    refetchIntervalInBackground: false, refetchOnMount: "always", staleTime: 10000 });
  const data = useMemo<Bootstrap | undefined>(() => {
    if (!catalogs.data || !live.data) return undefined;
    const schedules = new Map(live.data.schedules.map(row => [row.id, row]));
    return { ...catalogs.data, level: live.data.level, counts: live.data.counts, worker: live.data.worker,
      benchmarks: catalogs.data.benchmarks.map(row => ({ ...row, ...schedules.get(row.id) })) };
  }, [catalogs.data, live.data]);
  const previousActivity = useRef<LiveStatus["activity"] | undefined>(undefined);
  useEffect(() => {
    const activity = live.data?.activity;
    if (!activity) return;
    if (previousActivity.current?.monitoring && !activity.monitoring) void invalidateGeoCompletion(queryClient, environment, true);
    if (previousActivity.current?.tests && !activity.tests) void invalidateGeoCompletion(queryClient, environment, false);
    previousActivity.current = activity;
  }, [live.data?.activity, queryClient, environment]);
  const benchmarkId = selection.benchmarkId || data?.benchmarks[0]?.id || "";
  const filters = { ...selection, benchmarkId };
  const datesValid = Boolean(filters.from && filters.to && filters.from <= filters.to && Date.parse(filters.to) - Date.parse(filters.from) <= 366 * 86400000);
  const overviewFilters = { ...filters, questionKind: "unbranded" };
  const polling = { refetchInterval: !visible ? false as const : live.data?.activity.monitoring ? 15000 : 60000,
    refetchIntervalInBackground: false, staleTime: 15000 };
  const overview = useQuery({
    queryKey: ["geo", environment, "overview", overviewFilters],
    enabled: Boolean(data && benchmarkId && datesValid && tab === "overview"),
    queryFn: ({ signal }) => geoFetch<OverviewDashboard>({ view: "overview", ...overviewFilters }, signal), ...polling,
  });
  const competitors = useQuery({
    queryKey: ["geo", environment, "competitors", filters],
    enabled: Boolean(data && benchmarkId && datesValid && tab === "competitors"),
    queryFn: ({ signal }) => geoFetch<{ rows: Metric[]; samples: number }>({ view: "competitors", ...filters }, signal), ...polling,
  });
  const sources = useQuery({
    queryKey: ["geo", environment, "sources", filters],
    enabled: Boolean(data && benchmarkId && datesValid && tab === "sources"),
    queryFn: ({ signal }) => geoFetch<{ sources: SourceSummary[] }>({ view: "sources", ...filters }, signal), ...polling,
  });
  const activeQuery = tab === "overview" ? overview : tab === "competitors" ? competitors : sources;
  const refreshing = catalogs.isFetching || live.isFetching || overview.isFetching || competitors.isFetching || sources.isFetching;
  const aiReady = Boolean(data?.models.apiKeyConfigured && data?.models.analysis && data?.models.monitor);
  const analysisReady = Boolean(data?.models.apiKeyConfigured && data?.models.analysis);
  function viewOverviewAnswers(questionKind: "unbranded" | "branded") {
    setAnswerQuestion(null);
    setSelection(current => ({ ...current, questionKind }));
    setTab("runs");
  }
  function viewGroupQuestions(group: "topic" | "market", id: string) {
    setQuestionScope({ topicId: group === "topic" ? id : "", marketId: group === "market" ? id : "" });
    setTab("questions");
  }
  function viewQuestionAnswers(question: Question) {
    setAnswerQuestion(question);
    setSelection(current => ({ ...current, topicId: question.topic_id, marketId: question.market_id,
      language: question.language, questionKind: question.question_kind }));
    setTab("runs");
  }

  function openSetup() {
    setSettings(true);
    requestAnimationFrame(() => document.getElementById("geo-monitoring-setup")?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }

  async function perform(body: Record<string, unknown>, ai = false, success = "Saved."): Promise<unknown> {
    if (inFlight.current) throw new Error("An action is already in progress. Please wait for it to finish.");
    inFlight.current = true;
    setBusy(true);
    setBusyLabel(["runNow", "runAll", "test"].includes(String(body.action)) ? "Adding questions to the queue…" : body.action === "createBenchmark" ? "Saving your benchmark…" : ai ? "Generating AI suggestions…" : "Saving…");
    setError(null); setMessage("");
    try {
      const result = await geoWrite<Record<string, unknown>>(body, ai);
      if (typeof result.runId === "string") { setAnswerQuestion(null); setEvidenceId(result.runId); setTab(result.purpose === "test" ? "tests" : "runs"); }
      else if (typeof result.batchId === "string") { setAnswerQuestion(null); setTab("runs"); }
      if (body.action === "createBenchmark" && typeof result.id === "string") {
        const id = result.id;
        setSelection(current => ({ ...current, benchmarkId: id }));
        setSettings(false);
      }
      await invalidateGeoAction(queryClient, environment, String(body.action));
      setMessage(body.action === "cancelBatch" && result.alreadyFinished ? "This collection already finished. No answers were changed." : result.existing ? (body.action === "run" ? "This answer request already exists. Review its current status in Answers." : "This request was already saved.") : success);
      return result;
    } catch (value) {
      const failure = value instanceof Error ? value : new Error("This request could not be completed.");
      if ("runId" in failure && typeof failure.runId === "string") { setEvidenceId(failure.runId); setTab("runs"); }
      setError(failure);
      await invalidateGeoAction(queryClient, environment, String(body.action));
      throw failure;
    } finally { inFlight.current = false; setBusy(false); setBusyLabel(""); }
  }
  const run = (question: Question, purpose: "monitoring" | "test") => {
    void perform({ action: purpose === "test" ? "test" : "runNow", benchmarkId, questionId: question.id, requestKey: crypto.randomUUID() }, true,
      purpose === "test" ? "Test queued. Its result will never affect statistics." : "Reporting answer queued. It will update statistics after completion.").catch(() => {});
  };

  return <GeoRefreshProvider visible={visible} monitoring={Boolean(live.data?.activity.monitoring)} tests={Boolean(live.data?.activity.tests)}><div className="mx-auto w-full max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
    <header className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-emerald-400"><Radar className="h-4 w-4"/>Chartwell · AI monitoring</div>
        <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">AI visibility</h1><span className="rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{environment}</span>{data?.level === 3 && <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">View only</span>}</div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">See when AI mentions Chartwell, which competitors appear, and the sources behind each answer.</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className="mr-1 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-amber-400"/>{live.data?.schedules.some(row => row.schedule_enabled) ? "Weekly collection enabled" : "Schedule paused"}</span>
        {data?.level === 1 && <Button variant="outline" size="sm" aria-expanded={settings} aria-controls="geo-monitoring-setup" onClick={() => setSettings(!settings)}><Settings2 className="mr-2 h-3.5 w-3.5"/>Setup</Button>}
        <Button variant="outline" size="sm" aria-label="Refresh GEO data" title="Refresh results" disabled={busy || refreshing} onClick={() => void queryClient.invalidateQueries({ queryKey: ["geo", environment] })}><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}/></Button>
      </div>
    </header>
    <ErrorMessage error={catalogs.error || live.error}/>{(catalogs.isPending || live.isPending) && <Loading label="Loading AI visibility"/>}
    {data && <>
      {settings && data.level === 1 && <MonitoringSetup bootstrap={data} busy={busy} onClose={() => setSettings(false)} onCreate={name => perform({ action: "createBenchmark", name }, true, "Benchmark ready. Open Questions to approve a question and collect your first answer.")}/>}
      {!benchmarkId && !aiReady && !settings && <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
        <div className="flex items-start gap-3"><Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"/><div><p className="text-sm font-medium">AI setup is required before collecting answers</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{data.level === 1 ? "Open setup to see what is missing. You can add questions and review saved results now." : "Ask an administrator to complete AI setup. Saved results and the question library remain available."}</p></div></div>
        {data.level === 1 && <Button variant="outline" size="sm" onClick={openSetup}>Complete setup</Button>}
      </div>}
      <ErrorMessage error={error}/>
      {busy && <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-200"><Loader2 className="h-4 w-4 animate-spin"/>{busyLabel}<span className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto">Queue submissions finish quickly. Processing continues in Supabase.</span></div>}
      {message && !busy && <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0"/><p className="flex-1 leading-6">{message}</p><Button variant="ghost" size="sm" className="h-6 w-6 shrink-0 p-0" aria-label="Dismiss message" onClick={() => setMessage("")}><X className="h-3.5 w-3.5"/></Button></div>}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto border-b"><TabsList aria-label="AI visibility sections" className="h-auto min-w-max justify-start gap-1 rounded-none bg-transparent p-0">{tabs.map(([value, label]) => <TabsTrigger key={value} value={value} className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-emerald-400 data-[state=active]:bg-transparent data-[state=active]:text-emerald-300 data-[state=active]:shadow-none">{label}{value === "mapping-review" && (live.data?.mappingReviews || 0) > 0 && <span className="ml-2 rounded bg-amber-500/15 px-1.5 text-xs text-amber-200">{live.data?.mappingReviews}</span>}</TabsTrigger>)}</TabsList></div>
        {tab === "overview" && <div className="my-5">
          {!benchmarkId || !data.counts.active ? <GettingStarted bootstrap={data} benchmarkId={benchmarkId} onSetup={openSetup} onQuestions={() => setTab("questions")} onAnswers={() => setTab("runs")}/> : <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">How does AI visibility monitoring work?</summary><div className="mt-4"><GettingStarted bootstrap={data} benchmarkId={benchmarkId} onSetup={openSetup} onQuestions={() => setTab("questions")} onAnswers={() => setTab("runs")}/></div></details>}
        </div>}
        {!["questions", "tests", "guide", "mapping-review"].includes(tab) && benchmarkId && <div className="my-5"><ResultFilters bootstrap={data} filters={tab === "overview" ? overviewFilters : filters} onChange={setSelection} overview={tab === "overview"}/></div>}
        <TabsContent value="guide" className="mt-5"><Guide onNavigate={setTab}/></TabsContent>
        <TabsContent value="questions" className="mt-5"><Questions bootstrap={data} benchmarkId={benchmarkId} from={filters.from} to={filters.to} scope={questionScope} onScopeChange={setQuestionScope} onPeriodChange={period => setSelection(current => ({ ...current, ...period }))} busy={busy} perform={perform} onRun={run} onViewAnswers={viewQuestionAnswers} onRunAll={() => perform({ action: "runAll", benchmarkId, requestKey: crypto.randomUUID() }, true, "All approved questions queued. You can close this page while Supabase processes them.")} onBenchmarkChange={id => setSelection(current => ({ ...current, benchmarkId: id }))} onSetup={openSetup}/></TabsContent>
        <TabsContent value="mapping-review" className="mt-5"><MappingReviewQueue environment={environment} isAdmin={data.level === 1} onEvidence={setEvidenceId}/></TabsContent>
        <TabsContent value="tests" className="mt-5"><Runs key="tests" environment={environment} filters={filters} onEvidence={setEvidenceId} testHistory/></TabsContent>
        {tab === "overview" && benchmarkId && <div className="my-5"><ScheduleControl bootstrap={data} benchmarkId={benchmarkId} busy={busy} perform={perform}/></div>}
        {!["questions", "tests", "guide", "mapping-review"].includes(tab) && (!benchmarkId ? <Empty title="Set up your first benchmark" action={<div className="flex flex-wrap justify-center gap-2">{data.level === 1 && <Button size="sm" onClick={openSetup}>Open setup</Button>}<Button size="sm" variant="outline" onClick={() => setTab("questions")}>Go to questions</Button></div>}>A benchmark saves the models and settings for your answers. {data.level === 1 ? "Create one in Setup, then collect an answer from Questions." : "An administrator needs to create one before answers can be collected."}</Empty> : !datesValid ? <ErrorMessage error={new Error("Choose a start and end date, up to one year apart. The end date must be on or after the start date.")}/> : <>
          {["overview", "competitors", "sources"].includes(tab) && <><ErrorMessage error={activeQuery.error}/>{activeQuery.isPending && <Loading label="Loading results"/>}</>}
          <TabsContent value="overview" className="mt-0">{overview.data && !overview.error && <div className="space-y-6"><Overview data={overview.data} bootstrap={data} onTab={setTab} onEvidence={viewOverviewAnswers} onQuestions={viewGroupQuestions}/><AnswerValidation key={JSON.stringify(overviewFilters)} environment={environment} filters={overviewFilters} canReview={data.level < 3} onEvidence={setEvidenceId}/></div>}</TabsContent>
          <TabsContent value="runs" className="mt-0"><div className="space-y-5">{answerQuestion ? <section aria-label="Selected question answers" className="space-y-3 rounded-xl border bg-card p-5"><h2 className="text-sm font-semibold">{answerQuestion.question}</h2><p className="text-xs leading-6 text-muted-foreground">Version {answerQuestion.revision} · Completed reporting answers are selected to match this question's metric cards. The benchmark and dates above apply. Change Answer status to inspect other processing states. Tests remain in Test history.</p><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => setTab("questions")}>Back to questions</Button><Button variant="ghost" size="sm" onClick={() => setAnswerQuestion(null)}>Clear question filter</Button></div></section> : <BatchProgress key={benchmarkId} environment={environment} benchmarkId={benchmarkId} canEdit={data.level < 3} busy={busy} perform={perform} onReviewMappings={() => setTab("mapping-review")}/>}<Runs key={JSON.stringify([filters, answerQuestion?.id, answerQuestion?.revision])} environment={environment} filters={filters} question={answerQuestion} onEvidence={setEvidenceId}/></div></TabsContent>
          <TabsContent value="competitors" className="mt-0">{competitors.data && !competitors.error && <Panel title="How Chartwell compares" description="Each brand is counted once per completed answer. All values use the filters above.">
            {competitors.data.samples ? <div className="overflow-x-auto"><table className="w-full"><caption className="sr-only">Brand visibility and mentions across selected answers</caption><thead className="border-b bg-muted/30"><tr>{competitorColumns.map(({ label, metric }) => <th scope="col" className={tableHead} key={label}>{metric ? <GeoMetricLabel metric={metric}>{label}</GeoMetricLabel> : label}</th>)}</tr></thead><tbody className="divide-y">{competitors.data.rows.map(row => <tr key={row.brand_id} className={row.is_chartwell ? "bg-emerald-500/5" : "hover:bg-muted/30"}><th scope="row" className={`${tableCell} text-left font-medium`}>{row.brand_name}{row.is_chartwell && <span className="ml-2 text-xs text-emerald-400">Your brand</span>}</th><td className={`${tableCell} tabular-nums`}>{percentage(row.visibility_rate)}</td><td className={tableCell}>{percentage(row.share_of_voice)}</td><td className={tableCell}>{row.mentions} of {row.samples}</td></tr>)}</tbody></table></div> : <Empty title="No completed answers match these filters" action={<Button variant="outline" size="sm" onClick={() => setTab("questions")}>Go to questions</Button>}>Collect an answer with Run now, or adjust your dates and question filters. Tests are excluded from reporting.</Empty>}
            <p className="border-t px-5 py-4 text-xs leading-6 text-muted-foreground">Mention rate is the percentage of answers naming a brand. Share of mentions compares a brand’s mentions with all detected brand mentions.</p>
          </Panel>}</TabsContent>
          <TabsContent value="sources" className="mt-0">{sources.data && !sources.error && <Panel title="Websites used in the answers" description="A citation is a link attached to an answer. A consulted source was looked at during web search and may not be cited.">
            {sources.data.sources.length ? <div className="overflow-x-auto"><table className="w-full"><caption className="sr-only">Top 100 source domains in selected answers</caption><thead className="border-b bg-muted/30"><tr>{sourceColumns.map(({ label, metric }) => <th scope="col" key={label} className={tableHead}>{metric ? <GeoMetricLabel metric={metric}>{label}</GeoMetricLabel> : label}</th>)}</tr></thead><tbody className="divide-y">{sources.data.sources.map(source => <tr key={source.domain} className="hover:bg-muted/30"><td className={tableCell}><a className="inline-flex items-center gap-2 text-emerald-300 hover:underline" href={safeUrl(source.example_url)} target="_blank" rel="noopener noreferrer">{source.domain}<ExternalLink className="h-3 w-3"/><span className="sr-only"> (opens in a new tab)</span></a></td><td className={tableCell}>{source.cited_answers}</td><td className={tableCell}>{source.consulted_answers}</td><td className={tableCell}>{source.urls}</td></tr>)}</tbody></table></div> : <Empty title="No sources match these filters">Collect answers with Run now, or adjust your filters to include existing answers. Sources appear when the AI reports them.</Empty>}
            <p className="border-t p-5 text-xs leading-6 text-muted-foreground">Showing up to 100 websites reported by the AI provider. Open an answer in Answers to see its individual links and context. A source alone does not explain why a brand was recommended.</p>
          </Panel>}</TabsContent>
          <TabsContent value="opportunities" className="mt-0"><Opportunities key={JSON.stringify(filters)} environment={environment} filters={filters} canEdit={data.level < 3} analysisReady={analysisReady} busy={busy} perform={perform} onEvidence={setEvidenceId}/></TabsContent>
        </>)}
      </Tabs>
      <footer className="flex items-start gap-2 border-t pt-5 text-xs leading-6 text-muted-foreground"><BookOpen className="mt-1 h-3.5 w-3.5 shrink-0"/><p>These results come from saved OpenAI API answers. They can vary between runs and may differ from what someone sees in ChatGPT. Scheduled collection runs in Supabase. Test answers never affect statistics.</p></footer>
    </>}
    {evidenceId && <EvidenceDialog key={evidenceId} environment={environment} runId={evidenceId} canReview={Boolean(data && data.level < 3)} canManageMappings={data?.level === 1} brands={data?.brands || []} onClose={() => setEvidenceId(null)}/>}
  </div></GeoRefreshProvider>;
}
function Runs({ environment, filters, onEvidence, testHistory = false, question }: { environment: string; filters: Filters; onEvidence: (id: string) => void; testHistory?: boolean; question?: Question | null }) {
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState(question ? "succeeded" : "");
  const refresh = useGeoRefresh(testHistory ? "tests" : "monitoring", 5000);
  const questionFilter: Record<string, string | number> = question ? { questionId: question.id, questionRevision: question.revision } : {};
  const query = useQuery({ queryKey: ["geo", environment, testHistory ? "tests" : "runs", testHistory ? null : filters, questionFilter, page, status], queryFn: ({ signal }) => geoFetch<Page<Run>>(testHistory ? { view: "tests", page } : { view: "runs", ...filters, ...questionFilter, status, page }, signal), ...refresh });
  return <Panel title={testHistory ? "Test history — excluded from statistics" : "Reporting answer history"} description={testHistory ? "Saved tests for drafts and approved questions, across all benchmarks and dates. Reporting filters do not apply." : "Scheduled collection and Run now answers matching the reporting filters above."} action={!testHistory && <SelectField label="Answer status" value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}><option value="">All statuses</option><option value="succeeded">Completed</option><option value="running">In progress / interrupted</option><option value="queued">Waiting</option><option value="failed">Failed</option><option value="needs_review">Needs mapping review</option><option value="cancelled">Cancelled</option></SelectField>}>
    <ErrorMessage error={query.error}/>
    {query.isPending ? <Loading/> : query.error ? null : !query.data?.rows.length ? <Empty title={testHistory ? "No test answers yet" : "No reporting answers match these filters"}>{testHistory ? "Open Questions and choose Test on a saved draft or approved question. Tests never affect reporting." : "Open Questions, approve a question, then choose Run now. Check your benchmark, dates, and question filters if reporting answers already exist."}</Empty> : <div className="overflow-x-auto"><table className="w-full"><caption className="sr-only">Saved answers and collection status</caption><thead className="border-b bg-muted/30"><tr>{["Question", "Market", "Requested (Toronto)", "Status", "Answer details"].map(label => <th scope="col" key={label} className={tableHead}>{label}</th>)}</tr></thead><tbody className="divide-y">{query.data.rows.map(run => <tr key={run.id} className="hover:bg-muted/30"><td className={`${tableCell} min-w-64 max-w-md`}><div className="mb-2"><QuestionKindBadge kind={run.question_snapshot.questionKind}/></div><p className="line-clamp-2 leading-6">{run.question_snapshot.question}</p><p className="mt-1 text-xs text-muted-foreground">{testHistory ? "Test — excluded from statistics" : run.source === "manual" ? "Run now" : "Scheduled"} · {run.question_snapshot.language === "fr" ? "French" : "English"} · Version {run.question_revision}</p></td><td className={tableCell}>{run.question_snapshot.market}</td><td className={`${tableCell} whitespace-nowrap text-xs text-muted-foreground`}>{dateTime(run.scheduled_for)}</td><td className={tableCell}><StateBadge value={runState(run)}/></td><td className={tableCell}><Button variant="outline" size="sm" aria-label={`View answer: ${run.question_snapshot.question}`} onClick={() => onEvidence(run.id)}>View answer<ArrowUpRight className="ml-1 h-3 w-3"/></Button></td></tr>)}</tbody></table></div>}
    {query.data && !query.error && <Pager page={page} pageSize={query.data.pageSize} total={query.data.total} onChange={setPage}/>}
  </Panel>;
}

function Opportunities({ environment, filters, canEdit, analysisReady, busy, perform, onEvidence }: {
  environment: string; filters: Filters; canEdit: boolean; analysisReady: boolean; busy: boolean;
  perform: (body: Record<string, unknown>, ai?: boolean, success?: string) => Promise<unknown>;
  onEvidence: (id: string) => void;
}) {
  const [page, setPage] = useState(0);
  const refresh = useGeoRefresh();
  const query = useQuery({ queryKey: ["geo", environment, "opportunities", filters, page], queryFn: ({ signal }) => geoFetch<Page<Insight> & { answerCount: number }>({ view: "opportunities", ...filters, page }, signal), ...refresh });
  const answerCount = query.error || !query.data ? null : query.data.answerCount;
  const canGenerate = analysisReady && answerCount !== null && answerCount >= 3;
  return <Panel title="Opportunities to investigate" description="AI suggestions based on your selected answers. Each suggestion links to the answers that support it." action={canEdit ? <Button size="sm" disabled={busy || !canGenerate} onClick={() => void perform({ action: "opportunities", requestKey: crypto.randomUUID(), filters }, true, "New opportunities saved with supporting answers.").catch(() => {})}><Sparkles className="mr-2 h-4 w-4"/>Generate opportunities</Button> : undefined}>
    {canEdit && <div className="border-b bg-muted/20 px-5 py-3 text-xs leading-5 text-muted-foreground">{!analysisReady ? "An administrator needs to configure the analysis model and API key before you can generate suggestions." : answerCount === null ? "The completed answer count is not available yet. Wait for results to load, or refresh if they could not be loaded." : answerCount < 3 ? `At least 3 completed answers must match your filters. You currently have ${answerCount}. Collect more answers or adjust the filters above.` : `${answerCount} completed answers match your filters. Generating suggestions uses your OpenAI account.`}</div>}
    <ErrorMessage error={query.error}/>
    {query.isPending ? <Loading/> : query.error ? null : !query.data?.rows.length ? <Empty title="Turn your results into next steps">Collect at least three completed answers, then generate suggestions for this filter selection. Review the supporting answers before deciding what to change.</Empty> : <div className="divide-y">{query.data.rows.map(insight => <article className="space-y-3 p-5" key={insight.id}><div className="flex flex-wrap items-start justify-between gap-4"><div><StateBadge value={insight.status}/><h3 className="mt-3 font-medium">{insight.title}</h3></div>{canEdit && <SelectField label={`Status: ${insight.title}`} value={insight.status} disabled={busy} onChange={event => void perform({ action: "insightStatus", id: insight.id, status: event.target.value }, false, "Opportunity status updated.").catch(() => {})}><option value="new">New</option><option value="investigating">Investigating</option><option value="dismissed">Dismissed</option></SelectField>}</div><p className="max-w-4xl whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{insight.opportunity}</p><div className="flex flex-wrap gap-2">{insight.geo_insight_evidence.map((evidence, index) => <Button variant="outline" size="sm" key={evidence.run_id} onClick={() => onEvidence(evidence.run_id)}>Supporting answer {index + 1}<ArrowUpRight className="ml-1 h-3 w-3"/></Button>)}</div><p className="text-xs text-muted-foreground">Generated {dateTime(insight.created_at)} · {insight.model}</p></article>)}</div>}
    {query.data && !query.error && <Pager page={page} pageSize={query.data.pageSize} total={query.data.total} onChange={setPage}/>}
  </Panel>;
}
