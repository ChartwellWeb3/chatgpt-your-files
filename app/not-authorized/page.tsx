import { Card } from "@/components/ui/card";
import { Lock, AlertCircle } from "lucide-react";
import { createClient } from "../utils/supabase/server";
import { Button } from "@/components/ui/button";

import {
  LEVEL1_ALLOWED_PREFIXES,
  LEVEL2_ALLOWED_PREFIXES,
  LEVEL3_ALLOWED_PREFIXES,
} from "../const/userLevels";
export type UserLevel = 1 | 2 | 3;

export function getAllowedLinks(
  level: UserLevel
): { name: string; path: string }[] {
  if (level === 3) return LEVEL3_ALLOWED_PREFIXES;
  if (level === 2) return LEVEL2_ALLOWED_PREFIXES;
  return LEVEL1_ALLOWED_PREFIXES;
}

export default async function NotAuthorizedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let level: UserLevel = 3;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("level")
      .eq("id", user.id)
      .single();
    console.log(profile);
    level = (profile?.level ?? 3) as UserLevel;
  }

  const allowedLinks = getAllowedLinks(level);
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
        </div>

        <div className="flex items-center gap-2 rounded-md bg-destructive/15 p-3 text-sm text-destructive font-medium border border-destructive/20 ">
          <AlertCircle className="h-4 w-4" />
          <p>You are not authorized to access this page.</p>
        </div>
        <div className="mt-4 gap-2 text-center text-sm text-accent-foreground">
          <p>Links that you have access to:</p>
        </div>
        <ul className=" flex flex-wrap gap-2 justify-center mt-4">
          {allowedLinks.map((link) => (
            <li key={link.path} className="">
              <Button variant="outline" className="">
                <a href={link.path} className="">
                  {link.name}
                </a>
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
