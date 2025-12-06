import LogoutButton from "@/components/LogoutButton";
import { Toaster } from "@/components/ui/toaster";
import Providers from "@/lib/providers";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";

import { cookies } from "next/headers";
import Link from "next/link";
import type { PropsWithChildren } from "react";
import "three-dots/dist/three-dots.css";
import "./globals.css";

export const metadata = {
  title: "Residence Manager",
  description: "Manage your residences and files with AI",
};

export default async function RootLayout({ children }: PropsWithChildren) {
  const cookieStore = await cookies();
  const supabase = createServerComponentClient({
    cookies: () => cookieStore,
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en" className="h-full dark">
      <body className="h-full">
        <Providers>
          <div className="flex flex-col h-full">
            <nav className="w-full border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
              <div className="max-w-full flex justify-between items-center px-6 h-14">
                <div className="flex items-center gap-6">
                  <Link
                    href="/"
                    className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                  >
                    <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 100 100"
                        xmlns="http://www.w3.org/2000/svg"
                        className="fill-primary-foreground"
                      >
                        <path d="m11.906 46.43c-1.7852 1.4883-4.168 0.89453-5.0586-1.1914-1.1914-2.082-0.59375-4.7617 1.1914-5.9531l40.18-30.355c1.1914-0.89453 2.6797-0.89453 3.8672 0l40.18 30.355c1.4883 1.1914 2.082 3.8672 0.89453 5.9531-0.89453 2.082-3.2734 2.6797-5.0586 1.1914l-38.094-28.867-38.094 28.867z" />
                        <path
                          d="m83.633 48.809v37.5c0 2.9766-2.3828 5.6562-5.6562 5.6562h-15.773v-28.57c0-2.9766-2.3828-5.0586-5.0586-5.0586h-13.988c-2.9766 0-5.0586 2.082-5.0586 5.0586v28.57h-16.07c-2.9766 0-5.6562-2.6797-5.6562-5.6562v-37.5l33.633-25.297 33.633 25.297z"
                          fillRule="evenodd"
                        />
                      </svg>
                    </div>
                    <span className="font-semibold text-sm">
                      Residence Manager
                    </span>
                  </Link>
                  {user && (
                    <Link
                      href="/dashboard"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Dashboard
                    </Link>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  {user ? (
                    <>
                      <div className="hidden sm:block text-sm text-muted-foreground">
                        {user.email}
                      </div>
                      <LogoutButton />
                    </>
                  ) : (
                    <Link
                      href="/login"
                      className="px-4 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Login
                    </Link>
                  )}
                </div>
              </div>
            </nav>
            <main className="flex-1 overflow-hidden">{children}</main>
            <Toaster />
          </div>
        </Providers>
      </body>
    </html>
  );
}
