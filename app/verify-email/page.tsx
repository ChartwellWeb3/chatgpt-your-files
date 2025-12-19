import Link from "next/link";

export default function VerifyEmailPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-2xl font-bold">Check your email</h1>
      <p className="mt-4 text-gray-600">
        We have sent a confirmation link to your inbox (it can take up to 20
        minutes). Please click the link to activate your account.
      </p>

      <div className="mt-8">
        <p className="text-sm text-gray-500">
          Already confirmed?{" "}
          <Link href="/login" className="text-blue-500 hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
