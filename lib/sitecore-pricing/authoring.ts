import { ContentFolderNotFoundError, MissingSuiteFolderError, MissingSuiteVersionError, MissingResidenceVersionError, promotionInputError, PricingBatchYield, PricingError, normalizedId, canonicalSuite, PRICE_FIELDS, type PricingConfig, type PricingSource, type PriceValues, type PricingRow } from "./types.ts";
import { parseSitecoreLock } from "./lock.ts";

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
  const error = promotionInputError(source.values);
  if (error) throw new PricingError(error);
  const values = { ...current };
  for (const field of PRICE_FIELDS) if (source.values[field] !== undefined) {
    const value = source.values[field]!;
    values[field] = (field === "startDate" || field === "endDate") && value ? sitecoreDate(value, field === "endDate", timezone) : value;
  }
  if (source.values.promotionPrice === "") {
    values.promotionPrice = ""; values.startDate = ""; values.endDate = "";
  }
  if (values.promotionPrice && (!values.startDate || !values.endDate)) throw new PricingError("The resulting promotion needs both start and end dates. Blank cells preserve existing dates.");
  if ((values.promotionPrice || source.values.startDate || source.values.endDate) && values.startDate && values.endDate && values.endDate < values.startDate) throw new PricingError("The resulting promotion end date precedes its start date.");
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
  // Only identity/shared fields use a merged language view. Pricing reads and
  // mutations always use a verified, existing version in the requested language.
  private mergeIdentityItems(items: SitecoreItem[]): SitecoreItem[] {
    const merged = new Map<string, SitecoreItem>();
    for (const item of items) {
      const key = normalizedId(item.id); const previous = merged.get(key);
      if (previous && (previous.path !== item.path || normalizedId(previous.templateId) !== normalizedId(item.templateId)
        || (previous.propertyId && item.propertyId && previous.propertyId !== item.propertyId))) {
        throw new PricingError("The item identity or shared PropertyID differs between EN and FR. Refresh the import after checking Sitecore.", 503);
      }
      if (!previous || (!previous.propertyId && item.propertyId)) merged.set(key, item);
    }
    return Array.from(merged.values());
  }
  async getProperty(identifier: string): Promise<SitecoreItem | null> {
    const items = await Promise.all((["en", "fr"] as const).map(language => this.get(identifier, language, undefined, "property")));
    return this.mergeIdentityItems(items.filter((item): item is SitecoreItem => item !== null))[0] || null;
  }
  async getResidence(identifier: string, language: string): Promise<SitecoreItem> {
    const item = await this.get(identifier, language, undefined, "property");
    if (!item || item.language !== language || !Number.isInteger(item.version) || item.version < 1) throw new MissingResidenceVersionError(language);
    return item;
  }
  async children(parent: string): Promise<SitecoreItem[]> {
    const items: SitecoreItem[] = []; let after: string | null = null;
    for (let page = 0; page < 100; page++) {
      const result = await this.childrenPage(parent, after);
      items.push(...result.items);
      if (!result.cursor) return this.mergeIdentityItems(items);
      after = result.cursor;
    }
    throw new PricingError("The content folder is too large or its pagination is incomplete.");
  }
  // Both language cursors share the existing durable text checkpoint. No schema
  // change is needed, and a French-only item is never hidden by an English scan.
  async childrenPage(parent: string, after: string | null) {
    await this.connect();
    type Cursor = { en: string | null | false; fr: string | null | false };
    let cursors: Cursor = { en: null, fr: null };
    if (after !== null) {
      try {
        const saved = JSON.parse(after);
        if (!saved || saved.v !== 1 || !["en", "fr"].every(language => saved[language] === false || saved[language] === null || typeof saved[language] === "string")) throw new Error();
        cursors = { en: saved.en, fr: saved.fr };
      } catch { throw new PricingError("Invalid bilingual catalog checkpoint. Upload a new import.", 503); }
    }
    const pages = await Promise.all((["en", "fr"] as const).map(async language => {
      if (cursors[language] === false) return { language, exists: false, items: [] as SitecoreItem[], next: false as const };
      const result = await this.graphql<{ item: { children: { nodes: RawItem[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null }>(`query PricingCatalogPage($path:String!,$after:String,$language:String!){item(where:{database:"master",path:$path,language:$language}){children(first:100,after:$after){nodes{${this.selection} propertyId:field(name:"PropertyID"){value}} pageInfo{hasNextPage endCursor}}}}`, { path: parent, after: cursors[language], language });
      if (!result.item) return { language, exists: false, items: [] as SitecoreItem[], next: false as const };
      const { nodes, pageInfo } = result.item.children;
      if (pageInfo.hasNextPage && (!pageInfo.endCursor || pageInfo.endCursor === cursors[language])) throw new PricingError("The catalog pagination did not advance.", 503);
      return { language, exists: true, items: nodes.map(raw => this.item(raw)), next: pageInfo.hasNextPage ? pageInfo.endCursor! : false as const };
    }));
    if (after === null && !pages.some(page => page.exists)) throw new ContentFolderNotFoundError(parent);
    for (const page of pages) cursors[page.language] = page.next;
    return { items: this.mergeIdentityItems(pages.flatMap(page => page.items)), cursor: cursors.en === false && cursors.fr === false ? null : JSON.stringify({ v: 1, ...cursors }) };
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
          const property = await this.getProperty(child.id);
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
