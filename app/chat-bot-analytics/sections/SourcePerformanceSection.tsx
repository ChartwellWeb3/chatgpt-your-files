"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { InfoDialog } from "./InfoDialog";
import { createClient } from "@/app/utils/supabase/client";


type DocumentRow = {
  document_id: number;
  document_name: string;
  is_common: boolean;
  residence_name: string;
  total_citations: number;
};

type SectionRow = {
  section_id: number;
  document_id: number;
  document_name: string;
  content_preview: string;
  citation_count: number;
  is_common: boolean;
  residence_name: string;
};

type DeadDocRow = {
  document_id: number;
  document_name: string;
  is_common: boolean;
  residence_name: string;
};

type SourcePerformance = {
  top_documents: DocumentRow[];
  top_sections: SectionRow[];
  dead_documents: DeadDocRow[];
  total_citations: number;
  total_cited_sections: number;
  total_documents: number;
  dead_document_count: number;
};

const EMPTY: SourcePerformance = {
  top_documents: [],
  top_sections: [],
  dead_documents: [],
  total_citations: 0,
  total_cited_sections: 0,
  total_documents: 0,
  dead_document_count: 0,
};

type Tab = "top" | "dead";

function DocLabel({ name, isCommon, residenceName }: { name: string; isCommon: boolean; residenceName: string }) {
  return (
    <span className="flex flex-col min-w-0">
      <span className="truncate font-medium text-sm">{name}</span>
      <span className="text-xs text-muted-foreground">
        {isCommon ? "Common" : residenceName || "—"}
      </span>
    </span>
  );
}

