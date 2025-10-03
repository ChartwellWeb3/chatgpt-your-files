import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const supabaseFunctionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/chat`;
  const authHeader = req.headers.get("authorization");

  const response = await fetch(supabaseFunctionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });

  const readableStream = response.body;
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set("Access-Control-Allow-Origin", "*");

  // Use the standard Response object for streaming
  return new Response(readableStream, {
    status: response.status,
    headers,
  });
}
