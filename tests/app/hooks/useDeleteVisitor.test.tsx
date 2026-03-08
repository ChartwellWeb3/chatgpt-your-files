import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PropsWithChildren } from "react";

import { useDeleteVisitor } from "@/app/hooks/useDeleteVisitor";

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

describe("useDeleteVisitor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when visitor id is missing", async () => {
    const rpc = vi.fn();

    const { result } = renderHook(() => useDeleteVisitor({ rpc } as any), {
      wrapper: makeWrapper(),
    });

    await expect(result.current.deleteVisitor("")).rejects.toThrow(
      "Visitor ID is required",
    );
  });

  it("calls admin_delete_visitor when user confirms", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { result } = renderHook(() => useDeleteVisitor({ rpc } as any), {
      wrapper: makeWrapper(),
    });

    const output = await result.current.deleteVisitor("visitor-1");

    expect(output).toEqual({ ok: true, visitorId: "visitor-1" });
    expect(rpc).toHaveBeenCalledWith("admin_delete_visitor", {
      p_visitor_id: "visitor-1",
    });
  });

  it("propagates rpc errors", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: new Error("delete failed") });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { result } = renderHook(() => useDeleteVisitor({ rpc } as any), {
      wrapper: makeWrapper(),
    });

    await expect(result.current.deleteVisitor("visitor-3")).rejects.toThrow(
      "delete failed",
    );
  });

  it("returns a non-destructive response when user cancels", async () => {
    const rpc = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const { result } = renderHook(() => useDeleteVisitor({ rpc } as any), {
      wrapper: makeWrapper(),
    });

    const output = await result.current.deleteVisitor("visitor-2");

    expect(output).toEqual({ ok: false, visitorId: "visitor-2" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
