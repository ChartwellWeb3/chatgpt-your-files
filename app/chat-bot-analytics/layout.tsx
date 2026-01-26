import type { PropsWithChildren } from "react";
import { AnalyticsSidebar } from "./sections/AnalyticsSidebar";

const NAV_LINKS = [
  { href: "/chat-bot-analytics/overview", label: "Overview" },
  { href: "/chat-bot-analytics/visitors-sessions", label: "Visitors & Sessions" },
  { href: "/chat-bot-analytics/reviews", label: "Reviews" },
];

export default function ChatAnalyticsLayout({ children }: PropsWithChildren) {
  return (
    <div className="relative flex h-full">
      <AnalyticsSidebar links={NAV_LINKS} />
      <div className="flex-1 overflow-auto px-6">{children}</div>
    </div>
  );
}
