"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/app/utils/supabase/client";
import { useProfileLevel } from "@/app/hooks/useProfileLevel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { prompt, type ChatBotData } from "@/lib/chatbot/prompts";

type Residence = {
  id: number;
  name: string;
  custom_id: string;
  created_at: string;
};

type PromptFamily = "property" | "corporate";

type PromptVersion = {
  id: number;
  family: PromptFamily;
  name: string;
  prompt_text: string;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type DiffRow = {
  left: string;
  right: string;
  type: "equal" | "insert" | "delete";
};

function buildDiffRows(before: string, after: string): DiffRow[] {
  const leftLines = before.split("\n");
  const rightLines = after.split("\n");
  const n = leftLines.length;
  const m = rightLines.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array(m + 1).fill(0)
  );

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      if (leftLines[i - 1] === rightLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const ops: DiffRow[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      leftLines[i - 1] === rightLines[j - 1]
    ) {
      ops.push({
        left: leftLines[i - 1],
        right: rightLines[j - 1],
        type: "equal",
      });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ left: "", right: rightLines[j - 1], type: "insert" });
      j -= 1;
    } else if (i > 0) {
      ops.push({ left: leftLines[i - 1], right: "", type: "delete" });
      i -= 1;
    }
  }

  return ops.reverse();
}

