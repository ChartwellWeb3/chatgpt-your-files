"use client";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Compass, Radar, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SelectField({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-2 text-xs text-muted-foreground">{label}
    <select aria-label={label} {...props} className={`h-10 min-w-0 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 ${props.className || ""}`}>{children}</select></label>;
}
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center"><div className="mb-4 rounded-full border border-emerald-500/20 bg-emerald-500/5 p-3"><Radar className="h-5 w-5 text-emerald-400" /></div>
    <h3 className="font-medium">{title}</h3><div className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{children}</div>{action && <div className="mt-5">{action}</div>}</div>;
}
export function Panel({ title, description, children, action, className = "" }: { title: ReactNode; description?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-xl border bg-card ${className}`}><div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4"><div><h2 className="text-sm font-semibold">{title}</h2>{description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}</div>{action}</div>{children}</section>;
}
export function Pager({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  return <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-xs text-muted-foreground"><span>{total ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)} of ${total}` : "0 results"}</span><div className="flex gap-2">
    <Button size="sm" variant="outline" aria-label="Previous page" disabled={page === 0} onClick={() => onChange(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
    <Button size="sm" variant="outline" aria-label="Next page" disabled={(page + 1) * pageSize >= total} onClick={() => onChange(page + 1)}><ChevronRight className="h-4 w-4" /></Button></div></div>;
}
export function StateBadge({ value }: { value: string }) {
  const tone = ["active", "succeeded"].includes(value) ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : ["failed", "cancelled", "interrupted"].includes(value) ? "border-rose-500/20 bg-rose-500/10 text-rose-300" : ["draft", "running", "queued", "needs_review"].includes(value) ? "border-amber-500/20 bg-amber-500/10 text-amber-300" : "border-border bg-muted text-muted-foreground";
  const labels: Record<string, string> = { needs_review: "Needs review", active: "Approved", draft: "Needs review", succeeded: "Completed", running: "In progress", queued: "Waiting", collecting: "Collecting answer", extracting: "Analyzing answer", interrupted: "Interrupted" };
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs capitalize ${tone}`}>{labels[value] || value}</span>;
}
export function QuestionKindBadge({ kind }: { kind?: string | null }) {
  const branded = kind === "branded";
  const unbranded = kind === "unbranded";
  const Icon = branded ? Tag : Compass;
  const tone = branded ? "border-violet-400/30 bg-violet-400/10 text-violet-200" : unbranded ? "border-sky-400/30 bg-sky-400/10 text-sky-200" : "border-border bg-muted text-muted-foreground";
  const description = branded ? "Names Chartwell or another brand. Review these answers for factual accuracy and brand comparisons." : unbranded ? "Does not name a brand. Reporting answers measure whether AI mentions Chartwell on its own." : "This saved question does not have a recorded brand-name classification.";
  return <span title={description} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium ${tone}`}><Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0"/>{branded ? "With brand names" : unbranded ? "Without brand names" : "Question type not recorded"}</span>;
}
export function Loading({ label = "Loading GEO data" }: { label?: string }) {
  return <div aria-label={label} className="space-y-4 p-5"><div className="h-8 w-1/3 animate-pulse rounded bg-muted"/><div className="h-40 animate-pulse rounded bg-muted"/></div>;
}
export function ErrorMessage({ error }: { error: Error | null }) {
  return error ? <div role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-4 text-sm text-rose-200">{error.message}</div> : null;
}
export const dateTime = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
export const runState = (run: { status: string; lease_expires_at?: string | null }) => run.status === "running" && run.lease_expires_at && Date.parse(run.lease_expires_at) < Date.now() ? "interrupted" : run.status;

export function ConfirmDialog({ open, title, description, children, onClose }: { open: boolean; title: string; description: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const node = ref.current; const previous = document.activeElement as HTMLElement | null;
    node?.showModal();
    return () => { node?.close(); previous?.focus(); };
  }, [open]);
  return open ? <dialog ref={ref} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-xl border bg-card p-6 text-foreground shadow-2xl backdrop:bg-black/75"><h2 className="text-lg font-semibold">{title}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p><div className="mt-6 flex flex-wrap justify-end gap-2">{children}</div></dialog> : null;
}
