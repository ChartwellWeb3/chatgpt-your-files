import { pill } from "@/components/ui/pill";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DateRangePicker } from "./DateRangePicker";
interface BookedStats {
  total: number;
  dynamic: number;
}

interface BotBookedToursProps {
  loading?: boolean;
  stats: BookedStats; // <-- unified field
  title?: string; // <-- new optional title
  showDynamicPercent?: boolean; // <-- can toggle percent calculation
  bookedStart: string;
  bookedEnd: string;
  setBookedStart: (date: string) => void;
  setBookedEnd: (date: string) => void;
  showDatePicker?: boolean;
}

export const BotBookedToursSection = ({
  loading,
  stats,
  title = "Book a Tour form stats",
  showDynamicPercent = true,
  bookedStart,
  bookedEnd,
  setBookedStart,
  setBookedEnd,
  showDatePicker = false,
}: BotBookedToursProps) => {
  const dynamicPct = stats.total > 0 ? (stats.dynamic / stats.total) * 100 : 0;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-sm">{title}</div>
        {showDatePicker && (
          <DateRangePicker
            startDate={bookedStart}
            endDate={bookedEnd}
            onChange={(from, to) => {
              setBookedStart(from);
              setBookedEnd(to);
            }}
          />
        )}

        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {pill(`Submitted: ${stats.total}`)}
        {pill(`Dynamic: ${stats.dynamic}`)}

        {showDynamicPercent &&
          pill(
            `With dynamic: ${dynamicPct.toFixed(0)}%`,
            dynamicPct >= 50 ? "ok" : undefined
          )}
      </div>
    </Card>
  );
};
