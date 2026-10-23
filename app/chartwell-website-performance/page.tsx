import PerformanceDashboard from "./performance-dashboard";
import { getPerformanceEnvironment, PerformanceConfigurationError } from "@/app/utils/supabase/performance-server";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function ChartwellWebsitePerformancePage() {
  let environment: ReturnType<typeof getPerformanceEnvironment>;
  try {
    environment = getPerformanceEnvironment();
  } catch (error) {
    if (!(error instanceof PerformanceConfigurationError)) throw error;
    return <div className="mx-auto w-full max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Chartwell website performance</h1>
      <Card role="alert"><CardContent className="p-5">
        <h2 className="text-sm font-medium">Performance environment is not configured</h2>
        <p className="mt-2 text-sm text-muted-foreground">Configure this deployment for QA or production to view performance data.</p>
      </CardContent></Card>
    </div>;
  }
  return <PerformanceDashboard key={environment} environment={environment} />;
}
