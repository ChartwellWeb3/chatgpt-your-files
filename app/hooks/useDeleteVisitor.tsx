import { useMutation } from "@tanstack/react-query";
export function useDeleteVisitor(supabase: any) {
  const mutation = useMutation({
    mutationFn: async (visitorId: string) => {
      if (!visitorId) throw new Error("Visitor ID is required");

      const ok = window.confirm(
        `Delete visitor ${visitorId} and ALL related sessions/messages/sources? This cannot be undone.`
      );
      if (!ok) return { ok: false as const, visitorId };

      const { error } = await supabase.rpc("admin_delete_visitor", {
        p_visitor_id: visitorId,
      });
      if (error) throw error;

      return { ok: true as const, visitorId };
    },
  });

  return {
    deleting: mutation.isPending,
    deleteVisitor: mutation.mutateAsync,
    error: mutation.error,
  };
}
