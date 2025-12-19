import { useQuery } from "@tanstack/react-query";
// import type { Database } from "@/supabase/functions/_lib/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageRow, SourceRow } from "../types/types";

export function useReplay(
  supabase: SupabaseClient,
  selectedSessionId: string
) {
  return useQuery({
    queryKey: ["analytics-replay", selectedSessionId],
    enabled: !!selectedSessionId,
    queryFn: async () => {
      if (!selectedSessionId) return null;

      const { data: msgs, error: msgErr } = await supabase
        .from("chat_messages")
        .select("id,session_id,visitor_id,role,content,created_at")
        .eq("session_id", selectedSessionId)
        .order("created_at", { ascending: true });

      if (msgErr) throw msgErr;

      const assistantIds = (msgs ?? [])
        .filter((m: any) => m.role === "assistant")
        .map((m: any) => m.id);

      const sourcesRes = assistantIds.length
        ? await supabase
            .from("chat_message_sources")
            .select(
              "id,assistant_message_id,document_section_id,rank,score,source_type,snippet_used,created_at"
            )
            .in("assistant_message_id", assistantIds)
            .order("rank", { ascending: true })
        : { data: [] as any[], error: null as any };

      if (sourcesRes.error) throw sourcesRes.error;

      const sources = (sourcesRes.data ?? []) as SourceRow[];
      const sectionIds = Array.from(
        new Set(sources.map((s) => s.document_section_id))
      );

      const sectionToDoc = new Map<number, number>();
      const docMap = new Map<number, string>();

      if (sectionIds.length) {
        const secRes = await supabase
          .from("document_sections")
          .select("id,document_id")
          .in("id", sectionIds)
          .limit(5000);

        if (secRes.error) throw secRes.error;

        (secRes.data ?? []).forEach((row: any) =>
          sectionToDoc.set(row.id, row.document_id)
        );

        const docIds = Array.from(
          new Set((secRes.data ?? []).map((r: any) => r.document_id))
        );

        if (docIds.length) {
          const docsRes = await supabase
            .from("documents")
            .select("id,name")
            .in("id", docIds)
            .limit(5000);

          if (docsRes.error) throw docsRes.error;
          (docsRes.data ?? []).forEach((d: any) => docMap.set(d.id, d.name));
        }

        sources.forEach((s) => {
          const docId = sectionToDoc.get(s.document_section_id);
          s.doc_name = docId
            ? docMap.get(docId) ?? "Unknown doc"
            : "Unknown doc";
        });
      }

      const sourcesByMsg = new Map<number, SourceRow[]>();
      sources.forEach((s) => {
        const arr = sourcesByMsg.get(s.assistant_message_id) ?? [];
        arr.push(s);
        sourcesByMsg.set(s.assistant_message_id, arr);
      });

      return { messages: (msgs ?? []) as MessageRow[], sourcesByMsg };
    },
  });
}
