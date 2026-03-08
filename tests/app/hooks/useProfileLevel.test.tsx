import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();

vi.mock("@/app/utils/supabase/client", () => ({
  createClient: () => createClientMock(),
}));

import { useProfileLevel } from "@/app/hooks/useProfileLevel";

function buildProfileQuery(level: number | null) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue({ data: level ? { level } : null, error: null }),
  };

  return chain;
}

describe("useProfileLevel", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("falls back to level 3 when no authenticated user exists", async () => {
    const fromMock = vi.fn();
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: fromMock,
    });

    const { result } = renderHook(() => useProfileLevel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.level).toBe(3);
    expect(result.current.isAdmin).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("falls back to level 3 when profile row is missing", async () => {
    const profileQuery = buildProfileQuery(null);

    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockReturnValue(profileQuery),
    });

    const { result } = renderHook(() => useProfileLevel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.level).toBe(3);
    expect(result.current.isAdmin).toBe(false);
  });

  it("returns admin state for level 1 profile", async () => {
    const profileQuery = buildProfileQuery(1);

    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
      from: vi.fn().mockReturnValue(profileQuery),
    });

    const { result } = renderHook(() => useProfileLevel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.level).toBe(1);
    expect(result.current.isAdmin).toBe(true);
  });
});
