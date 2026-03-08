import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const openaiCreateMock = vi.fn();

vi.mock("@/app/utils/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    responses = { create: openaiCreateMock };
  },
}));

function buildSupabase(options?: {
  user?: { id: string } | null;
  userErr?: { message: string } | null;
  isAdmin?: boolean;
  adminErr?: { message: string } | null;
  messages?: any[];
  messageErr?: { message: string } | null;
  sessions?: any[];
  sessionErr?: { message: string } | null;
  inserted?: any;
  insertErr?: { message: string } | null;
}) {
  const opts = {
    user: { id: "admin-1" },
    userErr: null,
    isAdmin: true,
    adminErr: null,
    messages: [] as any[],
    messageErr: null,
    sessions: [] as any[],
    sessionErr: null,
    inserted: { id: 1, visitor_id: "visitor-1" },
    insertErr: null,
    ...options,
  };

  const chatMessagesChain = {
    select: vi.fn(() => chatMessagesChain),
    eq: vi.fn(() => chatMessagesChain),
    order: vi.fn().mockResolvedValue({ data: opts.messages, error: opts.messageErr }),
  };

  const chatSessionsChain = {
    select: vi.fn(() => chatSessionsChain),
    eq: vi.fn(() => chatSessionsChain),
    limit: vi.fn().mockResolvedValue({ data: opts.sessions, error: opts.sessionErr }),
  };

  const single = vi.fn().mockResolvedValue({ data: opts.inserted, error: opts.insertErr });
  const select = vi.fn(() => ({ single }));
  const upsert = vi.fn(() => ({ select }));

  const from = vi.fn((table: string) => {
    if (table === "chat_messages") return chatMessagesChain;
    if (table === "chat_sessions") return chatSessionsChain;
    if (table === "chat_visitor_analyses") return { upsert };
    throw new Error(`Unexpected table: ${table}`);
  });

  const rpc = vi.fn((fn: string) => {
    if (fn === "is_admin") {
      return Promise.resolve({ data: opts.isAdmin, error: opts.adminErr });
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
    from,
    __upsert: upsert,
  };
}

describe("POST /api/analytics/satisfaction", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockReset();
    openaiCreateMock.mockReset();
    process.env = { ...envBackup };
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_ANALYSIS_MODEL;
  });

  it("returns 500 when OPENAI_API_KEY is missing", async () => {
    const { POST } = await import("@/app/api/analytics/satisfaction/route");

    const res = await POST(new Request("http://localhost/api/analytics/satisfaction", { method: "POST" }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: "Missing OPENAI_API_KEY" });
  });

  it("returns 401 when user is not authenticated", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createClientMock.mockResolvedValue(buildSupabase({ user: null }));

    const { POST } = await import("@/app/api/analytics/satisfaction/route");

    const res = await POST(
      new Request("http://localhost/api/analytics/satisfaction", {
        method: "POST",
        body: JSON.stringify({ visitor_id: "visitor-1" }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("returns 403 for non-admin users", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createClientMock.mockResolvedValue(buildSupabase({ isAdmin: false }));

    const { POST } = await import("@/app/api/analytics/satisfaction/route");

    const res = await POST(
      new Request("http://localhost/api/analytics/satisfaction", {
        method: "POST",
        body: JSON.stringify({ visitor_id: "visitor-1" }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json).toEqual({ ok: false, error: "Forbidden" });
  });

  it("returns 400 when visitor_id is missing", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createClientMock.mockResolvedValue(buildSupabase());

    const { POST } = await import("@/app/api/analytics/satisfaction/route");

    const res = await POST(
      new Request("http://localhost/api/analytics/satisfaction", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ ok: false, error: "Missing visitor_id" });
  });

  it("returns 500 on chat message query errors", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createClientMock.mockResolvedValue(
      buildSupabase({ messageErr: { message: "messages failed" } }),
    );

    const { POST } = await import("@/app/api/analytics/satisfaction/route");

    const res = await POST(
      new Request("http://localhost/api/analytics/satisfaction", {
        method: "POST",
        body: JSON.stringify({ visitor_id: "visitor-1" }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: "messages failed" });
  });

  it("returns 404 when no chat messages exist", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createClientMock.mockResolvedValue(buildSupabase({ messages: [] }));

    const { POST } = await import("@/app/api/analytics/satisfaction/route");

    const res = await POST(
      new Request("http://localhost/api/analytics/satisfaction", {
        method: "POST",
        body: JSON.stringify({ visitor_id: "visitor-1" }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({ ok: false, error: "No messages found" });
  });

  it("returns 500 when model output is empty", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createClientMock.mockResolvedValue(
      buildSupabase({
        messages: [
          {
            role: "user",
            content: "Hello",
            created_at: "2026-03-01T00:00:00.000Z",
            session_id: "session-1",
          },
        ],
      }),
    );
    openaiCreateMock.mockResolvedValue({ output_text: "" });

    const { POST } = await import("@/app/api/analytics/satisfaction/route");

    const res = await POST(
      new Request("http://localhost/api/analytics/satisfaction", {
        method: "POST",
        body: JSON.stringify({ visitor_id: "visitor-1" }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: "Model returned empty output" });
  });

  it("writes normalized analysis and page_type for successful runs", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_ANALYSIS_MODEL = "gpt-test";

    const supabase = buildSupabase({
      messages: [
        {
          role: "user",
          content: "Can I book a tour?",
          created_at: "2026-03-01T00:00:00.000Z",
          session_id: "session-1",
        },
        {
          role: "assistant",
          content: "Yes",
          created_at: "2026-03-01T00:00:30.000Z",
          session_id: "session-1",
        },
      ],
      sessions: [
        {
          page_url: "https://chartwell.com/find-a-residence",
          residence_custom_id: "corporateen",
        },
      ],
      inserted: {
        id: 22,
        visitor_id: "visitor-1",
        last_message_at: "2026-03-01T00:00:30.000Z",
      },
    });

    createClientMock.mockResolvedValue(supabase);

    openaiCreateMock.mockResolvedValue({
      id: "resp_1",
      output_text: JSON.stringify({
        satisfaction_1_to_10: 11,
        sentiment: "unknown-ish",
        intent_primary: "unknown",
        intents: ["tour_booking", "other", "tour_booking"],
        intent_other: "custom intent",
        improvement: "[clarify] Ask one follow-up question.",
        summary: "The user asked about booking.",
        evidence: {
          visitor_goal: "Book a tour",
          goal_met: "true",
          key_quotes: ["Can I book a tour?", 5],
        },
        missed_or_weak_answers: [
          {
            visitor_question: "Can I book?",
            assistant_response: "Yes",
            issue_type: "unanswered",
            why_insufficient: "No next step.",
          },
          {
            visitor_question: "",
            assistant_response: "",
            issue_type: "unanswered",
            why_insufficient: "",
          },
        ],
      }),
    });

    const { POST } = await import("@/app/api/analytics/satisfaction/route");

    const res = await POST(
      new Request("http://localhost/api/analytics/satisfaction", {
        method: "POST",
        body: JSON.stringify({ visitor_id: "visitor-1" }),
      }),
    );

    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.analysis).toMatchObject({
      satisfaction_1_to_10: 10,
      sentiment: "unknown",
      intent_primary: "tour_booking",
      intents: ["tour_booking", "other"],
      intent_other: "custom intent",
    });

    expect(supabase.__upsert).toHaveBeenCalledTimes(1);
    const upsertPayload = supabase.__upsert.mock.calls[0][0];
    expect(upsertPayload.page_type).toBe("corporate");
    expect(upsertPayload.evidence_goal_met).toBe("yes");
    expect(Array.isArray(upsertPayload.evidence_key_quotes)).toBe(true);
  });

  it("returns 500 when analysis upsert fails", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    createClientMock.mockResolvedValue(
      buildSupabase({
        messages: [
          {
            role: "user",
            content: "Hello",
            created_at: "2026-03-01T00:00:00.000Z",
            session_id: "session-1",
          },
        ],
        insertErr: { message: "insert failed" },
      }),
    );

    openaiCreateMock.mockResolvedValue({
      output_text: JSON.stringify({
        satisfaction_1_to_10: 6,
        sentiment: "neutral",
        intent_primary: "unknown",
        intents: [],
        intent_other: "",
        improvement: "[clarify] Ask one follow-up question.",
        summary: "Short chat.",
        evidence: {
          visitor_goal: "Get info",
          goal_met: "unknown",
          key_quotes: [],
        },
        missed_or_weak_answers: [],
      }),
    });

    const { POST } = await import("@/app/api/analytics/satisfaction/route");

    const res = await POST(
      new Request("http://localhost/api/analytics/satisfaction", {
        method: "POST",
        body: JSON.stringify({ visitor_id: "visitor-1" }),
      }),
    );

    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: "insert failed" });
  });
});
