import { NextResponse } from "next/server";
import { createClient } from "@/app/utils/supabase/server";
import { createPerformanceClient, getPerformanceEnvironment, PerformanceConfigurationError } from "@/app/utils/supabase/performance-server";

const deploymentColumns = "id,environment,source_build_number,source_branch,source_build_url,source_finished_at,commit_sha,vercel_deployment_id,deployment_url,base_url,deployment_changes,created_at";
const runColumns = "id,deployment_id,device,monitoring_build_id,monitoring_build_url,report_artifact_name,profile_fingerprint,status,started_at,finished_at,error_message,upload_status,created_at";
const pageColumns = "run_id,page_id,page_name,page_path,locale,status,performance_score,lcp_ms,tbt_ms,cls,fcp_ms,speed_index_ms,noisy,error_message,aggregate:result->aggregate,comparison:result->comparison,insights:result->insights,identity:result->identity";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: { message: string; code?: string }) => NextResponse.json({ error: error.message, code: error.code, kind: "database" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });

function torontoMidnight(day: string) {
  // Toronto's offset at 05:00 UTC is the offset at the start of this local day,
  // including both daylight-saving transition days.
  const offset = new Intl.DateTimeFormat("en", { timeZone: "America/Toronto", timeZoneName: "shortOffset" }).formatToParts(new Date(`${day}T05:00:00Z`)).find((part) => part.type === "timeZoneName")?.value;
  const hours = Number(offset?.replace("GMT", "") ?? -5);
  return new Date(Date.parse(`${day}T00:00:00Z`) - hours * 3600000).toISOString();
}

