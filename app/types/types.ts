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
