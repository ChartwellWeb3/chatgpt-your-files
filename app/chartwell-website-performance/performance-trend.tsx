"use client";

import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartNoAxesCombined, Fingerprint, Info, Monitor, Smartphone, Table2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMetric, type Device, type PerformancePage, type PerformancePayload, type PerformanceRun, type TrendPoint } from "@/lib/performance";
import { fetchPerformance } from "@/lib/performance-client";

export function PerformanceTrend({ payload, selectedRuns, page: scopedPage, device: scopedDevice }: { payload: PerformancePayload; selectedRuns: Partial<Record<Device, PerformanceRun>>; page?: PerformancePage; device?: Device }) {
  const chartId = useId().replaceAll(":", "");
  const [deviceChoice, setDeviceChoice] = useState<Device | "">("");
  const device: Device = scopedDevice ?? (deviceChoice || (selectedRuns.mobile ? "mobile" : "desktop"));
  const metric = "score";
  const [profileChoice, setProfileChoice] = useState("");
  const [showTable, setShowTable] = useState(false);
  const profiles = Array.from(new Set([...payload.runs, ...payload.historyRuns].filter((run) => run.device === device && run.profile_fingerprint).map((run) => run.profile_fingerprint!)));
  const profile = profiles.includes(profileChoice) ? profileChoice : selectedRuns[device]?.profile_fingerprint ?? profiles[0] ?? "";
  const referenceRun = [...payload.runs, ...payload.historyRuns].find((run) => run.device === device && run.profile_fingerprint === profile);
  const deploymentIds = payload.deployments.map((deployment) => deployment.id);
  const selectedRunId = selectedRuns[device]?.id;
  const query = useQuery({
    queryKey: ["performance-trend", deploymentIds, device, referenceRun?.id, selectedRunId, scopedPage?.page_id],
    enabled: !!referenceRun && deploymentIds.length > 0,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ view: "trend", device, deploymentIds: deploymentIds.join(","), referenceRunId: referenceRun!.id });
      if (selectedRunId) params.set("selectedRunId", selectedRunId);
      if (scopedPage) params.set("pageId", scopedPage.page_id);
      return fetchPerformance<{ points: TrendPoint[] }>(params, signal);
    },
    staleTime: 30000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const points = query.data?.points ?? [];
  const measured = points.filter((p) => p.value !== null);
  const latest = measured[measured.length - 1];
  return <Card className="overflow-hidden" role="region" aria-label={scopedPage ? `${scopedPage.page_name} ${device} performance trends` : "Overall performance trends"}>
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 pb-4"><div className="space-y-1.5"><CardTitle className="flex items-center gap-2 text-base"><ChartNoAxesCombined className="h-4 w-4 text-emerald-300"/>Performance over time</CardTitle><CardDescription className="text-xs">{scopedPage ? `Follow ${scopedPage.page_name} on ${device} across deployments. Every point represents one measurement attempt.` : "Overall performance across measured pages. Each point is the average page score for one deployment."}</CardDescription></div><Button variant="outline" size="sm" className="gap-2 text-xs" onClick={() => setShowTable(!showTable)} aria-expanded={showTable}><Table2 className="h-3.5 w-3.5"/>{showTable ? "Hide values" : "View values"}</Button></CardHeader>
    <CardContent className="space-y-5 pb-4">
      <div className="flex flex-wrap items-center gap-3">
        {scopedPage ? <Badge variant="outline" className="max-w-full break-all text-xs">{scopedPage.page_path} · {scopedPage.locale?.toUpperCase() ?? "Locale unknown"}</Badge> : <Badge variant="outline" className="text-xs">All measured pages</Badge>}
        {scopedDevice ? <Badge variant="secondary" className="gap-1.5 text-xs">{device === "mobile" ? <Smartphone className="h-3.5 w-3.5"/> : <Monitor className="h-3.5 w-3.5"/>}{device === "mobile" ? "Mobile" : "Desktop"}</Badge> : <div className="inline-flex rounded-md border bg-muted/30 p-0.5" aria-label="Trend device">{(["mobile", "desktop"] as const).map((kind) => { const Icon = kind === "mobile" ? Smartphone : Monitor; return <Button variant={device === kind ? "secondary" : "ghost"} size="sm" className="h-7 gap-1.5 px-2.5 text-xs" key={kind} aria-pressed={device === kind} onClick={() => { setDeviceChoice(kind); setProfileChoice(""); }}><Icon className="h-3.5 w-3.5"/>{kind === "mobile" ? "Mobile" : "Desktop"}</Button>; })}</div>}
        <Badge variant="outline" className="text-xs">{scopedPage ? "Score / 100" : "Average score / 100"}</Badge>
        <div className="flex items-baseline gap-2 sm:ml-auto"><span className="text-2xl font-semibold tracking-tight tabular-nums">{formatMetric(metric, latest?.value)}</span><span className="text-[10px] text-muted-foreground">{scopedPage ? "latest available score / 100" : "latest available average / 100"}</span></div>
      </div>
      {query.isFetching && !query.data ? <div className="h-64 animate-pulse rounded-md bg-muted sm:h-72" aria-label="Loading performance trend"/> : query.error ? <p role="alert" className="flex min-h-60 items-center justify-center text-sm text-rose-300">{query.error.message}</p> : measured.length ? <div className="h-64 w-full sm:h-72"><ResponsiveContainer width="100%" height="100%"><AreaChart data={points} margin={{ top: 15, right: 15, bottom: 10, left: 0 }} accessibilityLayer>
        <defs><linearGradient id={`trend-${chartId}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.22}/><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0}/></linearGradient></defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 5"/>
        <XAxis dataKey="deploymentId" tickFormatter={(value) => formatDate(points.find((p) => p.deploymentId === value)?.date, true)} minTickGap={35} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} dy={8}/>
        <YAxis domain={[0, 100]} width={65} tickFormatter={(value) => formatMetric(metric, value)} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} tickCount={5}/>
        <Tooltip cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }} content={({ active, payload: entries }) => { const point = entries?.[0]?.payload as TrendPoint | undefined; return active && point ? <Card className="shadow-lg"><CardContent className="space-y-1 p-3"><p className="text-xs font-medium">{scopedPage ? "Score" : "Average score"}: {formatMetric(metric, point.value)} / 100</p>{!scopedPage && point.totalPages !== undefined && <p className="text-[10px] text-muted-foreground">{point.includedPages} of {point.totalPages} pages included</p>}<p className="text-[10px] text-muted-foreground">Build {point.build}</p><p className="text-[10px] text-muted-foreground">{formatDate(point.date)}</p></CardContent></Card> : null; }}/>
        <Area type="linear" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} fill={`url(#trend-${chartId})`} dot={{ r: 3.5, fill: "hsl(var(--card))", stroke: "hsl(var(--primary))", strokeWidth: 2 }} activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))" }} connectNulls={false} isAnimationActive={false}/>
      </AreaChart></ResponsiveContainer></div> : <div className="flex min-h-60 flex-col items-center justify-center px-4 text-center"><ChartNoAxesCombined className="mb-3 h-7 w-7 text-muted-foreground"/><h3 className="text-sm font-medium">No measurements available</h3><p className="mt-2 max-w-lg text-xs leading-relaxed text-muted-foreground">{scopedPage ? "This page has no completed measurements with comparable settings for this device." : "No completed page scores are available with comparable settings for this device."}</p></div>}
    </CardContent>
    {!scopedPage && <p className="px-6 pb-4 text-[10px] text-muted-foreground">Average of completed page scores, including variable samples. The pages included can vary between deployments.</p>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3 text-[10px] text-muted-foreground"><div className="flex flex-wrap items-center gap-2"><Fingerprint className="h-3.5 w-3.5"/>{scopedPage ? "Same page, locale & device" : "Same device"} · comparable settings<Select value={profile || "unknown"} onValueChange={setProfileChoice}><SelectTrigger aria-label="Trend reference measurement profile" className="h-7 w-36 text-[10px]"><SelectValue/></SelectTrigger><SelectContent>{!profiles.length && <SelectItem value="unknown" disabled>Not reported</SelectItem>}{profiles.map((p) => <SelectItem key={p} value={p}>{p.slice(0, 12)}…</SelectItem>)}</SelectContent></Select></div><span className="inline-flex items-center gap-1.5"><Info className="h-3 w-3"/>{measured.length} of {points.length} deployments · one point per deployment</span></div>
    {showTable && <div className="max-h-72 overflow-auto"><Table className="text-xs"><TableHeader><TableRow><TableHead className="text-xs">Deployment</TableHead><TableHead className="whitespace-nowrap text-xs">Finished · Toronto</TableHead><TableHead className="text-xs">{scopedPage ? "Score" : "Average score"}</TableHead>{!scopedPage && <TableHead className="text-xs">Pages included</TableHead>}</TableRow></TableHeader><TableBody>{[...points].reverse().map((point) => <TableRow key={point.deploymentId}><TableCell>Build {point.build}</TableCell><TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(point.date)}</TableCell><TableCell className="whitespace-nowrap tabular-nums" title={point.value === null ? point.reason ?? "Score not available" : undefined}>{formatMetric(metric, point.value)}</TableCell>{!scopedPage && <TableCell className="tabular-nums">{point.totalPages === undefined ? "—" : `${point.includedPages}/${point.totalPages}`}</TableCell>}</TableRow>)}</TableBody></Table></div>}
  </Card>;
}

