"use client";

import type { ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type InfoDialogProps = {
  title: string;
  summary?: string;
  children: ReactNode;
  triggerLabel?: string;
  buttonClassName?: string;
  iconClassName?: string;
};

export function InfoDialog({
  title,
  summary,
  children,
  triggerLabel,
  buttonClassName,
  iconClassName,
}: InfoDialogProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-8 w-8 text-muted-foreground ${buttonClassName ?? ""}`}
          aria-label={triggerLabel ?? `${title} info`}
          title={triggerLabel ?? `${title} info`}
        >
          <HelpCircle className={`h-4 w-4 ${iconClassName ?? ""}`} />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {summary ? (
            <AlertDialogDescription>{summary}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">{children}</div>
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
