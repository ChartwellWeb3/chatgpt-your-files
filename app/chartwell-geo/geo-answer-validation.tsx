"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { geoFetch, geoWrite, safeUrl } from "@/lib/geo/client";
import type { AnswerReview, Filters, Page, ReviewedEvidence, ReviewVerdict, ValidationAnswer } from "@/lib/geo/types";
import { dateTime, Empty, ErrorMessage, Loading, Pager, Panel, QuestionKindBadge, SelectField } from "./geo-ui";
import { useGeoRefresh } from "./geo-refresh";

const verdicts: { value: ReviewVerdict; label: string }[] = [
  { value: "correct", label: "Correct" }, { value: "partially_correct", label: "Partly correct" },
  { value: "incorrect", label: "Incorrect" }, { value: "unverifiable", label: "Unable to verify" },
];

export function ReviewBadge({ verdict }: { verdict: ReviewVerdict | "unreviewed" }) {
  const tone = verdict === "correct" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
    : verdict === "incorrect" ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
      : verdict === "partially_correct" ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
        : "border-border bg-muted text-muted-foreground";
  return <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${tone}`}>{verdicts.find(item => item.value === verdict)?.label || "Not reviewed"}</span>;
}

export function AnswerValidation({ environment, filters, canReview, onEvidence }: {
  environment: string; filters: Filters; canReview: boolean; onEvidence: (runId: string) => void;
}) {
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("unreviewed");
  const refresh = useGeoRefresh();
  const query = useQuery({
    queryKey: ["geo", environment, "validation", filters, "branded", status, page],
    queryFn: ({ signal }) => geoFetch<Page<ValidationAnswer>>({ view: "validation", ...filters, questionKind: "branded", reviewStatus: status, page }, signal),
    ...refresh,
  });
  useEffect(() => {
    if (query.data && !query.error) {
      const lastPage = Math.max(0, Math.ceil(query.data.total / query.data.pageSize) - 1);
      if (page > lastPage) setPage(lastPage);
    }
  }, [query.data, query.error, page]);
  return <Panel title="Answer validation" description="Review answers to questions with brand names against a trusted reference and record whether they are correct.">
    <div className="flex flex-wrap items-end gap-4 border-b p-5">
      <SelectField label="Review status" value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}><option value="">All review statuses</option><option value="unreviewed">Not reviewed</option>{verdicts.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</SelectField>
      <p className="max-w-xl text-xs leading-5 text-muted-foreground">Questions with brand names only. Uses the benchmark, dates, topic, market, and language above. Completed reporting answers only; tests are excluded. Reviews do not change discovery statistics.</p>
    </div>
    <ErrorMessage error={query.error}/>
    {query.isPending ? <Loading label="Loading answers to validate"/> : query.error ? null : !query.data?.rows.length ? <Empty title="No branded answers match this review selection">Choose another review status, adjust the dates, or collect reporting answers for questions with brand names.</Empty> : <div className="divide-y">{query.data.rows.map(answer => <article key={answer.id} className="space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-2"><QuestionKindBadge kind={answer.question_snapshot.questionKind}/><ReviewBadge verdict={answer.review_status}/>{answer.review?.severity && <span className="text-xs capitalize text-muted-foreground">{answer.review.severity} severity</span>}</div>
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><h3 className="text-sm font-medium leading-6">{answer.question_snapshot.question}</h3><p className="mt-1 text-xs text-muted-foreground">{answer.question_snapshot.market} · {dateTime(answer.scheduled_for)} Toronto{answer.review && ` · Reviewed ${dateTime(answer.review.created_at)}`}</p></div><Button variant="outline" size="sm" onClick={() => onEvidence(answer.id)}>{canReview ? "Review answer" : "View answer"}<ArrowUpRight className="ml-1 h-3.5 w-3.5"/></Button></div>
      <p className="line-clamp-4 whitespace-pre-wrap break-words rounded-lg border bg-muted/20 p-3 text-sm leading-6 text-muted-foreground">{answer.response_preview}</p>
      {answer.review?.notes && <p className="text-xs leading-6 text-muted-foreground"><span className="font-medium text-foreground">Review note: </span>{answer.review.notes}</p>}
    </article>)}</div>}
    {query.data && !query.error && <Pager page={page} pageSize={query.data.pageSize} total={query.data.total} onChange={setPage}/>}
  </Panel>;
}

function draftFromReview(review: AnswerReview | null) {
  return { expectedReviewId: review?.id || null, verdict: review?.verdict || "correct" as ReviewVerdict,
    expectedAnswer: review?.expected_answer || "", groundTruthUrl: review?.ground_truth_url || "",
    severity: review?.severity || "medium", notes: review?.notes || "", confirmed: false };
}

export function AnswerReviewForm({ data, environment, canReview }: { data: ReviewedEvidence; environment: string; canReview: boolean }) {
  const [draft, setDraft] = useState(() => draftFromReview(data.review));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const inFlight = useRef(false);
  const queryClient = useQueryClient();
  const history = useQuery({ queryKey: ["geo", environment, "reviews", data.run.id, historyPage], enabled: historyVisible,
    queryFn: ({ signal }) => geoFetch<Page<AnswerReview>>({ view: "reviews", runId: data.run.id, page: historyPage }, signal) });
  const issue = draft.verdict === "incorrect" || draft.verdict === "partially_correct";
  const verified = draft.verdict !== "unverifiable";
  const newerReview = (data.review?.id || null) !== draft.expectedReviewId;
  const update = (values: Partial<typeof draft>) => { setDraft(current => ({ ...current, ...values })); setSaved(false); };
  async function save() {
    if (inFlight.current || newerReview) return;
    inFlight.current = true; setSaving(true); setError(null); setSaved(false);
    try {
      const review = await geoWrite<AnswerReview>({ action: "reviewAnswer", runId: data.run.id, attemptId: data.attempt!.id, ...draft });
      setDraft(current => ({ ...current, expectedReviewId: review.id, confirmed: false }));
      queryClient.setQueryData<ReviewedEvidence>(["geo", environment, "evidence", data.run.id], current => current ? { ...current, review } : current);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["geo", environment, "validation"] }), queryClient.invalidateQueries({ queryKey: ["geo", environment, "reviews", data.run.id] })]);
      setSaved(true);
    } catch (value) {
      setError(value instanceof Error ? value : new Error("The review could not be saved."));
      await queryClient.invalidateQueries({ queryKey: ["geo", environment, "evidence", data.run.id] });
    } finally { inFlight.current = false; setSaving(false); }
  }
  return <section className="space-y-4 rounded-lg border p-5" aria-label="Factual answer review">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Validate this answer</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Human review against a reference source, preferably an official Chartwell page. Reviews keep the saved AI answer and visibility metrics unchanged.</p></div><ReviewBadge verdict={data.review?.verdict || "unreviewed"}/></div>
    {data.review && <div className="space-y-2 rounded-lg border bg-muted/20 p-4 text-sm leading-6"><p className="text-xs text-muted-foreground">Last reviewed {dateTime(data.review.created_at)} Toronto · Review {data.review.review_version}{data.review.severity && ` · ${data.review.severity} severity`}</p>{data.review.expected_answer && <p><span className="font-medium">Expected answer: </span>{data.review.expected_answer}</p>}{data.review.ground_truth_url && safeUrl(data.review.ground_truth_url) && <a className="inline-flex items-center gap-1 break-all text-emerald-300 underline" href={safeUrl(data.review.ground_truth_url)} target="_blank" rel="noopener noreferrer">Open reference source<ExternalLink className="h-3.5 w-3.5 shrink-0"/></a>}{data.review.notes && <p className="whitespace-pre-wrap"><span className="font-medium">Review notes: </span>{data.review.notes}</p>}</div>}
    {canReview ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      {newerReview && <div role="status" className="rounded-lg border border-amber-500/30 p-3 text-sm leading-6">A newer review is available. Reload it before saving; this replaces your unsaved edits.<Button type="button" variant="outline" size="sm" className="ml-2" onClick={() => { setDraft(draftFromReview(data.review)); setError(null); setSaved(false); }}>Reload saved review</Button></div>}
      <div className="grid gap-4 sm:grid-cols-2"><SelectField label="Your validation result" value={draft.verdict} disabled={saving} onChange={event => update({ verdict: event.target.value as ReviewVerdict, confirmed: false })}>{verdicts.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</SelectField>{issue && <SelectField label="Issue severity" value={draft.severity} disabled={saving} onChange={event => update({ severity: event.target.value as "high" | "medium" | "low" })}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></SelectField>}</div>
      {issue && <p className="text-xs leading-5 text-muted-foreground">Use High for material care-level, service, or location misinformation. Describe the incorrect claim and the correction in your notes.</p>}
      <label className="block space-y-2 text-xs text-muted-foreground"><span>Expected correct answer{!verified && " (if known)"}</span><Textarea aria-label="Expected correct answer" rows={2} maxLength={4000} required={verified} disabled={saving} value={draft.expectedAnswer} onChange={event => update({ expectedAnswer: event.target.value, confirmed: false })} placeholder="The residence offers memory care, according to its official service page."/></label>
      <label className="block space-y-2 text-xs text-muted-foreground"><span>Reference source URL{!verified && " (optional)"}</span><Input aria-label="Reference source URL" type="url" maxLength={2000} required={verified} disabled={saving} value={draft.groundTruthUrl} onChange={event => update({ groundTruthUrl: event.target.value, confirmed: false })} placeholder="https://chartwell.com/..."/></label>
      <label className="block space-y-2 text-xs text-muted-foreground"><span>{draft.verdict === "correct" ? "Review notes (optional)" : "What is wrong, missing, or unable to be verified?"}</span><Textarea aria-label="Answer review notes" rows={3} maxLength={4000} required={draft.verdict !== "correct"} disabled={saving} value={draft.notes} onChange={event => update({ notes: event.target.value })}/></label>
      {verified && <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-emerald-500" required checked={draft.confirmed} disabled={saving} onChange={event => update({ confirmed: event.target.checked })}/>I checked this answer against the reference source.</label>}
      <ErrorMessage error={error}/>{saved && <p role="status" className="flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4"/>Review saved. Earlier reviews remain in history.</p>}
      <div className="flex justify-end"><Button type="submit" size="sm" disabled={saving || newerReview || (verified && !draft.confirmed)}>{saving ? "Saving review…" : data.review ? "Save updated review" : "Save review"}</Button></div>
    </form> : <p className="text-xs text-muted-foreground">Administrators and the content team can save answer reviews.</p>}
    {data.review && data.review.review_version > 1 && <details className="border-t pt-3" onToggle={event => setHistoryVisible(event.currentTarget.open)}><summary className="cursor-pointer text-xs text-muted-foreground">Review history</summary><ErrorMessage error={history.error}/>{historyVisible && history.isPending && <Loading label="Loading review history"/>}{history.data && !history.error && <><ol className="mt-3 space-y-3">{history.data.rows.map(review => <li key={review.id} className="space-y-1 rounded-lg border p-3"><div className="flex flex-wrap items-center gap-2"><ReviewBadge verdict={review.verdict}/><span className="text-xs text-muted-foreground">Review {review.review_version} · {dateTime(review.created_at)} Toronto</span></div>{review.expected_answer && <p className="text-xs leading-6">Expected: {review.expected_answer}</p>}{review.ground_truth_url && safeUrl(review.ground_truth_url) && <a className="text-xs text-emerald-300 underline" href={safeUrl(review.ground_truth_url)} target="_blank" rel="noopener noreferrer">Reference source</a>}{review.notes && <p className="whitespace-pre-wrap text-xs leading-6 text-muted-foreground">{review.notes}</p>}</li>)}</ol><Pager page={historyPage} pageSize={history.data.pageSize} total={history.data.total} onChange={setHistoryPage}/></>}</details>}

  </section>;
}
