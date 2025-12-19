// "use server";

// import { revalidatePath } from "next/cache";
// import { redirect } from "next/navigation";
// import { createClient } from "../utils/supabase/server";

// /**
//  * STEP 1: Validate Password & Send Code (Login) OR Create User (Signup)
//  */
// export async function submitCredentials(formData: FormData) {
//   const supabase = await createClient();
//   const email = formData.get("email") as string;
//   const password = formData.get("password") as string;
//   const mode = formData.get("mode") as string; // 'login' or 'signup'

//   // --- 1. COMMON VALIDATION ---
//   // Strictly enforce @chartwell.com for BOTH login and signup attempts
//   // to prevent unauthorized access early.
//   if (!email.endsWith("@chartwell.com")) {
//     return {
//       error: "Access restricted to chartwell.com email addresses only.",
//     };
//   }

//   if (mode === "signup") {
//     // --- SIGN UP FLOW ---

    // // 1. Sign up with Supabase
    // const { error } = await supabase.auth.signUp({
    //   email,
    //   password,
    //   options: {
    //     // Crucial: This points to your route handler that prevents the "Bot Click" issue
    //     emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm`,
    //   },
    // });

//     if (error) return { error: error.message };

//     // Success: The UI will handle the redirect to /verify-email
//     return { success: true };
//   } else {
//     // --- LOGIN FLOW (Password + OTP) ---

//     // 1. Check Password First
//     // We try to sign in to see if the password matches
//     const { error: passwordError } = await supabase.auth.signInWithPassword({
//       email,
//       password,
//     });

//     if (passwordError) {
//       return { error: "Invalid email or password" };
//     }

//     // 2. Password is correct. Immediately Sign Out.
//     // We don't want a session yet; we want to force the OTP step.
//     await supabase.auth.signOut();

//     // 3. Send the Email Code (2FA)
//     const { error: otpError } = await supabase.auth.signInWithOtp({
//       email,
//       options: {
//         shouldCreateUser: false, // strictly prevent new users here
//       },
//     });

//     if (otpError) {
//       return { error: otpError.message };
//     }

//     return { success: true };
//   }
// }

// /**
//  * STEP 2: Verify Code (For Login Only)
//  */
// export async function verifyLoginCode(email: string, code: string) {
//   const supabase = await createClient();

//   const { error } = await supabase.auth.verifyOtp({
//     email,
//     token: code,
//     type: "email", // This verifies the code sent by signInWithOtp
//   });

//   if (error) {
//     return { error: error.message };
//   }

//   // If successful, Supabase sets the cookie automatically.
//   // We just redirect.
//   revalidatePath("/", "layout");
//   redirect("/chat-bot-analytics");
// }

// /** * SERVER ACTION: Sign Out
//  */



"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../utils/supabase/server";
import { EmailOtpType } from "@supabase/supabase-js";

/**
 * STEP 1: Submit Credentials
 */
export async function submitCredentials(formData: FormData) {
  const supabase = await createClient();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const mode = formData.get("mode") as string;

  if (!email.endsWith("@chartwell.com")) {
    return {
      error: "Access restricted to chartwell.com email addresses only.",
    };
  }

  if (mode === "signup") {
    // --- SIGN UP FLOW ---
    const { error } = await supabase.auth.signUp({
      email,
      password,
      // We don't need emailRedirectTo anymore because we aren't using links
    });

    if (error) return { error: error.message };

    // CHANGED: Return success so the UI switches to the "Enter Code" screen
    return { success: true };
  } else {
    // --- LOGIN FLOW ---
    const { error: passwordError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (passwordError) return { error: "Invalid email or password" };

    await supabase.auth.signOut();

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });

    if (otpError) return { error: otpError.message };

    return { success: true };
  }
}

/**
 * STEP 2: Verify Code (Handles BOTH Login and Signup)
 */
export async function verifyOtpCode(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get("email") as string;
  const code = formData.get("code") as string;
  const mode = formData.get("mode") as string; // 'login' or 'signup'

  // Determine the correct Supabase verification type
  // 'signup' = verifying a new user registration
  // 'email'  = verifying a login OTP for existing user
  const tokenType: EmailOtpType = mode === "signup" ? "signup" : "email";

  const { error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: tokenType,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/chat-bot-analytics");
}



export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect("/login");
}
