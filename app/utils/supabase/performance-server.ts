import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { PerformanceEnvironment } from "@/lib/performance";

export class PerformanceConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PerformanceConfigurationError";
  }
}

export function getPerformanceEnvironment(): PerformanceEnvironment {
  const environment = process.env.PERFORMANCE_ENVIRONMENT?.trim().toLowerCase();
  if (environment !== "qa" && environment !== "prod") {
    throw new PerformanceConfigurationError(
      "Website performance environment is not configured. Set PERFORMANCE_ENVIRONMENT to qa or prod on the server."
    );
  }
  return environment;
}

// This client has server privileges. Callers must authenticate the viewer with
// the original project's cookie-based client before querying performance data.
export function createPerformanceClient() {
  const url = process.env.PERFORMANCE_SUPABASE_URL?.trim();
  const secretKey = process.env.PERFORMANCE_SUPABASE_SECRET_KEY?.trim();

  if (!url || !secretKey) {
    throw new PerformanceConfigurationError(
      "Website performance is not configured. Set PERFORMANCE_SUPABASE_URL and PERFORMANCE_SUPABASE_SECRET_KEY on the server."
    );
  }

  let projectUrl: URL;
  try {
    projectUrl = new URL(url);
    if (!["https:", "http:"].includes(projectUrl.protocol)) throw new Error();
  } catch {
    throw new PerformanceConfigurationError("PERFORMANCE_SUPABASE_URL must be a valid HTTP or HTTPS project URL.");
  }

  const chatbotUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (chatbotUrl && projectUrl.origin === new URL(chatbotUrl).origin) {
    throw new PerformanceConfigurationError(
      "Website performance must use a separate Supabase project. Set PERFORMANCE_SUPABASE_URL to the new project's URL."
    );
  }

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
