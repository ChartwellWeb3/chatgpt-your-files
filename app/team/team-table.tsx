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
import { updateUserLevelAction } from "./team.actions";
import type { Level } from "./page";

type ProfileRow = {
  id: string;
  level: number;
  created_at: string;
  email: string;
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

  async function onChangeLevel(userId: string, newLevel: Level) {
    try {
      setBusyId(userId);
      await updateUserLevelAction({ userId, level: newLevel });
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
            Levels control which areas a user can access. Only Admin can edit or
            remove user data.
          </p>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User ID</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Created</TableHead>
            {/* <TableHead className="text-right">Actions</TableHead> */}
          </TableRow>
        </TableHeader>

        <TableBody>
          {profiles.map((p) => {
            const lvl = toLevel(p.level);
            const role = ROLE[lvl];
            const email = p.email;
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
                      disabled={!isAdmin || isMe || isBusy}
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
              </TableRow>
            );
          })}

          {profiles.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={4}
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
