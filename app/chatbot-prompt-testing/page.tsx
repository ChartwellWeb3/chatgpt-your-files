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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { prompt, type ChatBotData } from "@/lib/chatbot/prompts";
import { analyzerInstructions } from "@/lib/chatbot/analyzerPrompt";

type Residence = {
  id: number;
  name: string;
  custom_id: string;
  created_at: string;
};

type PromptFamily = "property" | "corporate";
type PromptFamilyAll = PromptFamily | "analyzer";
type Mode = "chat" | "analyzer";

type PromptVersion = {
  id: number;
  family: PromptFamilyAll;
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

type VisitorRow = {
  id: string;
  created_at: string;
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
  const [analyzerVersionId, setAnalyzerVersionId] = useState<number | null>(
    null
  );
  const [analyzerEditorText, setAnalyzerEditorText] = useState("");
  const [analyzerActivePromptText, setAnalyzerActivePromptText] = useState("");
  const [analyzerAppliedMode, setAnalyzerAppliedMode] = useState<
    "saved" | "draft"
  >("saved");
  const [showControls, setShowControls] = useState(true);
  const [mode, setMode] = useState<Mode>("chat");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const lastVersionIdRef = useRef<number | null>(null);
  const lastBaselineRef = useRef("");
  const lastAnalyzerVersionIdRef = useRef<number | null>(null);
  const lastAnalyzerBaselineRef = useRef("");
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const [analyzerInput, setAnalyzerInput] = useState("");
  const [analyzerOutput, setAnalyzerOutput] = useState("");
  const [analyzerParsed, setAnalyzerParsed] = useState<any | null>(null);
  const [analyzerLoading, setAnalyzerLoading] = useState(false);
  const [visitorSearch, setVisitorSearch] = useState("");
  const [selectedVisitorId, setSelectedVisitorId] = useState<string>("");
  const [visitorPage, setVisitorPage] = useState(0);
  const visitorPageSize = 20;

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

  const {
    data: visitorsResult,
    isLoading: loadingVisitors,
  } = useQuery({
    queryKey: ["prompt-testing-visitors", visitorPage],
    queryFn: async () => {
      const from = visitorPage * visitorPageSize;
      const to = from + visitorPageSize - 1;
      const { data, error, count } = await supabase
        .from("visitors")
        .select("id,created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      return {
        rows: (data ?? []) as VisitorRow[],
        count: count ?? 0,
      };
    },
    enabled: mode === "analyzer",
  });

  const visitors = visitorsResult?.rows ?? [];
  const visitorsCount =
    typeof (visitorsResult as any)?.count === "number"
      ? (visitorsResult as any).count
      : visitors.length;
  const totalVisitorPages = Math.max(
    1,
    Math.ceil(visitorsCount / visitorPageSize)
  );

  const filteredVisitors = useMemo(() => {
    const q = visitorSearch.trim().toLowerCase();
    if (!q) return visitors;
    return visitors.filter((v) => v.id.toLowerCase().includes(q));
  }, [visitors, visitorSearch]);

  const { data: visitorMessages = [], isLoading: loadingVisitorMessages } =
    useQuery({
      queryKey: ["prompt-testing-visitor-messages", selectedVisitorId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("chat_messages")
          .select("role,content,created_at")
          .eq("visitor_id", selectedVisitorId)
          .order("created_at", { ascending: true });
        if (error) throw error;
        return (data ?? []) as { role: string; content: string }[];
      },
      enabled: mode === "analyzer" && !!selectedVisitorId,
    });

  useEffect(() => {
    if (!selectedVisitorId || !visitorMessages.length) return;
    const formatted = visitorMessages
      .map((m) => {
        const role =
          m.role === "assistant" || m.role === "system" ? m.role : "user";
        return `${role}: ${m.content ?? ""}`;
      })
      .join("\n");
    setAnalyzerInput(formatted);
  }, [selectedVisitorId, visitorMessages]);

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

  const analyzerVersions = useMemo(
    () => promptVersions.filter((v) => v.family === "analyzer"),
    [promptVersions]
  );

  const analyzerDefaultVersion = useMemo(
    () =>
      analyzerVersions.find((v) => v.is_default) ??
      analyzerVersions[0] ??
      null,
    [analyzerVersions]
  );

  useEffect(() => {
    if (!analyzerVersions.length) return;
    if (
      !analyzerVersionId ||
      !analyzerVersions.some((v) => v.id === analyzerVersionId)
    ) {
      setAnalyzerVersionId(analyzerDefaultVersion?.id ?? null);
    }
  }, [analyzerVersions, analyzerVersionId, analyzerDefaultVersion]);

  const selectedAnalyzerVersion = useMemo(
    () => analyzerVersions.find((v) => v.id === analyzerVersionId) ?? null,
    [analyzerVersions, analyzerVersionId]
  );

  const analyzerBaselinePromptText = useMemo(() => {
    if (!selectedAnalyzerVersion) return "";
    if (selectedAnalyzerVersion.prompt_text?.trim())
      return selectedAnalyzerVersion.prompt_text;
    if (!selectedAnalyzerVersion.is_default)
      return selectedAnalyzerVersion.prompt_text ?? "";
    return analyzerInstructions();
  }, [selectedAnalyzerVersion]);

  const analyzerSavedOverrideText =
    selectedAnalyzerVersion?.prompt_text?.trim()
      ? selectedAnalyzerVersion.prompt_text
      : "";

  useEffect(() => {
    if (!selectedAnalyzerVersion) {
      setAnalyzerEditorText("");
      setAnalyzerActivePromptText("");
      setAnalyzerAppliedMode("saved");
      lastAnalyzerVersionIdRef.current = null;
      lastAnalyzerBaselineRef.current = "";
      return;
    }

    const versionChanged =
      selectedAnalyzerVersion.id !== lastAnalyzerVersionIdRef.current;
    if (versionChanged) {
      setAnalyzerEditorText(analyzerBaselinePromptText);
      setAnalyzerActivePromptText(analyzerSavedOverrideText);
      setAnalyzerAppliedMode("saved");
      lastAnalyzerVersionIdRef.current = selectedAnalyzerVersion.id;
      lastAnalyzerBaselineRef.current = analyzerBaselinePromptText;
      return;
    }

    if (
      analyzerBaselinePromptText !== lastAnalyzerBaselineRef.current &&
      analyzerEditorText === lastAnalyzerBaselineRef.current
    ) {
      setAnalyzerEditorText(analyzerBaselinePromptText);
      setAnalyzerActivePromptText(analyzerSavedOverrideText);
      setAnalyzerAppliedMode("saved");
    }

    lastAnalyzerBaselineRef.current = analyzerBaselinePromptText;
  }, [
    selectedAnalyzerVersion?.id,
    analyzerBaselinePromptText,
    analyzerEditorText,
    analyzerSavedOverrideText,
  ]);

  const hasUnsavedChanges = editorText !== baselinePromptText;
  const isGeneratedDefault =
    !!selectedVersion?.is_default && !selectedVersion?.prompt_text?.trim();
  const analyzerHasUnsavedChanges =
    analyzerEditorText !== analyzerBaselinePromptText;
  const analyzerIsGeneratedDefault =
    !!selectedAnalyzerVersion?.is_default &&
    !selectedAnalyzerVersion?.prompt_text?.trim();

  const canDelete =
    !!selectedVersion &&
    !selectedVersion.is_default &&
    !!userId &&
    selectedVersion.created_by === userId;
  const analyzerCanDelete =
    !!selectedAnalyzerVersion &&
    !selectedAnalyzerVersion.is_default &&
    !!userId &&
    selectedAnalyzerVersion.created_by === userId;

  const currentBaseline =
    mode === "chat" ? baselinePromptText : analyzerBaselinePromptText;
  const currentEditor = mode === "chat" ? editorText : analyzerEditorText;
  const currentHasUnsavedChanges =
    mode === "chat" ? hasUnsavedChanges : analyzerHasUnsavedChanges;
  const currentAppliedMode =
    mode === "chat" ? appliedMode : analyzerAppliedMode;
  const currentIsGeneratedDefault =
    mode === "chat" ? isGeneratedDefault : analyzerIsGeneratedDefault;
  const currentCanDelete = mode === "chat" ? canDelete : analyzerCanDelete;
  const currentVersions = mode === "chat" ? familyVersions : analyzerVersions;
  const currentVersionId =
    mode === "chat" ? selectedVersionId : analyzerVersionId;
  const setCurrentVersionId =
    mode === "chat" ? setSelectedVersionId : setAnalyzerVersionId;
  const currentSelectedVersion =
    mode === "chat" ? selectedVersion : selectedAnalyzerVersion;

  const applyDraft = () => {
    if (mode === "chat") {
      setActivePromptText(editorText);
      setAppliedMode("draft");
      toast({ description: "Draft applied for chat requests." });
      return;
    }
    setAnalyzerActivePromptText(analyzerEditorText);
    setAnalyzerAppliedMode("draft");
    toast({ description: "Draft applied for analyzer runs." });
  };

  const resetDraft = () => {
    if (mode === "chat") {
      if (!selectedVersion) return;
      setEditorText(baselinePromptText);
      setActivePromptText(savedOverrideText);
      setAppliedMode("saved");
      return;
    }
    if (!selectedAnalyzerVersion) return;
    setAnalyzerEditorText(analyzerBaselinePromptText);
    setAnalyzerActivePromptText(analyzerSavedOverrideText);
    setAnalyzerAppliedMode("saved");
  };

  const saveAsNewVersion = async () => {
    const name = window.prompt("Enter a version name");
    if (!name || !name.trim()) return;

    const family = mode === "chat" ? promptFamily : "analyzer";
    const text = mode === "chat" ? editorText : analyzerEditorText;
    const { data, error } = await supabase
      .from("prompt_versions")
      .insert({
        family,
        name: name.trim(),
        prompt_text: text,
      })
      .select("id")
      .single();

    if (error) {
      toast({ variant: "destructive", description: error.message });
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ["prompt-versions"] });
    if (mode === "chat") {
      setSelectedVersionId(data?.id ?? null);
    } else {
      setAnalyzerVersionId(data?.id ?? null);
    }
    toast({ description: "Saved new prompt version." });
  };

  const deleteVersion = async () => {
    if (mode === "chat") {
      if (!selectedVersion) return;
      if (selectedVersion.is_default) {
        toast({
          variant: "destructive",
          description: "Default cannot be deleted.",
        });
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
      return;
    }

    if (!selectedAnalyzerVersion) return;
    if (selectedAnalyzerVersion.is_default) {
      toast({ variant: "destructive", description: "Default cannot be deleted." });
      return;
    }
    if (!confirm(`Delete "${selectedAnalyzerVersion.name}"?`)) return;
    const { error } = await supabase
      .from("prompt_versions")
      .delete()
      .eq("id", selectedAnalyzerVersion.id);
    if (error) {
      toast({ variant: "destructive", description: error.message });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["prompt-versions"] });
    setAnalyzerVersionId(analyzerDefaultVersion?.id ?? null);
    toast({ description: "Prompt version deleted." });
  };

  const setAsDefault = async () => {
    if (!isAdmin) {
      toast({ variant: "destructive", description: "Admin only." });
      return;
    }

    if (mode === "chat") {
      if (!selectedVersion) return;
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
      return;
    }

    if (!selectedAnalyzerVersion) return;
    const { error } = await supabase.rpc("set_default_prompt_version", {
      p_family: "analyzer",
      p_version_id: selectedAnalyzerVersion.id,
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

  const parseTranscript = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return [] as { role: "user" | "assistant" | "system"; content: string }[];

    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        const list = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.transcript)
          ? parsed.transcript
          : Array.isArray(parsed?.messages)
          ? parsed.messages
          : [];
        return list
          .filter((m: any) => m && typeof m.content === "string")
          .map((m: any) => ({
            role:
              m.role === "assistant" || m.role === "system" ? m.role : "user",
            content: m.content,
          }));
      } catch {
        // fall through to line parsing
      }
    }

    const lines = raw.split(/\r?\n/);
    const entries: { role: "user" | "assistant" | "system"; content: string }[] =
      [];
    let current: { role: "user" | "assistant" | "system"; content: string } | null =
      null;

    const pushCurrent = () => {
      if (current && current.content.trim()) entries.push(current);
      current = null;
    };

    for (const line of lines) {
      const match = line.match(/^(user|assistant|system)\s*:\s*(.*)$/i);
      if (match) {
        pushCurrent();
        const role =
          match[1].toLowerCase() === "assistant"
            ? "assistant"
            : match[1].toLowerCase() === "system"
            ? "system"
            : "user";
        current = { role, content: match[2] ?? "" };
      } else if (current) {
        current.content += `${current.content ? "\n" : ""}${line}`;
      } else if (line.trim()) {
        current = { role: "user", content: line };
      }
    }

    pushCurrent();
    return entries;
  };

  const runAnalyzer = async () => {
    const transcript = parseTranscript(analyzerInput);
    if (!transcript.length) {
      toast({
        variant: "destructive",
        description: "Provide a conversation to analyze.",
      });
      return;
    }

    setAnalyzerLoading(true);
    setAnalyzerOutput("");
    setAnalyzerParsed(null);
    try {
      const res = await fetch("/api/chat/analyzer-testing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          prompt_override:
            analyzerActivePromptText && analyzerActivePromptText.trim()
              ? analyzerActivePromptText
              : null,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || "Analyzer request failed");
      }
      setAnalyzerOutput(
        typeof json?.output === "string" ? json.output : JSON.stringify(json)
      );
      setAnalyzerParsed(json?.parsed ?? null);
    } catch (err: any) {
      toast({
        variant: "destructive",
        description: err?.message ?? "Analyzer request failed",
      });
    } finally {
      setAnalyzerLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 border-b border-border bg-card/30 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">
            {mode === "chat" ? "Prompt Testing" : "Analyzer Prompt Testing"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === "chat"
              ? "Test prompt versions without saving conversations."
              : "Test analyzer prompts against conversation transcripts."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs
            value={mode}
            onValueChange={(value) => setMode(value as Mode)}
          >
            <TabsList className="h-9">
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="analyzer">Analyzer</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowControls((prev) => !prev)}
          >
            {showControls ? "Hide controls" : "Show controls"}
          </Button>
        </div>
      </div>

      <div className="flex flex-1">
        <div className="w-[70%] border-r border-border bg-card/30 flex flex-col">
          <div className="flex-1 overflow-hidden p-4">
            <div
              className={cn(
                "grid grid-cols-1 gap-4 items-stretch h-full",
                showControls && "lg:grid-cols-[minmax(220px,28%)_1fr]"
              )}
            >
              {showControls ? (
                <Card className="h-fit">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Prompt Controls</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    {mode === "chat" ? (
                      <>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">
                            Residence
                          </label>
                          <Select
                            value={
                              selectedResidenceId
                                ? String(selectedResidenceId)
                                : ""
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
                                <SelectItem
                                  key={res.id}
                                  value={String(res.id)}
                                >
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
                      </>
                    ) : null}

                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        Prompt version
                      </label>
                      <Select
                        value={currentVersionId ? String(currentVersionId) : ""}
                        onValueChange={(value) =>
                          setCurrentVersionId(Number(value))
                        }
                        disabled={loadingVersions || currentVersions.length === 0}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select version" />
                        </SelectTrigger>
                        <SelectContent>
                          {currentVersions.map((version) => (
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

                    {mode === "analyzer" ? (
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">
                          Load real conversation (by visitor)
                        </label>
                        <Input
                          value={visitorSearch}
                          onChange={(e) => setVisitorSearch(e.target.value)}
                          placeholder="Search by visitor id..."
                          className="h-8 text-sm"
                        />
                        <Select
                          value={selectedVisitorId}
                          onValueChange={(value) => setSelectedVisitorId(value)}
                          disabled={
                            loadingVisitors || filteredVisitors.length === 0
                          }
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue
                              placeholder={
                                loadingVisitors
                                  ? "Loading visitors..."
                                  : "Select a visitor"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {filteredVisitors.map((v) => (
                              <SelectItem key={v.id} value={v.id}>
                                {v.id} •{" "}
                                {new Date(v.created_at).toLocaleString()}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            Page {visitorPage + 1} of {totalVisitorPages}
                          </span>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setVisitorPage((p) => Math.max(0, p - 1))
                              }
                              disabled={visitorPage === 0}
                            >
                              Prev
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setVisitorPage((p) =>
                                  Math.min(totalVisitorPages - 1, p + 1)
                                )
                              }
                              disabled={visitorPage >= totalVisitorPages - 1}
                            >
                              Next
                            </Button>
                          </div>
                        </div>
                        {loadingVisitorMessages ? (
                          <p className="text-xs text-muted-foreground">
                            Loading messages...
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}

              <Card className="h-full flex flex-col">
                <CardHeader className="pb-2 shrink-0">
                  <CardTitle className="text-sm">Prompt Editor</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-0 flex-1 flex flex-col min-h-0">
                  <Textarea
                    value={currentEditor}
                    onChange={(e) =>
                      mode === "chat"
                        ? setEditorText(e.target.value)
                        : setAnalyzerEditorText(e.target.value)
                    }
                    rows={18}
                    placeholder="Prompt text..."
                    className="flex-1 min-h-0"
                  />
                  {currentIsGeneratedDefault ? (
                    <p className="text-xs text-muted-foreground">
                      This is the generated default prompt template. Edit it and
                      save a new version to keep your changes.
                    </p>
                  ) : null}
                  {mode === "chat" ? (
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
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Analyzer prompts run only on the transcript provided.
                    </p>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      {currentHasUnsavedChanges ? (
                        <Badge variant="outline">Unsaved changes</Badge>
                      ) : (
                        <span className="text-muted-foreground">
                          No unsaved changes
                        </span>
                      )}
                    </div>
                    <span className="text-muted-foreground">
                      {currentAppliedMode === "draft"
                        ? "Using draft"
                        : currentIsGeneratedDefault &&
                          !(mode === "chat"
                            ? activePromptText
                            : analyzerActivePromptText)
                        ? "Using runtime default"
                        : "Using saved version"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={applyDraft}
                      disabled={!currentEditor}
                    >
                      Apply (Run with draft)
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={saveAsNewVersion}
                      disabled={!currentEditor.trim()}
                    >
                      Save as new version
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsDiffOpen(true)}
                      disabled={!currentHasUnsavedChanges}
                    >
                      See changes
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={resetDraft}
                      disabled={!currentSelectedVersion}
                    >
                      Reset
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={deleteVersion}
                      disabled={!currentCanDelete}
                    >
                      Delete version
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={setAsDefault}
                      disabled={!currentSelectedVersion || !isAdmin}
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
              <h2 className="text-base font-semibold">
                {mode === "chat" ? "Chat Preview" : "AI Analyzer"}
              </h2>
              {mode === "chat" ? (
                <p className="text-xs text-muted-foreground">
                  Residence: {selectedResidence?.name ?? "None selected"}{" "}
                  {selectedResidence ? (
                    <span className="ml-2 text-[10px] uppercase">{lang}</span>
                  ) : null}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Paste a conversation and preview analyzer output.
                </p>
              )}
            </div>
            {mode === "chat" ? (
              <Button variant="outline" size="sm" onClick={clearChat}>
                Clear chat
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAnalyzerInput("");
                  setAnalyzerOutput("");
                  setAnalyzerParsed(null);
                }}
              >
                Clear
              </Button>
            )}
          </div>

          {mode === "chat" ? (
            <>
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
                      {msg.content ||
                        (msg.role === "assistant" && isSending ? "..." : "")}
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
            </>
          ) : (
            <div className="flex-1 overflow-auto p-4 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Conversation
                </label>
                <Textarea
                  value={analyzerInput}
                  onChange={(e) => setAnalyzerInput(e.target.value)}
                  rows={10}
                  placeholder={`user: Hi\nassistant: Hello! How can I help?\nuser: I'm looking for pricing.`}
                  className="min-h-[200px]"
                />
                <p className="text-xs text-muted-foreground">
                  Use `user:` / `assistant:` / `system:` lines, or paste JSON
                  array of messages.
                </p>
              </div>
              <Button
                onClick={runAnalyzer}
                disabled={analyzerLoading || !analyzerInput.trim()}
              >
                {analyzerLoading ? "Analyzing..." : "Run analyzer"}
              </Button>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Output
                </label>
                <div className="rounded-md border border-border bg-background/40 p-3 text-xs font-mono whitespace-pre-wrap min-h-[160px]">
                  {analyzerParsed
                    ? JSON.stringify(analyzerParsed, null, 2)
                    : analyzerOutput || "Analyzer output will appear here."}
                </div>
              </div>
            </div>
          )}
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
              {buildDiffRows(currentBaseline, currentEditor).map((row, idx) => (
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
