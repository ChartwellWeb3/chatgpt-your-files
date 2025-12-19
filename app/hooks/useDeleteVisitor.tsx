import { useState } from "react";

export function useDeleteVisitor(supabase: any) {
  const [deleting, setDeleting] = useState(false);

  const deleteVisitor = async (visitorId: string) => {
    if (!visitorId) return false;

    const ok = window.confirm(
      `Delete visitor ${visitorId} and ALL related sessions/messages/sources? This cannot be undone.`
    );
    if (!ok) return false;

    setDeleting(true);
    try {
      const { error } = await supabase.rpc("admin_delete_visitor", {
        p_visitor_id: visitorId,
      });
      if (error) throw error;
      return true;
    } finally {
      setDeleting(false);
    }
  };

  return { deleting, deleteVisitor };
}
