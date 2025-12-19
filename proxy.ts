import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
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

  // 1. Refresh the session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // 2. Define Public Routes
  const isPublicRoute =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/verify-email");

  // --- LOGIC GATES ---

  // Gate 1: Not Logged In -> Redirect to Login
  if (!user && !isPublicRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Gate 2: Logged In but UNVERIFIED -> Force to Verify Page
  // We strictly check if 'email_confirmed_at' exists
  if (user && !user.email_confirmed_at) {
    // If they are already on the verify page, let them stay
    if (path === "/verify-email" || path.startsWith("/auth")) {
      return response;
    }
    // Otherwise, kick them to the verify page
    return NextResponse.redirect(new URL("/verify-email", request.url));
  }

  // Gate 3: Logged In & Verified -> Block access to Login/Verify pages
  if (user && user.email_confirmed_at) {
    if (path.startsWith("/login") || path === "/verify-email") {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
