import { redirect } from "next/navigation";
import { requirePricingUser } from "@/lib/sitecore-pricing/server";
import { PricingError } from "@/lib/sitecore-pricing/types";
import PricingDashboard from "./pricing-dashboard";

export const dynamic = "force-dynamic";
export default async function SitecorePricingPage() {
  try { await requirePricingUser(); }
  catch (error) {
    if (error instanceof PricingError && error.status === 401) redirect("/login");
    if (error instanceof PricingError && error.status === 403) redirect("/not-authorized");
    throw error;
  }
  return <PricingDashboard />;
}
