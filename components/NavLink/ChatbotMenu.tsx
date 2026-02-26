"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type ChatbotLink = {
  href: string;
  label: string;
  icon?: ReactNode;
};

interface ChatbotMenuProps {
  label: string;
  icon?: ReactNode;
  links: ChatbotLink[];
}

export default function ChatbotMenu({ label, icon, links }: ChatbotMenuProps) {
  const currentPath = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = links.some(
    (link) => link.href === currentPath || currentPath.startsWith(`${link.href}/`)
  );
  const triggerClasses = isActive
    ? "text-white bg-green-600 gap-2"
    : "text-white bg-green-800 gap-2";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button className={triggerClasses}>
          {icon ? (
            <span className="text-base leading-none" aria-hidden>
              {icon}
            </span>
          ) : null}
          <span>{label}</span>
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="flex flex-col gap-1">
          {links.map((link) => {
            const isChildActive =
              link.href === currentPath || currentPath.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                aria-current={isChildActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  isChildActive && "bg-accent text-accent-foreground"
                )}
              >
                {link.icon ? (
                  <span className="text-base leading-none" aria-hidden>
                    {link.icon}
                  </span>
                ) : null}
                <span>{link.label}</span>
              </Link>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
