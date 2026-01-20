"use client";

import { BotBookedToursSection } from "./BotBookedToursSection";

type BookedTotals = {
  totalSubmitted: number;
  dynamicSubmitted: number;
};

type BookedByDateStats = {
  total: number;
  dynamic: number;
};

type FormsSectionProps = {
  loadingBookTourForms: boolean;
  loadingBookedByDate: boolean;
  bookTourTotals: BookedTotals;
  bookedByDateStats: BookedByDateStats;
  bookedStart: string;
  bookedEnd: string;
  setBookedStart: (date: string) => void;
  setBookedEnd: (date: string) => void;
};

export function AnalyticsFormsSection({
  loadingBookTourForms,
  loadingBookedByDate,
  bookTourTotals,
  bookedByDateStats,
  bookedStart,
  bookedEnd,
  setBookedStart,
  setBookedEnd,
}: FormsSectionProps) {
  return (
    <section id="analytics-forms" className="space-y-4">
      <h2 className="text-lg font-semibold">Forms</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <BotBookedToursSection
          loading={loadingBookTourForms}
          stats={{
            total: bookTourTotals.totalSubmitted,
            dynamic: bookTourTotals.dynamicSubmitted,
          }}
          bookedEnd={bookedEnd}
          bookedStart={bookedStart}
          setBookedEnd={setBookedEnd}
          setBookedStart={setBookedStart}
          title="Book a Tour: Overview range"
        />

        <BotBookedToursSection
          loading={loadingBookedByDate}
          stats={{
            total: bookedByDateStats.total,
            dynamic: bookedByDateStats.dynamic,
          }}
          bookedEnd={bookedEnd}
          bookedStart={bookedStart}
          setBookedEnd={setBookedEnd}
          setBookedStart={setBookedStart}
          showDatePicker={true}
          title="Booked Tours by Date"
        />
      </div>
    </section>
  );
}
