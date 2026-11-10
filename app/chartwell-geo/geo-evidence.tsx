"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { geoFetch, safeUrl } from "@/lib/geo/client";
import type { AttemptDetails, Brand, ReviewedEvidence, Source } from "@/lib/geo/types";
import { QuestionKindBadge, dateTime, ErrorMessage, Loading, runState, StateBadge } from "./geo-ui";
import { AnswerReviewForm } from "./geo-answer-validation";
import { invalidateGeoCompletion, useGeoRefresh } from "./geo-refresh";
import { MappingReviewPanel } from "./geo-mapping-review";

export function AnswerText({ text, sources }: { text: string; sources: Source[] }) {
  const citations = sources.filter(source => source.source_kind === "cited" && source.citation_start !== null && source.citation_end !== null && safeUrl(source.url))
    .sort((a, b) => Number(a.citation_start) - Number(b.citation_start));
  const nodes: ReactNode[] = []; let cursor = 0;
  for (const [index, citation] of Array.from(citations.entries())) {
    const start = Number(citation.citation_start); const end = Number(citation.citation_end);
    if (start < cursor || end > text.length || end <= start) continue;
    nodes.push(text.slice(cursor, start));
    nodes.push(<a key={index} href={safeUrl(citation.url)} target="_blank" rel="noopener noreferrer" className="text-emerald-300 underline decoration-emerald-500/40 underline-offset-4" title={citation.title || citation.domain}>{text.slice(start, end)}</a>);
    cursor = end;
  }
  nodes.push(text.slice(cursor));
  return <div className="whitespace-pre-wrap break-words text-sm leading-7">{nodes}</div>;
}
export function EvidenceDialog({ environment, runId, onClose, canReview = false, canManageMappings = false, brands = [] }: { environment: string; runId: string; onClose: () => void; canReview?: boolean; canManageMappings?: boolean; brands?: Brand[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rawVisible, setRawVisible] = useState(false);
  const [technicalVisible, setTechnicalVisible] = useState(false);
  const [previousId, setPreviousId] = useState<string | null>(null);
  const refresh = useGeoRefresh("any", 5000);
  const query = useQuery({ queryKey: ["geo", environment, "evidence", runId], queryFn: ({ signal }) => geoFetch<ReviewedEvidence>({ view: "evidence", runId }, signal), ...refresh,
    refetchInterval: query => refresh.refetchInterval !== false && ["queued", "running"].includes(query.state.data?.run.status || "") ? 5000 : false });
  const data = query.data;
  const queryClient = useQueryClient();
  const previousStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (data && previousStatus.current && ["queued", "running"].includes(previousStatus.current) && ["succeeded", "failed", "cancelled", "needs_review"].includes(data.run.status)) {
      void invalidateGeoCompletion(queryClient, environment, (data.run.purpose || (data.run.source === "scheduled" ? "monitoring" : "test")) === "monitoring");
    }
    if (data) previousStatus.current = data.run.status;
  }, [data?.run.status, queryClient, environment]);
  const raw = useQuery({ queryKey: ["geo", environment, "raw", runId, data?.attempt?.id], enabled: technicalVisible && rawVisible && Boolean(data?.attempt), queryFn: ({ signal }) => geoFetch<Record<string, unknown>>({ view: "raw", runId, attemptId: data!.attempt!.id }, signal), staleTime: 60000 });
  const previous = useQuery({ queryKey: ["geo", environment, "attempt", runId, previousId], enabled: technicalVisible && Boolean(previousId), queryFn: ({ signal }) => geoFetch<AttemptDetails>({ view: "attempt", runId, attemptId: previousId! }, signal), staleTime: 60000 });
  useEffect(() => {
    const node = dialog.current; const previous = document.activeElement as HTMLElement | null;
    if (node && !node.open) { if (typeof node.showModal === "function") node.showModal(); else node.setAttribute("open", ""); }
    return () => { node?.close?.(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} aria-labelledby="geo-evidence-title" onCancel={event => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-6xl overflow-y-auto rounded-xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/75">
    <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b bg-card px-5 py-4"><div><h2 id="geo-evidence-title" className="font-semibold">Answer details</h2><p className="mt-1 text-xs text-muted-foreground">The saved question, the AI answer, and the sources it used</p></div><Button size="sm" variant="ghost" aria-label="Close evidence" onClick={onClose}><X className="h-5 w-5"/></Button></div>
    <div className="space-y-5 p-5"><ErrorMessage error={query.error}/>{query.isPending && <Loading label="Loading evidence"/>}{data && <>
      {["queued", "running"].includes(data.run.status) && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm leading-6">Your answer is queued or processing in Supabase. This panel updates automatically. You can close it and return to the saved history later.</p>}
      {runState(data.run) === "interrupted" && <p role="alert" className="rounded-lg border border-amber-500/25 p-4 text-sm text-amber-200">This call was interrupted and is excluded from metrics. Review any saved answer before collecting another answer.</p>}
      <div className="rounded-lg border bg-card p-5"><div className="mb-3 flex flex-wrap items-center gap-2"><StateBadge value={runState(data.run)}/><QuestionKindBadge kind={data.run.question_snapshot.questionKind}/><span className="text-xs text-muted-foreground">{(data.run.purpose || (data.run.source === "scheduled" ? "monitoring" : "test")) === "test" ? "Test — excluded from statistics" : data.run.source === "manual" ? "Run now — included in reporting when completed" : "Scheduled reporting answer"} · {dateTime(data.run.scheduled_for)} Toronto</span></div><h3 className="text-lg font-medium leading-7">{data.run.question_snapshot.question}</h3><p className="mt-3 text-xs text-muted-foreground">{data.run.question_snapshot.topic} / {data.run.question_snapshot.market} · {data.run.question_snapshot.language.toUpperCase()} · Version {data.run.question_revision}</p><p className="mt-2 text-xs text-muted-foreground">Benchmark: {data.benchmark.name}</p></div>
      {data.attempt?.error_message && <div role="alert" className={`rounded-lg border p-4 text-sm ${data.run.status === "needs_review" ? "border-amber-500/25 bg-amber-500/5 text-amber-200" : "border-rose-500/25 bg-rose-500/5 text-rose-200"}`}>{data.attempt.error_message} This answer is excluded from metrics.</div>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]"><section className="min-w-0 rounded-lg border p-5"><h3 className="mb-4 text-sm font-semibold">Saved answer</h3>{data.attempt?.response_text ? <AnswerText text={data.attempt.response_text} sources={data.sources}/> : <p className="text-sm text-muted-foreground">An answer has not been saved yet.</p>}</section><div className="min-w-0 space-y-5"><section className="rounded-lg border p-5"><h3 className="text-sm font-semibold">Brands mentioned</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">Ranks come from numbered recommendations. A mention without a numbered rank still counts toward visibility.</p>{data.mentions.length ? <div className="mt-4 space-y-5">{data.mentions.map(mention => <div key={mention.brand_id}><div className="flex justify-between gap-2 text-sm"><span className="font-medium">{mention.observed_name}</span><span className="text-emerald-300">{mention.position == null ? "No numbered rank" : `#${mention.position}`}</span></div><blockquote className="mt-2 border-l-2 border-emerald-500/30 pl-3 text-xs leading-6 text-muted-foreground">{mention.evidence_quote}</blockquote></div>)}</div> : data.run.status === "needs_review" && data.extractedMentions?.length ? <div className="mt-4 space-y-4"><p className="text-xs text-amber-200">Saved AI extraction — excluded from statistics until ownership is verified.</p>{data.extractedMentions.map((mention, index) => <div key={index} className="text-xs leading-6"><p className="font-medium">{mention.observed_name}</p><p className="text-muted-foreground">Proposed parent: {mention.name}</p><blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-amber-500/30 pl-3 text-muted-foreground">{mention.evidence_quote}</blockquote></div>)}</div> : <p className="mt-3 text-xs leading-6 text-muted-foreground">{data.run.status === "succeeded" ? "No retirement operator brands were detected in this answer." : "Brand analysis has not completed yet."}</p>}</section>
      <section className="rounded-lg border p-5"><h3 className="text-sm font-semibold">Links cited in the answer</h3><SourceList sources={data.sources.filter(source => source.source_kind === "cited")}/><details className="mt-4 border-t pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">Other websites consulted ({data.sources.filter(source => source.source_kind === "consulted").length})</summary><SourceList sources={data.sources.filter(source => source.source_kind === "consulted")}/></details></section></div></div>
      <MappingReviewPanel data={data} environment={environment} brands={brands} isAdmin={canManageMappings}/>
      {data.run.question_snapshot.questionKind === "branded" && data.run.status === "succeeded" && data.attempt?.id === data.run.selected_attempt_id && (data.run.purpose || (data.run.source === "scheduled" ? "monitoring" : "test")) === "monitoring" && <AnswerReviewForm key={data.run.id} data={data} environment={environment} canReview={canReview}/>}
      <details className="rounded-lg border p-4" onToggle={event => setTechnicalVisible(event.currentTarget.open)}><summary className="cursor-pointer text-xs font-medium">Technical details and collection attempts</summary><div className="mt-4 space-y-4"><p className="break-words text-xs leading-6 text-muted-foreground">Requested model: {data.benchmark.model}<br/>Returned model: {data.attempt?.returned_model || "Pending"}<br/>Run ID: {data.run.id}</p>{data.attempts.map(attempt => <div key={attempt.id} className="flex flex-wrap gap-3 text-xs"><span>Attempt {attempt.attempt_number}</span><StateBadge value={attempt.status}/><span className="text-muted-foreground">{dateTime(attempt.started_at)}</span>{attempt.id !== data.attempt?.id && <Button variant="outline" size="sm" onClick={() => setPreviousId(previousId === attempt.id ? null : attempt.id)}>{previousId === attempt.id ? "Hide" : "Load"} answer for attempt {attempt.attempt_number}</Button>}</div>)}<ErrorMessage error={previous.error}/>{previousId && previous.isPending && <Loading label="Loading saved attempt"/>}{previousId && previous.data && !previous.error && <section className="space-y-3 rounded-lg border p-4"><h4 className="text-sm font-medium">Saved attempt {previous.data.attempt.attempt_number}</h4><p className="text-xs text-muted-foreground">Reporting uses only the selected successful attempt.</p>{previous.data.attempt.response_text ? <AnswerText text={previous.data.attempt.response_text} sources={previous.data.sources}/> : <p className="text-xs text-muted-foreground">No answer was saved for this attempt.</p>}<SourceList sources={previous.data.sources}/></section>}{data.attempt && <Button variant="outline" size="sm" onClick={() => setRawVisible(!rawVisible)}>{rawVisible ? "Hide" : "Load"} provider JSON</Button>}<ErrorMessage error={raw.error}/>{rawVisible && raw.isPending && <Loading/>}{rawVisible && raw.data && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-4 text-[11px]">{JSON.stringify(raw.data, null, 2)}</pre>}</div></details>
    </>}</div>
  </dialog>;
}
function SourceList({ sources }: { sources: Source[] }) {
  return sources.length ? <ul className="mt-3 space-y-3">{sources.map((source, index) => <li key={`${source.url}-${index}`} className="text-xs"><a href={safeUrl(source.url)} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-start gap-1.5 break-words text-emerald-300 hover:underline"><span>{source.title || source.domain}</span><ExternalLink className="mt-0.5 h-3 w-3 shrink-0"/></a><p className="mt-1 break-all text-[11px] text-muted-foreground">{source.domain}</p></li>)}</ul> : <p className="mt-3 text-xs text-muted-foreground">No sources reported.</p>;
}
