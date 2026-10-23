"use client";

import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertCircle, ArrowDown, ArrowUp, ArrowUpRight, ChevronLeft, ChevronRight, Clock3, Database, GitBranch, GitCompareArrows, Info, Layers, ListFilter, Monitor, RefreshCw, Search, Smartphone } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { pill } from "@/components/ui/pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMetric, isNoisy, METRICS, metricValue, pageComparison, pageRowId, runSummary, scoreDelta, type Device, type MetricKey, type PerformanceEnvironment, type PerformancePage, type PerformancePayload, type PerformanceRun } from "@/lib/performance";
import { fetchPerformance } from "@/lib/performance-client";
import { cn } from "@/lib/utils";
import { PageDetails } from "./performance-details";
import { PerformanceTrend } from "./performance-trend";
import { DeploymentChangesPanel } from "./performance-commits";
import { ScoreRing, ScoreValue } from "./performance-score";
import { safeLink, statusTone } from "./performance-format";

const EMPTY: PerformancePayload = { deployments: [], deployment: null, runs: [], pages: [], commits: [], historyRuns: [], historyPages: [] };

export default function PerformanceDashboard({ environment }: { environment: PerformanceEnvironment }) {
  const [deploymentId, setDeploymentId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [attempts, setAttempts] = useState<Partial<Record<Device, string>>>({});
  const [tab, setTab] = useState("pages");
  const [device, setDevice] = useState<Device | "all">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: MetricKey; ascending: boolean }>({ key: "score", ascending: true });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(0);
  const query = useQuery({
    queryKey: ["website-performance", environment, deploymentId, from, to],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (deploymentId) params.set("deploymentId", deploymentId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      return fetchPerformance<PerformancePayload>(params, signal);
    },
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
  const payload = query.data ?? EMPTY;
  const deployment = payload.deployment;
  const selectedRuns: Partial<Record<Device, PerformanceRun>> = {};
  for (const kind of ["mobile", "desktop"] as const) {
    selectedRuns[kind] = payload.runs.find((run) => run.id === attempts[kind] && run.device === kind) ?? payload.runs.find((run) => run.device === kind);
  }
  const selectedRunIds = Object.values(selectedRuns).filter(Boolean).map((run) => run!.id);
  const runById = new Map(payload.runs.map((run) => [run.id, run]));
  const rows = payload.pages.filter((page) => selectedRunIds.includes(page.run_id));
  const filtered = rows.filter((page) => (device === "all" || runById.get(page.run_id)?.device === device) && (!search || `${page.page_name} ${page.page_path} ${page.locale}`.toLowerCase().includes(search.toLowerCase())));
  const sorted = [...filtered].sort((a, b) => {
    const av = metricValue(a, sort.key); const bv = metricValue(b, sort.key);
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;
    return sort.ascending ? av - bv : bv - av;
  });
  const safeTablePage = Math.min(tablePage, Math.max(0, Math.ceil(sorted.length / 8) - 1));
  const selected = Object.values(selectedRuns).filter((run): run is PerformanceRun => !!run);
  const audit = !selected.length ? "No audits" : selected.every((run) => run.status === "complete") ? "Complete" : selected.some((run) => run.status === "failed") ? "Failed" : "Partial";
  const ingestion = !selected.length ? "No uploads" : selected.every((run) => run.upload_status === "ready") ? "Ready" : selected.some((run) => run.upload_status === "failed") ? "Failed" : "Pending";
  const changeDates = (value: string, end: boolean) => { if (end) setTo(value); else setFrom(value); setDeploymentId(""); setExpanded(null); };
  const changeDeployment = (id: string) => { setDeploymentId(id === "latest" ? "" : id); setAttempts({}); setExpanded(null); setTablePage(0); };
  const changeSort = (key: MetricKey) => setSort({ key, ascending: sort.key === key ? !sort.ascending : key === "score" });

  return <div className="mx-auto w-full max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
    <header className="flex items-start justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[.18em] text-emerald-300"><Activity className="h-3.5 w-3.5"/>Chartwell · Website monitoring</div><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Chartwell website performance</h1><p className="mt-2 text-sm text-muted-foreground">See what changed, find slow pages, and follow performance across deployments.</p></div>
      <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label="Refresh performance data" className="shrink-0 gap-2"><RefreshCw className={cn("h-3.5 w-3.5", query.isFetching && "animate-spin")}/><span className="hidden sm:inline">Refresh data</span></Button>
    </header>

    <Card><CardContent className="flex flex-wrap items-end gap-4 p-4">
      <div className="space-y-2"><p className="text-xs text-muted-foreground">Environment</p><div className="flex h-9 items-center"><Badge variant="outline" className="px-3 py-1" aria-label={`Environment: ${environment.toUpperCase()}`}>{environment.toUpperCase()}</Badge></div></div>
      <div className="min-w-44 flex-1 space-y-2 sm:max-w-xs"><label htmlFor="performance-deployment" className="text-xs text-muted-foreground">Deployment</label><Select value={deploymentId || "latest"} onValueChange={changeDeployment}><SelectTrigger id="performance-deployment" className="h-9"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="latest">Latest deployment</SelectItem>{payload.deployments.map((d) => <SelectItem key={d.id} value={d.id}>{d.source_build_number ? `Build ${d.source_build_number}` : d.commit_sha?.slice(0, 8) ?? d.id.slice(0, 8)} · {formatDate(d.source_finished_at ?? d.created_at, true)}</SelectItem>)}</SelectContent></Select></div>
      <div className="w-full space-y-2 sm:w-auto"><label htmlFor="performance-from" className="text-xs text-muted-foreground">Deployment dates</label><div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:flex"><Input className="h-9 min-w-0 w-full text-xs [color-scheme:dark] sm:w-36" id="performance-from" type="date" aria-label="Deployment start date" value={from} max={to || undefined} onChange={(e) => changeDates(e.target.value, false)}/><span className="text-xs text-muted-foreground">to</span><Input className="h-9 min-w-0 w-full text-xs [color-scheme:dark] sm:w-36" type="date" aria-label="Deployment end date" value={to} min={from || undefined} onChange={(e) => changeDates(e.target.value, true)}/></div></div>
      {(from || to) && <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); setDeploymentId(""); }}>Reset dates</Button>}
    </CardContent></Card>

    {query.error && <Card role="alert" className="border-destructive/40"><CardContent className="flex gap-3 p-5"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300"/><div><h2 className="text-sm font-medium">Performance data is unavailable</h2><p className="mt-1 text-sm text-muted-foreground">{query.error.message}</p><p className="mt-2 text-xs text-muted-foreground">Performance data could not be loaded. Try refreshing in a moment.</p></div></CardContent></Card>}
    {query.isPending && <div className="space-y-5" aria-label="Loading dashboard"><div className="h-24 animate-pulse rounded-lg bg-muted"/><div className="grid gap-5 md:grid-cols-2"><div className="h-48 animate-pulse rounded-lg bg-muted"/><div className="h-48 animate-pulse rounded-lg bg-muted"/></div><div className="h-80 animate-pulse rounded-lg bg-muted"/></div>}
    {!query.isPending && !query.error && !deployment && <Card><CardContent className="flex min-h-64 flex-col items-center justify-center p-8 text-center"><Database className="mb-4 h-7 w-7 text-muted-foreground"/><h2 className="font-medium">{from || to ? "No deployments in this date range" : `No ${environment.toUpperCase()} measurements yet`}</h2><p className="mt-2 max-w-lg text-sm text-muted-foreground">{from || to ? "Try clearing the date range to see other deployments." : `Deployment records and measurement results will appear when ingestion completes for ${environment.toUpperCase()}.`}</p></CardContent></Card>}
    {!query.isPending && !query.error && deployment && <>
      {payload.warnings?.length ? <details><summary className="cursor-pointer text-xs text-muted-foreground">Data availability · {payload.warnings.length} {payload.warnings.length === 1 ? "notice" : "notices"}</summary><ul className="mt-2 space-y-1 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">{payload.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details> : null}
      <Card className="border-emerald-500/15 bg-gradient-to-r from-emerald-950/25 to-card"><CardContent className="flex flex-wrap items-center justify-between gap-5 p-5">
        <div className="flex items-start gap-3"><div className="rounded-lg bg-emerald-400/10 p-2 text-emerald-300"><Layers className="h-5 w-5"/></div><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold">{deployment.source_build_number ? `Build ${deployment.source_build_number}` : `Deployment ${deployment.id.slice(0, 8)}`}</h2><Badge variant="outline" className="text-[10px]">{environment.toUpperCase()}</Badge></div><div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3"/>{deployment.source_branch ?? "Branch not reported"}</span><span className="font-mono">{deployment.commit_sha?.slice(0, 8) ?? "SHA not reported"}</span><span>{formatDate(deployment.source_finished_at ?? deployment.created_at)}</span>{safeLink(deployment.source_build_url) && <a href={deployment.source_build_url!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">Azure deployment<ArrowUpRight className="h-3 w-3"/></a>}{safeLink(deployment.deployment_url) && <a href={deployment.deployment_url!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">Open site<ArrowUpRight className="h-3 w-3"/></a>}</div></div></div>
        <div className="flex flex-wrap gap-5">{[["Deployment", "Recorded"], ["Lighthouse audit", audit], ["Data ingestion", ingestion]].map(([title, value]) => <div key={title}><div className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>{pill(value, statusTone(value))}</div>)}</div>
      </CardContent></Card>

      <section className="grid gap-5 md:grid-cols-2" aria-label="Device performance">{(["mobile", "desktop"] as const).map((kind) => <DeviceCard key={kind} device={kind} run={selectedRuns[kind]} runs={payload.runs.filter((run) => run.device === kind)} pages={payload.pages} onAttempt={(id) => { setAttempts((current) => ({ ...current, [kind]: id })); setExpanded(null); }}/>)}</section>
      <PerformanceTrend payload={payload} selectedRuns={selectedRuns}/>

      <Tabs value={tab} onValueChange={setTab} className="space-y-5">
        <TabsList className="h-auto max-w-full justify-start overflow-x-auto"><TabsTrigger value="pages" className="gap-2 text-xs"><ListFilter className="h-3.5 w-3.5"/>Page results<Badge variant="secondary" className="px-1.5 text-[10px]">{rows.length}</Badge></TabsTrigger><TabsTrigger value="changes" className="gap-2 text-xs"><GitCompareArrows className="h-3.5 w-3.5"/>Deployment changes</TabsTrigger></TabsList>
        <TabsContent value="pages"><Card className="overflow-hidden">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 pb-4"><div className="space-y-1.5"><CardTitle className="text-base">Page measurements</CardTitle><CardDescription className="text-xs">Open a page to see its measurements, score history, and optimization insights.</CardDescription></div><Select value={device} onValueChange={(value) => { setDevice(value as Device | "all"); setTablePage(0); }}><SelectTrigger className="h-9 w-36" aria-label="Page device filter"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All devices</SelectItem><SelectItem value="mobile">Mobile</SelectItem><SelectItem value="desktop">Desktop</SelectItem></SelectContent></Select></CardHeader>
          <CardContent className="pb-4"><div className="relative w-full sm:w-64"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"/><Input className="h-9 pl-9 text-xs" placeholder="Search page name or path" aria-label="Search pages" value={search} onChange={(e) => { setSearch(e.target.value); setTablePage(0); }}/></div></CardContent>
          {sorted.length ? <Table className="min-w-[850px] text-xs">
            <TableHeader>
              <TableRow className="bg-muted/25">
                <TableHead>Page</TableHead>
                <TableHead>Device</TableHead>
                {METRICS.map((metric) => <TableHead key={metric.key} aria-sort={sort.key === metric.key ? sort.ascending ? "ascending" : "descending" : "none"}>
                  <Button variant="ghost" size="sm" className="h-8 gap-1 px-0 text-xs hover:bg-transparent hover:text-foreground" onClick={() => changeSort(metric.key)} title={metric.description}>
                    {metric.label}{sort.key === metric.key && (sort.ascending ? <ArrowUp className="h-3 w-3"/> : <ArrowDown className="h-3 w-3"/>)}
                  </Button>
                </TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>{sorted.slice(safeTablePage * 8, safeTablePage * 8 + 8).map((page) => {
              const rowId = pageRowId(page);
              const run = runById.get(page.run_id);
              const delta = isNoisy(page) === false ? scoreDelta(pageComparison(page)) : null;
              const available = page.status === "complete" && run?.upload_status === "ready" && run?.status !== "failed";
              const isExpanded = expanded === rowId;
              return <Fragment key={rowId}>
                <TableRow data-state={isExpanded ? "selected" : undefined}>
                  <TableCell>
                    <Button variant="ghost" className="h-auto justify-start gap-2 px-0 text-left hover:bg-transparent" aria-expanded={isExpanded} aria-controls={isExpanded ? "performance-page-details" : undefined} onClick={() => setExpanded(isExpanded ? null : rowId)} aria-label={`${isExpanded ? "Close" : "Open"} ${page.page_name} ${run?.device ?? ""} details`}>
                      <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", isExpanded && "rotate-90 text-emerald-300")}/>
                      <span><span className="text-xs font-medium">{page.page_name}<span className="ml-2 rounded bg-muted px-1 text-[9px] text-muted-foreground">{page.locale?.toUpperCase() ?? "?"}</span></span><span className="mt-1 block max-w-48 truncate text-[10px] font-normal text-muted-foreground" title={page.page_path}>{page.page_path}</span></span>
                    </Button>
                  </TableCell>
                  <TableCell className="text-muted-foreground"><span className="inline-flex items-center gap-1.5">{run?.device === "mobile" ? <Smartphone className="h-3.5 w-3.5"/> : <Monitor className="h-3.5 w-3.5"/>}{run?.device ?? "—"}</span></TableCell>
                  {METRICS.map((metric) => <TableCell key={metric.key} className="whitespace-nowrap tabular-nums">{metric.key === "score" ? <div className="flex items-center gap-2"><ScoreValue value={available ? metricValue(page, metric.key) : null}/>{available && delta !== null && <span className={cn("text-[10px]", delta < 0 ? "text-rose-300" : "text-emerald-300")}>{formatMetric("score", delta, true)} pt</span>}</div> : formatMetric(metric.key, available ? metricValue(page, metric.key) : null)}</TableCell>)}
                </TableRow>
                {isExpanded && <TableRow className="bg-muted/20 hover:bg-muted/20">
                  <TableCell colSpan={METRICS.length + 2} className="p-0">
                    <div id="performance-page-details" className="sticky left-0 max-w-[calc(100vw-2rem-2px)] sm:max-w-[calc(100vw-3rem-2px)] lg:max-w-[calc(100vw-5rem-2px)]">
                      <div className="flex justify-end px-5 pt-3"><Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => setExpanded(null)}>Close details</Button></div>
                      <PageDetails page={page} run={run} payload={payload}/>
                    </div>
                  </TableCell>
                </TableRow>}
              </Fragment>;
            })}</TableBody>
          </Table> : <CardContent className="py-12 text-center"><p className="text-sm">{rows.length ? "No pages match these filters" : "Page measurements are not available"}</p><p className="mt-2 text-xs text-muted-foreground">{rows.length ? "Try a different page name or device." : "The selected attempt has no page records yet. Check audit and ingestion status above."}</p></CardContent>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-xs text-muted-foreground"><span>{sorted.length ? `${safeTablePage * 8 + 1}–${Math.min(safeTablePage * 8 + 8, sorted.length)} of ${sorted.length} page results` : "0 page results"} · selected attempts only</span><div className="flex gap-2"><Button variant="outline" size="icon" className="h-8 w-8" disabled={!safeTablePage} onClick={() => { setTablePage(safeTablePage - 1); setExpanded(null); }} aria-label="Previous page results"><ChevronLeft className="h-4 w-4"/></Button><Button variant="outline" size="icon" className="h-8 w-8" disabled={(safeTablePage + 1) * 8 >= sorted.length} onClick={() => { setTablePage(safeTablePage + 1); setExpanded(null); }} aria-label="Next page results"><ChevronRight className="h-4 w-4"/></Button></div></div>
        </Card></TabsContent>
        <TabsContent value="changes"><DeploymentChangesPanel payload={payload}/></TabsContent>
      </Tabs>
      <footer className="flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Info className="h-3 w-3"/>Lighthouse lab measurements · score changes in points · CLS is unitless</span><span className="inline-flex items-center gap-1.5"><Clock3 className="h-3 w-3"/>Timestamps in America/Toronto</span></footer>
    </>}
  </div>;
}

function DeviceCard({ device, run, runs, pages, onAttempt }: { device: Device; run?: PerformanceRun; runs: PerformanceRun[]; pages: PerformancePage[]; onAttempt: (id: string) => void }) {
  const title = device === "mobile" ? "Mobile" : "Desktop";
  const Icon = device === "mobile" ? Smartphone : Monitor;
  const metrics = runSummary(run, pages);
  return <Card>
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-4">
      <CardTitle className="flex items-center gap-2 text-sm"><Icon className="h-4 w-4 text-muted-foreground"/>{title}</CardTitle>
      {run ? <Select value={run.id} onValueChange={onAttempt}><SelectTrigger aria-label={`${title} measurement attempt`} className="h-8 w-auto max-w-[230px] text-[10px]"><SelectValue/></SelectTrigger><SelectContent>{runs.map((candidate, index) => <SelectItem value={candidate.id} key={candidate.id}>{index === 0 ? "Latest" : `Attempt ${runs.length - index}`} · {formatDate(candidate.started_at ?? candidate.created_at)} · {candidate.status}</SelectItem>)}</SelectContent></Select> : pill("Not measured")}
    </CardHeader>
    <CardContent>
      <div className="flex justify-center py-1"><ScoreRing value={metrics.score}/></div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-2">{run ? <>{pill(run.status, statusTone(run.status))}{pill(`Ingestion ${run.upload_status}`, statusTone(run.upload_status))}</> : <span className="text-xs text-muted-foreground">Awaiting measurement</span>}</div>
        {safeLink(run?.monitoring_build_url) && <Button variant="link" size="sm" asChild className="h-auto gap-1 p-0 text-xs text-muted-foreground"><a href={run!.monitoring_build_url!} target="_blank" rel="noreferrer">Monitoring build<ArrowUpRight className="h-3 w-3"/></a></Button>}
      </div>
      {run?.error_message && <p className="mt-2 text-xs text-rose-300">{run.error_message}</p>}
      <p className="mt-3 text-[10px] text-muted-foreground">Average score excludes missing and inconsistent samples. {run && <span className="font-mono" title={run.id}>Attempt {run.id.slice(0, 8)}</span>}</p>
    </CardContent>
  </Card>;
}


