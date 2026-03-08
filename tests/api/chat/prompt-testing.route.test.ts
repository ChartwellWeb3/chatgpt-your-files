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
  vectorDocs?: Array<{ id: number; content: string; score?: number }>;
  keywordDocs?: Array<{ section_id: number; content: string; rank?: number }>;
}) {
  const opts = {
    user: { id: "user-1" },
    userErr: null,
    vectorDocs: [] as Array<{ id: number; content: string; score?: number }>,
    keywordDocs: [] as Array<{ section_id: number; content: string; rank?: number }>,
    ...options,
  };

  const invoke = vi.fn().mockResolvedValue({ data: { documents: opts.vectorDocs }, error: null });
  const rpc = vi.fn().mockResolvedValue({ data: opts.keywordDocs, error: null });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.user },
        error: opts.userErr,
      }),
    },
    functions: { invoke },
    rpc,
    __invoke: invoke,
    __rpc: rpc,
  };
}

describe("POST /api/chat/prompt-testing", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockReset();
    openaiCreateMock.mockReset();
    process.env = { ...envBackup };
    delete process.env.OPENAI_API_KEY;
  });

  it("returns 500 when OPENAI_API_KEY is missing", async () => {
    const { POST } = await import("@/app/api/chat/prompt-testing/route");

    const res = await POST(new Request("http://localhost/api/chat/prompt-testing", { method: "POST" }));

    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Missing OPENAI_API_KEY");
  });

  it("returns 401 when user is not authenticated", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createClientMock.mockResolvedValue(buildSupabase({ user: null }));

    const { POST } = await import("@/app/api/chat/prompt-testing/route");

    const res = await POST(
      new Request("http://localhost/api/chat/prompt-testing", {
        method: "POST",
        body: JSON.stringify({ message: "Hello" }),
      }),
    );

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("returns 400 when message is missing", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createClientMock.mockResolvedValue(buildSupabase());

    const { POST } = await import("@/app/api/chat/prompt-testing/route");

    const res = await POST(
      new Request("http://localhost/api/chat/prompt-testing", {
        method: "POST",
        body: JSON.stringify({ message: "   " }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Message is required");
  });

  it("streams model output chunks", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    createClientMock.mockResolvedValue(buildSupabase());

    openaiCreateMock.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "response.output_text.delta", delta: "Hello" };
        yield { type: "response.output_text.delta", delta: " world" };
      },
    });

    const { POST } = await import("@/app/api/chat/prompt-testing/route");

    const res = await POST(
      new Request("http://localhost/api/chat/prompt-testing", {
        method: "POST",
        body: JSON.stringify({
          message: "Hi there",
          data: { isCorporate: false },
          history: [{ role: "user", content: "Previous" }],
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(await res.text()).toBe("Hello world");
  });

  it("applies prompt override data_context_block and calls search providers", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    const supabase = buildSupabase({
      vectorDocs: [
        { id: 1, content: "Doc A", score: 0.8 },
        { id: 2, content: "Doc A", score: 0.7 },
      ],
      keywordDocs: [{ section_id: 10, content: "Keyword B", rank: 0.6 }],
    });

    createClientMock.mockResolvedValue(supabase);

    openaiCreateMock.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { type: "response.output_text.delta", delta: "ok" };
      },
    });

    const { POST } = await import("@/app/api/chat/prompt-testing/route");

    await POST(
      new Request("http://localhost/api/chat/prompt-testing", {
        method: "POST",
        body: JSON.stringify({
          message: "What options are available?",
          data: {
            isCorporate: true,
            customId: "11034en",
            corporateId: "corporateen",
          },
          prompt_override: "Developer rules {{data_context_block}}",
        }),
      }),
    );

    expect(supabase.__invoke).toHaveBeenCalledTimes(2);
    expect(supabase.__rpc).toHaveBeenCalledTimes(2);

    const requestPayload = openaiCreateMock.mock.calls[0][0];
    const developerPrompt = requestPayload.input[0].content;

    expect(developerPrompt).toContain("Developer rules");
    expect(developerPrompt).toContain("<data_context>");
    expect(developerPrompt).toContain("Doc A");
    expect(developerPrompt).toContain("Keyword B");
  });
});
