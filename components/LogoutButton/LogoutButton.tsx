import { signOut } from "@/app/login/actions";
import { LogOut } from "lucide-react";

export const LogoutButton = () => {
  return (
    <form action={signOut}>
      <button
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        type="submit"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </form>
  );
}
