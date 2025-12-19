// "use client";

// import { useEffect, useState } from "react";
// import { useSearchParams } from "next/navigation";
// import { AlertCircle, CheckCircle2 } from "lucide-react";

// export function AuthErrorListener() {
//   // 1. Initialize with "idle"
//   const [status, setStatus] = useState<"idle" | "error" | "verified_by_scan">(
//     "idle"
//   );
//   const searchParams = useSearchParams();

//   useEffect(() => {
//     // Check URL hash for Supabase errors (client-side redirect)
//     // We strictly check typeof window to ensure this doesn't break SSR
//     const hash = typeof window !== "undefined" ? window.location.hash : "";
//     const params = new URLSearchParams(hash.replace("#", ""));

//     const queryError = searchParams.get("error");
//     const errorCode =
//       params.get("error_code") || searchParams.get("error_code");

//     // 2. ONLY call setStatus if the value is actually different to prevent loops
//     if (errorCode === "otp_expired") {
//       setStatus((prev) =>
//         prev !== "verified_by_scan" ? "verified_by_scan" : prev
//       );
//     } else if (queryError || params.get("error")) {
//       setStatus((prev) => (prev !== "error" ? "error" : prev));
//     }
//   }, [searchParams]);

//   if (status === "idle") return null;

//   if (status === "verified_by_scan") {
//     return (
//       <div className="flex items-center gap-2 rounded-md bg-yellow-500/15 p-3 text-sm text-yellow-600 font-medium border border-yellow-500/20 mb-4">
//         <CheckCircle2 className="h-4 w-4" />
//         <p>
//           Link expired (or already verified).
//           <strong> Please try logging in.</strong>
//         </p>
//       </div>
//     );
//   }

//   return (
//     <div className="flex items-center gap-2 rounded-md bg-destructive/15 p-3 text-sm text-destructive font-medium border border-destructive/20 mb-4">
//       <AlertCircle className="h-4 w-4" />
//       <p>Authentication error. Please try again.</p>
//     </div>
//   );
// }
