import { ConfirmForm } from "./confirm-form";
import { Card } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; code?: string }>;
}) {
  const { token_hash, type, code } = await searchParams;

  // We need EITHER (token_hash + type) OR (code)
  const isValid = (token_hash && type) || code;

  if (!isValid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="p-6 text-center text-destructive border-destructive/20 bg-destructive/10">
          <p className="font-semibold">Invalid link parameters.</p>
          <p className="text-sm mt-2 opacity-80">
            The link is missing the required code or token.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md p-8 space-y-6 text-center shadow-lg border-border">
        <div className="flex justify-center">
          <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center">
            <ShieldCheck className="h-8 w-8 text-green-600" />
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-bold">Secure Verification</h1>
          <p className="text-muted-foreground mt-2">
            Click the button below to finish activating your account.
          </p>
        </div>

        {/* Pass all potential params */}
        <ConfirmForm token_hash={token_hash} type={type} code={code} />

      </Card>
    </div>
  );
}
