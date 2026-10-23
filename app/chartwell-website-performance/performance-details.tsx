"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, AlertCircle, Lightbulb } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { METRICS, finite, formatBytes, formatDate, formatMetric, type PageResult, type PerformancePage, type PerformancePayload, type PerformanceRun } from "@/lib/performance";
import { fetchPerformance } from "@/lib/performance-client";
import { PerformanceTrend } from "./performance-trend";

export function PageDetails({ page, run, payload }: { page: PerformancePage; run?: PerformanceRun; payload: PerformancePayload }) {
  const query = useQuery({
    queryKey: ["performance-page", page.run_id, page.page_id, page.page_path, page.locale],
    queryFn: ({ signal }) => fetchPerformance<{ result: PageResult | null }>(
      new URLSearchParams({ view: "page", runId: page.run_id, pageId: page.page_id, path: page.page_path, locale: page.locale ?? "" }),
      signal
    ),
    staleTime: 60000,
  });
  if (query.isPending) return <div className="m-5 h-52 animate-pulse rounded-lg bg-muted" aria-label="Loading page details"/>;
  if (query.error) return <div className="p-5 text-sm text-rose-300" role="alert">{query.error.message}</div>;
  const result = query.data?.result;
  if (!result) return <p className="p-8 text-center text-sm text-muted-foreground">This attempt has no stored detailed page result.</p>;

  const metrics = result.aggregate?.metrics;
  const detailedPage: PerformancePage = { ...page, result };
  const samples = Array.isArray(result.runs) ? result.runs : [];
  const insights = Array.isArray(result.insights) ? result.insights : [];

  return <div className="space-y-5 p-4 sm:p-6" role="region" aria-label={`${page.page_name} measurement details`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold">{page.page_name}<span className="ml-2 text-[10px] font-normal text-muted-foreground">{page.locale?.toUpperCase() ?? "LOCALE UNKNOWN"}</span></h3>
        <p className="mt-1 text-xs text-muted-foreground">Page measurements · {samples.length} individual Lighthouse samples below</p>
      </div>
    </div>

    {(page.error_message || run?.error_message) && <Card role="alert" className="border-destructive/30">
      <CardContent className="flex gap-2 p-4 text-sm"><AlertCircle className="h-4 w-4 shrink-0 text-rose-300"/>{page.error_message ?? run?.error_message}</CardContent>
    </Card>}

    <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {METRICS.map(({ key, label, description }) => <Card key={key}>
        <CardContent className="p-3">
          <dt className="text-[10px] text-muted-foreground" title={description}>{label}{key === "score" ? " / 100" : ""}</dt>
          <dd className="mt-2 text-xl font-medium tracking-tight tabular-nums">{formatMetric(key, finite(metrics?.[key]))}</dd>
        </CardContent>
      </Card>)}
    </dl>

    {run && <PerformanceTrend payload={payload} selectedRuns={run.device === "mobile" ? { mobile: run } : { desktop: run }} page={detailedPage} device={run.device}/>}

    <div>
      <section>
        <h4 className="mb-3 flex items-center gap-2 text-xs font-medium"><Lightbulb className="h-4 w-4 text-muted-foreground"/>Optimization opportunities<Badge variant="secondary" className="px-1.5 text-[10px]">{insights.length}</Badge></h4>
        {insights.length ? <div className="space-y-2">{insights.map((insight, index) => <Card key={insight.id ?? index}>
          <CardContent className="flex items-center gap-3 p-3">
            <Badge variant="secondary" className="rounded-md px-2">{index + 1}</Badge>
            <div className="min-w-0 flex-1"><h5 className="text-xs font-medium">{insight.title}</h5><p className="mt-1 text-[10px] text-muted-foreground">{finite(insight.estimatedSavingsBytes) !== null ? `${formatBytes(insight.estimatedSavingsBytes)} estimated byte savings` : "Byte savings not reported"}</p></div>
            <div className="shrink-0 text-right"><div className="text-sm font-medium text-emerald-300">{formatMetric("lcp", insight.estimatedSavingsMs)}</div><p className="mt-1 text-[9px] text-muted-foreground">estimated savings</p></div>
          </CardContent>
        </Card>)}</div> : <p className="text-xs text-muted-foreground">No optimization insights were included in this result.</p>}
        <p className="mt-3 text-[10px] text-muted-foreground">Savings are Lighthouse estimates and can overlap across opportunities.</p>
      </section>

    </div>

    <section>
      <h4 className="mb-3 flex flex-wrap items-center gap-2 text-xs font-medium"><Activity className="h-4 w-4 text-muted-foreground"/>Individual samples</h4>
      {samples.length ? <Card className="overflow-hidden"><Table className="text-xs">
        <TableHeader><TableRow><TableHead className="whitespace-nowrap text-xs">Sample</TableHead><TableHead className="whitespace-nowrap text-xs">Collected · Toronto</TableHead>{METRICS.map((metric) => <TableHead className="whitespace-nowrap text-xs" key={metric.key} title={metric.description}>{metric.label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{samples.map((sample, index) => <TableRow key={index}><TableCell className="whitespace-nowrap">Sample {index + 1}</TableCell><TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(sample.fetchedAt)}</TableCell>{METRICS.map((metric) => <TableCell className="whitespace-nowrap tabular-nums" key={metric.key}>{formatMetric(metric.key, sample.metrics?.[metric.key])}</TableCell>)}</TableRow>)}</TableBody>
      </Table></Card> : <p className="text-xs text-muted-foreground">Individual samples are unavailable.</p>}
    </section>
  </div>;
}