export default function PromptTestingPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { isAdmin } = useProfileLevel();

  const [userId, setUserId] = useState<string | null>(null);
  const [selectedResidenceId, setSelectedResidenceId] = useState<number | null>(
    null
  );
  const [promptFamily, setPromptFamily] = useState<PromptFamily>("property");
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(
    null
  );
  const [editorText, setEditorText] = useState("");
  const [activePromptText, setActivePromptText] = useState("");
  const [appliedMode, setAppliedMode] = useState<"saved" | "draft">("saved");
  const [showControls, setShowControls] = useState(true);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const lastVersionIdRef = useRef<number | null>(null);
  const lastBaselineRef = useRef("");
  const [isDiffOpen, setIsDiffOpen] = useState(false);

  useEffect(() => {
    const loadUser = async () => {
      const { data } = await supabase.auth.getUser();
      setUserId(data.user?.id ?? null);
    };
    loadUser();
  }, [supabase]);

  const { data: residences = [], isLoading: loadingResidences } = useQuery({
    queryKey: ["prompt-testing-residences"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("residences")
        .select("id,name,custom_id,created_at")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Residence[];
    },
  });

  const { data: promptVersions = [], isLoading: loadingVersions } = useQuery({
    queryKey: ["prompt-versions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_versions")
        .select(
          "id,family,name,prompt_text,is_default,created_by,created_at"
        )
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PromptVersion[];
    },
  });

  const selectedResidence = useMemo(() => {
    if (!selectedResidenceId) return null;
    return residences.find((r) => r.id === selectedResidenceId) ?? null;
  }, [residences, selectedResidenceId]);

  const lang = useMemo(() => {
    const customId = selectedResidence?.custom_id?.toLowerCase() ?? "";
    return customId.endsWith("fr") ? "fr" : "en";
  }, [selectedResidence?.custom_id]);

  const familyVersions = useMemo(
    () => promptVersions.filter((v) => v.family === promptFamily),
    [promptVersions, promptFamily]
  );

  const defaultVersion = useMemo(
    () => familyVersions.find((v) => v.is_default) ?? familyVersions[0] ?? null,
    [familyVersions]
  );

  useEffect(() => {
    if (!familyVersions.length) return;
    if (
      !selectedVersionId ||
      !familyVersions.some((v) => v.id === selectedVersionId)
    ) {
      setSelectedVersionId(defaultVersion?.id ?? null);
    }
  }, [familyVersions, selectedVersionId, defaultVersion]);

  const selectedVersion = useMemo(
    () => familyVersions.find((v) => v.id === selectedVersionId) ?? null,
    [familyVersions, selectedVersionId]
  );

  const baselinePromptText = useMemo(() => {
    if (!selectedVersion) return "";
    if (selectedVersion.prompt_text?.trim()) return selectedVersion.prompt_text;
    if (!selectedVersion.is_default) return selectedVersion.prompt_text ?? "";

    const data: ChatBotData = {
      isCorporate: promptFamily === "corporate",
      customId: selectedResidence?.custom_id ?? null,
      corporateId: selectedResidence?.custom_id
        ?.toLowerCase()
        .startsWith("corporate")
        ? null
        : lang === "fr"
        ? "corporatefr"
        : "corporateen",
      lang,
      propertyName: selectedResidence?.name ?? null,
    };

    return prompt(data, "");
  }, [
    selectedVersion,
    promptFamily,
    selectedResidence?.custom_id,
    selectedResidence?.name,
    lang,
  ]);

  const savedOverrideText =
    selectedVersion?.prompt_text?.trim() ? selectedVersion.prompt_text : "";

  useEffect(() => {
    if (!selectedVersion) {
      setEditorText("");
      setActivePromptText("");
      setAppliedMode("saved");
      lastVersionIdRef.current = null;
      lastBaselineRef.current = "";
      return;
    }

    const versionChanged = selectedVersion.id !== lastVersionIdRef.current;
    if (versionChanged) {
      setEditorText(baselinePromptText);
      setActivePromptText(savedOverrideText);
      setAppliedMode("saved");
      lastVersionIdRef.current = selectedVersion.id;
      lastBaselineRef.current = baselinePromptText;
      return;
    }

    if (
      baselinePromptText !== lastBaselineRef.current &&
      editorText === lastBaselineRef.current
    ) {
      setEditorText(baselinePromptText);
      setActivePromptText(savedOverrideText);
      setAppliedMode("saved");
    }

    lastBaselineRef.current = baselinePromptText;
  }, [selectedVersion?.id, baselinePromptText, editorText, savedOverrideText]);

  const hasUnsavedChanges = editorText !== baselinePromptText;
  const isGeneratedDefault =
    !!selectedVersion?.is_default && !selectedVersion?.prompt_text?.trim();

  const canDelete =
    !!selectedVersion &&
    !selectedVersion.is_default &&
    !!userId &&
    selectedVersion.created_by === userId;

  const applyDraft = () => {
    setActivePromptText(editorText);
    setAppliedMode("draft");
    toast({ description: "Draft applied for chat requests." });
  };

  const resetDraft = () => {
    if (!selectedVersion) return;
    setEditorText(baselinePromptText);
    setActivePromptText(savedOverrideText);
    setAppliedMode("saved");
  };

  const saveAsNewVersion = async () => {
    const name = window.prompt("Enter a version name");
    if (!name || !name.trim()) return;

    const { data, error } = await supabase
      .from("prompt_versions")
      .insert({
        family: promptFamily,
        name: name.trim(),
        prompt_text: editorText,
      })
      .select("id")
      .single();

    if (error) {
      toast({ variant: "destructive", description: error.message });
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ["prompt-versions"] });
    setSelectedVersionId(data?.id ?? null);
    toast({ description: "Saved new prompt version." });
  };

  const deleteVersion = async () => {
    if (!selectedVersion) return;
    if (selectedVersion.is_default) {
      toast({ variant: "destructive", description: "Default cannot be deleted." });
      return;
    }
    if (!confirm(`Delete "${selectedVersion.name}"?`)) return;

    const { error } = await supabase
      .from("prompt_versions")
      .delete()
      .eq("id", selectedVersion.id);

    if (error) {
      toast({ variant: "destructive", description: error.message });
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ["prompt-versions"] });
    setSelectedVersionId(defaultVersion?.id ?? null);
    toast({ description: "Prompt version deleted." });
  };

  const setAsDefault = async () => {
    if (!selectedVersion) return;
    if (!isAdmin) {
      toast({ variant: "destructive", description: "Admin only." });
      return;
    }

    const { error } = await supabase.rpc("set_default_prompt_version", {
      p_family: promptFamily,
      p_version_id: selectedVersion.id,
    });

    if (error) {
      toast({ variant: "destructive", description: error.message });
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ["prompt-versions"] });
    toast({ description: "Default version updated." });
  };

  const sendMessage = async () => {
    if (!messageInput.trim()) return;
    if (!selectedResidence?.custom_id) {
      toast({ variant: "destructive", description: "Select a residence first." });
      return;
    }

    const userMessage = messageInput.trim();
    setMessageInput("");

    const history = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const data = {
      customId: selectedResidence.custom_id,
      corporateId: selectedResidence.custom_id
        .toLowerCase()
        .startsWith("corporate")
        ? null
        : lang === "fr"
        ? "corporatefr"
        : "corporateen",
      isCorporate: promptFamily === "corporate",
      lang,
      propertyName: selectedResidence.name,
    };

    const prompt_override =
      activePromptText && activePromptText.trim()
        ? activePromptText
        : null;

    setMessages((prev) => [
      ...prev,
      { role: "user", content: userMessage },
      { role: "assistant", content: "" },
    ]);
    setIsSending(true);

    try {
      const res = await fetch("/api/chat/prompt-testing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          history,
          data,
          lang,
          prompt_override,
        }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text();
        throw new Error(errText || "Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          if (!prev.length) return prev;
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: assistantText };
          return next;
        });
      }
    } catch (err: any) {
      toast({
        variant: "destructive",
        description: err?.message ?? "Failed to send message",
      });
    } finally {
      setIsSending(false);
    }
  };

  const clearChat = () => setMessages([]);

  return (
    <div className="flex h-full">
      <div className="w-[70%] border-r border-border bg-card/30 flex flex-col">
        <div className="p-4 border-b border-border flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">Prompt Testing</h1>
            <p className="text-sm text-muted-foreground">
              Test prompt versions without saving conversations.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowControls((prev) => !prev)}
          >
            {showControls ? "Hide controls" : "Show controls"}
          </Button>
        </div>
        <div className="flex-1 overflow-hidden p-4">
          <div
            className={cn(
              "grid grid-cols-1 gap-4 items-stretch h-full",
              showControls && "lg:grid-cols-[minmax(240px,28%)_1fr]"
            )}
          >
            {showControls ? (
              <Card className="h-fit">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Prompt Controls</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Residence
                    </label>
                    <Select
                      value={
                        selectedResidenceId ? String(selectedResidenceId) : ""
                      }
                      onValueChange={(value) =>
                        setSelectedResidenceId(Number(value))
                      }
                      disabled={loadingResidences}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select residence" />
                      </SelectTrigger>
                      <SelectContent>
                        {residences.map((res) => (
                          <SelectItem key={res.id} value={String(res.id)}>
                            {res.name} ({res.custom_id})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Prompt type
                    </label>
                    <Select
                      value={promptFamily}
                      onValueChange={(value) =>
                        setPromptFamily(value as PromptFamily)
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select prompt type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="property">Property</SelectItem>
                        <SelectItem value="corporate">Corporate</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Prompt version
                    </label>
                    <Select
                      value={
                        selectedVersionId ? String(selectedVersionId) : ""
                      }
                      onValueChange={(value) =>
                        setSelectedVersionId(Number(value))
                      }
                      disabled={loadingVersions || familyVersions.length === 0}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select version" />
                      </SelectTrigger>
                      <SelectContent>
                        {familyVersions.map((version) => (
                          <SelectItem
                            key={version.id}
                            value={String(version.id)}
                          >
                            {version.name}
                            {version.is_default && version.name !== "Default"
                              ? " (Default)"
                              : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Card className="h-full flex flex-col">
              <CardHeader className="pb-2 shrink-0">
                <CardTitle className="text-sm">Prompt Editor</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0 flex-1 flex flex-col min-h-0">
                <Textarea
                  value={editorText}
                  onChange={(e) => setEditorText(e.target.value)}
                  rows={18}
                  placeholder="Prompt text..."
                  className="flex-1 min-h-0"
                />
                {isGeneratedDefault ? (
                  <p className="text-xs text-muted-foreground">
                    This is the generated default prompt template. Edit it and
                    save a new version to keep your changes.
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Data context is always injected. Use{" "}
                  <span className="font-mono">{`{{data_context}}`}</span> to
                  insert raw context or{" "}
                  <span className="font-mono">
                    {`{{data_context_block}}`}
                  </span>{" "}
                  for a wrapped block. Otherwise it will be appended
                  automatically.
                </p>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    {hasUnsavedChanges ? (
                      <Badge variant="outline">Unsaved changes</Badge>
                    ) : (
                      <span className="text-muted-foreground">
                        No unsaved changes
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground">
                    {appliedMode === "draft"
                      ? "Using draft for chat"
                      : isGeneratedDefault && !activePromptText
                      ? "Using runtime default"
                      : "Using saved version"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={applyDraft} disabled={!editorText}>
                    Apply (Run with draft)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={saveAsNewVersion}
                    disabled={!editorText.trim()}
                  >
                    Save as new version
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsDiffOpen(true)}
                    disabled={!hasUnsavedChanges}
                  >
                    See changes
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={resetDraft}
                    disabled={!selectedVersion}
                  >
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={deleteVersion}
                    disabled={!canDelete}
                  >
                    Delete version
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={setAsDefault}
                    disabled={!selectedVersion || !isAdmin}
                  >
                    Set as default
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <div className="w-[30%] flex flex-col">
        <div className="p-4 border-b border-border bg-card/30 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Chat Preview</h2>
            <p className="text-xs text-muted-foreground">
              Residence: {selectedResidence?.name ?? "None selected"}{" "}
              {selectedResidence ? (
                <span className="ml-2 text-[10px] uppercase">
                  {lang}
                </span>
              ) : null}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={clearChat}>
            Clear chat
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-4">
          {messages.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No messages yet. Select a residence and send a prompt.
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div
                key={`${msg.role}-${idx}`}
                className={cn(
                  "max-w-3xl rounded-lg border px-4 py-3 text-sm whitespace-pre-wrap",
                  msg.role === "user"
                    ? "ml-auto bg-primary/10 border-primary/20"
                    : "bg-card border-border"
                )}
              >
                {msg.content || (msg.role === "assistant" && isSending
                  ? "..."
                  : "")}
              </div>
            ))
          )}
        </div>

        <div className="p-4 border-t border-border bg-card/30">
          <div className="flex items-center gap-2">
            <Input
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder="Type a message..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!isSending) sendMessage();
                }
              }}
              disabled={isSending}
            />
            <Button onClick={sendMessage} disabled={isSending}>
              {isSending ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      </div>

      {isDiffOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-5xl rounded-lg border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold">Prompt Changes</h3>
                <p className="text-xs text-muted-foreground">
                  Left is selected version, right is your current edits.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setIsDiffOpen(false)}>
                Close
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-0 border-b border-border">
              <div className="px-4 py-2 text-xs font-semibold text-muted-foreground border-r border-border">
                Base prompt
              </div>
              <div className="px-4 py-2 text-xs font-semibold text-muted-foreground">
                Draft prompt
              </div>
            </div>
            <div className="max-h-[70vh] overflow-auto">
              {buildDiffRows(baselinePromptText, editorText).map((row, idx) => (
                <div key={idx} className="grid grid-cols-2">
                  <div
                    className={cn(
                      "border-r border-border px-4 py-1 text-xs font-mono whitespace-pre-wrap",
                      row.type === "delete" && "bg-red-500/15 text-red-200",
                      row.type === "equal" && "text-muted-foreground"
                    )}
                  >
                    {row.left || " "}
                  </div>
                  <div
                    className={cn(
                      "px-4 py-1 text-xs font-mono whitespace-pre-wrap",
                      row.type === "insert" && "bg-emerald-500/15 text-emerald-200",
                      row.type === "equal" && "text-muted-foreground"
                    )}
                  >
                    {row.right || " "}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
