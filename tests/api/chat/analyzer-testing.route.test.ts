import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const openaiCreateMock = vi.fn();

vi.mock("@/app/utils/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    responses = {
      create: openaiCreateMock,
    };
  },
}));

function buildSupabase(options?: {
  user?: { id: string } | null;
  userErr?: { message: string } | null;
}) {
  const opts = {
    user: { id: "user-1" },
    userErr: null,
    ...options,
  };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.user },
        error: opts.userErr,
      }),
    },
  };
}

describe("POST /api/chat/analyzer-testing", () => {
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
    const { POST } = await import("@/app/api/chat/analyzer-testing/route");

    const res = await POST(new Request("http://localhost/api/chat/analyzer-testing", { method: "POST" }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: "Missing OPENAI_API_KEY" });
  });

  it("returns 401 when user is not authenticated", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createClientMock.mockResolvedValue(buildSupabase({ user: null }));

    const { POST } = await import("@/app/api/chat/analyzer-testing/route");

    const res = await POST(
      new Request("http://localhost/api/chat/analyzer-testing", {
        method: "POST",
        body: JSON.stringify({ transcript: [{ role: "user", content: "Hi" }] }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("returns 400 when transcript is empty", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createClientMock.mockResolvedValue(buildSupabase());

    const { POST } = await import("@/app/api/chat/analyzer-testing/route");

    const res = await POST(
      new Request("http://localhost/api/chat/analyzer-testing", {
        method: "POST",
        body: JSON.stringify({ transcript: [] }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ ok: false, error: "Transcript is required" });
  });

  it("returns parsed JSON output for json format", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_ANALYSIS_MODEL = "gpt-test";
    createClientMock.mockResolvedValue(buildSupabase());

    openaiCreateMock.mockResolvedValue({
      output_text: '{"score":8,"sentiment":"neutral"}',
    });

    const { POST } = await import("@/app/api/chat/analyzer-testing/route");

    const res = await POST(
      new Request("http://localhost/api/chat/analyzer-testing", {
        method: "POST",
        body: JSON.stringify({
          transcript: [{ role: "user", content: "Need pricing info" }],
          response_format: "json",
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      output: '{"score":8,"sentiment":"neutral"}',
      parsed: { score: 8, sentiment: "neutral" },
      format: "json",
    });

    expect(openaiCreateMock).toHaveBeenCalledTimes(1);
  });

  it("parses JSON wrapped in surrounding text", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createClientMock.mockResolvedValue(buildSupabase());

    openaiCreateMock.mockResolvedValue({
      output_text: 'Result: {"score":7,"sentiment":"satisfied"}',
    });

    const { POST } = await import("@/app/api/chat/analyzer-testing/route");

    const res = await POST(
      new Request("http://localhost/api/chat/analyzer-testing", {
        method: "POST",
        body: JSON.stringify({
          transcript: [{ role: "user", content: "Thanks" }],
          response_format: "json",
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.parsed).toEqual({ score: 7, sentiment: "satisfied" });
  });

  it("supports text mode and output fallback parsing", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createClientMock.mockResolvedValue(buildSupabase());

    openaiCreateMock.mockResolvedValue({
      output: [
        {
          content: [
            { text: "Line 1" },
            { content: "Line 2" },
          ],
        },
      ],
    });

    const { POST } = await import("@/app/api/chat/analyzer-testing/route");

    const res = await POST(
      new Request("http://localhost/api/chat/analyzer-testing", {
        method: "POST",
        body: JSON.stringify({
          transcript: [{ role: "system", content: "Check" }],
          response_format: "text",
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      output: "Line 1\nLine 2",
      parsed: null,
      format: "text",
    });
  });
});
