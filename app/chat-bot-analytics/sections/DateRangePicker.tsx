"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type RangeProps = {
  variant?: "range";
  startDate: string;
  endDate: string;
  onChange: (from: string, to: string) => void;
  label?: string;
};

type MonthProps = {
  variant: "month";
  value: string;
  onChange: (value: string) => void;
  label?: string;
  minYear?: number;
  maxYear?: number;
};

type Props = RangeProps | MonthProps;

// FIX timezone shifting issue
function toLocalDate(dateString?: string): Date | undefined {
  if (!dateString) return undefined;
  const [y, m, d] = dateString.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toLocalMonthDate(value?: string) {
  if (!value) return undefined;
  const [y, m] = value.split("-").map(Number);
  if (!y || !m) return undefined;
  return new Date(y, m - 1, 1);
}

function formatMonthValue(date?: Date) {
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function MonthPicker({
  value,
  onChange,
  label = "Month",
  minYear = 2020,
  maxYear,
}: MonthProps) {
  const [open, setOpen] = useState(false);
  const selectedMonth = toLocalMonthDate(value);
  const displayValue = selectedMonth
    ? format(selectedMonth, "MMM yyyy")
    : "Select month";
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const maxYearResolved = maxYear ?? currentYear + 10;
  const [viewYear, setViewYear] = useState(
    selectedMonth?.getFullYear() ?? currentYear,
  );
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setViewYear(selectedMonth?.getFullYear() ?? currentYear);
    }
  };

  const months = useMemo(
    () => [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ],
    [],
  );

  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = minYear; y <= maxYearResolved; y += 1) list.push(y);
    return list;
  }, [minYear, maxYearResolved]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="gap-8 group h-12 w-[220px] justify-between"
        >
          <div className="flex flex-col items-start justify-between">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground group-hover:text-white">
              {label}
            </span>
            <span className="text-sm font-medium">{displayValue}</span>
          </div>
          <CalendarIcon className="h-4 w-4 text-muted-foreground group-hover:text-white" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setViewYear((y) => Math.max(minYear, y - 1))}
            disabled={viewYear <= minYear}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={viewYear}
            onChange={(e) => setViewYear(Number(e.target.value))}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setViewYear((y) => Math.min(maxYearResolved, y + 1))}
            disabled={viewYear >= maxYearResolved}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {months.map((labelText, idx) => {
            const isSelected =
              selectedMonth &&
              selectedMonth.getFullYear() === viewYear &&
              selectedMonth.getMonth() === idx;
            return (
              <Button
                key={labelText}
                variant={isSelected ? "secondary" : "ghost"}
                size="sm"
                className="h-8"
                onClick={() =>
                  onChange(formatMonthValue(new Date(viewYear, idx, 1)))
                }
              >
                {labelText}
              </Button>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            size="sm"
            variant="ghost"
            className="text-xs px-2"
            onClick={() => onChange("")}
            disabled={!value}
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

function RangePicker({
  startDate,
  endDate,
  onChange,
  label = "Date range",
}: RangeProps) {
  const [open, setOpen] = useState(false);

  const range: DateRange = {
    from: toLocalDate(startDate),
    to: toLocalDate(endDate),
  };

  const hasRange = !!range.from && !!range.to;

  const displayValue = hasRange
    ? `${format(range.from!, "MMM d, yyyy")} – ${format(
        range.to!,
        "MMM d, yyyy",
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
              {label}
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

export function DateRangePicker(props: Props) {
  return props.variant === "month" ? (
    <MonthPicker {...props} />
  ) : (
    <RangePicker {...props} />
  );
}
