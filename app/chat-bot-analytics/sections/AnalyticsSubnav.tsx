"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type AnalyticsLink = {
  href: string;
  label: string;
  icon?: ReactNode;
};

export function AnalyticsSubnav({ links }: { links: AnalyticsLink[] }) {
  const pathname = usePathname();

  return (
    <div className="border-b border-border bg-card/50 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-3 px-6 py-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Chat Bot Analytics
        </div>
        <nav className="flex flex-wrap items-center gap-2">
          {links.map((link) => {
            const isActive =
              pathname === link.href || pathname.startsWith(`${link.href}/`);

            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}
              >
                {link.icon ? (
                  <span className="text-base leading-none">{link.icon}</span>
                ) : null}
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
