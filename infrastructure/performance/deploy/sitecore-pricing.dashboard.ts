// Paste this ENTIRE file into the performance project's sitecore-pricing/index.ts.
// Generated distribution. No credentials included. JWT verification must be OFF;
// the handler verifies SITECORE_PRICING_DISPATCH_SECRET before any work.
export const PRICE_FIELDS = ["regularPrice", "promotionPrice", "startDate", "endDate"] as const;
export const PRICING_ENVIRONMENTS = ["dev", "qa", "prod"] as const;
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

import { createHash } from "node:crypto";

export function pricingEnvironment(value: unknown): PricingEnvironment {
  if (typeof value !== "string" || !PRICING_ENVIRONMENTS.includes(value as PricingEnvironment)) throw new PricingError("Select DEV, QA, or PROD.");
  return value as PricingEnvironment;
}

// Independent of PERFORMANCE_ENVIRONMENT and delivery credentials. Template,
// root and timezone settings are shared defaults, with per-environment overrides.
// CM hosts and automation credentials must always be environment-specific.
export function getPricingConfig(env: Record<string, string | undefined> = Deno.env.toObject(), environment: PricingEnvironment = "dev"): PricingConfig {
  pricingEnvironment(environment);
  const label = environment.toUpperCase();
  const prefix = `SITECORE_PRICING_${label}_`;
  const setting = (name: string) => env[prefix + name]?.trim() || env[`SITECORE_PRICING_${name}`]?.trim();
  const cmUrl = env[prefix + "CM_URL"]?.trim();
  if (!cmUrl) throw new PricingError(`Set ${prefix}CM_URL to the ${label} Content Management host, not Experience Edge.`, 503);
  let url: URL;
  try { url = new URL(cmUrl); } catch { throw new PricingError(`The ${label} Content Management URL is invalid.`, 503); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)
    || ["edge.sitecorecloud.io", "auth.sitecorecloud.io", "api.sitecorecloud.io", "xmclouddeploy-api.sitecorecloud.io"].includes(url.hostname)) {
    throw new PricingError(`Use the HTTPS origin of the ${label} Content Management host. Experience Edge and API URLs are not authoring hosts.`, 503);
  }
  for (const other of PRICING_ENVIRONMENTS) {
    if (other === environment) continue;
    const otherUrl = env[`SITECORE_PRICING_${other.toUpperCase()}_CM_URL`]?.trim();
    if (otherUrl) {
      let origin: string | undefined;
      try { origin = new URL(otherUrl).origin; } catch { /* The other environment reports its own invalid configuration. */ }
      if (origin === url.origin) throw new PricingError(`${label} and ${other.toUpperCase()} must use different Content Management hosts.`, 503);
    }
  }
  const clientId = env[prefix + "CLIENT_ID"]?.trim();
  const clientSecret = env[prefix + "CLIENT_SECRET"]?.trim();
  if (!clientId || !clientSecret) throw new PricingError(`Configure ${prefix}CLIENT_ID and ${prefix}CLIENT_SECRET on the app and Edge Function.`, 503);
  const propertyTemplateId = setting("PROPERTY_TEMPLATE_ID") || "";
  const suiteTemplateId = setting("SUITE_TEMPLATE_ID") || "";
  const guid = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;
  if (!guid.test(propertyTemplateId) || !guid.test(suiteTemplateId)) throw new PricingError(`Configure shared SITECORE_PRICING_PROPERTY_TEMPLATE_ID and SITECORE_PRICING_SUITE_TEMPLATE_ID, or ${prefix}PROPERTY_TEMPLATE_ID and ${prefix}SUITE_TEMPLATE_ID overrides, with GUIDs verified in ${label}.`, 503);
  const configuredRoot = setting("CONTENT_ROOT");
  if (!configuredRoot && environment !== "dev") throw new PricingError(`Set SITECORE_PRICING_CONTENT_ROOT or ${prefix}CONTENT_ROOT to the intended ${label} import scope.`, 503);
  const root = (configuredRoot || "/sitecore/content/sxastarter/sxastarter/home").replace(/\/$/, "");
  if (!root.startsWith("/sitecore/content/") || root.includes("..")) throw new PricingError("The pricing content root must be below /sitecore/content/.", 503);
  const timezone = setting("TIMEZONE") || "America/Toronto";
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { throw new PricingError("The pricing timezone is invalid.", 503); }
  const fields = { regularPrice: "Regular SuitePrice", promotionPrice: "Promotion Price", startDate: "Start Date", endDate: "End Date" };
  // Retain the DEV hash for already queued DEV jobs. QA/PROD include their
  // environment explicitly; no existing import can be retargeted by the UI.
  const hash = createHash("sha256").update(JSON.stringify({ execution: "edge-auto-v1", ...(environment === "dev" ? {} : { environment }), host: url.origin, root, timezone, propertyTemplateId, suiteTemplateId, fields, suiteAliases: SUITE_ALIASES, residenceMatches: "all", languages: ["en", "fr"], blanks: "preserve", endDate: "inclusive" })).digest("hex");
  return { environment, host: url.origin, endpoint: `${url.origin}/sitecore/api/authoring/graphql/v1/`, clientId, clientSecret, root, timezone, propertyTemplateId, suiteTemplateId, fields, hash };
}

