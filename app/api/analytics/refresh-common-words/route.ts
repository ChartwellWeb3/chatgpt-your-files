import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/app/utils/supabase/server";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

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

  let day = todayIsoDate();
  try {
    const body = await req.json();
    if (typeof body?.day === "string" && body.day.length >= 10) {
      day = body.day.slice(0, 10);
    }
  } catch {
    // ignore invalid body
  }

  const { error: refreshErr } = await supabase.rpc(
    "refresh_chat_common_words",
    { p_day: day }
  );

  if (refreshErr) {
    return NextResponse.json(
      { ok: false, error: refreshErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, day });
}
