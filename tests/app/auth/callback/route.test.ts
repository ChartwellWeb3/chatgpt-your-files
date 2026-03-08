// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();

vi.mock("@/app/utils/supabase/server", () => ({
  createClient: createClientMock,
}));

function buildSupabase(exchangeError: { message: string } | null = null) {
  return {
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: exchangeError }),
    },
  };
}

describe("GET /auth/callback", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockReset();
    process.env = { ...envBackup };
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("redirects to login error when code is missing", async () => {
    const { GET } = await import("@/app/auth/callback/route");

    const res = await GET(new Request("http://localhost/auth/callback"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost/login?error=Could%20not%20verify%20code",
    );
  });

  it("redirects to forwarded host in non-local environments", async () => {
    process.env.NODE_ENV = "production";
    createClientMock.mockResolvedValue(buildSupabase(null));

    const { GET } = await import("@/app/auth/callback/route");

    const res = await GET(
      new Request("https://internal-host/auth/callback?code=abc&next=/team", {
        headers: {
          "x-forwarded-host": "manager.chartwell.com",
        },
      }),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://manager.chartwell.com/team");
  });

  it("falls back to request origin in production without x-forwarded-host", async () => {
    process.env.NODE_ENV = "production";
    createClientMock.mockResolvedValue(buildSupabase(null));

    const { GET } = await import("@/app/auth/callback/route");

    const res = await GET(
      new Request("https://manager-internal/auth/callback?code=abc&next=/analytics"),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://manager-internal/analytics");
  });

  it("redirects to origin in development", async () => {
    process.env.NODE_ENV = "development";
    createClientMock.mockResolvedValue(buildSupabase(null));

    const { GET } = await import("@/app/auth/callback/route");

    const res = await GET(
      new Request("http://localhost:3000/auth/callback?code=abc&next=/chat-bot-analytics"),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/chat-bot-analytics");
  });
});
