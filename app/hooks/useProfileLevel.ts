"use client";

import { useEffect, useState } from "react";
import { createClient } from "../utils/supabase/client";

export type Level = 1 | 2 | 3;

export function useProfileLevel() {
  const supabase = createClient();

  const [level, setLevel] = useState<Level>(3);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLevel(3);
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("level")
        .eq("id", user.id)
        .single();

      setLevel((profile?.level ?? 3) as Level);
      setLoading(false);
    };

    load();
  }, []);

  return { level, isAdmin: level === 1, loading };
}
