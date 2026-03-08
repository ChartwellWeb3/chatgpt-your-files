import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

import { useReplay } from "@/app/hooks/useReplay";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function buildSupabaseForReplay() {
  const messages = [
    {
      id: 1,
      session_id: "session-1",
      visitor_id: "visitor-1",
      role: "user",
      content: "Hello",
      created_at: "2026-03-01T00:00:00.000Z",
    },
    {
      id: 2,
      session_id: "session-1",
      visitor_id: "visitor-1",
      role: "assistant",
      content: "Hi there",
      created_at: "2026-03-01T00:00:05.000Z",
    },
  ];

  const msgChain = {
    select: vi.fn(() => msgChain),
    eq: vi.fn(() => msgChain),
    order: vi.fn().mockResolvedValue({ data: messages, error: null }),
  };

  const srcChain = {
    select: vi.fn(() => srcChain),
    in: vi.fn(() => srcChain),
    order: vi.fn().mockResolvedValue({
      data: [
        {
          id: 10,
          assistant_message_id: 2,
          document_section_id: 100,
          rank: 1,
          score: 0.9,
          source_type: "vector",
          snippet_used: "Snippet",
          created_at: "2026-03-01T00:00:05.500Z",
        },
      ],
      error: null,
    }),
  };

  const secChain = {
    select: vi.fn(() => secChain),
    in: vi.fn(() => secChain),
    limit: vi.fn().mockResolvedValue({
      data: [{ id: 100, document_id: 900 }],
      error: null,
    }),
  };

  const docChain = {
    select: vi.fn(() => docChain),
    in: vi.fn(() => docChain),
    limit: vi.fn().mockResolvedValue({
      data: [{ id: 900, name: "Residence FAQ" }],
      error: null,
    }),
  };

  const from = vi.fn((table: string) => {
    if (table === "chat_messages") return msgChain;
    if (table === "chat_message_sources") return srcChain;
    if (table === "document_sections") return secChain;
    if (table === "documents") return docChain;
    throw new Error(`Unexpected table ${table}`);
  });

  return { from };
}

describe("useReplay", () => {
  it("does not query when session id is empty", async () => {
    const supabase = { from: vi.fn() } as any;

    renderHook(() => useReplay(supabase, ""), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(supabase.from).not.toHaveBeenCalled();
    });
  });

  it("loads messages, sources, and document names for a selected session", async () => {
    const supabase = buildSupabaseForReplay() as any;

    const { result } = renderHook(() => useReplay(supabase, "session-1"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.messages).toHaveLength(2);
    const byMsg = result.current.data?.sourcesByMsg.get(2) ?? [];
    expect(byMsg).toHaveLength(1);
    expect(byMsg[0].doc_name).toBe("Residence FAQ");
  });
});
