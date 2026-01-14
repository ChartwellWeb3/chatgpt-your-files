// app/team/page.tsx
import { Card } from "@/components/ui/card";
import { Shield, Users, AlertTriangle } from "lucide-react";
import { createClient } from "../utils/supabase/server"; // adjust to your path
import TeamTable from "./team-table";

export type Level = 1 | 2 | 3;

const ROLE_META: Record<
  Level,
  { label: string; short: string; description: string }
> = {
  1: {
    label: "Admin",
    short: "Level 1",
    description:
      "Full access to all manager areas, can change team levels, manage API tools, and is the only role allowed to remove user data.",
  },
  2: {
    label: "Content Team",
    short: "Level 2",
    description:
      "Can manage chatbot content, view analytics, and use user data tracker. Cannot access API tools. Cannot remove user data.",
  },
  3: {
    label: "Basic",
    short: "Level 3",
    description:
      "Can view analytics and user data tracker. Cannot manage content or API tools. Cannot remove user data.",
  },
};

export default async function TeamPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background px-4">
        <Card className="w-full max-w-2xl bg-card/40 backdrop-blur-sm border-border shadow-lg p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Team Management
              </h1>
              <p className="text-sm text-muted-foreground">
                You must be logged in.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // My profile (includes level)
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("id, level")
    .eq("id", user.id)
    .single();

  const myLevel = (myProfile?.level ?? 3) as Level;
  const isAdmin = myLevel === 1;

  // List of profiles to manage
  const { data: profiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, level, created_at, email")
        .order("created_at", { ascending: false });
    
    // console.log();
    

  return (
    <div className="flex min-h-screen w-full items-start justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-5xl bg-card/40 backdrop-blur-sm border-border shadow-lg p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Users className="h-6 w-6 text-primary" />
          </div>

          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Team Management
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage access levels for Chartwell Manager tools.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm">
              <span className="text-muted-foreground">Your role: </span>
              <span className="font-medium">
                {ROLE_META[myLevel].label} ({ROLE_META[myLevel].short})
              </span>
            </div>
          </div>
        </div>

        {/* Role descriptions */}
        <div className="grid gap-3 md:grid-cols-3">
          {(Object.keys(ROLE_META) as unknown as Level[]).map((lvl) => (
            <div
              key={lvl}
              className="rounded-lg border border-border bg-background/30 p-4 space-y-1"
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold">{ROLE_META[lvl].label}</p>
                <p className="text-xs text-muted-foreground">
                  {ROLE_META[lvl].short}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                {ROLE_META[lvl].description}
              </p>
              {lvl === 1 && (
                <p className="text-xs text-muted-foreground mt-2">
                  ⚠ Only <span className="font-medium">Admin</span> can remove
                  user data.
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Warnings / state */}
        {!isAdmin && (
          <div className="rounded-md border border-border bg-background/30 p-4 text-sm text-muted-foreground">
            You can view the team list, but only{" "}
            <span className="font-medium">Admin</span> can change levels or
            remove user data.
          </div>
        )}

        {profilesErr ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load profiles: {profilesErr.message}
          </div>
        ) : (
          <TeamTable
            profiles={profiles ?? []}
            isAdmin={isAdmin}
            myUserId={user.id}
          />
        )}
      </Card>
    </div>
  );
}