import { SaxesParser } from "npm:saxes@6.0.0";

export type SitecoreLock = { locked: boolean; known: boolean; owner?: string };

// Sitecore can retain <r /> in __Lock after check-in. A nonempty XML value
// alone is not evidence of a lock; the owner attribute identifies a real lock.
export function parseSitecoreLock(value: string | null | undefined): SitecoreLock {
  const xml = value?.trim() || "";
  if (!xml) return { locked: false, known: true };
  if (xml.length > 16000) return { locked: true, known: false };
  let elements = 0; let valid = true; let owner = "";
  const parser = new SaxesParser({ xmlns: false });
  parser.on("doctype", () => { throw new Error("Unexpected lock document type"); });
  parser.on("opentag", tag => {
    elements++;
    if (elements !== 1 || tag.name !== "r") valid = false;
    if (elements === 1) owner = (tag.attributes.owner || "").trim();
  });
  parser.on("text", text => { if (text.trim()) valid = false; });
  parser.on("cdata", text => { if (text.trim()) valid = false; });
  try { parser.write(xml).close(); } catch { return { locked: true, known: false }; }
  if (!valid || elements !== 1) return { locked: true, known: false };
  return owner ? { locked: true, known: true, owner } : { locked: false, known: true };
}


type TypeRef = { kind: string; name: string | null; ofType?: TypeRef | null };
type SchemaField = { name: string; type: TypeRef; args?: { name: string; type: TypeRef }[] };
type SchemaType = { fields: SchemaField[] };
type RawItem = {
  itemId: string; name: string; path: string; template: Record<string, unknown>;
  pricingVersion: unknown; pricingLanguage: unknown; propertyId?: { value: string } | null;
  revision?: { value: string } | null; lock?: { value: string } | null;
  regularPrice?: { value: string; fieldId: string } | null; promotionPrice?: { value: string; fieldId: string } | null;
  startDate?: { value: string; fieldId: string } | null; endDate?: { value: string; fieldId: string } | null;
};
export type SitecoreItem = { id: string; name: string; path: string; templateId: string; version: number; language: string; propertyId: string; revision: string; locked: boolean; lockOwner?: string; lockStateKnown?: boolean; values: PriceValues; fieldsPresent: boolean };
const unwrap = (ref: TypeRef): TypeRef => ref.ofType ? unwrap(ref.ofType) : ref;
const refFields = "kind name ofType { kind name ofType { kind name } }";

export function sitecoreDate(day: string, end: boolean, timezone: string): string {
  const local = `${day}T${end ? "23:59:59" : "00:00:00"}`;
  let utc = Date.parse(`${local}Z`);
  for (let i = 0; i < 3; i++) {
    const offset = new Intl.DateTimeFormat("en", { timeZone: timezone, timeZoneName: "longOffset" }).formatToParts(new Date(utc)).find(p => p.type === "timeZoneName")?.value || "GMT";
    const match = offset.match(/^GMT([+-])(\d{2}):(\d{2})$/);
    const minutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1) : 0;
    utc = Date.parse(`${local}Z`) - minutes * 60000;
  }
  return new Date(utc).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function proposedValues(source: PricingSource, current: PriceValues, timezone: string): PriceValues {
  const values = { ...current };
  for (const field of PRICE_FIELDS) if (source.values[field] !== undefined) {
    const value = source.values[field]!;
    values[field] = field === "startDate" || field === "endDate" ? sitecoreDate(value, field === "endDate", timezone) : value;
  }
  if (values.promotionPrice && (!values.startDate || !values.endDate)) throw new PricingError("The resulting promotion needs both start and end dates. Blank cells preserve existing dates.");
  if (values.startDate && values.endDate && values.endDate < values.startDate) throw new PricingError("The resulting promotion end date precedes its start date.");
  return values;
}
export function sameValues(a: PriceValues, b: PriceValues): boolean { return PRICE_FIELDS.every(key => (a[key] || "") === (b[key] || "")); }
export function changedFields(before: PriceValues, after: PriceValues): PriceValues {
  return Object.fromEntries(PRICE_FIELDS.filter(key => (before[key] || "") !== (after[key] || "")).map(key => [key, after[key] || ""]));
}

