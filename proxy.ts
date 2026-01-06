import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  LEVEL3_ALLOWED_PREFIXES,
  LEVEL1_ALLOWED_PREFIXES,
  LEVEL2_ALLOWED_PREFIXES,
} from "./app/const/userLevels";

function isAllowedForLevel(pathname: string, level: { path: string }[]) {
  return level.some((link) =>
    link.path === "/" ? pathname === "/" : pathname.startsWith(link.path)
  );
}

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // 1) Refresh session / get user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // 2) Public routes
  const isPublicRoute =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/verify-email") ||
    path.startsWith("/not-authorized");
  path.startsWith("/api/analytics");
  path.startsWith("/api/auth");

  // Gate 1: Not logged in
  if (!user && !isPublicRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Gate 2: Logged in but unverified
  if (user && !user.email_confirmed_at) {
    if (path === "/verify-email" || path.startsWith("/auth")) return response;
    return NextResponse.redirect(new URL("/verify-email", request.url));
  }

  // Gate 3: Logged in & verified -> block login/verify
  if (user && user.email_confirmed_at) {
    if (path.startsWith("/login") || path === "/verify-email") {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  // ---- NEW: Level gating (only for logged-in verified users) ----
  if (user && user.email_confirmed_at) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("level")
      .eq("id", user.id)
      .single();

    // If profile missing, treat as most restricted (level 3)
    const level = profile?.level ?? 3;

    // Level 1 & 2: full access
    // Level 3: only allowed routes
    if (
      level === 3 &&
      !isPublicRoute &&
      !isAllowedForLevel(path, LEVEL3_ALLOWED_PREFIXES)
    ) {
      return NextResponse.redirect(new URL("/not-authorized", request.url));
    }
    if (
      level === 2 &&
      !isPublicRoute &&
      !isAllowedForLevel(path, LEVEL2_ALLOWED_PREFIXES)
    ) {
      return NextResponse.redirect(new URL("/not-authorized", request.url));
    }
    if (
      level === 1 &&
      !isPublicRoute &&
      !isAllowedForLevel(path, LEVEL1_ALLOWED_PREFIXES)
    ) {
      return NextResponse.redirect(new URL("/not-authorized", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
