"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Trash2 } from "lucide-react";
import { InfoDialog } from "./InfoDialog";

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
  onAddStopword: (word: string, lang: "en" | "fr") => Promise<void>;
  stopwordSet: Set<string>;
};

function renderList(
  items: CommonWord[],
  isAdmin: boolean,
  stopwordSet: Set<string>,
  onAddStopword: (word: string, lang: "en" | "fr") => Promise<void>
) {
  if (!items.length) {
    return <div className="text-sm text-muted-foreground">No data.</div>;
  }

  return (
    <ol className="text-sm divide-y divide-border/40">
      {items.map((item, idx) => (
        <li
          key={`${item.word}-${idx}`}
          className="flex items-center justify-between gap-3 py-2"
        >
          <span className="truncate">
            {idx + 1}. {item.word}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums min-w-[2.5rem] text-right">
              {item.freq}
            </span>
            {isAdmin ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={stopwordSet.has(`${item.lang}:${item.word}`)}
                onClick={() =>
                  onAddStopword(item.word, item.lang as "en" | "fr")
                }
                title={
                  stopwordSet.has(`${item.lang}:${item.word}`)
                    ? "Already a stopword"
                    : "Add to stopwords"
                }
              >
                {stopwordSet.has(`${item.lang}:${item.word}`) ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            ) : null}
          </div>
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
  onAddStopword,
  stopwordSet,
}: CommonWordsProps) {
  return (
    <section id="analytics-common-words" className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Common user words</h2>
          <InfoDialog
            title="Common user words"
            summary="Most frequent words used by visitors, separated by language."
          >
            <p>
              <span className="font-medium text-foreground">What it shows:</span>{" "}
              The top 50 words in user messages for English and French after
              stopword filtering.
            </p>
            <p>
              <span className="font-medium text-foreground">How it is collected:</span>{" "}
              The refresh job tokenizes <span className="font-medium">chat_messages</span>{" "}
              (user role), lowercases and strips punctuation, excludes stopwords,
              and counts frequency by session language.
            </p>
            <p>
              <span className="font-medium text-foreground">Update frequency:</span>{" "}
              Updated on demand when an admin clicks "Refresh words."
            </p>
          </InfoDialog>
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
            renderList(enWords, isAdmin, stopwordSet, onAddStopword)
          )}
        </Card>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">French (top 50)</div>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            renderList(frWords, isAdmin, stopwordSet, onAddStopword)
          )}
        </Card>
      </div>
    </section>
  );
}
