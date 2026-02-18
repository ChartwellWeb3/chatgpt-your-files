import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/app/utils/supabase/server";

export async function POST(req: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: isAdmin, error: adminErr } = await supabase.rpc("is_admin");
  if (adminErr) {
    return NextResponse.json({ ok: false, error: adminErr.message }, { status: 500 });
  }
  if (!isAdmin) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
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
    : 0;
  const limit = 350;
  const force = body.force === true;
  const minDaysSince = Number.isFinite(body.min_days_since)
    ? Math.max(0, Math.floor(body.min_days_since as number))
    : 0;

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
    return NextResponse.json(
      { ok: false, error: targetsErr.message ?? "RPC failed" },
      { status: 500 }
    );
  }

  const results: Array<{
    visitor_id: string;
    last_message_at: string;
    ok: boolean;
    duration_seconds?: number;
    error?: string;
  }> = [];

  for (const row of (targets ?? []) as Array<{
    visitor_id: string;
    first_message_at: string;
    last_message_at: string;
  }>) {
    const visitorId = row.visitor_id;
    const firstMessageAt = row.first_message_at;
    const lastMessageAt = row.last_message_at;

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
    } catch (err: unknown) {
      results.push({
        visitor_id: visitorId,
        last_message_at: lastMessageAt,
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    cutoff_days: cutoffDays,
    processed: results.length,
    results,
  });
}
