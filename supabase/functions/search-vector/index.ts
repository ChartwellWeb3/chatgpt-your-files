/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />
// Using a stable version of supabase-js for the Edge Runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
// Initialize the model directly in the Edge Runtime for embedding generation
// NOTE: This assumes the Supabase AI features are enabled for your project.
const model = new Supabase.ai.Session("gte-small");
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }
  try {
    // 0. Parse incoming payload
    const {
      message,
      customId,
      match_threshold = 0.75,
      limit = 8,
    } = await req.json();
    if (!message || !customId) {
      return new Response(
        JSON.stringify({
          error: "Message and customId are required",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }
    console.log(
      `[DEBUG] Starting embedding generation for customId: ${customId}`
    );
    // 1. Generate Embedding (This requires the AI feature to be enabled)
    const output = await model.run(message, {
      mean_pool: true,
      normalize: true,
    });
    console.log(
      `[DEBUG] Embedding generated. Vector length: ${output.length}.`
    );
    // 2. Connect to Supabase using the Service Role Key
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables. Check your secrets settings."
      );
    }
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log(
      `[DEBUG] Calling RPC 'match_document_sections_public' with threshold: ${match_threshold} and limit: ${limit}`
    );
    // 3. Call your existing RPC function for vector search
    // UPDATE: Using 'match_document_sections_public' and the four-argument
    // signature with 'p_' prefixes as requested by the user.
    const { data: documents, error } = await supabase.rpc(
      "match_document_sections_public",
      {
        p_embedding: output,
        p_residence_custom_id: customId,
        p_match_threshold: match_threshold,
        p_limit: limit,
      }
    );
    if (error) {
      console.error("Supabase RPC Error:", error);
      // The RPC function failed. The detailed error is here.
      throw new Error(`Database RPC failed: ${error.message}`);
    }
    console.log(`[DEBUG] RPC successful. Found ${documents.length} documents.`);
    return new Response(
      JSON.stringify({
        documents,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    // Catch all errors and return a 500 response with the error details
    console.error("Edge Function Fatal Error:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Unknown internal error.",
        detail:
          "Please check the full Supabase Function logs for the exact stack trace to diagnose the AI or RPC failure.",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
