"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialDates } from "@/lib/geo/client";
import type { Bootstrap, Filters } from "@/lib/geo/types";
import { SelectField } from "./geo-ui";

export function ResultFilters({ bootstrap, filters, onChange, overview = false }: {
  bootstrap: Bootstrap;
  filters: Filters;
  onChange: (filters: Filters) => void;
  overview?: boolean;
}) {
  const update = (values: Partial<Filters>) => onChange({ ...filters, ...values });
  const benchmark = bootstrap.benchmarks.find(row => row.id === filters.benchmarkId);
  const narrowed = [filters.topicId, filters.marketId, filters.language, filters.questionKind !== "unbranded"].filter(Boolean).length;
  const selection = [
    bootstrap.topics.find(row => row.id === filters.topicId)?.name || "All topics",
    bootstrap.markets.find(row => row.id === filters.marketId)?.name || "All markets",
    filters.language === "en" ? "English" : filters.language === "fr" ? "French" : "English + French",
    overview ? "Discovery metrics and answer validation" : filters.questionKind === "unbranded" ? "Questions without brand names" : filters.questionKind === "branded" ? "Questions with brand names" : "All question types",
  ];

  function recentDays(days: number) {
    const { to } = initialDates();
    const from = new Date(`${to}T12:00:00Z`);
    from.setUTCDate(from.getUTCDate() - days + 1);
    update({ from: from.toISOString().slice(0, 10), to });
  }

  return <section aria-label="Result filters" className="overflow-hidden rounded-xl border bg-card">
    <div className="grid gap-5 p-5 lg:grid-cols-[minmax(220px,1fr)_minmax(0,1.5fr)]">
      <div>
        <SelectField label="Benchmark" value={filters.benchmarkId} onChange={event => update({ benchmarkId: event.target.value })}>
          {bootstrap.benchmarks.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </SelectField>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">A saved set of AI models and settings. Results stay separate for each benchmark.</p>
        {benchmark && <p className="mt-1 break-words text-xs text-muted-foreground">Answer model: <span className="text-foreground/80">{benchmark.model}</span></p>}
      </div>
      <div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-2 text-xs text-muted-foreground"><span>From</span><Input aria-label="Period start date" type="date" className="[color-scheme:dark]" value={filters.from} max={filters.to} onChange={event => update({ from: event.target.value })}/></label>
          <label className="space-y-2 text-xs text-muted-foreground"><span>To</span><Input aria-label="Period end date" type="date" className="[color-scheme:dark]" value={filters.to} min={filters.from} onChange={event => update({ to: event.target.value })}/></label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {[7, 30, 90].map(days => <Button key={days} variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => recentDays(days)}>Last {days} days</Button>)}
          <span className="ml-auto text-xs text-muted-foreground">Toronto time</span>
        </div>
      </div>
    </div>

    <p className="border-t px-5 py-3 text-xs leading-5 text-muted-foreground">Reporting includes scheduled collection, Run now, and Run all. Test answers never affect statistics.</p>

    <details className="group border-t">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-5 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground"/>
        <span className="font-medium">Refine results{narrowed > 0 ? ` (${narrowed})` : ""}</span>
        <span className="order-last w-full text-xs leading-5 text-muted-foreground lg:order-none lg:ml-2 lg:w-auto">{selection.join(" · ")}</span>
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"/>
      </summary>
      <div className="space-y-3 border-t p-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SelectField label="Topic filter" value={filters.topicId} onChange={event => update({ topicId: event.target.value })}><option value="">All topics</option>{bootstrap.topics.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</SelectField>
          <SelectField label="Market filter" value={filters.marketId} onChange={event => update({ marketId: event.target.value })}><option value="">All markets</option>{bootstrap.markets.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</SelectField>
          <SelectField label="Language filter" value={filters.language} onChange={event => update({ language: event.target.value })}><option value="">English + French</option><option value="en">English</option><option value="fr">French</option></SelectField>
          {!overview && <SelectField label="Question type filter" value={filters.questionKind} onChange={event => update({ questionKind: event.target.value })}><option value="unbranded">Without brand names</option><option value="branded">With brand names</option><option value="all">All question types</option></SelectField>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-3xl text-xs leading-5 text-muted-foreground">{overview ? "Discovery metrics use questions without brand names. Answer validation below includes only questions with brand names and has its own review-status filter. These benchmark, date, topic, market, and language filters apply to both sections." : "Questions without brand names measure whether AI mentions Chartwell on its own. Use the question type filter to review branded answers separately or inspect all answers together."}</p>
          <Button variant="ghost" size="sm" onClick={() => onChange({ ...filters, ...initialDates(), topicId: "", marketId: "", language: "", questionKind: "unbranded" })}>Reset filters</Button>
        </div>
      </div>
    </details>
  </section>;
}
