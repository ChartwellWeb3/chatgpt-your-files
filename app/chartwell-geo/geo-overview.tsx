"use client";
import { Eye, Share2, ArrowRight } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { percentage } from "@/lib/geo/client";
import type { Bootstrap, OverviewDashboard, BreakdownMetric } from "@/lib/geo/types";
import { Empty, Panel } from "./geo-ui";
import { GeoMetricLabel } from "./geo-metric-help";

function delta(difference: number | null | undefined) {
  if (difference == null) return "Not enough data to compare periods";
  if (difference === 0) return "No change from the previous period";
  return `${difference > 0 ? "+" : ""}${difference.toFixed(1)} percentage points vs previous period`;
}
export function Overview({ data, bootstrap, onTab, onEvidence, onQuestions }: { data: OverviewDashboard; bootstrap: Bootstrap; onTab: (tab: string) => void; onEvidence: (questionKind: "unbranded" | "branded") => void; onQuestions: (group: "topic" | "market", id: string) => void }) {
  const chartwell = data.chartwell;
  const cards = [
    { metric: "mentionRate", label: "Chartwell mention rate", value: percentage(chartwell?.visibility_rate), icon: Eye, note: delta(data.differences.mentionRate), detail: `${chartwell?.mentions || 0} of ${chartwell?.samples || 0} answers mention Chartwell.` },
    { metric: "shareOfMentions", label: "Share of brand mentions", value: percentage(chartwell?.share_of_voice), icon: Share2, note: delta(data.differences.shareOfMentions), detail: "Chartwell’s share of all detected brand mentions. Each brand counts once per answer." },
  ] as const;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-semibold">Discovery: questions without brand names</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Based on {data.counts.succeeded} completed reporting answers matching your filters · Tests excluded</p><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Does AI mention Chartwell when the question does not name any brand? Discovery cards, trends, and comparisons use only those questions.</p></div><Button variant="outline" size="sm" onClick={() => onEvidence("unbranded")}>View discovery answers<ArrowRight className="ml-2 h-3.5 w-3.5"/></Button></div>
    {!data.counts.succeeded ? <Panel title="No completed discovery answers match this selection"><Empty title="Collect an answer to a question without brand names" action={<Button size="sm" variant="outline" onClick={() => onTab("questions")}>Go to questions</Button>}>Approve a question without brand names, then choose Run now or Run all, or enable the weekly schedule. Use Answer validation below to review saved branded answers. Check your benchmark, dates, topic, market, and language if you already have discovery answers.</Empty><p className="border-t px-5 py-3 text-xs leading-5 text-muted-foreground">{data.counts.pending} <GeoMetricLabel metric="pending" scope="discovery">in progress or waiting</GeoMetricLabel> · {data.counts.failed} <GeoMetricLabel metric="failed" scope="discovery">failed, cancelled, or interrupted</GeoMetricLabel> · {data.counts.needs_review || 0} <GeoMetricLabel metric="mappingReview" scope="discovery">needs mapping review</GeoMetricLabel>. Only completed reporting answers count.</p></Panel> : <>
    <div className="grid gap-4 sm:grid-cols-2">{cards.map(card => <div key={card.label} className="flex flex-col rounded-xl border bg-card p-5"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium"><GeoMetricLabel metric={card.metric} scope="discovery" comparison>{card.label}</GeoMetricLabel></h3><card.icon className="h-4 w-4 shrink-0 text-emerald-400/80"/></div><p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums">{card.value}</p><p className="mb-4 mt-2 text-xs leading-5 text-muted-foreground">{card.detail}</p><p className="mt-auto border-t pt-3 text-xs leading-5 text-muted-foreground">{card.note}</p></div>)}</div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <Panel title={<GeoMetricLabel metric="weekly" scope="discovery">Chartwell mentions over time</GeoMetricLabel>} description="Questions without brand names only. Gaps mean no completed discovery answers match your filters that week.">
        <div className="h-[300px] p-5" role="img" aria-label="Weekly Chartwell mention rate chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={data.trend} margin={{ top: 15, right: 12, bottom: 5, left: -22 }}><CartesianGrid stroke="#242424" vertical={false}/><XAxis dataKey="week" tickFormatter={value => String(value).slice(5)} stroke="#888" tickLine={false} axisLine={false} fontSize={11}/><YAxis domain={[0, 100]} tickFormatter={value => `${value}%`} stroke="#888" tickLine={false} axisLine={false} fontSize={11}/><Tooltip contentStyle={{ background: "#151515", border: "1px solid #333", borderRadius: 8 }} formatter={(value) => [`${Number(value).toFixed(1)}%`, "Chartwell mention rate"]} labelFormatter={label => `Week of ${label}`}/><Line type="linear" dataKey="visibility" stroke="#34d399" strokeWidth={2.5} dot={{ r: 4, fill: "#0f0f0f", strokeWidth: 2 }} connectNulls={false}/></LineChart></ResponsiveContainer></div>
      </Panel>
      <Panel title="Monitoring at a glance" description="Answer counts for these filters; question counts for your whole library">
        <div className="space-y-5 p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><p className="text-3xl font-semibold tabular-nums">{data.counts.succeeded}</p><p className="mt-1 text-xs text-muted-foreground"><GeoMetricLabel metric="completed" scope="discovery">completed answers in this selection</GeoMetricLabel></p></div>
            <div className="text-xs leading-6 text-muted-foreground"><p>{data.counts.failed} <GeoMetricLabel metric="failed" scope="discovery">failed / cancelled / interrupted</GeoMetricLabel></p><p>{data.counts.pending} <GeoMetricLabel metric="pending" scope="discovery">in progress / waiting</GeoMetricLabel></p><p>{data.counts.needs_review || 0} <GeoMetricLabel metric="mappingReview" scope="discovery">needs mapping review</GeoMetricLabel></p></div>
          </div>
          <div className="border-t pt-4">
            <div className="flex items-center justify-between text-sm"><GeoMetricLabel metric="library" scope="library">Approved questions</GeoMetricLabel><span className="font-medium text-emerald-300">{bootstrap.counts.active}</span></div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${bootstrap.counts.active / Math.max(1, bootstrap.counts.active + bootstrap.counts.draft) * 100}%` }}/></div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground"><p>{bootstrap.counts.draft} <GeoMetricLabel metric="library" scope="library">questions to review</GeoMetricLabel></p><p>{bootstrap.counts.archived} <GeoMetricLabel metric="library" scope="library">archived questions</GeoMetricLabel></p></div>
            <Button variant="outline" size="sm" className="mt-4 w-full" onClick={() => onTab("questions")}>Review question library <ArrowRight className="ml-2 h-3.5 w-3.5"/></Button>
          </div>
          <p className="border-t pt-4 text-[11px] leading-5 text-muted-foreground">Compared with: {data.previousFrom} to {data.previousTo}. The same filters apply to both periods. Changes to the question library can affect results. Failed or incomplete answers never count as missing mentions.</p>
        </div>
      </Panel>
    </div>
    <div className="grid gap-5 lg:grid-cols-2"><Breakdown title="Chartwell mentions by topic" metric="topic" rows={data.topics} onQuestions={id => onQuestions("topic", id)}/><Breakdown title="Chartwell mentions by market" metric="market" rows={data.markets} onQuestions={id => onQuestions("market", id)}/></div>
    </>}
  </div>;
}
function Breakdown({ title, metric, rows, onQuestions }: { title: string; metric: "topic" | "market"; rows: BreakdownMetric[]; onQuestions: (id: string) => void }) {
  return <Panel title={<GeoMetricLabel metric={metric} scope="discovery">{title}</GeoMetricLabel>} description="How often Chartwell appears in completed answers for each group">{!rows.length ? <Empty title="No answers for this group yet">Results will appear as questions in this group are collected.</Empty> : <div className="space-y-5 p-5">{rows.map(row => <div key={row.key}><div className="mb-2 flex flex-wrap justify-between gap-2 text-sm"><div className="flex flex-wrap items-center gap-2"><span>{row.label}</span><Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-emerald-300" aria-label={`View questions for ${row.label}`} onClick={() => onQuestions(row.key)}>View questions<ArrowRight className="ml-1 h-3 w-3"/></Button></div><span className="tabular-nums">{percentage(row.visibility_rate)} <span className="ml-2 text-xs text-muted-foreground">{row.mentions} of {row.samples} answers</span></span></div><div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500/80" style={{ width: `${Number(row.visibility_rate || 0) * 100}%` }}/></div></div>)}</div>}</Panel>;
}
