// app/team/team.actions.ts
"use server";

import { revalidatePath } from "next/cache";
// import  {createClient}  // adjust to your path
import { createClient } from "../utils/supabase/server";
import type { Level } from "./page";
import { isFeatureKey, type FeatureKey } from "@/lib/feature-access";
// import { createClient } from '../utils/supabase/client';

export async function updateUserLevelAction(input: {
  userId: string;
  level: Level;
}) {
  if (![1, 2, 3].includes(input.level)) throw new Error("Invalid role.");
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

export async function updateUserFeatureAction(input: {
  userId: string;
  feature: FeatureKey;
  enabled: boolean;
}): Promise<{ error?: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.userId)
    || !isFeatureKey(input.feature) || typeof input.enabled !== "boolean") {
    return { error: "Invalid feature access change." };
  }
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user || !user.email_confirmed_at) return { error: "Sign in with a verified admin account." };
  const { data: caller, error: profileError } = await supabase.from("profiles")
    .select("level").eq("id", user.id).single();
  if (profileError || caller?.level !== 1) return { error: "Only admins can change feature access." };
  const { error } = await supabase.rpc("set_profile_feature_access", {
    p_user_id: input.userId, p_feature: input.feature, p_enabled: input.enabled,
  });
  if (error) return { error: "Could not save feature access. Check that the access migration is installed and the user is not an admin." };
  revalidatePath("/", "layout");
  return {};
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
