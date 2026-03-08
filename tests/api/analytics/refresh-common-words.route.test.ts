import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();

vi.mock("@/app/utils/supabase/server", () => ({
  createClient: createClientMock,
}));

function buildSupabase(options?: {
  user?: { id: string } | null;
  userErr?: { message: string } | null;
  isAdmin?: boolean;
  adminErr?: { message: string } | null;
  refreshErr?: { message: string } | null;
}) {
  const opts = {
    user: { id: "admin-1" },
    userErr: null,
    isAdmin: true,
    adminErr: null,
    refreshErr: null,
    ...options,
  };

  const rpc = vi.fn((fn: string) => {
    if (fn === "is_admin") {
      return Promise.resolve({ data: opts.isAdmin, error: opts.adminErr });
    }

    if (fn === "refresh_chat_common_words") {
      return Promise.resolve({ data: null, error: opts.refreshErr });
    }

    return Promise.resolve({ data: null, error: null });
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.user },
        error: opts.userErr,
      }),
    },
    rpc,
  };
}

describe("POST /api/analytics/refresh-common-words", () => {
  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }));
    const { POST } = await import("@/app/api/analytics/refresh-common-words/route");

    const res = await POST(new Request("http://localhost/api/analytics/refresh-common-words", { method: "POST" }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("returns 403 for non-admin users", async () => {
    createClientMock.mockResolvedValue(buildSupabase({ isAdmin: false }));
    const { POST } = await import("@/app/api/analytics/refresh-common-words/route");

    const res = await POST(new Request("http://localhost/api/analytics/refresh-common-words", { method: "POST" }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json).toEqual({ ok: false, error: "Forbidden" });
  });

  it("returns 500 when refresh RPC fails", async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({ refreshErr: { message: "refresh failed" } }),
    );
    const { POST } = await import("@/app/api/analytics/refresh-common-words/route");

    const res = await POST(new Request("http://localhost/api/analytics/refresh-common-words", { method: "POST" }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: "refresh failed" });
  });

  it("returns ok for admin refresh", async () => {
    createClientMock.mockResolvedValue(buildSupabase());
    const { POST } = await import("@/app/api/analytics/refresh-common-words/route");

    const res = await POST(new Request("http://localhost/api/analytics/refresh-common-words", { method: "POST" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
  });
});
