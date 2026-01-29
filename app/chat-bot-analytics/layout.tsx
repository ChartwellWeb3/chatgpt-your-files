import type { PropsWithChildren } from "react";
import { BarChart3, Star, Users } from "lucide-react";
import { AnalyticsSubnav } from "./sections/AnalyticsSubnav";

const NAV_LINKS = [
  {
    href: "/chat-bot-analytics/overview",
    label: "Overview",
    icon: <BarChart3 className="h-4 w-4" />,
  },
  {
    href: "/chat-bot-analytics/visitors-sessions",
    label: "Visitors & Sessions",
    icon: <Users className="h-4 w-4" />,
  },
  {
    href: "/chat-bot-analytics/reviews",
    label: "Reviews",
    icon: <Star className="h-4 w-4" />,
  },
];

export default function ChatAnalyticsLayout({ children }: PropsWithChildren) {
  return (
    <div className="flex h-full flex-col">
      <AnalyticsSubnav links={NAV_LINKS} />
      <div className="flex-1 overflow-auto px-6">{children}</div>
    </div>
  );
}
