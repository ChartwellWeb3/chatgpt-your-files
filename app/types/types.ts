export type VisitorRow = {
  id: string;
  created_at: string;
};

export type SessionRow = {
  id: string;
  visitor_id: string;
  created_at: string;
  page_url: string | null;
  residence_custom_id: string | null;
  lang: string | null;
};

export type MessageRow = {
  id: number;
  session_id: string;
  visitor_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

export type SourceRow = {
  id: number;
  assistant_message_id: number;
  document_section_id: number;
  rank: number;
  score: number | null;
  source_type: string | null;
  snippet_used: string | null;
  created_at: string;
  doc_name?: string;
};

export type ConversationAnalysis = {
  satisfaction_1_to_10: number;
  sentiment: "satisfied" | "neutral" | "angry" | "unknown";
  improvement: string;
  summary: string;
  evidence?: {
    visitor_goal: string;
    goal_met: "yes" | "partial" | "no" | "unknown";
    key_quotes: string[];
  };
};

export type VisitorAnalysisRow = {
  id: number;
  visitor_id: string;
  last_message_at: string;
  source: "auto" | "manual";
  model: string;
  prompt_version: string;
  satisfaction_1_to_10: number;
  sentiment: "satisfied" | "neutral" | "angry" | "unknown";
  improvement: string;
  summary: string;
  evidence_visitor_goal?: string | null;
  evidence_goal_met?: "yes" | "partial" | "no" | "unknown" | null;
  evidence_key_quotes?: string[] | null;
  created_at: string;
};

export type VisitorDurationRow = {
  id: number;
  visitor_id: string;
  first_message_at: string;
  last_message_at: string;
  duration_seconds: number;
  source: "auto" | "manual";
  created_at: string;
};
