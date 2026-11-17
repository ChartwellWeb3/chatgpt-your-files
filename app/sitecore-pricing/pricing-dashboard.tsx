"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RefreshCw, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PRICE_FIELDS, PRICING_ENVIRONMENTS, type PricingEnvironment, type PricingImport, type PricingRow } from "@/lib/sitecore-pricing/types";

type Bootstrap = { setup: { ready: boolean; host?: string; message?: string; configHash?: string; timezone?: string }; jobs: PricingImport[] };
type ProductionPrompt = { kind: "select" } | { kind: "upload"; file: File } | { kind: "command"; id: string; action: "run" | "retry"; filename: string; host: string };
type Detail = { job: PricingImport; rows: PricingRow[]; counts: Record<string, number>; total: number; pageSize: number };
type ResultFilter = "all" | PricingRow["status"];
const resultStatuses: PricingRow["status"][] = ["applied", "invalid", "unchanged", "skipped", "conflict", "failed", "pending", "ready", "applying"];
const busyStatuses = ["preview_queued", "previewing", "apply_queued", "applying"];
const labels: Record<string, string> = { uploaded: "Ready to run", preview_queued: "Queued", previewing: "Preparing updates", review: "Previous manual import", apply_queued: "Updates queued", applying: "Updating prices", completed: "Finished", failed: "Stopped — needs attention", cancelled: "Cancelled", ready: "Waiting to update", unchanged: "Unchanged", invalid: "Needs correction", applied: "Updated", conflict: "Content changed", pending: "Preparing", skipped: "Skipped" };
const fieldLabels = { regularPrice: "Regular", promotionPrice: "Promotion", startDate: "Start", endDate: "End" };
const canDeleteImport = (job: PricingImport) => !job.lease_expires_at || Date.parse(job.lease_expires_at) < Date.now();
async function responseData<T>(response: Response): Promise<T> {
  let value;
  try { value = await response.json(); } catch { throw new Error("The pricing request could not be completed. Refresh and check your login."); }
  if (!response.ok) throw new Error(value.error || "The pricing request failed.");
  return value as T;
}
function displayValue(field: string, value: string | undefined, timezone: string) {
  if (!value) return "—";
  if (field.endsWith("Date")) {
    const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
    if (!match) return value;
    const date = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-CA", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(date) : value;
  }
  return value;
}
export default function PricingDashboard() {
  const client = useQueryClient();
  const [environment, setEnvironment] = useState<PricingEnvironment>("dev");
  const [productionPrompt, setProductionPrompt] = useState<ProductionPrompt | null>(null);
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [activeId, setActiveId] = useState(""); const [page, setPage] = useState(0);
  const [working, setWorking] = useState(false); const [actionError, setActionError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PricingImport | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const bootstrap = useQuery({ queryKey: ["sitecore-pricing", "bootstrap", environment], queryFn: () => fetch(`/api/sitecore/pricing?environment=${environment}`, { cache: "no-store" }).then(responseData<Bootstrap>), refetchInterval: 10000, retry: false });
  const detail = useQuery({ queryKey: ["sitecore-pricing", "import", activeId, environment, page, resultFilter], enabled: Boolean(activeId),
    queryFn: () => fetch(`/api/sitecore/pricing?environment=${environment}&view=import&id=${activeId}&page=${page}${resultFilter === "all" ? "" : `&status=${resultFilter}`}`, { cache: "no-store" }).then(responseData<Detail>),
    refetchInterval: query => busyStatuses.includes(query.state.data?.job.status || "") ? 3000 : false, retry: false });
  useEffect(() => { if (!activeId && bootstrap.data?.jobs[0]) setActiveId(bootstrap.data.jobs[0].id); }, [activeId, bootstrap.data]);
  const setup = bootstrap.data?.setup; const job = detail.data?.job; const counts = detail.data?.counts || {};
  const busy = Boolean(job && busyStatuses.includes(job.status));
  const totalTargets = Object.values(counts).reduce((sum, value) => sum + Number(value), 0);
  const progress = Math.min(100, Math.max(0, job?.progress || 0));
  const selectJob = (id: string) => { setActiveId(id); setPage(0); setResultFilter("all"); setActionError(""); };
  const refresh = () => client.invalidateQueries({ queryKey: ["sitecore-pricing"] });
  async function sendCommand(id: string, action: "run" | "retry" | "cancel", targetEnvironment: PricingEnvironment, confirmProduction = false) {
    await responseData<{ saved: boolean }>(await fetch("/api/sitecore/pricing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, environment: targetEnvironment, confirmProduction, ...(confirmProduction ? { confirmedHost: setup?.host, confirmedConfigHash: setup?.configHash } : {}) }) }));
  }
  function selectEnvironment(value: PricingEnvironment) {
    setEnvironment(value); selectJob(""); setProductionPrompt(null);
    if (fileRef.current) fileRef.current.value = "";
  }
  function uploadAndRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const file = fileRef.current?.files?.[0]; if (!file) return;
    if (environment === "prod") { setProductionPrompt({ kind: "upload", file }); return; }
    void uploadFile(file, environment);
  }
  async function uploadFile(file: File, targetEnvironment: PricingEnvironment, confirmProduction = false) {
    setWorking(true); setUploading(true); setActionError("");
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Upload an XLSX workbook up to 10 MB.");
      const form = new FormData(); form.set("file", file); form.set("environment", targetEnvironment);
      const result = await responseData<{ id: string }>(await fetch("/api/sitecore/pricing", { method: "POST", body: form }));
      selectJob(result.id); if (fileRef.current) fileRef.current.value = "";
      setUploading(false);
      await sendCommand(result.id, "run", targetEnvironment, confirmProduction);
    } catch (error) { setActionError(error instanceof Error ? error.message : "The import could not be started."); }
    finally { await refresh(); setWorking(false); setUploading(false); }
  }
  function command(action: "run" | "retry" | "cancel") {
    if (!job) return;
    if (job.environment === "prod" && action !== "cancel") {
      setProductionPrompt({ kind: "command", id: job.id, action, filename: job.filename, host: job.target_host }); return;
    }
    void executeCommand(job.id, job.environment, action);
  }
  async function executeCommand(id: string, targetEnvironment: PricingEnvironment, action: "run" | "retry" | "cancel", confirmProduction = false) {
    setWorking(true); setActionError("");
    try { await sendCommand(id, action, targetEnvironment, confirmProduction); }
    catch (error) { setActionError(error instanceof Error ? error.message : "The action failed."); }
    finally { await refresh(); setWorking(false); }
  }
  function confirmProduction() {
    const prompt = productionPrompt; setProductionPrompt(null);
    if (prompt?.kind === "select") selectEnvironment("prod");
    else if (prompt?.kind === "upload") void uploadFile(prompt.file, "prod", true);
    else if (prompt?.kind === "command") void executeCommand(prompt.id, "prod", prompt.action, true);
  }
  async function deleteImport() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setWorking(true); setDeleteError("");
    try {
      await responseData(await fetch("/api/sitecore/pricing", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: target.id }) }));
      // Cancel stale reads before changing selection, so a completed request
      // cannot restore the deleted import or leave the detail panel loading.
      await client.cancelQueries({ queryKey: ["sitecore-pricing"] });
      const remaining = (client.getQueryData<Bootstrap>(["sitecore-pricing", "bootstrap", environment])?.jobs || []).filter(item => item.id !== target.id);
      client.setQueryData<Bootstrap>(["sitecore-pricing", "bootstrap", environment], data => data ? { ...data, jobs: remaining } : data);
      client.removeQueries({ queryKey: ["sitecore-pricing", "import", target.id] });
      if (activeId === target.id) selectJob(remaining[0]?.id || "");
      setDeleteTarget(null);
      await refresh();
    } catch (error) { setDeleteError(error instanceof Error ? error.message : "The import could not be deleted."); }
    finally { setWorking(false); }
  }
  function resultTable() {
    return <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <h3 className="font-medium">Results</h3>
        <div className="flex items-center gap-2"><label htmlFor="pricing-result-filter" className="text-sm text-muted-foreground">Filter by result</label>
          <select id="pricing-result-filter" value={resultFilter} disabled={working} className="h-10 rounded-md border bg-background px-3 text-sm" onChange={event => { setResultFilter(event.target.value as ResultFilter); setPage(0); }}>
            <option value="all">All results ({totalTargets})</option>
            {resultStatuses.map(status => <option key={status} value={status}>{labels[status]} ({counts[status] || 0})</option>)}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="p-4">Residence / suite</th><th className="p-4">Prices and dates</th><th className="p-4">Result</th></tr></thead>
        <tbody className="divide-y">{detail.data?.rows.map(row => <tr key={row.id} className={row.status === "invalid" ? "align-top bg-red-500/5" : "align-top"}>
          <td className="min-w-[210px] p-4"><p className="font-medium">{row.source.residence || "Unnamed residence"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{row.source.propertyId} · {row.source.careLevel.toUpperCase()} · {row.source.suiteTitle}</p>
            <p className="mt-1 text-xs text-muted-foreground">Excel row {row.row_number} · {row.language.toUpperCase()}</p>
          </td>
          <td className="min-w-[260px] p-4"><dl className="space-y-1">{PRICE_FIELDS.map(field => <div key={field} className="grid grid-cols-[70px_1fr] gap-2 text-xs"><dt className="text-muted-foreground">{fieldLabels[field]}</dt><dd>{row.after_values ? <>{displayValue(field, row.before_values?.[field], setup?.timezone || "America/Toronto")} → {displayValue(field, row.after_values[field], setup?.timezone || "America/Toronto")}</> : row.source.values[field] === "" ? "Clear" : row.source.values[field] || "Keep existing"}</dd></div>)}</dl></td>
          <td className="min-w-[180px] max-w-md p-4"><span className={row.status === "invalid" ? "inline-flex rounded-full border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-700 dark:text-red-300" : "text-xs"}>{labels[row.status] || row.status}</span>
          </td>
        </tr>)}</tbody>
      </table></div>
      {!detail.data?.rows.length && <p className="p-8 text-center text-sm text-muted-foreground">{detail.isFetching ? "Loading…" : "No rows to show."}</p>}
      <div className="flex items-center justify-between border-t p-3"><p className="text-xs text-muted-foreground">{detail.data?.total || 0} targets · Page {page + 1}</p><div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={(page + 1) * (detail.data?.pageSize || 25) >= (detail.data?.total || 0)} onClick={() => setPage(page + 1)}>Next</Button>
      </div></div>
    </div>;
  }
  return <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-8 sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold tracking-tight">Suite pricing <span className="ml-2 rounded border border-amber-500/40 px-2 py-1 align-middle text-xs text-amber-500">{environment.toUpperCase()}</span></h1><p className="mt-3 text-sm text-muted-foreground">Choose your Excel file and click Run. Eligible English and French prices update automatically.</p></div><div className="flex items-end gap-3"><div><label htmlFor="pricing-environment" className="mb-1 block text-xs font-medium">Sitecore environment</label><select id="pricing-environment" value={environment} disabled={working} className="h-10 rounded-md border bg-background px-3 text-sm" onChange={event => { const value = event.target.value as PricingEnvironment; if (value === "prod" && environment !== "prod") setProductionPrompt({ kind: "select" }); else selectEnvironment(value); }}>{PRICING_ENVIRONMENTS.map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></div><Button variant="outline" onClick={refresh} disabled={working}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div></header>
    {(bootstrap.error || detail.error || actionError) && <p role="alert" className="rounded-lg border border-red-500/40 p-4 text-sm">{actionError || bootstrap.error?.message || detail.error?.message}</p>}
    {setup && !setup.ready && <p role="alert" className="rounded-lg border border-amber-500/40 p-4 text-sm">{setup.message}</p>}
    <section className="rounded-xl border bg-card p-5"><form onSubmit={uploadAndRun} className="flex flex-wrap items-end gap-4">
      <div className="min-w-0 flex-1"><label htmlFor="pricing-file" className="mb-2 block text-sm font-medium">Market rate tracker</label><input ref={fileRef} id="pricing-file" type="file" accept=".xlsx" required disabled={!setup?.ready || working} className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-2 file:text-foreground" /></div><Button type="submit" disabled={!setup?.ready || working}><Play className="mr-2 h-4 w-4" />{working ? "Starting…" : "Run"}</Button>
    </form><p className="mt-3 text-xs text-muted-foreground">XLSX up to 10 MB · Promotion price and both dates are required together; leaving all three blank removes the promotion · Updates {environment.toUpperCase()} authoring content; publish through Sitecore.</p>{setup?.host && <p className="mt-2 break-all text-xs text-muted-foreground">Target: {setup.host}</p>}{uploading && <div className="mt-3 space-y-2"><p role="status" className="text-sm">Preparing your import… 0%</p><div role="progressbar" aria-label="Preparing pricing import" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} className="h-3 rounded-full bg-muted" /></div>}</section>
    <div className="grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 font-medium">Recent imports</h2>
        {!bootstrap.data?.jobs.length && <p className="text-sm text-muted-foreground">Your imports will appear here.</p>}
        <div className="max-h-[650px] space-y-2 overflow-y-auto">{bootstrap.data?.jobs.map(item => <div key={item.id} className={`flex items-start rounded-lg border ${activeId === item.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"}`}>
          <button type="button" disabled={working} onClick={() => selectJob(item.id)} aria-pressed={activeId === item.id} className="min-w-0 flex-1 p-3 text-left text-sm">
            <span className="block break-words font-medium">{item.filename}</span><span className="mt-1 block text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString("en-CA")}</span><span className="mt-1 block text-xs">{labels[item.status] || item.status}</span>
          </button>
          <Button size="icon" variant="ghost" className="mr-1 mt-1 h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" disabled={working || !canDeleteImport(item)} aria-label={`Delete import ${item.filename}`} title={canDeleteImport(item) ? "Delete saved import data" : "Wait for processing to finish or cancel remaining work first"} onClick={() => { setDeleteError(""); setDeleteTarget(item); }}><Trash2 className="h-4 w-4" /></Button>
        </div>)}</div>
      </aside>
      <section className="min-w-0 space-y-4">
        {!activeId && <p className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">Choose a workbook to get started.</p>}{activeId && detail.isPending && detail.isFetching && <p role="status">Loading import…</p>}
        {activeId && detail.isError && <div className="rounded-xl border p-5 text-sm"><p>This import could not be loaded. Resolve the setup message above, then refresh. Saved imports can still be deleted from the list.</p><Button variant="outline" size="sm" className="mt-3" onClick={refresh}>Try again</Button></div>}
        {job && <><div className="rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="break-words text-lg font-medium">{job.filename}</h2><p className="mt-1 break-all text-xs text-muted-foreground">{job.environment.toUpperCase()} - {job.target_host}</p><p role="status" className="mt-1 text-sm text-muted-foreground">{labels[job.status] || job.status}</p></div><a href={`/api/sitecore/pricing?environment=${job.environment}&view=export&id=${job.id}`} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm"><Download className="h-4 w-4" />Download report</a></div>
          {job.execution_mode === "edge_auto" ? <><div className="mt-5 flex justify-between text-sm"><span>{busy ? "Processing prices" : job.status === "completed" ? "Processing complete" : "Import progress"}</span><span>{progress}%</span></div><div role="progressbar" aria-label="Pricing import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="mt-2 h-3 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>{busy && <p className="mt-2 text-xs text-muted-foreground">You can close this page. Your import continues in the background.</p>}</> : <p className="mt-4 text-sm text-muted-foreground">Upload this workbook again to use the new Run flow.</p>}
          <div className="mt-5 flex flex-wrap gap-4 text-sm"><span><strong>{counts.applied || 0}</strong> updated</span><span><strong>{counts.unchanged || 0}</strong> unchanged</span><span><strong>{counts.skipped || 0}</strong> skipped</span><span className="text-muted-foreground">{totalTargets} targets</span></div>
          <div className="mt-4 flex flex-wrap gap-3">
            {job.status === "uploaded" && <Button disabled={working || job.config_hash !== setup?.configHash} onClick={() => command("run")}>Run</Button>}
            {job.execution_mode === "edge_auto" && (job.status === "failed" || (job.status === "completed" && Boolean(counts.failed))) && <Button variant="outline" disabled={working || job.config_hash !== setup?.configHash} onClick={() => command("retry")}>Retry interrupted updates</Button>}
            {job.execution_mode === "edge_auto" && !["completed", "cancelled"].includes(job.status) && (!job.lease_expires_at || Date.parse(job.lease_expires_at) < Date.now()) && <Button variant="outline" disabled={working} onClick={() => command("cancel")}>Cancel remaining work</Button>}
          </div>
        </div>
        <section aria-label="Results">{resultTable()}</section></>}
      </section>
    </div>
    <AlertDialog open={Boolean(productionPrompt)} onOpenChange={open => { if (!open) setProductionPrompt(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{productionPrompt?.kind === "select" ? "Switch to PROD?" : "Run pricing updates in PROD?"}</AlertDialogTitle><AlertDialogDescription asChild><div className="space-y-3">
        {productionPrompt?.kind === "select" ? <p>You are selecting the production Sitecore environment. Before each run or retry, you will be asked to confirm the workbook and target.</p> : <><p>This will automatically save eligible English and French pricing changes in production authoring content. Promotion price and both dates must be supplied together. Leaving all three blank clears the promotion and its dates. Publishing is handled separately in Sitecore.</p><p className="break-words font-medium">{productionPrompt?.kind === "upload" ? productionPrompt.file.name : productionPrompt?.filename}</p><p className="break-all">Target: {productionPrompt?.kind === "command" ? productionPrompt.host : setup?.host}</p></>}
      </div></AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmProduction}>{productionPrompt?.kind === "select" ? "Use PROD" : "Yes, run on PROD"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => { if (!open && !working) setDeleteTarget(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete saved import?</AlertDialogTitle><AlertDialogDescription>
        Permanently delete “{deleteTarget?.filename}”, including its source rows, results, and saved before/after values. Remaining work will stop. Sitecore prices will stay as they are.
      </AlertDialogDescription></AlertDialogHeader>
        {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
        <AlertDialogFooter><AlertDialogCancel disabled={working}>Keep import</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={working} onClick={event => { event.preventDefault(); void deleteImport(); }}>{working ? "Deleting…" : "Delete import"}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
