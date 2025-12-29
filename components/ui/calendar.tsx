"use client";

import * as React from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

// Thin wrapper so the rest of your app can keep importing `Calendar`
export function Calendar(props: CalendarProps) {
  return <DayPicker  {...props} />;
}
