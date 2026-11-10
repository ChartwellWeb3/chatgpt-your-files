"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { geoFetch } from "@/lib/geo/client";
import type { Batch, Bootstrap, Page, ScheduleStatus } from "@/lib/geo/types";
import { ConfirmDialog, dateTime, Empty, ErrorMessage, Loading, Pager, Panel } from "./geo-ui";
import { GeoMetricHelp } from "./geo-metric-help";
import { invalidateGeoCompletion, invalidateGeoViews, useGeoRefresh } from "./geo-refresh";

type Perform = (body: Record<string, unknown>, ai?: boolean, success?: string) => Promise<unknown>;
export function ScheduleControl({ bootstrap, benchmarkId, busy, perform }: { bootstrap: Bootstrap; benchmarkId: string; busy: boolean; perform: Perform }) {
  const benchmark = bootstrap.benchmarks.find(row => row.id === benchmarkId);
  const refresh = useGeoRefresh();
  const last = useQuery({ queryKey: ["geo", bootstrap.environment, "schedule", benchmarkId], enabled: Boolean(benchmarkId), queryFn: ({ signal }) => geoFetch<ScheduleStatus>({ view: "schedule", benchmarkId }, signal), ...refresh });
  if (!benchmark) return null;
  const enabled = bootstrap.benchmarks.find(row => row.schedule_enabled);
  const healthy = Boolean(bootstrap.worker?.last_seen_at && Date.parse(bootstrap.worker.last_seen_at) > Date.now() - 5 * 60000);
  return <Panel title="Weekly collection" description="Every Monday at 9:00 AM Toronto time. Scheduled runs and Run now contribute to the same reporting results.">
    <div className="flex flex-wrap items-center justify-between gap-4 p-5"><div className="space-y-2 text-xs leading-5 text-muted-foreground">
      <p className="text-sm text-foreground">{benchmark.schedule_enabled ? "Schedule enabled" : "Schedule paused"} · {benchmark.name}</p>
      <p>{bootstrap.counts.scheduled} of {bootstrap.counts.active} approved questions selected for Monday collection. Change the checkboxes in Questions to update this list.</p>
      {bootstrap.counts.scheduled === 0 && <p className="text-amber-200">No approved questions are selected. Select questions before the next Monday collection.</p>}
      <p>Next collection: {benchmark.next_scheduled_at ? `${dateTime(benchmark.next_scheduled_at)} Toronto` : "Enable the schedule to set the next Monday slot."}</p>
      <p>Worker: {!bootstrap.worker?.dispatcher_enabled ? "Deployment / Cron activation required" : healthy ? "Connected" : "No recent heartbeat — check Supabase Cron and worker logs"}{bootstrap.worker?.last_seen_at ? ` · Last seen ${dateTime(bootstrap.worker.last_seen_at)}` : ""}</p>
      <p>Last scheduled batch: {last.data?.lastBatch ? `${dateTime(last.data.lastBatch.scheduled_for)} · ${last.data.lastBatch.completed} completed / ${last.data.lastBatch.total} questions · ${last.data.lastBatch.failed} failed` : last.isPending ? "Loading…" : last.error ? "Could not load batch status" : "None yet"}</p>
      {enabled && enabled.id !== benchmarkId && <p className="text-amber-200">Currently scheduled: {enabled.name}. Enabling this benchmark replaces that schedule.</p>}
      <p>Pausing stops new scheduled batches. Work already queued continues.</p>
    </div>{bootstrap.level === 1 && <Button variant={benchmark.schedule_enabled ? "outline" : "default"} size="sm" disabled={busy || (!benchmark.schedule_enabled && (!bootstrap.worker?.dispatcher_enabled || !healthy))} onClick={() => void perform({ action: "schedule", benchmarkId, enabled: !benchmark.schedule_enabled }, false, benchmark.schedule_enabled ? "Schedule paused. Queued work will continue." : "Monday collection enabled.").catch(() => {})}>{benchmark.schedule_enabled ? "Pause schedule" : "Enable Monday schedule"}</Button>}</div>
  </Panel>;
}

