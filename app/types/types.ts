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
  intent_primary:
    | "pricing_and_costs"
    | "waitlist_or_availability"
    | "tour_booking"
    | "finding_residence"
    | "living_and_care_options"
    | "assisted_living"
    | "independent_living"
    | "memory_care"
    | "respite_short_term"
    | "amenities_and_services"
    | "dining_nutrition"
    | "wellness_healthcare"
    | "activities_events"
    | "location_neighborhood"
    | "transportation"
    | "move_in_process"
    | "policies_and_rules"
    | "pet_policy"
    | "accessibility"
    | "caregiver_family_support"
    | "billing_payments"
    | "forms_documents"
    | "careers"
    | "corporate_information"
    | "contact_support"
    | "other"
    | "unknown";
  intents: Array<
    | "pricing_and_costs"
    | "waitlist_or_availability"
    | "tour_booking"
    | "finding_residence"
    | "living_and_care_options"
    | "assisted_living"
    | "independent_living"
    | "memory_care"
    | "respite_short_term"
    | "amenities_and_services"
    | "dining_nutrition"
    | "wellness_healthcare"
    | "activities_events"
    | "location_neighborhood"
    | "transportation"
    | "move_in_process"
    | "policies_and_rules"
    | "pet_policy"
    | "accessibility"
    | "caregiver_family_support"
    | "billing_payments"
    | "forms_documents"
    | "careers"
    | "corporate_information"
    | "contact_support"
    | "other"
    | "unknown"
  >;
  intent_other: string;
  improvement: string;
  summary: string;
  evidence?: {
    visitor_goal: string;
    goal_met: "yes" | "partial" | "no" | "unknown";
    key_quotes: string[];
  };
  missed_or_weak_answers: Array<{
    visitor_question: string;
    assistant_response: string;
    issue_type: "unanswered";
    why_insufficient: string;
  }>;
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
  intent_primary?: ConversationAnalysis["intent_primary"] | null;
  intents?: ConversationAnalysis["intents"] | null;
  intent_other?: string | null;
  improvement: string;
  summary: string;
  evidence_visitor_goal?: string | null;
  evidence_goal_met?: "yes" | "partial" | "no" | "unknown" | null;
  evidence_key_quotes?: string[] | null;
  missed_or_weak_answers?: ConversationAnalysis["missed_or_weak_answers"] | null;
  page_type?: "corporate" | "residence" | "find_a_residence" | "unknown" | null;
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

export type SessionDurationRow = {
  id: number;
  session_id: string;
  visitor_id: string;
  first_message_at: string;
  last_message_at: string;
  duration_seconds: number;
  source: "auto" | "manual";
  created_at: string;
};
