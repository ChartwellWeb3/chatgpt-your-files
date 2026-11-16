import type { SupabaseClient } from "@supabase/supabase-js";
import { SitecoreAuthoring, proposedValues, sameValues, type SitecoreItem } from "./authoring.ts";
import { MissingSuiteFolderError, MissingSuiteVersionError, PricingBatchYield, PricingError, normalizedId, type PricingImport, type PricingRow } from "./types.ts";

function data<T>(result: { data: T; error: unknown }): T { if (result.error) throw result.error; return result.data; }
type CatalogTask = { path: string; depth: number; cursor: string | null };
type CatalogResidence = { item_id: string; path: string; property_id: string };
const neutral = (error: unknown) => error instanceof MissingSuiteVersionError || error instanceof MissingSuiteFolderError;

// All writes go through leased RPCs. A deadline yields without failing a row;
// the next invocation resumes the exact saved stage, catalog page, or write.
export async function runPricingEdgeBatch(db: SupabaseClient, api: SitecoreAuthoring, budgetMs = 95000): Promise<boolean> {
  const started = Date.now(); api.deadline = started + Math.min(budgetMs, 95000);
  data(await db.rpc("sitecore_pricing_ping", { p_config_hash: api.config.hash }));
  let job = data(await db.rpc("sitecore_pricing_claim_environment", { p_environment: api.config.environment, p_config_hash: api.config.hash })) as PricingImport | null;
  if (!job) return false;
  const id = job.id; const token = job.lease_token;
  const ids = { p_id: id, p_token: token };
  const rpc = async (name: string, args: Record<string, unknown> = {}) => data(await db.rpc(name, { ...ids, ...args }));
  const heartbeat = async () => { if (!await rpc("sitecore_pricing_heartbeat")) throw new PricingError("Import lease lost; processing will resume after recovery.", 409); };
  const save = (row: PricingRow, result: Record<string, unknown>) => rpc("sitecore_pricing_save_row", { p_row_id: row.id, p_result: result });
  try {
    if (job.environment !== (api.config.environment) || (job.environment === "prod" && (!job.production_confirmed_by || !job.production_confirmed_at || job.production_confirmation_hash !== job.config_hash)) || job.config_hash !== api.config.hash || job.target_host !== api.config.host || job.content_root !== api.config.root || !job.run_requested_at) {
      throw new PricingError("Import configuration changed. Upload and run a new workbook.", 409);
    }
    await api.verifyTemplates();
    while (Date.now() + 35000 < api.deadline) {
      await heartbeat();
      if (job.edge_stage === "catalog") {
        const tasks = data(await db.from("sitecore_pricing_catalog_tasks").select("path,depth,cursor").eq("import_id", id).eq("done", false).order("depth").order("path").limit(1)) as CatalogTask[];
        const task = tasks[0];
        if (task) {
          // A residence itself is also a valid configured root.
          let root: SitecoreItem | null = null;
          if (task.path === api.config.root && task.cursor === null) {
            root = await api.get(task.path, undefined, undefined, "property");
            if (!root) throw new PricingError("The configured content root was not found.", 503);
          }
          const rootIsProperty = root && normalizedId(root.templateId) === normalizedId(api.config.propertyTemplateId);
          const page = rootIsProperty ? { items: [root!], cursor: null } : await api.childrenPage(task.path, task.cursor);
          const residences = page.items.filter(item => normalizedId(item.templateId) === normalizedId(api.config.propertyTemplateId));
          const folders = rootIsProperty || task.depth >= 3 ? [] : page.items.filter(item => normalizedId(item.templateId) !== normalizedId(api.config.propertyTemplateId) && item.name.toLowerCase() !== "data");
          await rpc("sitecore_pricing_catalog_page", { p_path: task.path, p_cursor: task.cursor, p_next: page.cursor,
            p_folders: folders.map(item => ({ path: item.path })), p_residences: residences.map(item => ({ id: item.id, path: item.path, propertyId: item.propertyId })) });
        }
      } else if (job.edge_stage === "expand" || job.edge_stage === "preview") {
        let query = db.from("sitecore_pricing_rows").select("*").eq("import_id", id).eq("status", "pending");
        if (job.edge_stage === "expand") query = query.is("residence_item_id", null);
        const rows = data(await query.order("row_number").order("language").order("residence_path").order("id").limit(1)) as PricingRow[];
        const row = rows[0];
        if (row) {
          try {
            if (job.edge_stage === "expand") {
              // Paginate: Supabase's normal 1000-row response cap must not omit
              // any residences sharing an ID. Expansion itself is capped at 2000.
              const matches: CatalogResidence[] = [];
              for (let offset = 0; ; offset += 1000) {
                const part = data(await db.from("sitecore_pricing_catalog").select("item_id,path,property_id").eq("import_id", id).eq("property_id", row.source.propertyId).order("item_id").range(offset, offset + 999)) as CatalogResidence[];
                matches.push(...part);
                if (matches.length > 2000) throw new PricingError("More than 2000 residences share this Web Property ID. Narrow the content root.");
                if (part.length < 1000) break;
              }
              if (!matches.length) throw new PricingError(`No residence has Web Property ID ${row.source.propertyId} under ${api.config.root}.`);
              await rpc("sitecore_pricing_expand_row", { p_row_id: row.id, p_residences: matches.map(item => ({ id: item.item_id, path: item.path })) });
            } else {
              if (!row.residence_item_id || !row.residence_path) throw new PricingError("The saved residence target is incomplete.", 503);
              const property = await api.get(row.residence_item_id, undefined, undefined, "property");
              if (!property || property.path !== row.residence_path || property.propertyId !== row.source.propertyId
                || normalizedId(property.templateId) !== normalizedId(api.config.propertyTemplateId)) throw new PricingError("The residence changed during discovery. Upload and run again.");
              const item = await api.resolve(row.source, row.language, [property]);
              const after = proposedValues(row.source, item.values, api.config.timezone);
              await save(row, { status: sameValues(item.values, after) ? "unchanged" : "ready", item_id: item.id, item_path: item.path,
                item_version: item.version, revision: item.revision, before_values: item.values, after_values: after, message: null });
            }
          } catch (error) {
            if (error instanceof PricingBatchYield) throw error;
            if (neutral(error)) await save(row, { status: "skipped", message: (error as Error).message });
            else if (error instanceof PricingError && error.status < 500 && error.status !== 409) await save(row, { status: "invalid", message: error.message });
            else throw error;
          }
        }
      } else if (job.edge_stage === "apply") {
        const rows = data(await db.from("sitecore_pricing_rows").select("*").eq("import_id", id).in("status", ["ready", "applying"])
          .order("row_number").order("language").order("residence_path").order("id").limit(1)) as PricingRow[];
        const row = rows[0];
        if (row) {
          try {
            if (!row.item_id || !row.before_values || !row.after_values || !row.residence_item_id) throw new PricingError("Saved update snapshot is incomplete.");
            const property = await api.get(row.residence_item_id, undefined, undefined, "property");
            if (!property || property.path !== row.residence_path || property.propertyId !== row.source.propertyId
              || normalizedId(property.templateId) !== normalizedId(api.config.propertyTemplateId)) throw new PricingError("The residence moved or its Web Property ID changed. Upload and run again.");
            const current = await api.get(row.item_id, row.language);
            const folder = `${row.residence_path}/Data/SuitePlans/${row.source.careLevel}`;
            api.validateTarget(current, row.language, folder);
            if (current.path !== row.item_path || current.version !== row.item_version) throw new PricingError("The SuitePlan moved or its version changed. Upload and run again.");
            if (sameValues(current.values, row.after_values)) {
              await save(row, { status: "applied", message: "Verified the requested values in Sitecore." });
            } else {
              if (current.revision !== row.revision || !sameValues(current.values, row.before_values)) throw new PricingError("The SuitePlan changed before the update. Upload and run again.");
              await heartbeat();
              await save(row, { status: "applying", message: "Update in progress; awaiting verification." });
              await api.update(row, current);
              const verified = await api.get(row.item_id, row.language);
              api.validateTarget(verified, row.language, folder);
              if (verified.version !== row.item_version || verified.path !== row.item_path) throw new PricingError("The SuitePlan path or version changed during the update.");
              if (!sameValues(verified.values, row.after_values)) throw new PricingError("The saved values could not be verified. Retry to reconcile the result.", 503);
              await save(row, { status: "applied", message: `Updated and verified in ${job.environment.toUpperCase()} authoring content.` });
            }
          } catch (error) {
            if (error instanceof PricingBatchYield) throw error;
            if (neutral(error)) await save(row, { status: "skipped", message: (error as Error).message });
            else {
              await save(row, { status: error instanceof PricingError && error.status < 500 ? "conflict" : "failed",
                message: error instanceof PricingError ? error.message : "Update interrupted. Retry to reconcile Sitecore values." });
              if (!(error instanceof PricingError) || error.status >= 500) throw error;
            }
          }
        }
      }
      job = await rpc("sitecore_pricing_edge_advance") as PricingImport;
      if (job.status === "completed") return true;
    }
  } catch (error) {
    if (!(error instanceof PricingBatchYield)) {
      const message = error instanceof PricingError ? error.message : "Pricing processing stopped. Check the Edge Function configuration, database setup, and connectivity; then retry.";
      // Never include provider response bodies, credentials, or raw exceptions.
      await rpc("sitecore_pricing_finish", { p_error: message });
      return true;
    }
  }
  await rpc("sitecore_pricing_edge_release");
  return true;
}
