import Messages from "./messages";

export default function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 to-muted/30">
      <div className="w-full max-w-md p-8 bg-white rounded-xl shadow-lg flex flex-col gap-6 border border-border">
        <h2 className="text-2xl font-bold text-center text-primary mb-2">
          Sign in to your account
        </h2>
        <form
          className="flex flex-col gap-4"
          action="/auth/sign-in"
          method="post"
        >
          <div className="flex flex-col gap-1">
            <label
              className="text-sm font-medium text-muted-foreground"
              htmlFor="email"
            >
              Email
            </label>
            <input
              className="rounded-md px-4 py-2 bg-muted/10 border border-border focus:outline-none focus:ring-2 text-black focus:ring-primary transition mb-2"
              name="email"
              type="email"
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              className="text-sm font-medium text-muted-foreground"
              htmlFor="password"
            >
              Password
            </label>
            <input
              className="rounded-md px-4 py-2 bg-muted/10 border border-border focus:outline-none  text-black focus:ring-2 focus:ring-primary transition mb-2"
              type="password"
              name="password"
              placeholder="••••••••"
              required
            />
          </div>
          <button className="bg-primary hover:bg-primary/90 rounded-md px-4 py-2 text-black font-semibold text-lg transition mb-2 shadow">
            Sign In
          </button>
          <Messages />
        </form>
      </div>
    </div>
  );
}
