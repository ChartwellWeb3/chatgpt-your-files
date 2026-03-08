// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const revalidatePathMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("@/app/utils/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

function toFormData(values: Record<string, string>) {
  const fd = new FormData();
  Object.entries(values).forEach(([key, value]) => fd.set(key, value));
  return fd;
}

function buildSupabase() {
  return {
    auth: {
      signUp: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
      verifyOtp: vi.fn().mockResolvedValue({ error: null }),
    },
  };
}

describe("app/login/actions", () => {
  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockReset();
    revalidatePathMock.mockReset();
    redirectMock.mockReset();
  });

  it("rejects non-chartwell domains", async () => {
    const { submitCredentials } = await import("@/app/login/actions");

    const result = await submitCredentials(
      toFormData({
        email: "user@example.com",
        password: "pass",
        mode: "login",
      }),
    );

    expect(result).toEqual({
      error: "Access restricted to chartwell.com email addresses only.",
    });
  });

  it("returns sign-up errors", async () => {
    const supabase = buildSupabase();
    supabase.auth.signUp.mockResolvedValue({ error: { message: "signup failed" } });
    createClientMock.mockResolvedValue(supabase);

    const { submitCredentials } = await import("@/app/login/actions");

    const result = await submitCredentials(
      toFormData({
        email: "user@chartwell.com",
        password: "pass",
        mode: "signup",
      }),
    );

    expect(result).toEqual({ error: "signup failed" });
  });

  it("runs signup flow", async () => {
    const supabase = buildSupabase();
    createClientMock.mockResolvedValue(supabase);

    const { submitCredentials } = await import("@/app/login/actions");

    const result = await submitCredentials(
      toFormData({
        email: "user@chartwell.com",
        password: "pass",
        mode: "signup",
      }),
    );

    expect(result).toEqual({ success: true });
    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: "user@chartwell.com",
      password: "pass",
    });
  });

  it("returns an error when password login fails", async () => {
    const supabase = buildSupabase();
    supabase.auth.signInWithPassword.mockResolvedValue({ error: { message: "bad creds" } });
    createClientMock.mockResolvedValue(supabase);

    const { submitCredentials } = await import("@/app/login/actions");

    const result = await submitCredentials(
      toFormData({
        email: "user@chartwell.com",
        password: "wrong",
        mode: "login",
      }),
    );

    expect(result).toEqual({ error: "Invalid email or password" });
  });

  it("returns an error when OTP send fails", async () => {
    const supabase = buildSupabase();
    supabase.auth.signInWithOtp.mockResolvedValue({ error: { message: "otp failed" } });
    createClientMock.mockResolvedValue(supabase);

    const { submitCredentials } = await import("@/app/login/actions");

    const result = await submitCredentials(
      toFormData({
        email: "user@chartwell.com",
        password: "pass",
        mode: "login",
      }),
    );

    expect(result).toEqual({ error: "otp failed" });
  });

  it("runs login flow and sends OTP", async () => {
    const supabase = buildSupabase();
    createClientMock.mockResolvedValue(supabase);

    const { submitCredentials } = await import("@/app/login/actions");

    const result = await submitCredentials(
      toFormData({
        email: "user@chartwell.com",
        password: "pass",
        mode: "login",
      }),
    );

    expect(result).toEqual({ success: true });
    expect(supabase.auth.signInWithPassword).toHaveBeenCalled();
    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "user@chartwell.com",
      options: { shouldCreateUser: false },
    });
  });

  it("returns verify OTP errors", async () => {
    const supabase = buildSupabase();
    supabase.auth.verifyOtp.mockResolvedValue({ error: { message: "invalid code" } });
    createClientMock.mockResolvedValue(supabase);

    const { verifyOtpCode } = await import("@/app/login/actions");

    const result = await verifyOtpCode(
      toFormData({
        email: "user@chartwell.com",
        code: "123456",
        mode: "login",
      }),
    );

    expect(result).toEqual({ error: "invalid code" });
  });

  it("verifies OTP and redirects", async () => {
    const supabase = buildSupabase();
    createClientMock.mockResolvedValue(supabase);

    const { verifyOtpCode } = await import("@/app/login/actions");

    await verifyOtpCode(
      toFormData({
        email: "user@chartwell.com",
        code: "123456",
        mode: "signup",
      }),
    );

    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
      email: "user@chartwell.com",
      token: "123456",
      type: "signup",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
    expect(redirectMock).toHaveBeenCalledWith("/chat-bot-analytics");
  });

  it("signOut clears session and redirects", async () => {
    const supabase = buildSupabase();
    createClientMock.mockResolvedValue(supabase);

    const { signOut } = await import("@/app/login/actions");

    await signOut();

    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });
});
