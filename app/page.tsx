import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function Index() {
  const cookeStore = cookies();
  const supabase = createServerComponentClient({ cookies: () => cookeStore });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-8 max-w-2xl px-6 text-center">
        <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center shadow-glow">
          <svg
            width="32"
            height="32"
            viewBox="0 0 100 100"
            xmlns="http://www.w3.org/2000/svg"
            className="fill-primary"
          >
            <path d="m11.906 46.43c-1.7852 1.4883-4.168 0.89453-5.0586-1.1914-1.1914-2.082-0.59375-4.7617 1.1914-5.9531l40.18-30.355c1.1914-0.89453 2.6797-0.89453 3.8672 0l40.18 30.355c1.4883 1.1914 2.082 3.8672 0.89453 5.9531-0.89453 2.082-3.2734 2.6797-5.0586 1.1914l-38.094-28.867-38.094 28.867z" />
            <path
              d="m83.633 48.809v37.5c0 2.9766-2.3828 5.6562-5.6562 5.6562h-15.773v-28.57c0-2.9766-2.3828-5.0586-5.0586-5.0586h-13.988c-2.9766 0-5.0586 2.082-5.0586 5.0586v28.57h-16.07c-2.9766 0-5.6562-2.6797-5.6562-5.6562v-37.5l33.633-25.297 33.633 25.297z"
              fillRule="evenodd"
            />
          </svg>
        </div>
        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-bold text-balance">
           Chartwell Residence Management System
          </h1>
          <p className="text-lg text-muted-foreground text-balance">
            Organize your files across multiple residences and chat with an AI
            assistant that understands your documents.
          </p>
        </div>
        <a
          href="/login"
          className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-all hover:shadow-glow"
        >
          Get Started
        </a>
      </div>
    </div>
  );
}
