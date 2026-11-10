"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Loader2 } from "lucide-react";
import { updateUserLevelAction, updateUserFeatureAction } from "./team.actions";
import { FEATURES, hasFeatureAccess, type FeatureKey } from "@/lib/feature-access";
import type { Level } from "./page";

type ProfileRow = {
  id: string;
  level: number;
  created_at: string;
  email: string | null;
  feature_access: unknown;
};

const ROLE: Record<
  Level,
  { label: string; badge: "default" | "secondary" | "outline" }
> = {
  1: { label: "Admin", badge: "default" },
  2: { label: "Content Team", badge: "secondary" },
  3: { label: "Basic", badge: "outline" },
};

function toLevel(v: number): Level {
  if (v === 1 || v === 2 || v === 3) return v;
  return 3;
}

export default function TeamTable({
  profiles,
  isAdmin,
  myUserId,
}: {
  profiles: ProfileRow[];
  isAdmin: boolean;
  myUserId: string;
}) {
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function onChangeFeature(userId: string, feature: FeatureKey, enabled: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateUserFeatureAction({ userId, feature, enabled });
        if (result.error) setError(result.error);
      } catch {
        setError("Could not save feature access. Please try again.");
      }
    });
  }

  async function onChangeLevel(userId: string, newLevel: Level) {
    try {
      setBusyId(userId);
      setError(null);
      await updateUserLevelAction({ userId, level: newLevel });
    } catch {
      setError("Could not save the role. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-background/30 overflow-hidden">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <p className="font-semibold">Team Members</p>
          <p className="text-sm text-muted-foreground">
            Feature switches control section access. Roles control actions within each section.
            Admins always have access to every feature. New users need feature access enabled here.
          </p>
        </div>
      </div>

      {error && <p role="alert" className="p-4 text-sm text-destructive">{error}</p>}
      <p role="status" className="sr-only">{pending ? "Saving feature access" : ""}</p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Created</TableHead>
            {FEATURES.map((feature) => <TableHead key={feature.key}>{feature.label}</TableHead>)}
            {/* <TableHead className="text-right">Actions</TableHead> */}
          </TableRow>
        </TableHeader>

        <TableBody>
          {profiles.map((p) => {
            const lvl = toLevel(p.level);
            const role = ROLE[lvl];
            const email = p.email ?? p.id;
            const isMe = p.id === myUserId;
            const isBusy = busyId === p.id;

            return (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">
                  {email}
                  {isMe && (
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      (you)
                    </span>
                  )}
                </TableCell>

                <TableCell>
                  <div className="flex items-center gap-3">
                    <Badge variant={role.badge}>{role.label}</Badge>

                    {/* Admin can change levels */}
                    <Select
                      disabled={!isAdmin || isMe || busyId !== null || pending}
                      value={String(lvl)}
                      onValueChange={(v) =>
                        onChangeLevel(p.id, toLevel(Number(v)))
                      }
                    >
                      <SelectTrigger className="w-[180px] bg-background/40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Admin (Level 1)</SelectItem>
                        <SelectItem value="2">
                          Content Team (Level 2)
                        </SelectItem>
                        <SelectItem value="3">Basic (Level 3)</SelectItem>
                      </SelectContent>
                    </Select>

                    {isBusy && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>

                  {!isAdmin && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Only Admin can change roles.
                    </p>
                  )}
                  {isMe && isAdmin && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      You can’t change your own role here.
                    </p>
                  )}
                </TableCell>

                <TableCell className="text-sm text-muted-foreground">
                  {new Date(p.created_at).toLocaleString()}
                </TableCell>
                {FEATURES.map((feature) => {
                  const enabled = hasFeatureAccess(p, feature.key);
                  return <TableCell key={feature.key}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`${feature.label} access for ${email}`}
                      disabled={!isAdmin || lvl === 1 || busyId !== null || pending}
                      onClick={() => onChangeFeature(p.id, feature.key, !enabled)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${enabled ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                    >
                      <span aria-hidden className={`h-2 w-2 rounded-full ${enabled ? "bg-primary" : "bg-muted-foreground"}`} />
                      {enabled ? "On" : "Off"}
                    </button>
                    {lvl === 1 && <p className="mt-1 text-xs text-muted-foreground">Always enabled</p>}
                  </TableCell>;
                })}
              </TableRow>
            );
          })}

          {profiles.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={3 + FEATURES.length}
                className="py-10 text-center text-muted-foreground"
              >
                No profiles found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
