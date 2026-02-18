/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

type TargetRow = {
  visitor_id: string;
  first_message_at: string;
  last_message_at: string;
};

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: {
    cutoff_days?: number;
    limit?: number;
    force?: boolean;
    min_days_since?: number;
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const cutoffDays = Number.isFinite(body.cutoff_days)
    ? Math.max(1, Math.floor(body.cutoff_days as number))
    : 7;
  const limit = Number.isFinite(body.limit)
    ? Math.max(1, Math.floor(body.limit as number))
    : 100;
  const force = body.force === true;
  const minDaysSince = Number.isFinite(body.min_days_since)
    ? Math.max(0, Math.floor(body.min_days_since as number))
    : 0;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: targets, error: targetsErr } = await supabase.rpc(
    "chat_visitors_needing_duration",
    {
      p_cutoff_days: cutoffDays,
      p_limit: limit,
      p_force: force,
      p_min_days_since: minDaysSince,
    }
  );

  if (targetsErr) {
    return new Response(
      JSON.stringify({ error: targetsErr.message ?? "RPC failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const results: Array<{
    visitor_id: string;
    last_message_at: string;
    ok: boolean;
    duration_seconds?: number;
    error?: string;
  }> = [];

  for (const row of (targets ?? []) as TargetRow[]) {
    const visitorId = row.visitor_id as string;
    const firstMessageAt = row.first_message_at as string;
    const lastMessageAt = row.last_message_at as string;

    try {
      const firstMs = Date.parse(firstMessageAt);
      const lastMs = Date.parse(lastMessageAt);
      if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs)) {
        throw new Error("Invalid message timestamps");
      }

      const durationSeconds = Math.max(
        0,
        Math.floor((lastMs - firstMs) / 1000)
      );

      const { error: upsertErr } = await supabase
        .from("chat_visitor_durations")
        .upsert(
          {
            visitor_id: visitorId,
            first_message_at: firstMessageAt,
            last_message_at: lastMessageAt,
            duration_seconds: durationSeconds,
            source: "auto",
            created_at: new Date().toISOString(),
          },
          { onConflict: "visitor_id,last_message_at,source" }
        );

      if (upsertErr) throw upsertErr;

      results.push({
        visitor_id: visitorId,
        last_message_at: lastMessageAt,
        duration_seconds: durationSeconds,
        ok: true,
      });
    } catch (err: any) {
      results.push({
        visitor_id: visitorId,
        last_message_at: lastMessageAt,
        ok: false,
        error: err?.message ?? "Unknown error",
      });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      cutoff_days: cutoffDays,
      processed: results.length,
      results,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
