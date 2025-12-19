import { AuthForm } from "@/components/auth-form/auth-form"; // Import the new component
import { Card } from "@/components/ui/card";
import { Lock, Check, MailCheck, AlertCircle } from "lucide-react";
// import { AuthErrorListener } from "./AuthErrorListener";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    message?: string;
    error?: string;
    verified?: string;
  }>;
}) {
  const { message, error, verified } = await searchParams;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md bg-card/40 backdrop-blur-sm border-border shadow-lg p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Chartwell Manager
          </h1>
          <p className="text-sm text-muted-foreground">Authentication Portal</p>
        </div>

        {/* Global Error Listeners (URL params) */}
        {/* <AuthErrorListener /> */}

        {/* Server Messages (Redirect params) */}
        {verified === "true" && (
          <div className="flex items-center gap-2 rounded-md bg-green-500/15 p-3 text-sm text-green-600 font-medium border border-green-500/20">
            <MailCheck className="h-4 w-4" />
            <p>Email successfully verified! Please log in.</p>
          </div>
        )}

        {message && (
          <div className="flex items-center gap-2 rounded-md bg-blue-500/15 p-3 text-sm text-blue-600 font-medium border border-blue-500/20">
            <Check className="h-4 w-4" />
            <p>{message}</p>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-destructive/15 p-3 text-sm text-destructive font-medium border border-destructive/20">
            <AlertCircle className="h-4 w-4" />
            <p>{error}</p>
          </div>
        )}

        {/* New Client Form with Tabs */}
        <AuthForm />
      </Card>
    </div>
  );
}
