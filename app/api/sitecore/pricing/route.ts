import { createHash } from "node:crypto";
import { authorizePricing, checked, limitedBody, pricingFailure, pricingJson, pricingUuid, pricingSchemaStatus, pricingSchemaMessage } from "@/lib/sitecore-pricing/server";
import { getPricingConfig, pricingEnvironment } from "@/lib/sitecore-pricing/config";
import { SitecoreAuthoring } from "@/lib/sitecore-pricing/authoring";
import { pricingDispatchConfig, wakePricingEdge } from "@/lib/sitecore-pricing/dispatch";
import { MAX_WORKBOOK_BYTES, parsePricingWorkbook } from "@/lib/sitecore-pricing/workbook";
import { PricingError, type PricingImport, type PricingRow } from "@/lib/sitecore-pricing/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { db } = await authorizePricing();
    const params = new URL(request.url).searchParams; const view = params.get("view") || "bootstrap";
    const environment = pricingEnvironment(params.get("environment") || "dev");
    if (view === "bootstrap") {
      let setup: { ready: boolean; host?: string; root?: string; timezone?: string; message?: string; configHash?: string };
      try { const config = getPricingConfig(undefined, environment); pricingDispatchConfig(); setup = { ready: true, host: config.host, root: config.root, timezone: config.timezone, configHash: config.hash }; }
      catch (error) { if (!(error instanceof PricingError)) throw error; setup = { ready: false, message: error.message }; }
      const schema = await pricingSchemaStatus(db);
      if (!schema.ready) setup = { ...setup, ready: false, message: pricingSchemaMessage(schema) };
      const jobs = checked(await db.from("sitecore_pricing_imports").select("*").eq("environment", environment).order("created_at", { ascending: false }).limit(20));
      const worker = checked(await db.from("sitecore_pricing_runtime").select("last_seen_at,config_hash").eq("id", true).maybeSingle());
      return pricingJson({ setup, jobs, worker, environment });
    }
    const id = pricingUuid(params.get("id"));
    const job = checked(await db.from("sitecore_pricing_imports").select("*").eq("id", id).eq("environment", environment).maybeSingle()) as PricingImport | null;
    if (!job) throw new PricingError("Import not found.", 404);
    if (view === "export") {
      const rows: PricingRow[] = [];
      for (let start = 0; ; start += 1000) {
        const batch = checked(await db.from("sitecore_pricing_rows").select("*").eq("import_id", id).order("row_number").order("language").order("residence_path").order("id").range(start, start + 999)) as PricingRow[];
        rows.push(...batch); if (batch.length < 1000) break;
      }
      const csv = (v: unknown) => { let value = String(v ?? ""); if (/^[=+\-@\t\r]/.test(value)) value = `'${value}`; return `"${value.replace(/"/g, '""')}"`; };
      const fields = ["regularPrice", "promotionPrice", "startDate", "endDate"] as const;
      const lines = [["Excel row", "Web Property ID", "Residence", "Matched residence", "Care level", "Suite", "Language", "Status", "Sitecore item", ...fields.flatMap(f => [`Previous ${f}`, `Proposed ${f}`]), "Message", "Warnings"]];
      for (const row of rows) lines.push([String(row.row_number), row.source.propertyId, row.source.residence, row.residence_path || "", row.source.careLevel, row.source.suiteTitle, row.language, row.status, row.item_path || "", ...fields.flatMap(f => [row.before_values?.[f] || "", row.after_values?.[f] || ""]), row.message || "", row.status === "skipped" ? "" : row.source.warnings.join("; ")]);
      return new Response("\uFEFF" + lines.map(line => line.map(csv).join(",")).join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sitecore-${job.environment}-pricing-${id}.csv"`, "Cache-Control": "private, no-store" } });
    }
    if (view !== "import") throw new PricingError("Unknown pricing view.");
    const schema = await pricingSchemaStatus(db);
    if (!schema.ready) throw new PricingError(pricingSchemaMessage(schema), 503);
    const pageRaw = params.get("page") || "0";
    if (!/^\d{1,4}$/.test(pageRaw)) throw new PricingError("Invalid page.");
    const page = Number(pageRaw); const pageSize = 25;
    let query = db.from("sitecore_pricing_rows").select("*", { count: "exact" }).eq("import_id", id);
    if (params.get("developers") === "true") query = query.eq("developer_attention", true);
    const status = params.get("status");
    if (status) {
      if (!["invalid", "pending", "ready", "unchanged", "applying", "applied", "conflict", "failed", "skipped"].includes(status)) throw new PricingError("Invalid status filter.");
      query = query.eq("status", status);
    }
    const result = await query.order("row_number").order("language").order("residence_path").order("id").range(page * pageSize, (page + 1) * pageSize - 1);
    const rows = checked(result);
    const counts = checked(await db.rpc("sitecore_pricing_counts", { p_import_id: id }));
    const issues = await db.from("sitecore_pricing_rows").select("id", { count: "exact", head: true }).eq("import_id", id).eq("developer_attention", true);
    checked(issues);
    return pricingJson({ job, rows, counts, developerCount: issues.count || 0, total: result.count || 0, page, pageSize });
  } catch (error) { return pricingFailure(error); }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await authorizePricing(request);
    const contentType = request.headers.get("content-type") || "";
    if (contentType.startsWith("multipart/form-data")) {
      const bytes = await limitedBody(request, MAX_WORKBOOK_BYTES + 128 * 1024);
      let form: FormData;
      try { form = await new Response(new Uint8Array(bytes).buffer, { headers: { "Content-Type": contentType } }).formData(); } catch { throw new PricingError("Invalid workbook upload."); }
      const environment = pricingEnvironment(form.get("environment") || "dev");
      const config = getPricingConfig(undefined, environment);
      const file = form.get("file");
      if (!(file instanceof File) || !/\.xlsx$/i.test(file.name) || file.name.length > 240) throw new PricingError("Upload an XLSX workbook.");
      if (file.size > MAX_WORKBOOK_BYTES) throw new PricingError("Upload a workbook up to 10 MB.", 413);
      const workbookBytes = new Uint8Array(await file.arrayBuffer());
      const parsed = await parsePricingWorkbook(workbookBytes);
      pricingDispatchConfig();
      const id = checked(await db.rpc("sitecore_pricing_upload_environment", { p_environment: environment, p_filename: file.name, p_sha256: createHash("sha256").update(workbookBytes).digest("hex"), p_sheet: parsed.sheetName, p_host: config.host, p_config_hash: config.hash, p_actor: user.id, p_rows: parsed.rows, p_root: config.root }));
      return pricingJson({ id, sourceRows: parsed.rows.length }, 201);
    }
    if (!contentType.startsWith("application/json")) throw new PricingError("Use a workbook upload or JSON request.", 415);
    let input: Record<string, unknown>;
    try { input = JSON.parse(new TextDecoder().decode(await limitedBody(request, 3000))); } catch (error) { if (error instanceof PricingError) throw error; throw new PricingError("Invalid request."); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new PricingError("Invalid request.");
    const environment = pricingEnvironment(input.environment ?? "dev");
    if (input.action === "checkConnection") {
      const config = getPricingConfig(undefined, environment); const api = new SitecoreAuthoring(config);
      const root = await api.get(config.root, undefined, undefined, "metadata");
      const { property, suite } = await api.verifyTemplates();
      if (!root) throw new PricingError(`The ${environment.toUpperCase()} content root could not be found.`, 503);
      return pricingJson({ connected: true, host: config.host, root: root.path, propertyTemplate: property.name, suiteTemplate: suite.name });
    }
    const id = pricingUuid(input.id);
    if (!["run", "retry", "cancel"].includes(String(input.action))) throw new PricingError("Unknown pricing action.");
    const job = checked(await db.from("sitecore_pricing_imports").select("*").eq("id", id).eq("environment", environment).maybeSingle()) as PricingImport | null;
    if (!job) throw new PricingError("Import not found.", 404);
    if (input.action !== "cancel") {
      const config = getPricingConfig(undefined, job.environment);
      if (job.environment === "prod" && (input.confirmProduction !== true || input.confirmedHost !== job.target_host || input.confirmedConfigHash !== job.config_hash)) throw new PricingError("Confirm the production run and its current target before updating PROD prices.", 409);
      pricingDispatchConfig();
      if (job.execution_mode !== "edge_auto" || job.config_hash !== config.hash || job.target_host !== config.host) throw new PricingError(`Upload again to use the current ${job.environment.toUpperCase()} configuration.`, 409);
    }
    checked(await db.rpc("sitecore_pricing_environment_command", { p_import_id: id, p_action: input.action, p_actor: user.id, p_environment: job.environment, p_production_confirmed: input.confirmProduction === true }));
    const dispatchWarning = input.action === "cancel" ? null : await wakePricingEdge(job.environment);
    return pricingJson({ saved: true, dispatchWarning }, 202);
  } catch (error) { return pricingFailure(error); }
}

export async function DELETE(request: Request) {
  try {
    const { db, user } = await authorizePricing(request);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new PricingError("Use a JSON request.", 415);
    let input: { id?: unknown };
    try { input = JSON.parse(new TextDecoder().decode(await limitedBody(request, 1000))); }
    catch (error) { if (error instanceof PricingError) throw error; throw new PricingError("Invalid request."); }
    const id = pricingUuid(input?.id);
    const deleted = checked(await db.rpc("sitecore_pricing_delete_import", { p_import_id: id, p_actor: user.id }));
    return pricingJson({ deleted: Boolean(deleted), id });
  } catch (error) { return pricingFailure(error); }
}
