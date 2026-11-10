"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, Circle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Bootstrap } from "@/lib/geo/types";
import { Panel } from "./geo-ui";

export function MonitoringSetup({ bootstrap, busy, onCreate, onClose }: {
  bootstrap: Bootstrap;
  busy: boolean;
  onCreate: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const ready = Boolean(bootstrap.models.monitor && bootstrap.models.analysis && bootstrap.models.apiKeyConfigured);
  const settings = [
    { label: "Answer collection", value: bootstrap.models.monitor, description: "Asks your questions with web search." },
    { label: "Answer analysis", value: bootstrap.models.analysis, description: "Finds brand mentions, rankings, and opportunities." },
    { label: "OpenAI API key", value: bootstrap.models.apiKeyConfigured ? "Configured" : null, description: "Used for collection and analysis." },
  ];
  return <div id="geo-monitoring-setup" className="scroll-mt-6">
    <Panel title="Monitoring setup" description="Create a benchmark: a named set of AI models and settings used to collect comparable answers." action={<Button variant="ghost" size="sm" aria-label="Close setup" onClick={onClose}><X className="h-4 w-4"/></Button>}>
      <div className="space-y-5 p-5">
        <div className="grid gap-3 md:grid-cols-3">{settings.map(setting => <div key={setting.label} className="rounded-lg border bg-background/50 p-4">
          <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-muted-foreground">{setting.label}</p>{setting.value ? <CheckCircle2 aria-label="Configured" className="h-4 w-4 text-emerald-400"/> : <Circle aria-label="Missing" className="h-4 w-4 text-amber-300"/>}</div>
          <p className={`mt-3 break-words text-sm font-medium ${setting.value ? "" : "text-amber-200"}`}>{setting.value || "Needs configuration"}</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">{setting.description}</p>
        </div>)}</div>
        {!ready && <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium text-amber-200">Complete the missing settings to create a benchmark.</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">An administrator needs to configure these server environment variables and restart or redeploy the app:</p>
          <ul className="mt-2 space-y-1 text-xs">{!bootstrap.models.monitor && <li><code>OPENAI_GEO_MONITOR_MODEL</code> — answer collection</li>}{!bootstrap.models.analysis && <li><code>OPENAI_GEO_ANALYSIS_MODEL</code> — answer analysis</li>}{!bootstrap.models.apiKeyConfigured && <li><code>OPENAI_API_KEY</code> — OpenAI access</li>}</ul>
        </div>}
        <form className="space-y-3 border-t pt-5" onSubmit={event => { event.preventDefault(); void onCreate(name.trim()).catch(() => {}); }}>
          <div className="flex flex-wrap items-end gap-3"><label className="w-full space-y-2 text-xs text-muted-foreground sm:max-w-sm"><span>Benchmark name (at least 3 characters)</span><Input aria-label="Benchmark name" placeholder="e.g. OpenAI · October 2026" minLength={3} maxLength={160} required value={name} onChange={event => setName(event.target.value)}/></label><Button type="submit" disabled={busy || !ready || name.trim().length < 3}>Create benchmark</Button></div>
          <p className="max-w-3xl text-xs leading-5 text-muted-foreground">Creating a benchmark saves these settings. It does not collect answers or turn on a schedule. Create a new benchmark when you change models so earlier results keep their original settings.</p>
        </form>
      </div>
    </Panel>
  </div>;
}

export function GettingStarted({ bootstrap, benchmarkId, onSetup, onQuestions, onAnswers }: {
  bootstrap: Bootstrap;
  benchmarkId: string;
  onSetup: () => void;
  onQuestions: () => void;
  onAnswers: () => void;
}) {
  const steps = [
    { title: "Choose your AI setup", description: "A benchmark keeps answers collected with the same models together.", status: benchmarkId ? "Benchmark ready" : "Benchmark needed", complete: Boolean(benchmarkId), action: bootstrap.level === 1 && !benchmarkId ? onSetup : undefined, button: "Open setup" },
    { title: "Add and approve questions", description: "Use questions a family might ask when looking for a retirement residence.", status: `${bootstrap.counts.active} approved · ${bootstrap.counts.draft} awaiting review`, complete: bootstrap.counts.active > 0, action: onQuestions, button: bootstrap.level < 3 ? "Manage questions" : "View questions" },
    { title: "Collect and review answers", description: "Use Test to preview a draft without affecting statistics. Use Run now on approved questions, or enable Monday collection, for reporting.", status: "Monday schedule + Run now feed reporting", complete: false, action: benchmarkId ? onAnswers : undefined, button: "View answers" },
  ];
  return <section aria-label="How monitoring works" className="space-y-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-semibold">From questions to visibility</h2><p className="text-xs text-muted-foreground">Start with a few questions, then expand your library.</p></div>
    <ol className="grid gap-3 lg:grid-cols-3">{steps.map((step, index) => <li key={step.title} className="flex gap-3 rounded-xl border bg-card p-4">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${step.complete ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "bg-muted text-muted-foreground"}`}>{step.complete ? <CheckCircle2 className="h-4 w-4"/> : index + 1}</span>
      <div className="flex min-w-0 flex-1 flex-col"><h3 className="text-sm font-medium">{step.title}</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">{step.description}</p><p className="mb-2 mt-3 text-xs text-foreground/80">{step.status}</p>{step.action && <Button variant="link" size="sm" className="mt-auto h-auto self-start p-0 text-emerald-300" onClick={step.action}>{step.button}<ArrowRight className="ml-1.5 h-3 w-3"/></Button>}</div>
    </li>)}</ol>
  </section>;
}
