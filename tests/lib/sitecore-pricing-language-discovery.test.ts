// @vitest-environment node
// Supplied for later execution. Tests/builds are not run for this task.
import { describe, expect, it, vi } from "vitest";
import { SitecoreAuthoring } from "@/lib/sitecore-pricing/authoring";
import { ContentFolderNotFoundError, MissingResidenceVersionError, type PricingConfig } from "@/lib/sitecore-pricing/types";
const root = "/sitecore/content/Home";
const config: PricingConfig = { environment: "dev", host: "https://dev.test", endpoint: "https://dev.test/authoring", clientId: "id", clientSecret: "secret", root, timezone: "America/Toronto", propertyTemplateId: "property", suiteTemplateId: "suite", hash: "hash", fields: { regularPrice: "Regular SuitePrice", promotionPrice: "Promotion Price", startDate: "Start Date", endDate: "End Date" } };
const scalar = (name: string) => ({ kind: "SCALAR", name });
function raw(id: string, language: string, propertyId = "11295", templateId = "property", path = `${root}/${id}`) {
  return { itemId: id, name: id, path, template: { templateId }, pricingVersion: 1, pricingLanguage: language, propertyId: { value: propertyId }, revision: { value: "revision" }, lock: { value: "<r />" },
    regularPrice: { value: "4500", fieldId: "regular" }, promotionPrice: { value: "", fieldId: "promo" }, startDate: { value: "", fieldId: "start" }, endDate: { value: "", fieldId: "end" } };
}
function adapter(respond: (query: string, variables: Record<string, unknown>) => unknown) {
  const api = new SitecoreAuthoring(config);
  const graphql = vi.spyOn(api, "graphql").mockImplementation(async (query, variables = {}) => {
    if (query.includes("query PricingSchema")) return { __schema: { queryType: { fields: [{ name: "item", type: { kind: "OBJECT", name: "Item" }, args: [{ name: "where", type: { kind: "INPUT_OBJECT", name: "ItemWhere" } }] }] }, mutationType: { fields: [{ name: "updateItem", args: [{ name: "input", type: { kind: "INPUT_OBJECT", name: "UpdateItemInput" } }] }] } } };
    if (query.includes("query PricingType")) return { __type: { fields: variables.name === "Item" ? [{ name: "version", type: scalar("Int") }, { name: "language", type: scalar("String") }, { name: "template", type: { kind: "OBJECT", name: "Template" } }] : [{ name: "templateId", type: scalar("String") }] } };
    return respond(query, variables);
  });
  return { api, graphql };
}
describe("French-only pricing discovery and identity checks", () => {
  it("reads shared property identity from French when English is absent", async () => {
    const f = adapter((_query, variables) => ({ item: (variables.where as { language: string }).language === "fr" ? raw("residence", "fr") : null }));
    expect(await f.api.getProperty(`${root}/residence`)).toMatchObject({ id: "residence", language: "fr", propertyId: "11295" });
    expect(await f.api.getResidence("residence", "fr")).toMatchObject({ language: "fr", version: 1 });
    await expect(f.api.getResidence("residence", "en")).rejects.toBeInstanceOf(MissingResidenceVersionError);
    expect(f.graphql.mock.calls.some(([query]) => query.startsWith("mutation "))).toBe(false);
  });
  it("never treats a returned fallback language as an eligible residence version", async () => {
    const f = adapter(() => ({ item: raw("residence", "fr") }));
    await expect(f.api.getResidence("residence", "en")).rejects.toBeInstanceOf(MissingResidenceVersionError);
  });
  it("merges EN/FR catalogs and resumes their cursors independently", async () => {
    const f = adapter((_query, variables) => ({ item: { children: { nodes: [raw(variables.language === "fr" ? "french-only" : variables.after ? "english-second" : "english-first", String(variables.language))], pageInfo: { hasNextPage: variables.language === "en" && !variables.after, endCursor: variables.language === "en" && !variables.after ? "en-page-two" : null } } } }));
    const first = await f.api.childrenPage(root, null);
    expect(first.items.map(item => item.id)).toEqual(["english-first", "french-only"]);
    expect(JSON.parse(first.cursor!)).toEqual({ v: 1, en: "en-page-two", fr: false });
    const second = await f.api.childrenPage(root, first.cursor);
    expect(second.items.map(item => item.id)).toEqual(["english-second"]); expect(second.cursor).toBeNull();
    expect(f.graphql.mock.calls.filter(([query, variables]) => query.includes("query PricingCatalogPage") && variables?.language === "fr")).toHaveLength(1);
  });
  it("deduplicates bilingual items and prefers populated shared identity", async () => {
    const f = adapter((_query, variables) => ({ item: { children: { nodes: [raw("same-residence", String(variables.language), variables.language === "en" ? "" : "11295")], pageInfo: { hasNextPage: false, endCursor: null } } } }));
    const page = await f.api.childrenPage(root, null);
    expect(page.items).toHaveLength(1); expect(page.items[0].propertyId).toBe("11295");
  });
  it("does not hide inconsistent shared PropertyIDs", async () => {
    const f = adapter((_query, variables) => ({ item: raw("same-residence", String((variables.where as { language: string }).language), (variables.where as { language: string }).language === "en" ? "11295" : "99999") }));
    await expect(f.api.getProperty("same-residence")).rejects.toThrow("shared PropertyID differs");
  });
  it("finds a French-only SuitePlan folder and updates only its existing FR version", async () => {
    const folder = `${root}/residence/Data/SuitePlans/il`;
    const f = adapter((query, variables) => {
      if (query.includes("query PricingCatalogPage")) return { item: variables.language === "en" ? null : { children: { nodes: [raw("studio", "fr", "", "suite", `${folder}/studio`)], pageInfo: { hasNextPage: false, endCursor: null } } } };
      const where = variables.where as { language: string };
      return { item: where.language === "fr" ? raw("studio", "fr", "", "suite", `${folder}/studio`) : null };
    });
    const property = { id: "residence", name: "residence", path: `${root}/residence`, templateId: "property", version: 1, language: "fr", propertyId: "11295", revision: "revision", locked: false, fieldsPresent: false, values: {} };
    const source = { rowNumber: 10, propertyId: "11295", residence: "French residence", careLevel: "il", suiteTitle: "studio", values: { regularPrice: "999", promotionPrice: "", startDate: "", endDate: "" }, errors: [], warnings: [] };
    expect(await f.api.resolve(source, "fr", [property])).toMatchObject({ id: "studio", language: "fr", version: 1 });
  });
  it("reports a missing folder only after checking both languages", async () => {
    const f = adapter(() => ({ item: null }));
    await expect(f.api.childrenPage(root, null)).rejects.toBeInstanceOf(ContentFolderNotFoundError);
    expect(f.graphql.mock.calls.filter(([query]) => query.includes("query PricingCatalogPage"))).toHaveLength(2);
  });
});