export class SitecoreAuthoring {
  config: PricingConfig;
  deadline = Infinity;
  private token = ""; private tokenExpires = 0; private selection = "";
  private itemInput = ""; private updateInput = "";
  private versionMember: string | null = null; private languageMember: string | null = null; private templateMember = "";
  constructor(config: PricingConfig) { this.config = config; }

  private async bearer() {
    if (this.token && Date.now() < this.tokenExpires) return this.token;
    let response: Response;
    try {
      response = await fetch("https://auth.sitecorecloud.io/oauth/token", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audience: "https://api.sitecorecloud.io", grant_type: "client_credentials", client_id: this.config.clientId, client_secret: this.config.clientSecret }) });
    } catch { throw new PricingError("Unable to reach Sitecore authentication. Check the Edge Function network and environment credentials.", 503); }
    if (!response.ok) throw new PricingError("Sitecore rejected the environment automation credentials.", 503);
    const data = await response.json();
    if (typeof data.access_token !== "string" || !Number.isFinite(data.expires_in)) throw new PricingError("Sitecore returned an invalid authentication response.", 503);
    this.token = data.access_token; this.tokenExpires = Date.now() + Math.max(0, data.expires_in - 60) * 1000;
    return this.token;
  }
  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (Date.now() + 30000 > this.deadline) throw new PricingBatchYield();
    const token = await this.bearer(); let response: Response;
    try {
      response = await fetch(this.config.endpoint, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(25000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
    } catch { throw new PricingError("The Sitecore authoring request did not complete. Retry to reconcile saved values before any further update.", 503); }
    if (response.status === 401) { this.token = ""; throw new PricingError("Sitecore authorization expired. Retry the import.", 503); }
    if (!response.ok) throw new PricingError(`The Sitecore authoring API returned HTTP ${response.status}.`, 503);
    const result = await response.json();
    if (result.errors?.length || !result.data) throw new PricingError("The Sitecore authoring API rejected the operation. Verify the authoring schema, template fields, language versions, locks, and workflow permissions.", 503);
    return result.data as T;
  }
  private async type(name: string): Promise<SchemaType> {
    const result = await this.graphql<{ __type: SchemaType | null }>(`query PricingType($name:String!){__type(name:$name){fields{name type{${refFields}}}}}`, { name });
    if (!result.__type?.fields) throw new PricingError("The Sitecore authoring schema is unavailable. Enable schema introspection for this integration.", 503);
    return result.__type;
  }
  async connect(): Promise<void> {
    if (this.selection) return;
    const schema = await this.graphql<{ __schema: { queryType: { fields: SchemaField[] }; mutationType: { fields: SchemaField[] } } }>(`query PricingSchema{__schema{queryType{fields{name type{${refFields}} args{name type{${refFields}}}}} mutationType{fields{name args{name type{${refFields}}}}}}}`);
    const itemRef = schema.__schema.queryType.fields.find(f => f.name === "item");
    if (!itemRef) throw new PricingError("This is not an Authoring and Management GraphQL endpoint.", 503);
    this.itemInput = unwrap(itemRef.args?.find(a => a.name === "where")?.type || { kind: "", name: null }).name || "";
    this.updateInput = unwrap(schema.__schema.mutationType.fields.find(f => f.name === "updateItem")?.args?.find(a => a.name === "input")?.type || { kind: "", name: null }).name || "";
    if (!this.itemInput || !this.updateInput) throw new PricingError("The authoring API does not expose item queries and updates.", 503);
    const item = await this.type(unwrap(itemRef.type).name!);
    const accessor = async (name: string, alias: string, candidates: string[]): Promise<{ query: string; member: string | null }> => {
      const field = item.fields.find(f => f.name === name);
      if (!field) throw new PricingError(`The authoring schema must expose item ${name} metadata.`, 503);
      const type = unwrap(field.type);
      if (type.kind === "SCALAR" || type.kind === "ENUM") return { query: `${alias}:${name}`, member: null };
      const nested = await this.type(type.name!);
      const member = candidates.find(candidate => nested.fields.some(f => f.name === candidate && ["SCALAR", "ENUM"].includes(unwrap(f.type).kind)));
      if (!member) throw new PricingError(`Unsupported authoring ${name} metadata. Verify the environment API schema.`, 503);
      return { query: `${alias}:${name}{${member}}`, member };
    };
    const version = await accessor("version", "pricingVersion", ["number", "version"]);
    const language = await accessor("language", "pricingLanguage", ["name"]);
    const template = await accessor("template", "template", ["templateId", "itemId", "id"]);
    if (!template.member) throw new PricingError("The authoring API must expose a template identifier.", 503);
    this.versionMember = version.member; this.languageMember = language.member; this.templateMember = template.member;
    this.selection = `itemId name path ${version.query} ${language.query} ${template.query}
      revision:field(name:"__Revision"){value} lock:field(name:"__Lock"){value}`;
  }
  private item(raw: RawItem): SitecoreItem {
    const scalar = (value: unknown, member: string | null) => member && value && typeof value === "object" ? (value as Record<string, unknown>)[member] : value;
    const lock = parseSitecoreLock(raw.lock?.value);
    return { id: raw.itemId, name: raw.name, path: raw.path, templateId: String(raw.template[this.templateMember]), version: Number(scalar(raw.pricingVersion, this.versionMember)), language: String(scalar(raw.pricingLanguage, this.languageMember)), propertyId: raw.propertyId?.value?.trim() || "", revision: raw.revision?.value || "", locked: lock.locked, lockOwner: lock.owner, lockStateKnown: lock.known, values: Object.fromEntries(PRICE_FIELDS.map(key => [key, raw[key]?.value || ""])), fieldsPresent: PRICE_FIELDS.every(key => Boolean(raw[key]?.fieldId)) };
  }
  async get(identifier: string, language?: string, version?: number, fields: "pricing" | "property" | "metadata" = "pricing"): Promise<SitecoreItem | null> {
    await this.connect();
    const where: Record<string, unknown> = { database: "master", ...(identifier.startsWith("/") ? { path: identifier } : { itemId: identifier }), ...(language ? { language } : {}), ...(version ? { version } : {}) };
    const selection = fields === "property" ? 'propertyId:field(name:"PropertyID"){value}'
      : fields === "pricing" ? PRICE_FIELDS.map(key => `${key}:field(name:${JSON.stringify(this.config.fields[key])}){value fieldId}`).join("\n") : "";
    const result = await this.graphql<{ item: RawItem | null }>(`query PricingItem($where:${this.itemInput}!){item(where:$where){${this.selection} ${selection}}}`, { where });
    return result.item ? this.item(result.item) : null;
  }
  async children(parent: string): Promise<SitecoreItem[]> {
    await this.connect(); const items: SitecoreItem[] = []; let after: string | null = null;
    for (let page = 0; page < 100; page++) {
      const result: { item: { children: { nodes: RawItem[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null } = await this.graphql(`query PricingChildren($path:String!,$after:String){item(where:{database:"master",path:$path}){children(first:100,after:$after){nodes{${this.selection}} pageInfo{hasNextPage endCursor}}}}`, { path: parent, after });
      if (!result.item) throw new ContentFolderNotFoundError(parent);
      items.push(...result.item.children.nodes.map(raw => this.item(raw)));
      const info = result.item.children.pageInfo;
      if (!info.hasNextPage) return items;
      if (!info.endCursor || info.endCursor === after) break;
      after = info.endCursor;
    }
    throw new PricingError("The content folder is too large or its pagination is incomplete.");
  }
  // One durable catalog page per step, rather than scanning the full tree in
  // a function invocation. PropertyID is shared, so no language fallback is used.
  async childrenPage(parent: string, after: string | null) {
    await this.connect();
    const result = await this.graphql<{ item: { children: { nodes: RawItem[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null }>(`query PricingCatalogPage($path:String!,$after:String){item(where:{database:"master",path:$path}){children(first:100,after:$after){nodes{${this.selection} propertyId:field(name:"PropertyID"){value}} pageInfo{hasNextPage endCursor}}}}`, { path: parent, after });
    if (!result.item) throw new ContentFolderNotFoundError(parent);
    const { nodes, pageInfo } = result.item.children;
    if (pageInfo.hasNextPage && (!pageInfo.endCursor || pageInfo.endCursor === after)) throw new PricingError("The catalog pagination did not advance.", 503);
    return { items: nodes.map(raw => this.item(raw)), cursor: pageInfo.hasNextPage ? pageInfo.endCursor : null };
  }
  async verifyTemplates(): Promise<{ property: SitecoreItem; suite: SitecoreItem }> {
    await this.connect();
    const [property, suite] = await Promise.all([
      this.get(this.config.propertyTemplateId, undefined, undefined, "metadata"),
      this.get(this.config.suiteTemplateId, undefined, undefined, "metadata"),
    ]);
    for (const [key, expected, item] of [
      ["SITECORE_PRICING_PROPERTY_TEMPLATE_ID", "PropertyPage", property],
      ["SITECORE_PRICING_SUITE_TEMPLATE_ID", "SuitePlan", suite],
    ] as const) {
      if (!item?.path.toLowerCase().startsWith("/sitecore/templates/")) throw new PricingError(`${key} must identify the ${expected} template definition in the selected environment.`, 503);
      if (item.name.toLowerCase() !== expected.toLowerCase()) throw new PricingError(`${key} currently identifies "${item.name}". Select the "${expected}" template used by the actual content items and copy its Item ID.`, 503);
    }
    return { property: property!, suite: suite! };
  }
  async residences(): Promise<SitecoreItem[]> {
    await this.verifyTemplates();
    const queue = [{ path: this.config.root, depth: 0 }]; const residences: SitecoreItem[] = []; let visited = 0;
    while (queue.length) {
      const parent = queue.shift()!;
      if (++visited > 1500) throw new PricingError("The content tree is too large. Configure a narrower pricing content root.");
      for (const child of await this.children(parent.path)) {
        if (normalizedId(child.templateId) === normalizedId(this.config.propertyTemplateId)) {
          const property = await this.get(child.id, undefined, undefined, "property");
          if (!property) throw new PricingError("A residence changed while the catalog was being read. Retry the preview.", 503);
          residences.push(property);
        }
        else if (parent.depth < 3 && child.name.toLowerCase() !== "data") queue.push({ path: child.path, depth: parent.depth + 1 });
      }
    }
    if (!residences.length) throw new PricingError(`No PropertyPage items were found under ${this.config.root}. Check the content root and residence template ID before uploading again.`, 503);
    if (!residences.some(item => item.propertyId)) throw new PricingError(`Found ${residences.length} PropertyPage items, but none have a PropertyID value. Verify the Yardi field on the residence items.`, 503);
    return residences;
  }
  async resolve(source: PricingSource, language: string, residences: SitecoreItem[]): Promise<SitecoreItem> {
    const properties = residences.filter(item => item.propertyId === source.propertyId);
    if (properties.length !== 1) throw new PricingError(properties.length
      ? `More than one residence has Web Property ID ${source.propertyId}: ${properties.slice(0, 10).map(item => item.path).join(", ")}. Confirm the intended residence before importing.`
      : `No residence has Web Property ID ${source.propertyId} under the configured root ${this.config.root}. Rows outside this scope cannot be updated by this import.`);
    const folder = `${properties[0].path}/Data/SuitePlans/${source.careLevel}`;
    let children: SitecoreItem[];
    try { children = await this.children(folder); }
    catch (error) {
      if (error instanceof ContentFolderNotFoundError) throw new MissingSuiteFolderError(folder);
      throw error;
    }
    const suites = children.filter(item => normalizedId(item.templateId) === normalizedId(this.config.suiteTemplateId));
    const matches = suites.filter(item => canonicalSuite(item.name) === canonicalSuite(source.suiteTitle));
    if (matches.length !== 1) throw new PricingError(matches.length ? "More than one SuitePlan matches this care level and suite title."
      : suites.length ? `No SuitePlan matches "${source.suiteTitle}" in ${folder}. Available suite names: ${suites.slice(0, 12).map(item => item.name).join(", ")}.`
      : `The folder ${folder} exists, but none of its ${children.length} items use the configured SuitePlan template ${this.config.suiteTemplateId}. Check the template ID against an actual price item.`);
    const item = await this.get(matches[0].id, language);
    this.validateTarget(item, language, folder);
    return item!;
  }
  validateTarget(item: SitecoreItem | null, language: string, folder?: string): asserts item is SitecoreItem {
    if (!item || item.language !== language || !Number.isInteger(item.version) || item.version < 1) {
      if (language === "en" || language === "fr") throw new MissingSuiteVersionError(language);
      throw new PricingError(`No existing ${language.toUpperCase()} SuitePlan version. Language fallback is not eligible for updating.`);
    }
    if (normalizedId(item.templateId) !== normalizedId(this.config.suiteTemplateId) || !item.path.toLowerCase().startsWith(`${this.config.root.toLowerCase()}/`) || (folder && !item.path.toLowerCase().startsWith(`${folder.toLowerCase()}/`))) throw new PricingError("The target is outside the configured SuitePlan scope.");
    if (!item.fieldsPresent || !item.revision) throw new PricingError("The SuitePlan is missing pricing fields or revision metadata.");
    if (item.lockStateKnown === false) throw new PricingError("The SuitePlan lock metadata could not be verified. Check the item's __Lock field in Sitecore before trying again.", 503);
    if (item.locked) throw new PricingError(`The SuitePlan is locked${item.lockOwner ? ` by ${item.lockOwner}` : ""}. Have the editor save and unlock it in Sitecore, then create a new preview.`);
  }
  async update(row: PricingRow, current: SitecoreItem): Promise<void> {
    const changes = changedFields(current.values, row.after_values!);
    const input = { database: "master", itemId: current.id, language: row.language, version: current.version, fields: Object.entries(changes).map(([key, value]) => ({ name: this.config.fields[key as keyof PriceValues], value, reset: false })) };
    const result = await this.graphql<{ updateItem: { item: { itemId: string } | null } }>(`mutation PricingUpdate($input:${this.updateInput}!){updateItem(input:$input){item{itemId}}}`, { input });
    if (!result.updateItem?.item || normalizedId(result.updateItem.item.itemId) !== normalizedId(current.id)) throw new PricingError("Sitecore did not confirm the requested item update.", 503);
  }
}


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

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.88.0";

async function matchingSecret(actual: string, expected: string) {
  const hash = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([hash(actual), hash(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

Deno.serve(async request => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("SITECORE_PRICING_DISPATCH_SECRET") || "";
  if (secret.length < 32 || !await matchingSecret(request.headers.get("x-pricing-secret") || "", secret)) return new Response("Unauthorized", { status: 401 });
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return new Response("Pricing setup incomplete", { status: 503 });
  let requested;
  try {
    const body = await request.text();
    if (body.length > 1000) return new Response("Invalid request", { status: 400 });
    const input = body ? JSON.parse(body) : {};
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
    requested = input.environment === undefined ? undefined : pricingEnvironment(input.environment);
  } catch { return new Response("Invalid environment", { status: 400 }); }
  const configs: PricingConfig[] = [];
  for (const environment of requested ? [requested] : PRICING_ENVIRONMENTS) {
    try { configs.push(getPricingConfig(Deno.env.toObject(), environment)); }
    catch { if (requested) return new Response("Pricing environment configuration incomplete", { status: 503 }); }
  }
  if (!configs.length) return new Response("Pricing configuration incomplete", { status: 503 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal || AbortSignal.timeout(10000) }) } });
  // Respond quickly to the authenticated app or cron. Work still has a bounded
  // lifetime; every page/row is durable and cron recovers killed invocations.
  EdgeRuntime.waitUntil((async () => {
    try {
      // Separate hosts can progress together within one bounded wall-clock
      // window. A failure in one environment never interrupts another.
      const batches = await Promise.allSettled(configs.map(config => runPricingEdgeBatch(db, new SitecoreAuthoring(config))));
      const worked = batches.some(batch => batch.status === "fulfilled" && batch.value);
      if (batches.some(batch => batch.status === "rejected")) console.error("A pricing environment batch was interrupted; cron will recover its saved lease.");
      if (worked) {
        // Continue after releasing the lease. A failed wake is recovered by cron.
        // Batches do network work, so chaining stays well below the platform's
        // request recursion rate; cron is the independent recovery path.
        await fetch(`${url}/functions/v1/sitecore-pricing`, { method: "POST", headers: { "x-pricing-secret": secret, "Content-Type": "application/json" }, body: JSON.stringify(requested ? { environment: requested } : {}), signal: AbortSignal.timeout(10000) }).catch(() => {});
      }
    } catch { console.error("Pricing batch interrupted; saved work resumes after lease expiration."); }
  })());
  return Response.json({ accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
});
