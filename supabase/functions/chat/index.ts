import { createClient } from "@supabase/supabase-js";
import { OpenAIStream, StreamingTextResponse } from "ai";
import { codeBlock } from "common-tags";
import OpenAI from "openai";
import type { Database } from "../_lib/database.ts";

// OpenAI client
const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY")!,
});

// Env vars from Supabase
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

// --- CORS setup ---
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "https://chat.supabase.com",
]);

function buildCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  };
}

// --- Main handler ---
Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    if (corsHeaders["Access-Control-Allow-Origin"] === "null") {
      return new Response(null, { status: 403, headers: corsHeaders });
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(
        JSON.stringify({ error: "Missing environment variables." }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    const authorization = req.headers.get("Authorization");
    if (!authorization) {
      return new Response(
        JSON.stringify({ error: "No authorization header passed" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      global: { headers: { authorization } },
      auth: { persistSession: false },
    });

    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { messages = [], embedding /*, residence_custom_id */ } = body;

    if (!embedding) {
      return new Response(
        JSON.stringify({ error: "Missing `embedding` in request body" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Call your RPC function
    const { data: documents, error: matchError } = await supabase.rpc(
      "match_document_sections",
      { embedding, match_threshold: 0.8 }
    );

    if (matchError) {
      console.error("Supabase RPC error:", matchError);
      return new Response(
        JSON.stringify({
          error: "There was an error reading your documents, please try again.",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    const injectedDocs =
      documents
        ?.map((row: any) => row.content)
        .filter(Boolean)
        .join("\n\n") ?? "No documents found";

    // Construct chat messages
    const completionMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [
        {
          role: "system",
          content: codeBlock`
          You are an AI assistant who answers questions strictly using the provided documents.
          Keep replies succinct.

          If the question is not related to these documents, reply:
          "Sorry, I couldn't find any information on that."

          If the information isn't available in the documents, reply:
          "Sorry, I couldn't find any information on that."

          Do not go off topic.

          Documents:
          ${injectedDocs}
        `,
        },
        ...messages,
      ];

    // Request streaming response from OpenAI
    const completionStream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: completionMessages,
      max_tokens: 1024,
      temperature: 0,
      stream: true,
    });

    const stream = OpenAIStream(completionStream);
    return new StreamingTextResponse(stream, { headers: corsHeaders });
  } catch (e) {
    console.error("Unhandled error:", e);
    return new Response(JSON.stringify({ error: "Unexpected server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