export function BatchProgress({ environment, benchmarkId, canEdit, busy, perform, onReviewMappings }: { environment: string; benchmarkId: string; canEdit: boolean; busy: boolean; perform: Perform; onReviewMappings?: () => void }) {
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState<Batch | null>(null);
  const [cancel, setCancel] = useState<Batch | null>(null);
  const queryClient = useQueryClient();
  const refresh = useGeoRefresh("monitoring", 5000);
  const previousProgress = useRef(new Map<string, string>());
  const query = useQuery({ queryKey: ["geo", environment, "batches", benchmarkId, page], queryFn: ({ signal }) => geoFetch<Page<Batch>>({ view: "batches", benchmarkId, page }, signal), ...refresh });
  useEffect(() => {
    if (query.data && !query.error) {
      const lastPage = Math.max(0, Math.ceil(query.data.total / query.data.pageSize) - 1);
      if (page > lastPage) setPage(lastPage);
    }
  }, [query.data, query.error, page]);
  useEffect(() => {
    let completed = false; let changed = false;
    for (const row of query.data?.rows || []) {
      const fingerprint = `${row.completed}:${row.failed}:${row.cancelled}:${row.mapping_review || 0}`;
      const previous = previousProgress.current.get(row.id);
      if (previous && previous !== fingerprint) {
        changed = true;
        if (Number(previous.split(":")[0]) !== row.completed) completed = true;
      }
      previousProgress.current.set(row.id, fingerprint);
    }
    if (completed) void invalidateGeoCompletion(queryClient, environment, true);
    else if (changed) void invalidateGeoViews(queryClient, environment, ["overview", "runs", "live"]);
  }, [query.data?.rows, queryClient, environment]);
  return <>
    <Panel title="Collection batches" description="Run all and scheduled collection continue in Supabase after you close this page. Cancelled collections are hidden; completed answers remain in reporting.">
      <ErrorMessage error={query.error}/>{query.isPending ? <Loading/> : query.error ? null : !query.data?.rows.length ? <Empty title="No collections to show">Cancelled collections are hidden. Use Run now or Run all approved questions, or enable the Monday schedule to start a collection.</Empty> : <div className="divide-y">{query.data.rows.map(batch => <article key={batch.id} className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-medium">{batch.trigger_kind === "scheduled" ? "Monday collection" : batch.trigger_kind === "all" ? "Run all approved questions" : "Run now"}{batch.cancelled_at && <span className="ml-2 text-xs text-muted-foreground">Stopped</span>}</h3><p className="mt-1 text-xs text-muted-foreground">{dateTime(batch.scheduled_for)} Toronto · {batch.total} questions</p></div>{canEdit && <div className="flex flex-wrap gap-2">{!batch.cancelled_at && batch.failed > 0 && <Button variant="outline" size="sm" disabled={busy} onClick={() => setRetry(batch)}>Retry failed ({batch.failed})</Button>}{!batch.cancelled_at && batch.queued + batch.collecting + batch.analyzing + (batch.mapping_review || 0) > 0 && <Button variant="outline" size="sm" className="border-rose-500/30 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200" disabled={busy} onClick={() => setCancel(batch)}>Cancel collection</Button>}</div>}</div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {(["queued", "collecting", "analyzing", "completed", "failed", "cancelled"] as const).map(status => <span key={status} className={`inline-flex items-center gap-1 ${status === "completed" ? "text-emerald-300" : status === "failed" && batch.failed ? "text-rose-300" : ""}`}>{batch[status]} {status}<GeoMetricHelp metric="batch" label={`${status[0].toUpperCase()}${status.slice(1)} questions`} scope="batch"/></span>)}
        </div>
        <div className="h-1.5 overflow-hidden rounded bg-muted" role="progressbar" aria-label="Completed batch questions" aria-valuemin={0} aria-valuemax={Math.max(1,batch.total)} aria-valuenow={batch.completed}><div className="h-full bg-emerald-500" style={{ width: `${batch.completed / Math.max(1, batch.total) * 100}%` }}/></div>
        {(batch.mapping_review || 0) > 0 && <div className="flex flex-wrap items-center gap-3 text-xs text-amber-200"><span>{batch.mapping_review} answers need brand mapping review; excluded from statistics.</span>{onReviewMappings && <Button variant="outline" size="sm" onClick={onReviewMappings}>Review mappings</Button>}</div>}
        {batch.needs_review > 0 && <p className="text-xs leading-5 text-amber-200">{batch.needs_review} interrupted collections need review. Open their saved answers before choosing Retry failed; a new collection may issue another paid request.</p>}
      </article>)}</div>}{query.data && !query.error && <Pager page={page} pageSize={query.data.pageSize} total={query.data.total} onChange={setPage}/>}
    </Panel>
    <ConfirmDialog open={Boolean(retry)} onClose={() => setRetry(null)} title="Retry failed reporting answers?" description="Successful answers stay unchanged. Analysis reuses saved answers where possible. Failed or interrupted collections may issue another OpenAI request. Review their evidence first. Completed retries update dashboard statistics."><Button variant="outline" disabled={busy} onClick={() => setRetry(null)}>Cancel</Button><Button disabled={busy} onClick={() => { if (retry) void perform({ action: "retryBatch", batchId: retry.id, requestKey: crypto.randomUUID() }, false, "Failed answers queued for retry.").then(() => setRetry(null)).catch(() => {}); }}>Retry failed</Button></ConfirmDialog>
    <ConfirmDialog open={Boolean(cancel)} onClose={() => setCancel(null)} title="Cancel this collection?" description={`Stop the remaining work in this collection (${cancel ? cancel.queued + cancel.collecting + cancel.analyzing + (cancel.mapping_review || 0) : 0} unfinished questions when selected). Completed answers stay in reporting. An OpenAI request already in progress may still finish and incur usage, but its result will not be saved after cancellation. Future scheduled collections will still run.`}><Button variant="outline" disabled={busy} onClick={() => setCancel(null)}>Keep collecting</Button><Button variant="destructive" disabled={busy} onClick={() => { if (cancel) void perform({ action: "cancelBatch", batchId: cancel.id }, false, "Collection stopped. Completed answers are retained; remaining work is cancelled.").then(() => setCancel(null)).catch(() => {}); }}>Cancel collection</Button></ConfirmDialog>
  </>;
}
