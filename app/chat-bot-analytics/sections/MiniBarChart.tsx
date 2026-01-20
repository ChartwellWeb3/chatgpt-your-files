"use client";

export type ChartItem = { label: string; value: number };

export function MiniBarChart({
  title,
  items,
  emptyLabel = "No data yet",
}: {
  title: string;
  items: ChartItem[];
  emptyLabel?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">{title}</div>
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground">{emptyLabel}</div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="truncate">{item.label}</span>
                <span className="text-muted-foreground">{item.value}</span>
              </div>
              <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${(item.value / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
