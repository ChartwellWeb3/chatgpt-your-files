// Local declarations for static checking of the deployable distribution.
// Runtime uses Deno, the Supabase EdgeRuntime, and the pinned npm imports.
declare module "npm:@supabase/supabase-js@2.88.0" {
  export { createClient, type SupabaseClient } from "@supabase/supabase-js";
}
declare module "npm:saxes@6.0.0" {
  export { SaxesParser } from "saxes";
}
declare const Deno: {
  env: { get(name: string): string | undefined; toObject(): Record<string, string> };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};
declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void };
