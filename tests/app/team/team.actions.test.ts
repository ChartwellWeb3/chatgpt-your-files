// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/app/utils/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

function buildCallerQuery(level: number) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue({ data: { level }, error: null }),
  };

  return chain;
}

function buildUpdateDeleteQuery(error: { message: string } | null) {
  const chain = {
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn().mockResolvedValue({ error }),
  };

  return chain;
}

function buildSupabase(options?: {
  user?: { id: string } | null;
  callerLevel?: number;
  updateErr?: { message: string } | null;
  deleteErr?: { message: string } | null;
}) {
  const opts = {
    user: { id: "admin-1" },
    callerLevel: 1,
    updateErr: null,
    deleteErr: null,
    ...options,
  };

  const profileQuery = buildCallerQuery(opts.callerLevel);
  const updateQuery = buildUpdateDeleteQuery(opts.updateErr);
  const deleteQuery = buildUpdateDeleteQuery(opts.deleteErr);

  const from = vi.fn((table: string) => {
    if (table === "profiles") {
      return {
        select: profileQuery.select,
        eq: profileQuery.eq,
        single: profileQuery.single,
        update: updateQuery.update,
        delete: deleteQuery.delete,
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: opts.user } }),
    },
    from,
    __updateEq: updateQuery.eq,
    __deleteEq: deleteQuery.eq,
  };
}

describe("app/team/team.actions", () => {
  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockReset();
    revalidatePathMock.mockReset();
  });

  it("blocks updates when unauthenticated", async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: null }));

    const { updateUserLevelAction } = await import("@/app/team/team.actions");

    await expect(
      updateUserLevelAction({ userId: "user-2", level: 2 as 1 | 2 | 3 }),
    ).rejects.toThrow("Not authenticated.");
  });

  it("blocks updates for non-admin callers", async () => {
    createClientMock.mockResolvedValue(buildSupabase({ callerLevel: 2 }));

    const { updateUserLevelAction } = await import("@/app/team/team.actions");

    await expect(
      updateUserLevelAction({ userId: "user-2", level: 2 as 1 | 2 | 3 }),
    ).rejects.toThrow("Forbidden: Admin only.");
  });

  it("prevents admin from changing own role", async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: { id: "admin-1" } }));

    const { updateUserLevelAction } = await import("@/app/team/team.actions");

    await expect(
      updateUserLevelAction({ userId: "admin-1", level: 2 as 1 | 2 | 3 }),
    ).rejects.toThrow("You cannot change your own role.");
  });

  it("propagates profile update errors", async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({ updateErr: { message: "update failed" } }),
    );

    const { updateUserLevelAction } = await import("@/app/team/team.actions");

    await expect(
      updateUserLevelAction({ userId: "user-2", level: 2 as 1 | 2 | 3 }),
    ).rejects.toThrow("update failed");
  });

  it("updates a user level and revalidates /team", async () => {
    const supabase = buildSupabase();
    createClientMock.mockResolvedValue(supabase);

    const { updateUserLevelAction } = await import("@/app/team/team.actions");

    await updateUserLevelAction({ userId: "user-2", level: 2 as 1 | 2 | 3 });

    expect(supabase.__updateEq).toHaveBeenCalledWith("id", "user-2");
    expect(revalidatePathMock).toHaveBeenCalledWith("/team");
  });

  it("blocks remove-user when caller is not admin", async () => {
    createClientMock.mockResolvedValue(buildSupabase({ callerLevel: 3 }));

    const { removeUserDataAction } = await import("@/app/team/team.actions");

    await expect(removeUserDataAction({ userId: "user-2" })).rejects.toThrow(
      "Forbidden: Admin only.",
    );
  });

  it("prevents admin from removing own data", async () => {
    createClientMock.mockResolvedValue(buildSupabase({ user: { id: "admin-1" } }));

    const { removeUserDataAction } = await import("@/app/team/team.actions");

    await expect(removeUserDataAction({ userId: "admin-1" })).rejects.toThrow(
      "You cannot remove your own data.",
    );
  });

  it("propagates profile delete errors", async () => {
    createClientMock.mockResolvedValue(
      buildSupabase({ deleteErr: { message: "delete failed" } }),
    );

    const { removeUserDataAction } = await import("@/app/team/team.actions");

    await expect(removeUserDataAction({ userId: "user-2" })).rejects.toThrow(
      "delete failed",
    );
  });

  it("removes user profile data and revalidates /team", async () => {
    const supabase = buildSupabase();
    createClientMock.mockResolvedValue(supabase);

    const { removeUserDataAction } = await import("@/app/team/team.actions");

    await removeUserDataAction({ userId: "user-2" });

    expect(supabase.__deleteEq).toHaveBeenCalledWith("id", "user-2");
    expect(revalidatePathMock).toHaveBeenCalledWith("/team");
  });
});
