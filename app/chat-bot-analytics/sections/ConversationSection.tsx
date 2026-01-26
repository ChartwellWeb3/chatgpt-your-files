// ConversationSection.tsx (updated)
import { pill } from "@/components/ui/pill";
import { Loader2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/app/helpers/fmtDate";
import { SessionRow, MessageRow, SourceRow } from "@/app/types/types";
import { useState } from "react";

interface ConversationProps {
  selectedSessionId: string;
  loadingReplay: boolean;
  replay:
    | {
        messages: MessageRow[];
        sourcesByMsg: Map<number, SourceRow[]>;
      }
    | null
    | undefined;
  setSelectedSessionId: (id: string) => void;
  filteredSessions: Array<SessionRow>;
  selectedVisitorId: string;
  isBySession: boolean;
  compact?: boolean;

  // optional meta if you have it
  lang?: string;
  pageUrl?: string;
  residenceId?: string | null;
  botMode?: string;
}

// async function analyzeConversation(payload: any) {
//   const res = await fetch("/api/analytics/satisfaction", {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify(payload),
//   });

//   const contentType = res.headers.get("content-type") || "";
//   const raw = await res.text();

//   // Helpful debugging
//   if (!res.ok) {
//     throw new Error(
//       `API ${res.status} ${res.statusText}. Body starts with: ${raw.slice(
//         0,
//         120
//       )}`
//     );
//   }

//   // If we accidentally got HTML, it’s almost always 404/redirect/middleware
//   if (raw.trim().startsWith("<!DOCTYPE") || contentType.includes("text/html")) {
//     throw new Error(
//       `Expected JSON but got HTML. Check route path/middleware. Body starts with: ${raw.slice(
//         0,
//         120
//       )}`
//     );
//   }

//   // Prefer parsing from raw (more reliable)
//   let data: any;
//   try {
//     data = JSON.parse(raw);
//   } catch {
//     throw new Error(
//       `Response was not valid JSON. Body starts with: ${raw.slice(0, 120)}`
//     );
//   }

//   if (!data?.ok) throw new Error(data?.error || "Analysis failed");
//   return data.analysis;
// }

export const ConversationSection = ({
  selectedSessionId,
  loadingReplay,
  replay,
  selectedVisitorId,
  isBySession,
  compact = false,
  // lang,
  // pageUrl,
  // residenceId,
  // botMode,
}: ConversationProps) => {
  const [showSources, setShowSources] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // const [analysisLoading, setAnalysisLoading] = useState(false);
  // const [analysisError, setAnalysisError] = useState<string | null>(null);
  // const [analysis, setAnalysis] = useState<null | {
  //   prompt_adherence_1_to_10: number;
  //   user_satisfaction_1_to_10: number;
  //   one_line_improvement: string;
  //   summary: string;
  // }>(null);

  async function copyToClipboard(text: string) {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }

  function downloadTxt(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function buildTxtOnly(replay: { messages: MessageRow[] }) {
    return replay.messages
      .map((m) => {
        const header = `[${m.created_at}] ${m.role.toUpperCase()}`;
        return `${header}\n${m.content ?? ""}\n`;
      })
      .join("\n----------------------------------------\n\n");
  }

  return (
    <div className={`bg-card/40 overflow-hidden flex flex-col ${compact ? "h-full" : "h-[75vh]"}`}>
      <div className="p-4 border-b border-border flex items-center justify-between gap-4">
        {isBySession ? (
          <div className="mt-2 text-xs text-muted-foreground">
            {selectedSessionId ? (
              <>
                Session:{" "}
                <span className="font-mono text-foreground">
                  {selectedSessionId}
                </span>
              </>
            ) : (
              "Select a session to replay messages and sources."
            )}
          </div>
        ) : (
          <div className="flex w-full justify-between gap-2">
            <Button
              variant="outline"
              className="w-full"
              disabled={!replay}
              onClick={() => {
                if (!replay) return;
                const txt = buildTxtOnly({ messages: replay.messages });
                const filename = `chat-full-${(
                  selectedVisitorId || "visitor"
                ).slice(0, 12)}-${new Date().toISOString().slice(0, 10)}.txt`;
                downloadTxt(filename, txt);
              }}
            >
              Download TXT
            </Button>

            {/* <Button
              className="w-full"
              disabled={!replay || analysisLoading}
              onClick={async () => {
                if (!replay) return;

                try {
                  setAnalysisError(null);
                  setAnalysisLoading(true);
                  setAnalysis(null);

                  const transcript = replay.messages.map((m, idx) => ({
                    role: m.role as "user" | "assistant" | "system",
                    content: m.content ?? "",
                    index: idx,
                  }));

                  const result = await analyzeConversation({
                    transcript,
                    lang: lang ?? "unknown",
                    page_url: pageUrl ?? "unknown",
                    residence_id: residenceId ?? null,
                    bot_mode: botMode ?? "unknown",
                  });

                  setAnalysis(result);
                } catch (e: any) {
                  setAnalysisError(e?.message ?? "Failed to analyze");
                } finally {
                  setAnalysisLoading(false);
                }
              }}
            >
              {analysisLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Analyzing…
                </>
              ) : (
                "Analyze Satisfaction"
              )}
            </Button> */}
          </div>
        )}

        <div className="flex justify-end items-center gap-4">
          <p className="text-sm">Show Sources</p>
          <Button onClick={() => setShowSources(!showSources)}>
            {showSources ? "Hide" : "Show"}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!selectedSessionId && isBySession ? (
          <div className="text-sm text-muted-foreground">
            Pick a session on the left.
          </div>
        ) : loadingReplay ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading replay…
          </div>
        ) : !replay ? (
          <div className="text-sm text-muted-foreground">No replay data.</div>
        ) : (
          <>
            {/* {analysisError ? (
              <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                {analysisError}
              </div>
            ) : null} */}

            <div className="space-y-4">
              {replay.messages.map((m) => {
                const isUser = m.role === "user";
                const sources =
                  m.role === "assistant"
                    ? replay.sourcesByMsg.get(m.id) ?? []
                    : [];

                return (
                  <div
                    key={m.id}
                    className={`flex ${
                      isUser ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={[
                        "max-w-[88%] rounded-lg border p-3",
                        isUser
                          ? "bg-primary text-primary-foreground border-primary/30"
                          : "bg-background border-border",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-3 text-xs opacity-80 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="uppercase">{m.role}</span>
                          <span>{fmtDate(m.created_at)}</span>
                        </div>

                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-7 px-2"
                          onClick={async () => {
                            try {
                              await copyToClipboard(m.content ?? "");
                              setCopiedId(m.id);
                              window.setTimeout(
                                () =>
                                  setCopiedId((prev) =>
                                    prev === m.id ? null : prev
                                  ),
                                1200
                              );
                            } catch {}
                          }}
                        >
                          {copiedId === m.id ? (
                            <>
                              <Check className="h-3.5 w-3.5 mr-1" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                            </>
                          )}
                        </Button>
                      </div>

                      <div className="text-sm whitespace-pre-wrap leading-relaxed">
                        {m.content}
                      </div>

                      {sources.length > 0 && (
                        <div className="mt-3 border-t border-border/60">
                          <div className="flex items-center justify-between py-2">
                            <div className="text-xs font-medium text-muted-foreground mb-2">
                              Sources used
                            </div>
                          </div>

                          <div
                            className={`space-y-2 ${
                              showSources ? "scale-100" : "scale-0 h-0"
                            } ease-in-out duration-200`}
                          >
                            {sources.slice(0, 10).map((s) => (
                              <div
                                key={s.id}
                                className="rounded-md border border-border/60 p-2 bg-muted/20"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-xs text-muted-foreground">
                                    #{s.rank}
                                    {s.source_type ? ` • ${s.source_type}` : ""}
                                    {typeof s.score === "number"
                                      ? ` • score ${s.score.toFixed(4)}`
                                      : ""}
                                  </div>
                                  {pill(s.doc_name ?? "Unknown doc")}
                                </div>

                                <div className="text-xs text-muted-foreground mt-1">
                                  section_id:{" "}
                                  <span className="font-mono">
                                    {s.document_section_id}
                                  </span>
                                </div>

                                {s.snippet_used ? (
                                  <div className="text-xs text-muted-foreground mt-2 overflow-y-scroll bg-muted/10 p-2 rounded line-clamp-5">
                                    {s.snippet_used}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* {analysis ? (
              <div className="mb-4 rounded-lg border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">Conversation QA</div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      try {
                        await copyToClipboard(
                          JSON.stringify(analysis, null, 2)
                        );
                      } catch {}
                    }}
                  >
                    <Copy className="h-3.5 w-3.5 mr-1" />
                    Copy JSON
                  </Button>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-border/60 p-3">
                    <div className="text-xs text-muted-foreground">
                      Prompt adherence
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      {analysis.prompt_adherence_1_to_10}/10
                    </div>
                  </div>

                  <div className="rounded-md border border-border/60 p-3">
                    <div className="text-xs text-muted-foreground">
                      User satisfaction
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      {analysis.user_satisfaction_1_to_10}/10
                    </div>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="text-xs text-muted-foreground mb-1">
                    One-line improvement
                  </div>
                  <div className="text-sm">{analysis.one_line_improvement}</div>
                </div>

                <div className="mt-3">
                  <div className="text-xs text-muted-foreground mb-1">
                    Summary
                  </div>
                  <div className="text-sm">{analysis.summary}</div>
                </div>
              </div>
            ) : null} */}
          </>
        )}
      </div>
    </div>
  );
};