export async function GET(request: Request) {
  const authClient = await createClient();
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Sign in to view performance data." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });

  // All signed-in users from the original project may read performance data.
  // The separate server client uses elevated credentials and no user session.
  let supabase: ReturnType<typeof createPerformanceClient>;
  let environment: ReturnType<typeof getPerformanceEnvironment>;
  try {
    environment = getPerformanceEnvironment();
    supabase = createPerformanceClient();
  } catch (error) {
    if (!(error instanceof PerformanceConfigurationError)) throw error;
    return NextResponse.json({ error: error.message, code: "PERFORMANCE_NOT_CONFIGURED", kind: "configuration" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
  const params = new URL(request.url).searchParams;
  const view = params.get("view");
  if (view === "trend") {
    const device = params.get("device");
    const referenceRunId = params.get("referenceRunId");
    const selectedRunId = params.get("selectedRunId");
    const deploymentIds = Array.from(new Set((params.get("deploymentIds") ?? "").split(",").filter(Boolean)));
    const pageId = params.get("pageId");
    if (!referenceRunId || !uuid.test(referenceRunId) || (selectedRunId && !uuid.test(selectedRunId))
      || !deploymentIds.length || deploymentIds.length > 100 || deploymentIds.some((id) => !uuid.test(id))
      || (device !== "mobile" && device !== "desktop")
      || (params.has("pageId") && (!pageId?.trim() || !selectedRunId))) {
      return NextResponse.json({ error: "Invalid trend measurements or deployments." }, { status: 400 });
    }
    const args = {
      p_environment: environment,
      p_deployment_ids: deploymentIds,
      p_device: device,
      p_reference_run_id: referenceRunId,
      p_selected_run_id: selectedRunId || null,
    };
    const { data, error } = pageId
      ? await supabase.rpc("performance_page_trend", { ...args, p_page_id: pageId })
      : await supabase.rpc("performance_overall_trend", args);
    if (error?.code === "PGRST202" || error?.code === "42883") {
      return NextResponse.json({ error: "Performance trends need to be configured in the performance database.", code: "PERFORMANCE_TRENDS_NOT_INSTALLED", kind: "configuration" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
    if (error?.code === "22023") return NextResponse.json({ error: error.message }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
    if (error) return fail(error);
    return NextResponse.json({ points: data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (view === "summary" || view === "page") {
    const runId = params.get("runId");
    if (!runId || !uuid.test(runId)) return NextResponse.json({ error: "Invalid measurement ID." }, { status: 400 });
    if (view === "summary") {
      const { data, error } = await supabase.from("performance_runs").select("summary").eq("id", runId).maybeSingle();
      if (error) return fail(error);
      if (!data) return NextResponse.json({ error: "Measurement not found." }, { status: 404 });
      // Fetch a single summary on demand; omit duplicated page and commit payloads.
      const report = data.summary ?? {};
      const keys = ["mode", "status", "profile", "environment", "deviceProfile", "measurementId", "monitoringBuildId", "profileFingerprint", "startedAt", "finishedAt", "aliasVerifiedAt", "deployment", "toolchain", "measurement", "pageSelection", "authentication", "storage"];
      return NextResponse.json({ summary: Object.fromEntries(keys.filter((key) => report[key] !== undefined).map((key) => [key, report[key]])) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const pageId = params.get("pageId");
    if (!pageId) return NextResponse.json({ error: "A page ID is required." }, { status: 400 });
    let query = supabase.from("performance_page_results").select("result").eq("run_id", runId).eq("page_id", pageId);
    if (params.has("path")) query = query.eq("page_path", params.get("path"));
    query = params.get("locale") ? query.eq("locale", params.get("locale")) : query.is("locale", null);
    const { data, error } = await query.maybeSingle();
    if (error) return fail(error);
    if (!data) return NextResponse.json({ error: "Page result not found." }, { status: 404 });
    return NextResponse.json({ result: data.result }, { headers: { "Cache-Control": "private, no-store" } });
  }

  // One environment per app deployment; request parameters cannot change it.
  const deploymentId = params.get("deploymentId");
  if (deploymentId && !uuid.test(deploymentId)) return NextResponse.json({ error: "Invalid deployment ID." }, { status: 400 });
  const from = params.get("from");
  const to = params.get("to");
  if ([from, to].some((date) => date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) || (from && to && from > to)) return NextResponse.json({ error: "Choose a valid date range." }, { status: 400 });
  let query = supabase.from("performance_deployments").select(deploymentColumns).eq("environment", environment).order("source_finished_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(100);
  if (from) query = query.gte("source_finished_at", torontoMidnight(from));
  if (to) query = query.lt("source_finished_at", torontoMidnight(new Date(Date.parse(to) + 86400000).toISOString().slice(0, 10)));
  const { data: deployments, error: deploymentsError } = await query;
  if (deploymentsError) return fail(deploymentsError);
  const selected = deploymentId ? deployments?.find((d) => d.id === deploymentId) : deployments?.[0];
  const empty = { deployments: deployments ?? [], deployment: null, runs: [], pages: [], commits: [], historyRuns: [], historyPages: [] };
  if (!selected) return NextResponse.json(empty, { headers: { "Cache-Control": "private, no-store" } });
  const warnings: string[] = [];
  if (deployments?.length === 100) warnings.push("Showing the 100 most recent deployments in this range. Narrow the dates to inspect older deployments.");

  const { data: runs, error: runsError } = await supabase.from("performance_runs").select(runColumns).eq("deployment_id", selected.id).order("created_at", { ascending: false }).limit(100);
  if (runsError) return fail(runsError);
  if (runs?.length === 100) warnings.push("The latest 100 attempts for this deployment are shown.");
  const runIds = (runs ?? []).map((run) => run.id);
  let pages: unknown[] = [];
  if (runIds.length) {
    const { data, error } = await supabase.from("performance_page_results").select(pageColumns).in("run_id", runIds).order("page_name").limit(1000);
    if (error) return fail(error);
    pages = data ?? [];
    if (pages.length === 1000) warnings.push("The page list reached its query limit. Select a newer deployment to reduce the attempt count.");
  }
  const { data: commits, error: commitsError } = await supabase.from("performance_deployment_commits").select("deployment_id,commit_sha,short_sha,message,author,authored_at,azure_url,direction,position").eq("deployment_id", selected.id).order("position").limit(1000);
  // Embedded deployment_changes is also a supported source of commit history.
  if (commitsError) warnings.push("The normalized commit table is unavailable. Stored deployment changes are used when present.");

  const ids = (deployments ?? []).map((deployment) => deployment.id);
  const { data: historyRuns, error: historyError } = await supabase.from("performance_runs").select(runColumns).in("deployment_id", ids).order("created_at", { ascending: false }).limit(500);
  if (historyError) warnings.push("Historical measurements could not be loaded: " + historyError.message);
  if (historyRuns?.length === 500) warnings.push("The profile selector lists the latest 500 attempts. Trend calculations still cover every deployment in this range.");
  return NextResponse.json({ deployments, deployment: selected, runs: runs ?? [], pages, commits: commits ?? [], commitsUnavailable: !!commitsError, historyRuns: historyRuns ?? [], historyPages: [], warnings: Array.from(new Set(warnings)) }, { headers: { "Cache-Control": "private, no-store" } });
}

