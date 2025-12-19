export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      chat_message_sources: {
        Row: {
          assistant_message_id: number
          created_at: string
          document_section_id: number
          id: number
          rank: number
          score: number | null
          session_id: string | null
          snippet_used: string | null
          source_type: string | null
          user_message_id: number | null
        }
        Insert: {
          assistant_message_id: number
          created_at?: string
          document_section_id: number
          id?: never
          rank?: number
          score?: number | null
          session_id?: string | null
          snippet_used?: string | null
          source_type?: string | null
          user_message_id?: number | null
        }
        Update: {
          assistant_message_id?: number
          created_at?: string
          document_section_id?: number
          id?: never
          rank?: number
          score?: number | null
          session_id?: string | null
          snippet_used?: string | null
          source_type?: string | null
          user_message_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_sources_assistant_message_fk"
            columns: ["assistant_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_sources_assistant_message_id_fkey"
            columns: ["assistant_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_sources_document_section_id_fkey"
            columns: ["document_section_id"]
            isOneToOne: false
            referencedRelation: "document_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_sources_session_fk"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_sources_user_message_fk"
            columns: ["user_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: number
          role: string
          session_id: string
          visitor_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: never
          role: string
          session_id: string
          visitor_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: never
          role?: string
          session_id?: string
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sessions: {
        Row: {
          created_at: string
          id: string
          lang: string | null
          page_url: string | null
          residence_custom_id: string | null
          visitor_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lang?: string | null
          page_url?: string | null
          residence_custom_id?: string | null
          visitor_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lang?: string | null
          page_url?: string | null
          residence_custom_id?: string | null
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_sessions_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      document_sections: {
        Row: {
          content: string
          document_id: number
          embedding: string | null
          id: number
          search_vector_en: unknown
          search_vector_fr: unknown
        }
        Insert: {
          content: string
          document_id: number
          embedding?: string | null
          id?: never
          search_vector_en?: unknown
          search_vector_fr?: unknown
        }
        Update: {
          content?: string
          document_id?: number
          embedding?: string | null
          id?: never
          search_vector_en?: unknown
          search_vector_fr?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "document_sections_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_sections_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents_with_storage_path"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          created_by: string
          id: number
          is_common: boolean
          name: string
          residence_id: number | null
          storage_object_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          id?: never
          is_common?: boolean
          name: string
          residence_id?: number | null
          storage_object_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: never
          is_common?: boolean
          name?: string
          residence_id?: number | null
          storage_object_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_residence_id_fkey"
            columns: ["residence_id"]
            isOneToOne: false
            referencedRelation: "residences"
            referencedColumns: ["id"]
          },
        ]
      }
      residences: {
        Row: {
          created_at: string
          created_by: string | null
          custom_id: string
          id: number
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          custom_id: string
          id?: never
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          custom_id?: string
          id?: never
          name?: string
        }
        Relationships: []
      }
      visitor_forms: {
        Row: {
          created_at: string
          form_type: string
          id: string
          is_submitted: boolean
          submitted_at: string | null
          submitted_with_button: string
          visitor_id: string
        }
        Insert: {
          created_at?: string
          form_type: string
          id?: string
          is_submitted?: boolean
          submitted_at?: string | null
          submitted_with_button: string
          visitor_id: string
        }
        Update: {
          created_at?: string
          form_type?: string
          id?: string
          is_submitted?: boolean
          submitted_at?: string | null
          submitted_with_button?: string
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visitor_forms_visitor_id_fkey"
            columns: ["visitor_id"]
            isOneToOne: false
            referencedRelation: "visitors"
            referencedColumns: ["id"]
          },
        ]
      }
      visitors: {
        Row: {
          created_at: string
          id: string
        }
        Insert: {
          created_at?: string
          id: string
        }
        Update: {
          created_at?: string
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      documents_with_storage_path: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: number | null
          is_common: boolean | null
          name: string | null
          residence_custom_id: string | null
          residence_id: number | null
          residence_name: string | null
          storage_object_id: string | null
          storage_object_path: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_residence_id_fkey"
            columns: ["residence_id"]
            isOneToOne: false
            referencedRelation: "residences"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_delete_visitor: {
        Args: { p_visitor_id: string }
        Returns: undefined
      }
      match_document_sections:
        | {
            Args: { embedding: string; match_threshold: number }
            Returns: {
              content: string
              document_id: number
              embedding: string | null
              id: number
              search_vector_en: unknown
              search_vector_fr: unknown
            }[]
            SetofOptions: {
              from: "*"
              to: "document_sections"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: {
              embedding: string
              match_threshold: number
              residence_custom_id?: string
            }
            Returns: {
              content: string
              document_id: number
              embedding: string | null
              id: number
              search_vector_en: unknown
              search_vector_fr: unknown
            }[]
            SetofOptions: {
              from: "*"
              to: "document_sections"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      match_document_sections_public: {
        Args: {
          p_embedding: string
          p_limit?: number
          p_match_threshold: number
          p_residence_custom_id?: string
        }
        Returns: {
          content: string
          document_id: number
          embedding: string | null
          id: number
          search_vector_en: unknown
          search_vector_fr: unknown
        }[]
        SetofOptions: {
          from: "*"
          to: "document_sections"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_sections_ml: {
        Args: {
          p_lang?: string
          p_limit?: number
          p_offset?: number
          p_residence_custom_id: string
          q: string
        }
        Returns: {
          content: string
          document_id: number
          document_name: string
          is_common: boolean
          lang: string
          rank: number
          residence_custom_id: string
          section_id: number
          snippet: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      supabase_url: { Args: never; Returns: string }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

