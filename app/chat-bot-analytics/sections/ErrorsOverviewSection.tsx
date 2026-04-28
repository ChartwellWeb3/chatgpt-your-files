import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate } from "@/app/helpers/fmtDate";
import { InfoDialog } from "./InfoDialog";

type ErrorAlertRow = {
  id: number;
  error_key: string;
  last_sent_at: string;
  count: number;
};

type ErrorsOverviewSectionProps = {
  startDate: string;
  endDate: string;
  rows: ErrorAlertRow[];
  isLoading: boolean;
  error: unknown;
};

function getErrorMessage(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Failed to load errors.";
}

export function ErrorsOverviewSection({
  startDate,
  endDate,
  rows,
  isLoading,
  error,
}: ErrorsOverviewSectionProps) {
  const rangeLabel =
    startDate || endDate
      ? `${startDate || "..."} -> ${endDate || "..."}`
      : "All time";
  const latestAlertAt = rows[0]?.last_sent_at ?? null;

  return (
    <section id="analytics-errors" className="space-y-4">
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Errors</h2>
            <InfoDialog
              title="Error alerts"
              summary="Recent chatbot error keys tracked for alert throttling and visibility."
            >
              <p>
                Shows rows from{" "}
                <span className="font-medium">chatbot_error_alerts</span>.
              </p>
              <p>
                <span className="font-medium">Count</span> is the accumulated
                count stored for that error key, and{" "}
                <span className="font-medium">Last sent</span> is the latest
                alert timestamp.
              </p>
            </InfoDialog>
          </div>

          <div className="text-xs text-muted-foreground">
            Range: {rangeLabel} • {rows.length} unique error
            {rows.length !== 1 ? "s" : ""}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border/70 bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">
              Visible error keys
            </div>
            <div className="mt-1 text-2xl font-semibold">{rows.length}</div>
          </div>

          <div className="rounded-md border border-border/70 bg-muted/20 p-3">
            <div className="text-xs text-muted-foreground">
              Most recent alert
            </div>
            <div className="mt-1 text-sm font-medium">
              {latestAlertAt ? fmtDate(latestAlertAt) : "-"}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : null}

        {error ? (
          <div className="text-sm text-destructive">
            {getErrorMessage(error)}
          </div>
        ) : null}

        {!isLoading && !error && rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No errors found for this period.
          </div>
        ) : null}

        {!isLoading && !error && rows.length > 0 ? (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Showing up to 10 error keys ordered by most recent alert.
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Error key</TableHead>
                  <TableHead className="w-[120px]">Count</TableHead>
                  <TableHead className="w-[220px]">Last sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs break-all">
                      {row.error_key}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{row.count}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {fmtDate(row.last_sent_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
