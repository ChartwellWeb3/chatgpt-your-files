import { getPerformanceEnvironment, PerformanceConfigurationError } from "@/app/utils/supabase/performance-server";
import GeoDashboard from "./geo-dashboard";
import { requireFeaturePage } from "@/lib/feature-access-server";

export const dynamic = "force-dynamic";
export default async function GeoPage() {
  await requireFeaturePage("ai_visibility");
  try {
    const environment = getPerformanceEnvironment();
    return <GeoDashboard key={environment} environment={environment} />;
  } catch (error) {
    if (!(error instanceof PerformanceConfigurationError)) throw error;
    return <div className="mx-auto max-w-[1500px] space-y-4 px-6 py-9"><h1 className="text-3xl font-semibold">Chartwell AI visibility</h1>
      <div role="alert" className="rounded-lg border p-6"><h2 className="font-medium">Environment setup required</h2>
        <p className="mt-2 text-sm text-muted-foreground">Configure this deployment for QA or production to open GEO monitoring.</p></div></div>;
  }
}
