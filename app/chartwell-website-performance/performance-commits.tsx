"use client";

import { useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, GitCommitHorizontal, GitCompareArrows, Info, Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { pill } from "@/components/ui/pill";
import { deploymentCommits, formatDate, type DeploymentIdentity, type PerformanceCommit, type PerformancePayload } from "@/lib/performance";
import { cn } from "@/lib/utils";
import { safeLink, statusTone } from "./performance-format";

export function DeploymentChangesPanel({ payload }: { payload: PerformancePayload }) {
  const deployment = payload.deployment;
  if (!deployment) return null;
  const changes = deployment.deployment_changes;
  const added = deploymentCommits(deployment, payload.commits, "added");
  const removed = deploymentCommits(deployment, payload.commits, "removed");
  const current: DeploymentIdentity = changes?.current ?? { url: deployment.source_build_url ?? undefined, commit: deployment.commit_sha ?? undefined, buildNumber: deployment.source_build_number ?? undefined, finishedAt: deployment.source_finished_at ?? undefined };
  return <div className="grid items-start gap-5 lg:grid-cols-[1fr_1.5fr]">
    <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="flex items-center gap-2 text-sm"><GitCompareArrows className="h-4 w-4 text-muted-foreground"/>Deployment comparison</CardTitle>{pill(changes?.relation ?? "Relation unknown", statusTone(changes?.relation))}</div><CardDescription className="text-xs">{changes?.repository?.name ?? "Source repository"} · shared by mobile and desktop</CardDescription></CardHeader>
      <CardContent>
        <div className="ml-1.5 border-l border-emerald-400/20">
          {changes?.previous ? <DeploymentStep title="Previous deployment" identity={changes.previous}/> : <div className="relative pb-7 pl-6"><div className="absolute -left-1 top-1 h-2 w-2 rounded-full border border-muted-foreground bg-card"/><h3 className="text-xs font-medium">No previous deployment recorded</h3><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{changes?.status === "no-previous-deployment" ? "This is the first known deployment in this environment." : "The previous deployment identity was not provided."}</p></div>}
          <DeploymentStep title="Current deployment" identity={current}/>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">{pill(changes?.status ?? "History not reported", statusTone(changes?.status))}{safeLink(changes?.comparisonUrl) && <Button asChild variant="outline" size="sm" className="gap-1.5 text-xs"><a href={changes!.comparisonUrl!} target="_blank" rel="noreferrer">Compare in Azure<ArrowUpRight className="h-3 w-3"/></a></Button>}</div>{changes?.reason && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{changes.reason}</p>}
      </CardContent>
    </Card>
    <div className="space-y-5">
      {(!changes || changes.status === "unavailable") && <Card role="status" className="border-amber-500/20"><CardContent className="flex gap-3 p-4"><Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"/><div><p className="text-xs font-medium">Commit history unavailable</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{changes?.reason ?? "This deployment has no confirmed commit range. This does not indicate an empty range."}</p></div></CardContent></Card>}
      {payload.commitsUnavailable && !added.length && !removed.length && changes?.status !== "complete" && <p className="text-xs text-muted-foreground">Neither the commit table nor the stored deployment changes provided a commit list.</p>}
      <CommitList commits={added} title="Added commits" emptyMessage={changes?.status === "complete" ? "The confirmed commit range contains no added commits." : changes?.status === "no-previous-deployment" ? "There is no previous deployment to compare against." : "No added commit records are available."}/>
      {(removed.length > 0 || changes?.relation === "rollback" || changes?.relation === "diverged") && <CommitList commits={removed} title="Removed commits" emptyMessage={changes?.status === "complete" ? "The confirmed range contains no removed commits." : "Removed commit history is unavailable."} removed/>}
    </div>
  </div>;
}

function DeploymentStep({ title, identity }: { title: string; identity: DeploymentIdentity }) {
  return <div className="relative pb-6 pl-6 last:pb-0"><div className="absolute -left-1 top-1 h-2 w-2 rounded-full border border-emerald-300 bg-card"/><h3 className="text-xs font-medium">{title}</h3><p className="mt-2 text-sm">Build {identity.buildNumber ?? identity.buildId ?? "unknown"}</p><p className="mt-2 font-mono text-xs text-muted-foreground">{identity.shortSha ?? identity.commit?.slice(0, 8) ?? "SHA not reported"}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(identity.finishedAt)}</p>{safeLink(identity.url) && <Button variant="link" size="sm" asChild className="mt-2 h-auto gap-1 p-0 text-xs text-emerald-300"><a href={identity.url!} target="_blank" rel="noreferrer">Open deployment<ArrowUpRight className="h-3 w-3"/></a></Button>}</div>;
}
function CommitList({ commits, title, emptyMessage, removed = false }: { commits: PerformanceCommit[]; title: string; emptyMessage: string; removed?: boolean }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const filtered = commits.filter((commit) => `${commit.message} ${commit.author} ${commit.commit_sha}`.toLowerCase().includes(search.toLowerCase()));
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 6) - 1));
  return <Card className="overflow-hidden"><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3"><div className="space-y-1.5"><CardTitle className="flex items-center gap-2 text-sm"><GitCommitHorizontal className="h-4 w-4 text-muted-foreground"/>{title}<Badge variant="secondary" className="px-1.5 text-[10px]">{commits.length}</Badge></CardTitle>{removed && <CardDescription className="text-xs">Commits removed by a rollback or divergent history.</CardDescription>}</div>{commits.length > 0 && <div className="relative"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground"/><Input className="h-9 w-52 pl-8 text-xs" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Message, author or SHA" aria-label={`Search ${title.toLowerCase()}`}/></div>}</CardHeader>
    {filtered.length ? filtered.slice(safePage * 6, safePage * 6 + 6).map((commit) => <CommitRow commit={commit} key={commit.commit_sha}/>) : <CardContent className="py-10 text-center"><p className="text-sm">{search ? "No commits match" : "No commit records"}</p><p className="mt-2 text-xs text-muted-foreground">{search ? "Try a different message, author or commit SHA." : emptyMessage}</p></CardContent>}
    {filtered.length > 6 && <div className="flex items-center justify-between border-t px-6 py-3"><span className="text-xs text-muted-foreground">{safePage * 6 + 1}–{Math.min(safePage * 6 + 6, filtered.length)} of {filtered.length}</span><div className="flex gap-2"><Button variant="outline" size="icon" className="h-8 w-8" disabled={!safePage} onClick={() => setPage(safePage - 1)} aria-label="Previous commits"><ChevronLeft className="h-4 w-4"/></Button><Button variant="outline" size="icon" className="h-8 w-8" disabled={(safePage + 1) * 6 >= filtered.length} onClick={() => setPage(safePage + 1)} aria-label="Next commits"><ChevronRight className="h-4 w-4"/></Button></div></div>}
  </Card>;
}
function CommitRow({ commit }: { commit: PerformanceCommit }) {
  const [expanded, setExpanded] = useState(false);
  const lines = commit.message.split("\n");
  return <article className="border-t px-6 py-4"><Button variant="ghost" className="h-auto w-full items-start justify-between gap-3 whitespace-normal px-0 py-0 text-left text-xs leading-relaxed hover:bg-transparent hover:text-foreground" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} commit ${commit.short_sha}`}><span>{lines[0]}</span><ChevronDown className={cn("mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground", expanded && "rotate-180")}/></Button><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">{safeLink(commit.azure_url) ? <a href={commit.azure_url!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-emerald-300 hover:underline">{commit.short_sha}<ArrowUpRight className="h-3 w-3"/></a> : <span className="font-mono">{commit.short_sha}</span>}<span>{commit.author ?? "Author not reported"}</span><time>{formatDate(commit.authored_at)}</time></div>{expanded && <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{commit.message}</p>}</article>;
}

