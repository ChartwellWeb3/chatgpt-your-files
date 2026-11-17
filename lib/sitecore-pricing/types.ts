export const PRICE_FIELDS = ["regularPrice", "promotionPrice", "startDate", "endDate"] as const;
export const PRICING_ENVIRONMENTS = ["dev", "qa", "prod"] as const;
export const PRICING_CARE_LEVELS = ["il", "al", "mc", "sa", "ltc", "th"] as const;
export type PricingEnvironment = typeof PRICING_ENVIRONMENTS[number];
export type PriceField = typeof PRICE_FIELDS[number];
export type PriceValues = Partial<Record<PriceField, string>>;
export type PricingSource = {
  rowNumber: number; propertyId: string; residence: string; careLevel: string; suiteTitle: string;
  values: PriceValues; errors: string[]; warnings: string[]; skipReason?: "empty_update";
};
export type PricingRow = {
  id: string; import_id: string; row_number: number; language: "en" | "fr"; source: PricingSource;
  status: "invalid" | "pending" | "ready" | "unchanged" | "applying" | "applied" | "conflict" | "failed" | "skipped";
  item_id: string | null; item_path: string | null; item_version: number | null;
  before_values: PriceValues | null; after_values: PriceValues | null; revision: string | null;
  message: string | null; attempts: number;
  residence_item_id?: string | null; residence_path?: string | null;
};
export type PricingImport = {
  id: string; filename: string; file_sha256: string; sheet_name: string; created_at: string;
  created_by: string; approved_by: string | null; environment: PricingEnvironment; target_host: string;
  config_hash: string; status: "uploaded" | "preview_queued" | "previewing" | "review" | "apply_queued" | "applying" | "completed" | "failed" | "cancelled";
  phase: "preview" | "apply"; error_message: string | null; lease_token: string | null;
  lease_expires_at: string | null; heartbeat_at: string | null; finished_at: string | null;
  execution_mode?: "manual" | "edge_auto";
  edge_stage?: "catalog" | "expand" | "preview" | "apply" | "done";
  progress?: number;
  content_root?: string | null;
  run_requested_at?: string | null;
  run_requested_by?: string | null;
  production_confirmed_at?: string | null;
  production_confirmed_by?: string | null;
  production_confirmation_hash?: string | null;
};
// A batch deadline is a checkpoint boundary, never a row failure.
export class PricingBatchYield extends Error {}
export type PricingConfig = {
  environment: PricingEnvironment;
  host: string; endpoint: string; clientId: string; clientSecret: string; root: string; timezone: string;
  propertyTemplateId: string; suiteTemplateId: string; hash: string;
  fields: Record<PriceField, string>;
};
export class PricingError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.name = "PricingError"; this.status = status; }
}
export const EMPTY_PRICING_ROW_MESSAGE = "No price or date values supplied; skipped.";
export class MissingSuiteVersionError extends PricingError {
  constructor(language: "en" | "fr") {
    super(`No ${language === "en" ? "English" : "French"} SuitePlan version; skipped.`);
    this.name = "MissingSuiteVersionError";
  }
}
export class ContentFolderNotFoundError extends PricingError {
  constructor(path: string) { super(`Content folder not found: ${path}.`); this.name = "ContentFolderNotFoundError"; }
}
export class MissingSuiteFolderError extends PricingError {
  constructor(path: string) {
    super(`No SuitePlans folder for this care level; skipped. Path: ${path}`);
    this.name = "MissingSuiteFolderError";
  }
}
// Explicit aliases confirmed in the workbook and Sitecore content tree.
export const SUITE_ALIASES: Readonly<Record<string, string>> = {
  studios: "studio",
  "1 bed": "1bed",
  "2 beds": "2bed",
  "2beds": "2bed",
  "2bedroom": "2bed",
};
export const canonicalSuite = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return SUITE_ALIASES[normalized] || normalized;
};
export const normalizedId = (value: string) => value.replace(/[{}-]/g, "").toLowerCase();
