// app/team/team.actions.ts
"use server";

import { revalidatePath } from "next/cache";
// import  {createClient}  // adjust to your path
import { createClient } from "../utils/supabase/server";
import type { Level } from "./page";
// import { createClient } from '../utils/supabase/client';

export async function updateUserLevelAction(input: {
  userId: string;
  level: Level;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated.");

  // check caller is Admin
  const { data: caller } = await supabase
    .from("profiles")
    .select("level")
    .eq("id", user.id)
    .single();
  if ((caller?.level ?? 3) !== 1) throw new Error("Forbidden: Admin only.");

  // safety: prevent changing own role here
  if (input.userId === user.id)
    throw new Error("You cannot change your own role.");

  const { error } = await supabase
    .from("profiles")
    .update({ level: input.level })
    .eq("id", input.userId);

  if (error) throw new Error(error.message);

  revalidatePath("/team");
}

export async function removeUserDataAction(input: { userId: string }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated.");

  // check caller is Admin
  const { data: caller } = await supabase
    .from("profiles")
    .select("level")
    .eq("id", user.id)
    .single();
  if ((caller?.level ?? 3) !== 1) throw new Error("Forbidden: Admin only.");

  // safety: prevent deleting yourself
  if (input.userId === user.id)
    throw new Error("You cannot remove your own data.");

  /**
   * ✅ Remove app/user data
   * Add all your domain tables here (chat logs, trackers, etc.)
   * Example:
   * await supabase.from("chat_messages").delete().eq("user_id", input.userId);
   */

  // delete profile row
  const { error: profileErr } = await supabase
    .from("profiles")
    .delete()
    .eq("id", input.userId);
  if (profileErr) throw new Error(profileErr.message);

  /**
   * OPTIONAL:
   * Deleting from auth.users requires admin privileges (service role) and should be done on server only.
   * If you want that:
   * - create a separate supabase admin client using SUPABASE_SERVICE_ROLE_KEY
   * - call admin.auth.admin.deleteUser(input.userId)
   *
   * I’m not enabling it by default here to avoid accidental hard-deletes.
   */

  revalidatePath("/team");
}
