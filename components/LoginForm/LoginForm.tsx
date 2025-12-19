// "use client";

// import { useState, useTransition } from "react";
// import { sendLoginCode, verifyLoginCode } from "@/app/login/actions";

// export default function LoginForm() {
//   const [step, setStep] = useState<"email" | "verify">("email");
//   const [email, setEmail] = useState("");
//   const [error, setError] = useState<string | null>(null);
//   const [isPending, startTransition] = useTransition();

//   // HANDLER: User submits Email
//   const handleSendCode = async (formData: FormData) => {
//     setError(null);
//     // We store email in state so we can pass it to the verify step later
//     const emailVal = formData.get("email") as string;
//     setEmail(emailVal);

//     startTransition(async () => {
//       const result = await sendLoginCode(formData);

//       if (result?.error) {
//         setError(result.error);
//       } else if (result?.showVerifyStep) {
//         setStep("verify"); // Switch UI to Step 2
//       }
//     });
//   };

//   // HANDLER: User submits Code
//   const handleVerify = async (formData: FormData) => {
//     setError(null);
//     // We must append the email to this formData because the verify action needs it
//     formData.append("email", email);

//     startTransition(async () => {
//       const result = await verifyLoginCode(null, formData);
//       if (result?.error) {
//         setError(result.error);
//       }
//     });
//   };

//   return (
//     <div className="max-w-md mx-auto p-6 border rounded-lg">
//       <h1 className="text-2xl font-bold mb-4">
//         {step === "email" ? "Log In" : "Check your Email"}
//       </h1>

//       {error && (
//         <div className="bg-red-100 text-red-600 p-2 mb-4 rounded">{error}</div>
//       )}

//       {step === "email" ? (
//         /* --- STEP 1: EMAIL FORM --- */
//         <form action={handleSendCode} className="space-y-4">
//           <div>
//             <label className="block text-sm mb-1">Email Address</label>
//             <input
//               name="email"
//               type="email"
//               required
//               className="w-full border p-2 rounded"
//               placeholder="you@example.com"
//             />
//           </div>
//           <button
//             type="submit"
//             disabled={isPending}
//             className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-50"
//           >
//             {isPending ? "Sending Code..." : "Send Code"}
//           </button>
//         </form>
//       ) : (
//         /* --- STEP 2: CODE FORM --- */
//         <form action={handleVerify} className="space-y-4">
//           <p className="text-sm text-gray-600">
//             We sent a 6-digit code to <strong>{email}</strong>.
//           </p>

//           <div>
//             <label className="block text-sm mb-1">Enter Code</label>
//             <input
//               name="code"
//               type="text"
//               required
//               className="w-full border p-2 rounded text-center tracking-widest text-lg"
//               placeholder="123456"
//               maxLength={6}
//             />
//           </div>

//           <button
//             type="submit"
//             disabled={isPending}
//             className="w-full bg-green-600 text-white p-2 rounded hover:bg-green-700 disabled:opacity-50"
//           >
//             {isPending ? "Verifying..." : "Verify & Login"}
//           </button>

//           <button
//             type="button"
//             onClick={() => setStep("email")}
//             className="w-full text-sm text-gray-500 hover:underline"
//           >
//             Wrong email? Go back
//           </button>
//         </form>
//       )}
//     </div>
//   );
// }
