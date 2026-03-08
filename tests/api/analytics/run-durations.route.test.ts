import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();

vi.mock("@/app/utils/supabase/server", () => ({
  createClient: createClientMock,
}));

type DurationTarget = {
  session_id: string;
  visitor_id: string;
  first_message_at: string;
  last_message_at: string;
};

function buildSupabase(options?: {
  user?: { id: string } | null;
  userErr?: { message: string } | null;
  isAdmin?: boolean;
  adminErr?: { message: string } | null;
  targets?: DurationTarget[];
  targetsErr?: { message: string } | null;
  upsertErr?: { message: string } | null;
}) {
  const opts = {
    user: { id: "admin-1" },
    userErr: null,
    isAdmin: true,
    adminErr: null,
    targets: [] as DurationTarget[],
    targetsErr: null,
    upsertErr: null,
    ...options,
  };

  const upsert = vi.fn().mockResolvedValue({ error: opts.upsertErr });

  const rpc = vi.fn((fn: string, payload?: Record<string, unknown>) => {
    if (fn === "is_admin") {
      return Promise.resolve({ data: opts.isAdmin, error: opts.adminErr });
    }

    if (fn === "chat_sessions_needing_duration") {
      return Promise.resolve({ data: opts.targets, error: opts.targetsErr, payload });
    }

    return Promise.resolve({ data: null, error: null });
  });

  const from = vi.fn(() => ({ upsert }));

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.user },
        error: opts.userErr,
      }),
    },
    rpc,
    from,
    __upsert: upsert,
  };
}

describe("POST /api/analytics/run-durations", () => {
  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }));
    const { POST } = await import("@/app/api/analytics/run-durations/route");

    const res = await POST(new Request("http://localhost/api/analytics/run-durations", { method: "POST" }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("returns 403 for non-admin users", async () => {
    createClientMock.mockResolvedValue(buildSupabase({ isAdmin: false }));
    const { POST } = await import("@/app/api/analytics/run-durations/route");

    const res = await POST(new Request("http://localhost/api/analytics/run-durations", { method: "POST" }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json).toEqual({ ok: false, error: "Forbidden" });
  });

  it("computes and upserts duration seconds", async () => {
    const supabase = buildSupabase({
      targets: [
        {
          session_id: "s1",
          visitor_id: "v1",
          first_message_at: "2026-03-01T00:00:00.000Z",
          last_message_at: "2026-03-01T00:01:30.000Z",
        },
      ],
    });

    createClientMock.mockResolvedValue(supabase);
    const { POST } = await import("@/app/api/analytics/run-durations/route");

    const res = await POST(
      new Request("http://localhost/api/analytics/run-durations", {
        method: "POST",
        body: JSON.stringify({ cutoff_days: 5, limit: 10, force: true, min_days_since: 1 }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.processed).toBe(1);
    expect(json.results[0]).toMatchObject({
      session_id: "s1",
      visitor_id: "v1",
      duration_seconds: 90,
      ok: true,
    });

    expect(supabase.__upsert).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("chat_sessions_needing_duration", {
      p_cutoff_days: 5,
      p_limit: 10,
      p_force: true,
      p_min_days_since: 1,
    });
  });

  it("marks rows as failed when timestamps are invalid", async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({
        targets: [
          {
            session_id: "s2",
            visitor_id: "v2",
            first_message_at: "invalid",
            last_message_at: "2026-03-01T00:01:30.000Z",
          },
        ],
      }),
    );

    const { POST } = await import("@/app/api/analytics/run-durations/route");

    const res = await POST(new Request("http://localhost/api/analytics/run-durations", { method: "POST" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results[0].ok).toBe(false);
    expect(json.results[0].error).toBe("Invalid message timestamps");
  });
});
