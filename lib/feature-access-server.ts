import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/app/utils/supabase/server";
import { hasFeatureAccess, type FeatureKey } from "./feature-access";

export async function requireFeaturePage(feature: FeatureKey) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");
  if (!user.email_confirmed_at) redirect("/verify-email");
  const { data: profile, error: profileError } = await supabase.from("profiles")
    .select("level, feature_access").eq("id", user.id).single();
  if (profileError) throw new Error("Feature access could not be verified. Ask an administrator to check the access setup.");
  if (!hasFeatureAccess(profile, feature)) redirect("/not-authorized");
}
