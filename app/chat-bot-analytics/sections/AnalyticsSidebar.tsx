"use client";

import Link from "next/link";
import { PanelLeft, X } from "lucide-react";
import { useState } from "react";

type AnalyticsLink = {
  href: string;
  label: string;
};

export function AnalyticsSidebar({ links }: { links: AnalyticsLink[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="absolute left-0 top-0 z-40 h-full">
      <div className="relative h-full">
        {!open && (
          <button
            type="button"
            aria-label={open ? "Close analytics menu" : "Open analytics menu"}
            onClick={() => setOpen((value) => !value)}
            className="absolute left-2 top-5 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md transition hover:bg-muted"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        )}
        <aside
          className={`h-full w-56 border-r border-border bg-card px-4 py-6 shadow-lg transition-transform duration-200 ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              ChatBot Analytics menu
            </div>
            <button
              type="button"
              aria-label="Close analytics menu"
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-foreground transition hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav className="space-y-2">
            {links.map((link) => (
              <Link
                onClick={() => setOpen(!open)}
                key={link.href}
                href={link.href}
                className="block rounded-md px-3 py-2 text-sm hover:bg-muted/40"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </aside>
      </div>
    </div>
  );
}
