"use client";

import { useState, useTransition } from "react";
import { submitCredentials,  } from "@/app/login/actions"; // Updated import
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
  Loader2,
  Mail,
  Lock,
  // KeyRound,
  // ArrowLeft,
} from "lucide-react";

export function AuthForm() {
  const [isLogin, setIsLogin] = useState(true);

  // Track if we are verifying a 'login' or a 'signup'
  // const [verifyMode, setVerifyMode] = useState<"login" | "signup">("login");

  const [step, setStep] = useState<"credentials" | "verify">("credentials");
  // const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // HANDLER: Step 1 (Email + Password)
  const onSubmitCredentials = (formData: FormData) => {
    setError(null);
    // const emailVal = formData.get("email") as string;
    // setEmail(emailVal);

    // Determine mode based on current tab state
    // const mode = isLogin ? "login" : "signup";

    startTransition(async () => {
      const result = await submitCredentials(formData);

      if (result?.error) {
        setError(result.error);
      } else {
        // SUCCESS: Move to Step 2 for BOTH Login and Signup
        // setVerifyMode(mode);
        setStep("verify");
      }
    });
  };

  // HANDLER: Step 2 (Code)
  // const onVerifyCode = (formData: FormData) => {
  //   setError(null);

  //   // Append the email and mode to the form data so the server knows what to verify
  //   formData.append("email", email);
  //   formData.append("mode", verifyMode);

  //   startTransition(async () => {
  //     const result = await verifyOtpCode(formData);
  //     if (result?.error) {
  //       setError(result.error);
  //     }
  //   });
  // };

  return (
    <div className="space-y-6">
      {/* TABS (Only show in Step 1) */}
      {step === "credentials" && (
        <div className="grid grid-cols-2 gap-1 p-1 bg-muted/50 rounded-lg">
          <button
            type="button"
            onClick={() => {
              setIsLogin(true);
              setError(null);
            }}
            className={`text-sm font-medium py-2 rounded-md transition-all ${
              isLogin
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Log In
          </button>
          <button
            type="button"
            onClick={() => {
              setIsLogin(false);
              setError(null);
            }}
            className={`text-sm font-medium py-2 rounded-md transition-all ${
              !isLogin
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Sign Up
          </button>
        </div>
      )}

      {/* ERROR MESSAGE */}
      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/15 p-3 text-sm text-destructive font-medium border border-destructive/20">
          <AlertCircle className="h-4 w-4" />
          <p>{error}</p>
        </div>
      )}

      {/* --- STEP 1: CREDENTIALS --- */}
      <form action={onSubmitCredentials} className="space-y-4">
        <input type="hidden" name="mode" value={isLogin ? "login" : "signup"} />

        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="name@chartwell.com"
              required
              className="pl-9 bg-background/50"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              required
              className="pl-9 bg-background/50"
            />
          </div>
        </div>

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : isLogin ? (
            "Continue"
          ) : (
            "Create Account"
          )}
        </Button>
      </form>
    </div>
  );
}
