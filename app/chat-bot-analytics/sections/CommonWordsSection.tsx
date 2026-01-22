"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type CommonWord = {
  word: string;
  freq: number;
  lang: string;
};

type CommonWordsProps = {
  loading: boolean;
  enWords: CommonWord[];
  frWords: CommonWord[];
  isAdmin: boolean;
  refreshingWords: boolean;
  refreshCommonWords: () => void;
};

function renderList(items: CommonWord[]) {
  if (!items.length) {
    return <div className="text-sm text-muted-foreground">No data.</div>;
  }

  return (
    <ol className="space-y-1 text-sm">
      {items.map((item, idx) => (
        <li
          key={`${item.word}-${idx}`}
          className="flex items-center justify-between gap-3"
        >
          <span className="truncate">
            {idx + 1}. {item.word}
          </span>
          <span className="text-xs text-muted-foreground">{item.freq}</span>
        </li>
      ))}
    </ol>
  );
}

export function CommonWordsSection({
  loading,
  enWords,
  frWords,
  refreshCommonWords,
  refreshingWords,
  isAdmin,
}: CommonWordsProps) {
  return (
    <section id="analytics-common-words" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Common user words</h2>
        </div>
        {isAdmin ? (
          <Button
            variant="secondary"
            className="gap-2"
            onClick={refreshCommonWords}
            disabled={refreshingWords}
          >
            {refreshingWords ? "Refreshing words..." : "Refresh words"}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">English (top 50)</div>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            renderList(enWords)
          )}
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">French (top 50)</div>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            renderList(frWords)
          )}
        </Card>
      </div>
    </section>
  );
}
