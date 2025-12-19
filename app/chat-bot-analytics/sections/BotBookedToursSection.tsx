import { pill } from "@/components/ui/pill";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";

interface BotBookedToursProps {
  loadingBookTourRows?: boolean;
  bookTourTotals: {
    totalSubmitted: number;
    dynamicSubmitted: number;
  };
}

export const BotBookedToursSection = ({
  loadingBookTourRows,
  bookTourTotals,
}: BotBookedToursProps) => {
  const dynamicPct =
    bookTourTotals.totalSubmitted > 0
      ? (bookTourTotals.dynamicSubmitted / bookTourTotals.totalSubmitted) * 100
      : 0;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-sm">Book a Tour form stats</div>
        {loadingBookTourRows ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {pill(`Submitted: ${bookTourTotals.totalSubmitted}`)}
        {pill(`Dynamic: ${bookTourTotals.dynamicSubmitted}`)}
        {pill(
          `With dynamic: ${dynamicPct.toFixed(0)}%`,
          dynamicPct >= 50 ? "ok" : undefined
        )}
      </div>
    </Card>
  );
};
