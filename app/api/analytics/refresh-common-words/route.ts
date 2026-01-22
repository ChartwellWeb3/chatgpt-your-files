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

  const { error: refreshErr } = await supabase.rpc(
    "refresh_chat_common_words"
  );

  if (refreshErr) {
    return NextResponse.json(
      { ok: false, error: refreshErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