export function SourcePerformanceSection() {
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>("top");
  const [showSections, setShowSections] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["analytics-source-performance"],
    queryFn: async (): Promise<SourcePerformance> => {
      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        "analytics_source_performance",
        { p_start: null, p_end: null },
      );
      if (rpcErr) throw rpcErr;
      return (rpcData as SourcePerformance) ?? EMPTY;
    },
  });

  const d = data ?? EMPTY;
  const maxCitations = d.top_documents[0]?.total_citations ?? 1;
  const citedDocCount = d.total_documents - d.dead_document_count;
  const citedPct = d.total_documents > 0 ? Math.round((citedDocCount / d.total_documents) * 100) : 0;

  return (
    <section id="analytics-source-performance" className="space-y-4">
      <Card className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Document & source performance</h2>
            <InfoDialog
              title="Document & source performance"
              summary="Which documents the bot cites most, and which are never cited at all."
            >
              <p>
                Every time the assistant answers using a document section, a row
                is written to{" "}
                <span className="font-mono">chat_message_sources</span>. This
                section counts those citations per document and per section
                across all time.
              </p>
              <p>
                <strong>Top cited</strong> shows which documents the bot relies
                on most — useful for prioritising content quality reviews.
              </p>
              <p>
                <strong>Dead content</strong> lists documents that have never
                been cited. These may be stale, duplicate, or insufficiently
                chunked — good candidates for the content team to review or
                remove.
              </p>
            </InfoDialog>
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : null}

        {error ? (
          <div className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Failed to load source performance."}
          </div>
        ) : null}

        {!isLoading && !error ? (
          <div className="space-y-5">
            {/* Summary row */}
            <div className="flex flex-wrap gap-3">
              <div className="bg-muted rounded-lg px-4 py-3 text-center min-w-[120px]">
                <div className="text-2xl font-bold">{d.total_citations.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Total citations</div>
              </div>
              <div className="bg-muted rounded-lg px-4 py-3 text-center min-w-[140px]">
                <div className="text-2xl font-bold">
                  {citedDocCount}
                  <span className="text-sm text-muted-foreground font-normal"> / {d.total_documents}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Docs cited ({citedPct}%)</div>
              </div>
              {d.dead_document_count > 0 ? (
                <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg px-4 py-3 text-center min-w-[120px]">
                  <div className="text-2xl font-bold text-amber-600">{d.dead_document_count}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Dead docs</div>
                </div>
              ) : null}
              <div className="bg-muted rounded-lg px-4 py-3 text-center min-w-[120px]">
                <div className="text-2xl font-bold">{d.total_cited_sections.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Sections cited</div>
              </div>
            </div>

            {/* Tab switcher */}
            <div className="flex gap-1 border-b text-sm">
              {(["top", "dead"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1.5 -mb-px border-b-2 transition-colors ${
                    tab === t
                      ? "border-primary text-primary font-medium"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "top" ? "Top cited" : `Dead content (${d.dead_document_count})`}
                </button>
              ))}
            </div>

            {/* Top cited tab */}
            {tab === "top" ? (
              <div className="space-y-4">
                <Card className="p-4 space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Most cited documents
                  </div>
                  {d.top_documents.length > 0 ? (
                    <ol className="space-y-2">
                      {d.top_documents.map((doc, idx) => {
                        const barPct = maxCitations > 0
                          ? Math.round((doc.total_citations / maxCitations) * 100)
                          : 0;
                        return (
                          <li key={doc.document_id} className="flex items-center gap-2 text-sm">
                            <span className="text-xs text-muted-foreground w-4 text-right shrink-0">
                              {idx + 1}.
                            </span>
                            <div className="flex-1 flex items-center gap-2 min-w-0">
                              <DocLabel
                                name={doc.document_name}
                                isCommon={doc.is_common}
                                residenceName={doc.residence_name}
                              />
                              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[40px]">
                                <div
                                  className="h-full bg-primary/60 rounded-full"
                                  style={{ width: `${barPct}%` }}
                                />
                              </div>
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0 w-16 text-right">
                              {doc.total_citations.toLocaleString()}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <div className="text-xs text-muted-foreground">No citations recorded in this period.</div>
                  )}
                </Card>

                {/* Top sections toggle */}
                <div>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    onClick={() => setShowSections((v) => !v)}
                  >
                    {showSections ? "Hide top sections" : "Show top cited sections"}
                  </button>

                  {showSections ? (
                    <Card className="mt-3 p-4 space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Most cited sections
                      </div>
                      {d.top_sections.length > 0 ? (
                        <ol className="space-y-3">
                          {d.top_sections.map((sec, idx) => (
                            <li key={sec.section_id} className="flex gap-2 text-sm">
                              <span className="text-xs text-muted-foreground w-4 text-right shrink-0 pt-0.5">
                                {idx + 1}.
                              </span>
                              <div className="flex-1 min-w-0 space-y-0.5">
                                <div className="flex items-baseline gap-1.5 flex-wrap">
                                  <span className="font-medium text-xs">{sec.document_name}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {sec.is_common ? "Common" : sec.residence_name || "—"}
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground line-clamp-2 font-mono leading-relaxed">
                                  {sec.content_preview}
                                </p>
                              </div>
                              <span className="text-xs text-muted-foreground shrink-0 w-12 text-right pt-0.5">
                                {sec.citation_count.toLocaleString()}×
                              </span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <div className="text-xs text-muted-foreground">No data.</div>
                      )}
                    </Card>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Dead content tab */}
            {tab === "dead" ? (
              <Card className="p-4 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Documents with zero citations in this period
                </div>
                {d.dead_documents.length > 0 ? (
                  <ul className="space-y-1.5">
                    {d.dead_documents.map((doc) => (
                      <li
                        key={doc.document_id}
                        className="flex items-center gap-3 text-sm py-1 border-b last:border-0"
                      >
                        <DocLabel
                          name={doc.document_name}
                          isCommon={doc.is_common}
                          residenceName={doc.residence_name}
                        />
                        <span className="shrink-0 text-xs text-amber-600 font-medium ml-auto">
                          0 citations
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    All documents were cited at least once in this period.
                  </div>
                )}
              </Card>
            ) : null}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
