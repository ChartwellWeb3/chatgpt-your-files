"use server";

import { createClient } from "../../utils/supabase/server";
import { redirect } from "next/navigation";
import { type EmailOtpType } from "@supabase/supabase-js";

// Define the shape of your return state
type FormState = {
  error?: string;
  success?: boolean;
} | null;

// Replace 'any' with 'FormState' (or 'unknown' if you don't care)
export async function verifyEmailAction(
  _prevState: FormState,
  formData: FormData
) {
  const code = formData.get("code") as string;
  const token_hash = formData.get("token_hash") as string;
  const type = formData.get("type") as EmailOtpType;

  const supabase = await createClient();
  let errorMsg = null;

  // ... rest of your logic ...

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) errorMsg = error.message;
  } else if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (error) errorMsg = error.message;
  } else {
    return { error: "Invalid verification link parameters." };
  }

  if (errorMsg) {
    return { error: errorMsg };
  }

  await supabase.auth.signOut();
  redirect("/login?verified=true");
}
