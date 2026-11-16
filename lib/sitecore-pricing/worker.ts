import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPricingConfig } from "./config.ts";
import { SitecoreAuthoring, proposedValues, sameValues } from "./authoring.ts";
import { EMPTY_PRICING_ROW_MESSAGE, MissingSuiteFolderError, MissingSuiteVersionError, PricingError, normalizedId, type PricingImport, type PricingRow } from "./types.ts";

function checked<T>(result: { data: T; error: unknown }): T { if (result.error) throw result.error; return result.data; }
function workerDatabase() {
  const url = process.env.PERFORMANCE_SUPABASE_URL?.trim(); const key = process.env.PERFORMANCE_SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) throw new PricingError("Configure PERFORMANCE_SUPABASE_URL and PERFORMANCE_SUPABASE_SECRET_KEY on the worker.", 503);
  if (new URL(url).origin === new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://unconfigured.invalid").origin) throw new PricingError("The worker database must be the separate performance project.", 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal || AbortSignal.timeout(20000), cache: "no-store" }) } });
}

async function processImport(db: SupabaseClient, api: SitecoreAuthoring, job: PricingImport) {
  if (job.config_hash !== api.config.hash || job.target_host !== api.config.host) throw new PricingError("Import configuration changed. Upload again for a fresh preview.");
  const heartbeat = async () => {
    const live = checked(await db.rpc("sitecore_pricing_heartbeat", { p_id: job.id, p_token: job.lease_token }));
    if (!live) throw new PricingError("The import lease was lost. This worker will not make further changes.", 409);
    checked(await db.rpc("sitecore_pricing_ping", { p_config_hash: api.config.hash }));
  };
  const save = async (row: PricingRow, result: Record<string, unknown>) => {
    const response = await db.rpc("sitecore_pricing_save_row", { p_id: job.id, p_token: job.lease_token, p_row_id: row.id, p_result: result });
    if (result.status === "skipped" && response.error && ["22023", "23514"].includes(response.error.code)) {
      throw new PricingError("Install 20261113213000_skip_missing_suite_versions.sql in the performance database, then retry this import.", 503);
    }
    checked(response);
  };
  await heartbeat();
  // Catalog reads can take several minutes. Renew the lease during those reads;
  // check it explicitly again before each mutation and every durable save.
  let leaseFailed = false;
  let renewing = false;
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    heartbeat().catch(() => { leaseFailed = true; }).finally(() => { renewing = false; });
  }, 20000);
  try {
    const residences = job.phase === "preview" ? await api.residences() : [];
    while (true) {
      if (leaseFailed) throw new PricingError("The worker heartbeat failed. Resume after the lease expires.", 503);
      await heartbeat();
      const rows = checked(await db.from("sitecore_pricing_rows").select("*").eq("import_id", job.id)
        .in("status", job.phase === "preview" ? ["pending"] : ["ready", "applying"]).order("row_number").order("language").order("residence_path").order("id").limit(1)) as PricingRow[];
      const row = rows[0]; if (!row) break;
      if (job.phase === "preview") {
        try {
          if (row.source.skipReason === "empty_update") { await save(row, { status: "skipped", message: EMPTY_PRICING_ROW_MESSAGE }); continue; }
          if (!row.residence_item_id) {
            const matches = residences.filter(item => item.propertyId === row.source.propertyId);
            if (!matches.length) throw new PricingError(`No residence has Web Property ID ${row.source.propertyId} under the configured root ${api.config.root}. Rows outside this scope cannot be updated by this import.`);
            checked(await db.rpc("sitecore_pricing_expand_row", { p_id: job.id, p_token: job.lease_token, p_row_id: row.id,
              p_residences: matches.map(item => ({ id: item.id, path: item.path })) }));
            continue;
          }
          const targets = residences.filter(item => normalizedId(item.id) === normalizedId(row.residence_item_id!) && item.propertyId === row.source.propertyId);
          const item = await api.resolve(row.source, row.language, targets);
          const after = proposedValues(row.source, item.values, api.config.timezone);
          await save(row, { status: sameValues(item.values, after) ? "unchanged" : "ready", item_id: item.id, item_path: item.path, item_version: item.version, revision: item.revision, before_values: item.values, after_values: after, message: null });
        } catch (error) {
          if (error instanceof MissingSuiteVersionError || error instanceof MissingSuiteFolderError) {
            await save(row, { status: "skipped", message: error.message }); continue;
          }
          if (!(error instanceof PricingError) || error.status >= 500 || error.status === 409) throw error;
          await save(row, { status: "invalid", message: error.message });
        }
      } else {
        try {
          if (!row.item_id || !row.before_values || !row.after_values) throw new PricingError("The saved preview is incomplete.");
          const current = await api.get(row.item_id, row.language);
          api.validateTarget(current, row.language);
          if (current.path !== row.item_path || current.version !== row.item_version) {
            await save(row, { status: "conflict", message: "The item moved or its latest version changed after preview. Upload again to review the latest content." }); continue;
          }
          // A lost response or worker restart must be reconciled before retrying.
          if (sameValues(current.values, row.after_values)) {
            await save(row, { status: "applied", message: "Verified the proposed values in Sitecore." }); continue;
          }
          if (current.revision !== row.revision || !sameValues(current.values, row.before_values)) {
            await save(row, { status: "conflict", message: "The item, version, or values changed after preview. Upload again to review the latest content." }); continue;
          }
          await heartbeat();
          if (leaseFailed) throw new PricingError("The worker lease is uncertain. Retry after it expires.", 503);
          // Persist intent before sending any mutation. Expired claims re-read Sitecore.
          await save(row, { status: "applying", message: "Update submitted; awaiting verification." });
          await api.update(row, current);
          const verified = await api.get(row.item_id, row.language);
          api.validateTarget(verified, row.language);
          if (verified.version !== row.item_version || verified.path !== row.item_path) throw new PricingError("Sitecore's version or path changed during the update. Review the item in Sitecore and upload a fresh preview.", 409);
          if (!sameValues(verified.values, row.after_values)) throw new PricingError("Read-back did not match the reviewed values. Retry to reconcile the result.", 503);
          await save(row, { status: "applied", message: "Updated and verified. Publishing remains separate." });
        } catch (error) {
          if (leaseFailed) throw error;
          if (error instanceof MissingSuiteVersionError || error instanceof MissingSuiteFolderError) {
            await save(row, { status: "skipped", message: error.message }); continue;
          }
          await save(row, { status: error instanceof PricingError && error.status < 500 ? "conflict" : "failed", message: error instanceof PricingError ? error.message : "The update could not be verified. Retry to reconcile the Sitecore values." });
          // Stop a service/authentication outage after the first failed target.
          // Explicit Retry resumes the remaining ready rows and reconciles this one.
          if (!(error instanceof PricingError) || error.status >= 500) throw error;
        }
      }
    }
    checked(await db.rpc("sitecore_pricing_finish", { p_id: job.id, p_token: job.lease_token }));
  } finally { clearInterval(timer); }
}

export async function pricingWorkerTick(): Promise<boolean> {
  const config = getPricingConfig(); const db = workerDatabase();
  checked(await db.rpc("sitecore_pricing_ping", { p_config_hash: config.hash }));
  const job = checked(await db.rpc("sitecore_pricing_claim", { p_config_hash: config.hash })) as PricingImport | null;
  if (!job) return false;
  try { await processImport(db, new SitecoreAuthoring(config), job); }
  catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const message = error instanceof PricingError ? error.message : ["42703", "42883", "PGRST202", "PGRST204"].includes(code)
      ? "Install 20261113223000_pricing_empty_rows_and_shared_property_ids.sql in the performance database, then retry the preview."
      : "The worker could not complete the import. Check database setup and connectivity, then retry.";
    const result = await db.rpc("sitecore_pricing_finish", { p_id: job.id, p_token: job.lease_token, p_error: message });
    if (result.error) console.error("Pricing import interrupted; its lease will expire", { importId: job.id });
    else console.error("Pricing import needs attention", { importId: job.id, message });
  }
  return true;
}
