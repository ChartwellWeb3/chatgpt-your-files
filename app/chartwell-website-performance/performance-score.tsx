import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { finite, formatMetric } from "@/lib/performance";

const scoreClass = (value: number | null) => value === null ? "text-muted-foreground" : value >= 90 ? "text-emerald-300" : value >= 50 ? "text-amber-300" : "text-rose-300";

export function ScoreRing({ value }: { value: number | null }) {
  const circumference = 2 * Math.PI * 40;
  return <div className={cn("relative grid h-24 w-24 shrink-0 place-items-center", scoreClass(value))} role="img" aria-label={value === null ? "No trusted score" : `Average performance score ${Math.round(value)} out of 100`}>
    <svg viewBox="0 0 90 90" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true"><circle cx="45" cy="45" r="40" fill="none" className="stroke-muted" strokeWidth="4"/><circle cx="45" cy="45" r="40" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, value ?? 0)) / 100)}/></svg>
    <div className="text-center"><div className="text-3xl font-semibold tracking-tight">{formatMetric("score", value)}</div><div className="mt-1 text-[9px] text-muted-foreground">OUT OF 100</div></div>
  </div>;
}
export function ScoreValue({ value }: { value: unknown }) {
  const score = finite(value);
  return <Badge variant="outline" className={cn("min-w-10 justify-center rounded-md font-mono", scoreClass(score))}>{formatMetric("score", score)}</Badge>;
}
