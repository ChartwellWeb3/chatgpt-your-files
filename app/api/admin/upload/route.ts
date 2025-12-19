// import { NextResponse } from "next/server";
// import { createClient } from "@/app/utils/supabase/server";
// import { createClient as createAdminClient } from "@supabase/supabase-js";

// export const dynamic = "force-dynamic";

// const BUCKET = "files";

// export async function POST(req: Request) {
//   try {
//     // 1) Verify user session (cookie-based) with anon client
//     const supabaseAuth = await createClient(); 

//     const { data: userRes, error: userErr } = await supabaseAuth.auth.getUser();
//     const user = userRes.user;

//     if (userErr || !user) {
//       return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
//     }

//     // 2) Parse multipart form data
//     const form = await req.formData();
//     const file = form.get("file") as File | null;
//     const rawScope = form.get("scope") as string | null;

//     if (!file) {
//       return NextResponse.json({ error: "Missing file" }, { status: 400 });
//     }

//     // Sanitize the scope (residence ID) to prevent directory traversal
//     // Default to "common" if no scope is provided
//     const scope = rawScope?.replace(/[^a-z0-9-_]/gi, "") || "common";

//     // Basic safety limits
//     const MAX_MB = 15;
//     if (file.size > MAX_MB * 1024 * 1024) {
//       return NextResponse.json(
//         { error: `File too large (max ${MAX_MB}MB)` },
//         { status: 400 }
//       );
//     }

//     // 3) Upload with Service Role (bypasses RLS) — SERVER ONLY
//     // ⚠️ SECURITY NOTE: Ensure 'NEXT_SUPABASE_SERVICE_ROLE_KEY' does NOT start with 'NEXT_PUBLIC_' in your .env
//     const supabaseAdmin = createAdminClient(
//       process.env.NEXT_PUBLIC_SUPABASE_URL!,
//       process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY!,
//       { auth: { persistSession: false } }
//     );

//     // Create a clean file name and a unique ID for the folder
//     const safeName = (file.name || "file").replace(/[^\w.\-]+/g, "_");
//     const uuid = crypto.randomUUID();

//     // ✅ FIXED: Path structure matches your frontend expectations: residence/uuid/filename
//     const path = `${scope}/${uuid}/${safeName}`;

//     const arrayBuffer = await file.arrayBuffer();
//     const buffer = Buffer.from(arrayBuffer);

//     const { error: uploadErr } = await supabaseAdmin.storage
//       .from(BUCKET)
//       .upload(path, buffer, {
//         contentType: file.type || "application/octet-stream",
//         upsert: false,
//       });

//     if (uploadErr) {
//       console.error("Upload error:", uploadErr);
//       return NextResponse.json({ error: uploadErr.message }, { status: 500 });
//     }

//     // 4) Return success (No need for Signed URL here if you just want to confirm upload)
//     return NextResponse.json({
//       ok: true,
//       bucket: BUCKET,
//       path, // Return this path so you can save it to your database if needed
//     });
//   } catch (e: unknown) {
//     console.error("Server Route Error:", e);
//     const errorMessage =
//       e instanceof Error ? e.message : "Unknown server error";

//     return NextResponse.json({ error: errorMessage }, { status: 500 });
//   }
// }
