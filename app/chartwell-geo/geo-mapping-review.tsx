"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { geoFetch, geoWrite, safeUrl } from "@/lib/geo/client";
import type { Brand, MappingReview, Page, ReviewedEvidence } from "@/lib/geo/types";
import { dateTime, Empty, ErrorMessage, Loading, Pager, Panel, QuestionKindBadge, SelectField } from "./geo-ui";
import { invalidateGeoViews, useGeoRefresh } from "./geo-refresh";

export function MappingReviewQueue({ environment, isAdmin, onEvidence }: { environment: string; isAdmin: boolean; onEvidence: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const refresh = useGeoRefresh("any");
  const query = useQuery({ queryKey: ["geo", environment, "mappingReviews", page],
    queryFn: ({ signal }) => geoFetch<Page<MappingReview>>({ view: "mappingReviews", page }, signal), ...refresh });
  useEffect(() => {
    if (query.data && !query.error) {
      const lastPage = Math.max(0, Math.ceil(query.data.total / query.data.pageSize)-1);
      if (page>lastPage) setPage(lastPage);
    }
  }, [query.data, query.error, page]);
  return <Panel title="Brand mappings needing review" description="Unresolved residence-to-operator relationships in this environment, across all dates and benchmarks. Saved answers stay excluded from brand statistics until resolved.">
    <p className="border-b px-5 py-3 text-xs leading-6 text-muted-foreground">{isAdmin ? "Open an answer, check a reference source, and verify its parent brand. The worker then revalidates the saved analysis." : "An administrator must verify these relationships. You can inspect the saved answers and sources."} Test results remain excluded after verification.</p>
    <ErrorMessage error={query.error}/>
    {query.isPending ? <Loading label="Loading mapping reviews"/> : query.error ? null : !query.data?.rows.length ? <Empty title="No unresolved brand mappings">Answers that need an administrator to confirm a residence's parent brand will appear here.</Empty> : <div className="divide-y">{query.data.rows.map(item => <article key={item.id} className="space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-2"><QuestionKindBadge kind={item.question_snapshot.questionKind}/><span className="text-xs text-amber-200">Needs review</span>{item.purpose === "test" && <span className="text-xs text-muted-foreground">Test — excluded from statistics</span>}</div>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-medium">{item.observed_name} → {item.proposed_brand_name}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.question_snapshot.question}</p><p className="mt-1 text-xs text-muted-foreground">{item.question_snapshot.market} · Awaiting verification since {dateTime(item.created_at)} Toronto</p></div><Button variant="outline" size="sm" onClick={() => onEvidence(item.run_id)}>{isAdmin ? "Review mapping" : "View answer"}<ArrowUpRight className="ml-1 h-3.5 w-3.5"/></Button></div>
      <blockquote className="whitespace-pre-wrap border-l-2 border-amber-500/30 pl-3 text-xs leading-6 text-muted-foreground">{item.evidence_quote}</blockquote>
    </article>)}</div>}
    {query.data && !query.error && <Pager page={page} pageSize={query.data.pageSize} total={query.data.total} onChange={setPage}/>}
  </Panel>;
}

