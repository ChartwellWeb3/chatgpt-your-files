"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoDialog } from "./InfoDialog";

type Stopword = {
  id: number;
  word: string;
  lang: "en" | "fr";
};

type StopwordsSectionProps = {
  loading: boolean;
  error: string | null;
  enWords: Stopword[];
  frWords: Stopword[];
  onAdd: (word: string, lang: "en" | "fr") => Promise<void>;
  onDelete: (id: number) => Promise<void>;
};

export function StopwordsSection({
  loading,
  error,
  enWords,
  frWords,
  onAdd,
  onDelete,
}: StopwordsSectionProps) {
  const [word, setWord] = useState("");
  const [lang, setLang] = useState<"en" | "fr">("en");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    const normalized = word.trim().toLowerCase();
    if (!normalized) {
      setFormError("Enter a word.");
      return;
    }
    if (/\s/.test(normalized)) {
      setFormError("Use a single word.");
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      await onAdd(normalized, lang);
      setWord("");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to add.";
      setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  const renderList = (items: Stopword[]) => {
    if (!items.length) {
      return <div className="text-sm text-muted-foreground">No words.</div>;
    }
    return (
      <ol className="space-y-1 text-sm">
        {items.map((item) => (
          <li
            key={`${item.lang}-${item.id}`}
            className="flex items-center justify-between gap-3"
          >
            <span className="truncate">{item.word}</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onDelete(item.id)}
            >
              Remove
            </Button>
          </li>
        ))}
      </ol>
    );
  };

  return (
    <section id="analytics-stopwords" className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Stopwords</h2>
          <InfoDialog
            title="Stopwords"
            summary="Words excluded from the common-word analysis."
          >
            <p>
              <span className="font-medium text-foreground">What it shows:</span>{" "}
              A curated list of words that should be ignored when calculating
              common user words.
            </p>
            <p>
              <span className="font-medium text-foreground">How it is collected:</span>{" "}
              Managed manually by admins in <span className="font-medium">chat_stopwords</span>.
            </p>
            <p>
              <span className="font-medium text-foreground">Update frequency:</span>{" "}
              Changes are immediate in this list, and take effect in the common
              words after the next refresh.
            </p>
          </InfoDialog>
        </div>
        <p className="text-xs text-muted-foreground">
          These words are excluded from the common-word lists.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Add a word"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            className="max-w-xs"
          />
          <select
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={lang}
            onChange={(e) => setLang(e.target.value as "en" | "fr")}
          >
            <option value="en">English</option>
            <option value="fr">French</option>
          </select>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Adding..." : "Add"}
          </Button>
        </div>
        {formError ? (
          <div className="text-sm text-destructive">{formError}</div>
        ) : null}
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">English</div>
          <div className="max-h-72 overflow-y-auto pr-1">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : (
              renderList(enWords)
            )}
          </div>
        </Card>
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">French</div>
          <div className="max-h-72 overflow-y-auto pr-1">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : (
              renderList(frWords)
            )}
          </div>
        </Card>
      </div>
    </section>
  );
}
