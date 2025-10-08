"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import type { Database } from "../../supabase/functions/_lib/database";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  FileText,
  MessageSquare,
  Plus,
  Trash2,
  Upload,
  X,
  Edit2,
  Check,
  Loader2,
  Send,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useChat } from "ai/react";
import { usePipeline } from "@/lib/hooks/use-pipeline";
import { cn } from "@/lib/utils";

type Residence = {
  id: number;
  name: string;
  custom_id: string;
  created_at: string;
};

type Document = {
  id: number;
  name: string;
  storage_object_path: string | null;
  residence_custom_id: string | null;
  is_common: boolean | null;
};

export default function DashboardPage() {
  const supabase = createClientComponentClient<Database>();
  const queryClient = useQueryClient();
  const [selectedResidence, setSelectedResidence] = useState<Residence | null>(
    null
  );
  const [isCreating, setIsCreating] = useState(false);
  const [newResidenceName, setNewResidenceName] = useState("");
  const [newResidenceId, setNewResidenceId] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [editedCustomId, setEditedCustomId] = useState("");
  const [activeTab, setActiveTab] = useState<"files" | "chat">("files");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // ...existing code...

  const generateEmbedding = usePipeline(
    "feature-extraction",
    "Supabase/gte-small"
  );

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    setMessages,
  } = useChat({
    api: "/api/chat",
  });

  const isReady = !!generateEmbedding;

  const { data: residences, isLoading: loadingResidences } = useQuery<
    Residence[]
  >(["residences"], async () => {
    const { data, error } = await supabase
      .from("residences")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data as Residence[];
  });

  const { data: documents, refetch: refetchDocuments } = useQuery<Document[]>(
    ["documents", selectedResidence?.custom_id],
    async () => {
      const { data, error } = await supabase
        .from("documents_with_storage_path")
        .select();
      if (error) throw error;

      return (data as unknown as Document[]).filter((doc) => {
        if (selectedResidence === null) {
          return doc.is_common === true;
        }
        return doc.residence_custom_id === selectedResidence?.custom_id;
      });
    },
    {
      enabled: selectedResidence !== null,
    }
  );

  const [residenceSearch, setResidenceSearch] = useState("");
  const [filteredResidences, setFilteredResidences] = useState<Residence[]>([]);
  const [fileSearch, setFileSearch] = useState("");
  const [filteredDocuments, setFilteredDocuments] = useState<Document[]>([]);

  useEffect(() => {
    if (!residences) {
      setFilteredResidences([]);
      setFilteredDocuments([]);
      return;
    }
    setFilteredResidences(
      residenceSearch.trim()
        ? residences.filter((r: Residence) =>
            r.name
              .toLowerCase()
              .startsWith(residenceSearch.trim().toLowerCase())
          )
        : residences
    );
    setFilteredDocuments(
      fileSearch.trim()
        ? (documents ?? []).filter((d: Document) =>
            d.name?.toLowerCase().includes(fileSearch.trim().toLowerCase())
          )
        : documents ?? []
    );
  }, [residences, residenceSearch, documents, fileSearch]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const createResidence = async () => {
    if (!newResidenceName.trim()) {
      toast({
        variant: "destructive",
        description: "Residence name cannot be empty",
      });
      return;
    }

    const customId =
      newResidenceId.trim() ||
      newResidenceName
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");

    const { error } = await supabase
      .from("residences")
      .insert({ name: newResidenceName.trim(), custom_id: customId });

    if (error) {
      toast({
        variant: "destructive",
        description: "Failed to create residence",
      });
      return;
    }

    toast({ description: `Created residence: ${newResidenceName}` });
    setNewResidenceName("");
    setNewResidenceId("");
    setIsCreating(false);
    queryClient.invalidateQueries(["residences"]);
  };

  const deleteResidence = async (residence: Residence) => {
    if (
      !confirm(
        `Delete "${residence.name}"? This will also delete all associated files.`
      )
    )
      return;

    const { error } = await supabase
      .from("residences")
      .delete()
      .eq("id", residence.id);

    if (error) {
      toast({
        variant: "destructive",
        description: "Failed to delete residence",
      });
      return;
    }

    toast({ description: `Deleted residence: ${residence.name}` });
    if (selectedResidence?.id === residence.id) {
      setSelectedResidence(null);
    }
    queryClient.invalidateQueries(["residences"]);
  };

  const updateResidence = async () => {
    if (!selectedResidence || !editedName.trim() || !editedCustomId.trim()) {
      toast({
        variant: "destructive",
        description: "Name and Custom ID cannot be empty",
      });
      return;
    }

    const customIdRegex = /^[a-z0-9-]+$/;
    if (!customIdRegex.test(editedCustomId)) {
      toast({
        variant: "destructive",
        description:
          "Custom ID must contain only lowercase letters, numbers, and hyphens",
      });
      return;
    }

    const { error } = await supabase
      .from("residences")
      .update({
        name: editedName.trim(),
        custom_id: editedCustomId.trim(),
      })
      .eq("id", selectedResidence.id);

    if (error) {
      if (error.code === "23505") {
        toast({
          variant: "destructive",
          description: "This Custom ID is already in use",
        });
      } else {
        toast({
          variant: "destructive",
          description: "Failed to update residence",
        });
      }
      return;
    }

    toast({ description: "Residence updated successfully" });
    setEditingName(false);
    queryClient.invalidateQueries(["residences"]);
    setSelectedResidence({
      ...selectedResidence,
      name: editedName.trim(),
      custom_id: editedCustomId.trim(),
    });
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const scope = selectedResidence?.custom_id || "common";
    let successCount = 0;
    let failCount = 0;
    for (const file of Array.from(files)) {
      const uuid = crypto.randomUUID();
      const storagePath = `${scope}/${uuid}/${file.name}`;
      const { error } = await supabase.storage
        .from("files")
        .upload(storagePath, file);
      if (error) {
        failCount++;
      } else {
        successCount++;
      }
    }
    if (successCount > 0) {
      toast({
        description: `${successCount} file${
          successCount > 1 ? "s" : ""
        } uploaded successfully`,
      });
      refetchDocuments();
    }
    if (failCount > 0) {
      toast({
        variant: "destructive",
        description: `${failCount} file${
          failCount > 1 ? "s" : ""
        } failed to upload`,
      });
    }
  };

  const deleteDocument = async (doc: Document) => {
    if (!confirm("Delete this file?")) return;

    if (doc.storage_object_path) {
      await supabase.storage.from("files").remove([doc.storage_object_path]);
    }

    const { error } = await supabase
      .from("documents")
      .delete()
      .eq("id", doc.id);

    if (error) {
      toast({ variant: "destructive", description: "Failed to delete file" });
      return;
    }

    toast({ description: "File deleted" });
    refetchDocuments();
  };

  return (
    <div className="flex h-full">
      {/* Sidebar - Residence List */}
      <div className="w-80 border-r border-border bg-card/30 flex flex-col">
        <div className="p-4 border-b border-border flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Residences</h2>
            <Button
              size="sm"
              onClick={() => setIsCreating(true)}
              className="h-8 w-8 p-0 bg-primary/10 hover:bg-primary/20 text-primary"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <Input
            placeholder="Search residences..."
            value={residenceSearch}
            onChange={(e) => setResidenceSearch(e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-2 space-y-1">
            {loadingResidences ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              filteredResidences.map((residence) => (
                <div
                  key={residence.id}
                  onClick={() => {
                    setSelectedResidence(residence);
                    setMessages([]);
                    setActiveTab("files");
                  }}
                  className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all ${
                    selectedResidence?.id === residence.id
                      ? "bg-primary/10 shadow-glow"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        selectedResidence?.id === residence.id
                          ? "bg-primary"
                          : "bg-muted-foreground/30"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {residence.name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate font-mono">
                        {residence.custom_id}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteResidence(residence);
                    }}
                    className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Create Residence Form */}
        {isCreating && (
          <div className="p-4 border-t border-border bg-card/50 space-y-3 animate-in">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">New Residence</h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsCreating(false)}
                className="h-6 w-6 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2">
              <Input
                placeholder="Residence name"
                value={newResidenceName}
                onChange={(e) => setNewResidenceName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createResidence()}
                className="h-9 text-sm"
              />
              <Input
                placeholder="Custom ID (optional)"
                value={newResidenceId}
                onChange={(e) => setNewResidenceId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createResidence()}
                className="h-9 text-sm font-mono"
              />
              <Button onClick={createResidence} className="w-full h-9 text-sm">
                Create
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {selectedResidence ? (
          <>
            {/* Header */}
            <div className="p-6 border-b border-border bg-card/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    {editingName ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            value={editedName}
                            onChange={(e) => setEditedName(e.target.value)}
                            onKeyDown={(e) =>
                              e.key === "Enter" && updateResidence()
                            }
                            placeholder="Residence name"
                            className="h-8 w-64"
                            autoFocus
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            value={editedCustomId}
                            onChange={(e) =>
                              setEditedCustomId(e.target.value.toLowerCase())
                            }
                            onKeyDown={(e) =>
                              e.key === "Enter" && updateResidence()
                            }
                            placeholder="custom-id"
                            className="h-8 w-64 font-mono text-sm"
                          />
                          <Button
                            size="sm"
                            onClick={updateResidence}
                            className="h-8 w-8 p-0"
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingName(false)}
                            className="h-8 w-8 p-0"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center gap-2">
                          <h1 className="text-xl font-semibold">
                            {selectedResidence.name}
                          </h1>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingName(true);
                              setEditedName(selectedResidence.name);
                              setEditedCustomId(selectedResidence.custom_id);
                            }}
                            className="h-7 w-7 p-0 opacity-50 hover:opacity-100"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <p className="text-sm text-muted-foreground font-mono">
                          {selectedResidence.custom_id}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant={activeTab === "files" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setActiveTab("files")}
                    className="gap-2"
                  >
                    <FileText className="h-4 w-4" />
                    Files
                  </Button>
                  <Button
                    variant={activeTab === "chat" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => {
                      setActiveTab("chat");
                      setMessages([]);
                    }}
                    className="gap-2"
                  >
                    <MessageSquare className="h-4 w-4" />
                    Chat
                  </Button>
                </div>
              </div>
            </div>

            {/* Content Area */}
            {activeTab === "files" ? (
              <div className="flex-1 overflow-auto p-6">
                <div className="max-w-5xl mx-auto space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">Files</h2>
                      <p className="text-sm text-muted-foreground">
                        {filteredDocuments.length || 0} file
                        {filteredDocuments.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      className="gap-2"
                    >
                      <Upload className="h-4 w-4" />
                      Upload Files
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = e.target.files;
                        if (files && files.length > 0) uploadFiles(files);
                        e.target.value = "";
                      }}
                    />
                  </div>
                  <Input
                    placeholder="Search files..."
                    value={fileSearch}
                    onChange={(e) => setFileSearch(e.target.value)}
                    className="h-8 text-sm mb-4"
                  />
                  {/* Drag and Drop Zone */}
                  <div
                    className={cn(
                      "border-2 border-dashed rounded-lg p-6 text-center transition-colors mb-6",
                      isDragging
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card/50"
                    )}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      if (
                        e.dataTransfer.files &&
                        e.dataTransfer.files.length > 0
                      ) {
                        uploadFiles(e.dataTransfer.files);
                      }
                    }}
                  >
                    <p className="text-muted-foreground">
                      Drag and drop files here, or click "Upload Files"
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredDocuments.map((doc) => (
                      <div
                        key={doc.id}
                        className="group relative p-4 rounded-lg border border-border bg-card hover:bg-card/80 transition-all hover:shadow-lg"
                      >
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteDocument(doc)}
                          className="absolute top-2 right-2 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        <div className="flex flex-col items-center gap-3 text-center">
                          <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                            <FileText className="h-6 w-6 text-primary" />
                          </div>
                          <div className="w-full">
                            <p className="text-sm font-medium truncate">
                              {doc.name}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {filteredDocuments.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="w-16 h-16 bg-muted/30 rounded-full flex items-center justify-center mb-4">
                        <FileText className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <p className="text-muted-foreground">No files yet</p>
                      <p className="text-sm text-muted-foreground/60 mt-1">
                        Upload a file to get started
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col">
                <div className="flex-1 overflow-y-auto p-6">
                  <div className="max-w-3xl mx-auto space-y-4">
                    {messages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                          <MessageSquare className="h-8 w-8 text-primary" />
                        </div>
                        <p className="text-muted-foreground">
                          Start a conversation
                        </p>
                        <p className="text-sm text-muted-foreground/60 mt-1">
                          Ask questions about your files in{" "}
                          {selectedResidence.name}
                        </p>
                      </div>
                    ) : (
                      messages.map(({ id, role, content }) => (
                        <div
                          key={id}
                          className={cn(
                            "flex animate-fade-in",
                            role === "user" ? "justify-end" : "justify-start"
                          )}
                        >
                          <div
                            className={cn(
                              "max-w-[80%] p-4 rounded-lg",
                              role === "user"
                                ? "bg-primary text-primary-foreground"
                                : "bg-card border border-border"
                            )}
                          >
                            <p className="text-sm whitespace-pre-wrap leading-relaxed">
                              {content}
                            </p>
                          </div>
                        </div>
                      ))
                    )}

                    {isLoading && (
                      <div className="flex justify-start animate-fade-in">
                        <div className="bg-card border border-border rounded-lg p-4">
                          <div className="dot-pulse" />
                        </div>
                      </div>
                    )}

                    <div ref={messagesEndRef} />
                  </div>
                </div>

                <div className="p-6 border-t border-border bg-card/30">
                  <form
                    className="max-w-3xl mx-auto flex gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!generateEmbedding || !selectedResidence) {
                        toast({
                          variant: "destructive",
                          description:
                            "Unable to generate embeddings or no residence selected",
                        });
                        return;
                      }

                      const output = await generateEmbedding(input, {
                        pooling: "mean",
                        normalize: true,
                      });

                      const embedding = JSON.stringify(Array.from(output.data));

                      const {
                        data: { session },
                      } = await supabase.auth.getSession();

                      if (!session) {
                        toast({
                          variant: "destructive",
                          description: "Please sign in to chat",
                        });
                        return;
                      }

                      handleSubmit(e, {
                        options: {
                          headers: {
                            authorization: `Bearer ${session.access_token}`,
                          },
                          body: {
                            embedding,
                            residence_custom_id: selectedResidence.custom_id,
                          },
                        },
                      });
                    }}
                  >
                    <Textarea
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          const form = e.currentTarget.form;
                          if (form) {
                            form.requestSubmit();
                          }
                        }
                      }}
                      placeholder="Ask a question..."
                      className="min-h-[60px] resize-none"
                      disabled={isLoading || !isReady}
                    />
                    <Button
                      type="submit"
                      disabled={isLoading || !input.trim() || !isReady}
                      className="h-[60px] px-6"
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </form>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-muted/30 rounded-full flex items-center justify-center mx-auto">
                <Building2 className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="text-lg font-medium">Select a residence</p>
                <p className="text-sm text-muted-foreground">
                  Choose a residence from the sidebar to get started
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