export function MappingReviewPanel({ data, environment, brands, isAdmin }: { data: ReviewedEvidence; environment: string; brands: Brand[]; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<Error | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const items = (data.mappingReviews || []).filter(item => item.status === "verified" || data.run.status === "needs_review");
  const recheckAvailable = isAdmin && (data.run.status === "needs_review" || (data.run.status === "failed" && data.attempt?.error_stage === "extraction"));
  if (!items.length && !recheckAvailable && data.run.status !== "needs_review") return null;
  return <section className="space-y-4 rounded-lg border border-amber-500/30 p-5" aria-label="Brand mapping verification">
    <div><h3 className="text-sm font-semibold">Brand ownership verification</h3><p className="mt-2 text-xs leading-6 text-muted-foreground">Confirm which operator owns or operates each named residence using a trusted reference. The saved answer and AI extraction remain preserved. {data.run.purpose === "test" ? "This test remains excluded from reporting." : "Reporting resumes only after every unresolved mapping is verified and the saved analysis passes validation."}</p></div>
    {items.map(item => <div key={item.id} className="space-y-3 rounded-lg border p-4">
      <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Residence / observed name</dt><dd className="mt-1 font-medium">{item.observed_name}</dd></div><div><dt className="text-xs text-muted-foreground">AI-proposed parent brand</dt><dd className="mt-1 font-medium">{item.proposed_brand_name}</dd></div></dl>
      <blockquote className="whitespace-pre-wrap border-l-2 border-amber-500/30 pl-3 text-xs leading-6 text-muted-foreground">{item.evidence_quote}</blockquote>
      {item.status === "verified" ? <div className="space-y-2 text-sm text-emerald-300"><p>Verified parent: {item.verified_brand_name}{item.verified_at && ` · ${dateTime(item.verified_at)} Toronto`}</p>{item.reference_url && safeUrl(item.reference_url) && <a href={safeUrl(item.reference_url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">Reference source<ExternalLink className="h-3.5 w-3.5"/></a>}{item.verification_notes && <p className="whitespace-pre-wrap text-xs leading-6 text-muted-foreground">{item.verification_notes}</p>}</div>
        : isAdmin && data.run.status === "needs_review" ? <VerifyMappingForm item={item} environment={environment} brands={brands}/>
          : <p className="text-xs text-amber-200">Administrator verification required.</p>}
    </div>)}
    {recheckAvailable && <div className="space-y-2 border-t pt-4"><p className="text-xs leading-6 text-muted-foreground">After updating the catalog elsewhere, or for an older failed ownership analysis, recheck the existing extraction. This does not call AI or search the web.</p><ErrorMessage error={error}/><Button variant="outline" size="sm" disabled={rechecking} onClick={async () => {
      setRechecking(true); setError(null);
      try { await geoWrite({ action: "recheckMapping", runId: data.run.id }); await invalidateGeoViews(queryClient, environment, ["evidence", "mappingReviews", "live", "runs", "tests", "batches", "overview"]); }
      catch (value) { setError(value instanceof Error ? value : new Error("Saved analysis could not be queued.")); }
      finally { setRechecking(false); }
    }}>{rechecking ? "Queueing recheck…" : "Recheck saved analysis"}</Button></div>}
  </section>;
}

function VerifyMappingForm({ item, environment, brands }: { item: MappingReview; environment: string; brands: Brand[] }) {
  const [brandId, setBrandId] = useState(item.proposed_brand_id || "new");
  const [brandName, setBrandName] = useState(item.proposed_brand_name);
  const [referenceUrl, setReferenceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [message, setMessage] = useState("");
  const queryClient = useQueryClient();
  return <form className="space-y-3" onSubmit={async event => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await geoWrite<{ queued: boolean; pendingMappings: number }>({ action: "verifyMapping", reviewId: item.id, brandId: brandId === "new" ? null : brandId, brandName, referenceUrl, notes, confirmed });
      setMessage(result.queued ? "Verified. The saved analysis is queued for revalidation." : "Verified. Other mappings in this answer still need review.");
      await invalidateGeoViews(queryClient, environment, ["evidence", "mappingReviews", "catalogs", "live", "runs", "tests", "batches", "overview"]);
    } catch (value) { setError(value instanceof Error ? value : new Error("Mapping could not be verified.")); }
    finally { setBusy(false); }
  }}>
    <SelectField label={`Verified parent brand for ${item.observed_name}`} value={brandId} disabled={busy} onChange={event => { setBrandId(event.target.value); setConfirmed(false); }}><option value="new">Add a verified parent brand…</option>{item.proposed_brand_id && !brands.some(brand => brand.id === item.proposed_brand_id) && <option value={item.proposed_brand_id}>{item.proposed_brand_name}</option>}{brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</SelectField>
    {brandId === "new" && <label className="block space-y-2 text-xs text-muted-foreground"><span>Parent brand name</span><Input aria-label={`Parent brand name for ${item.observed_name}`} required maxLength={160} value={brandName} disabled={busy} onChange={event => { setBrandName(event.target.value); setConfirmed(false); }}/></label>}
    <label className="block space-y-2 text-xs text-muted-foreground"><span>Reference URL establishing this relationship</span><Input aria-label={`Ownership reference URL for ${item.observed_name}`} type="url" required maxLength={2000} placeholder="https://operator.example/community" value={referenceUrl} disabled={busy} onChange={event => { setReferenceUrl(event.target.value); setConfirmed(false); }}/></label>
    <label className="block space-y-2 text-xs text-muted-foreground"><span>Verification notes (optional)</span><Textarea aria-label={`Verification notes for ${item.observed_name}`} maxLength={4000} rows={2} value={notes} disabled={busy} onChange={event => setNotes(event.target.value)}/></label>
    <label className="flex items-start gap-2 text-sm leading-6"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-emerald-500" required checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)}/>I checked that the reference identifies this residence as part of the selected parent brand.</label>
    <ErrorMessage error={error}/>{message && <p role="status" className="text-xs text-emerald-300">{message}</p>}
    <Button type="submit" size="sm" disabled={busy || !confirmed}>{busy ? "Verifying…" : "Verify relationship"}</Button>
  </form>;
}
