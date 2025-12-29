"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type Props = {
  startDate: string;
  endDate: string;
  onChange: (from: string, to: string) => void;
};

// FIX timezone shifting issue ⬇
function toLocalDate(dateString?: string): Date | undefined {
  if (!dateString) return undefined;
  const [y, m, d] = dateString.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function DateRangePicker({ startDate, endDate, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const range: DateRange = {
    from: toLocalDate(startDate),
    to: toLocalDate(endDate),
  };

  const hasRange = !!range.from && !!range.to;

  const displayValue = hasRange
    ? `${format(range.from!, "MMM d, yyyy")} – ${format(
        range.to!,
        "MMM d, yyyy"
      )}`
    : "All time";

  const handleSelect = (next: DateRange | undefined) => {
    const fmt = (d?: Date) => (d ? format(d, "yyyy-MM-dd") : "");
    onChange(fmt(next?.from), fmt(next?.to));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-8 group h-12 w-full">
          <div className="flex flex-col items-start justify-between">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground group-hover:text-white">
              Date range
            </span>
            <span className="text-sm font-medium">{displayValue}</span>
          </div>
          <CalendarIcon className="h-4 w-4 text-muted-foreground group-hover:text-white" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-auto p-2 space-y-2">
        <Calendar
          mode="range"
          numberOfMonths={2}
          selected={range}
          onSelect={handleSelect}
   
        />

        <div className="flex justify-end gap-2 pt-1">
          <Button
            size="sm"
            variant="ghost"
            className="text-xs px-2"
            onClick={() => onChange("", "")}
            disabled={!hasRange}
          >
            Clear
          </Button>
          <Button
            size="sm"
            className="text-xs px-3"
            onClick={() => setOpen(false)}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
