"use client";

import { useActionState } from "react";
import { verifyEmailAction } from "./actions";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

const initialState = {
  error: "",
};

type Props = {
  token_hash?: string;
  type?: string;
  code?: string; // <--- Add this
};

export function ConfirmForm({ token_hash, type, code }: Props) {
  const [state, formAction, isPending] = useActionState(
    verifyEmailAction,
    initialState
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {/* Pass whatever params we have to the action */}
      <input type="hidden" name="token_hash" value={token_hash || ""} />
      <input type="hidden" name="type" value={type || ""} />
      <input type="hidden" name="code" value={code || ""} />

      {state?.error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/15 p-3 text-sm text-destructive font-medium border border-destructive/20">
          <AlertCircle className="h-4 w-4" />
          <p>{state.error}</p>
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full bg-green-600 hover:bg-green-700"
        disabled={isPending}
      >
        {isPending ? "Activating..." : "Activate Account"}
      </Button>
    </form>
  );
}
