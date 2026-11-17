// @vitest-environment node
// Authored for later execution; tests/builds were not run during implementation.
import { describe, expect, it, vi } from "vitest";
import { SitecoreAuthoring, type SitecoreItem } from "@/lib/sitecore-pricing/authoring";
import { ContentFolderNotFoundError, MissingSuiteFolderError, MissingSuiteVersionError, type PricingConfig, type PricingRow, type PricingSource } from "@/lib/sitecore-pricing/types";

const root = "/sitecore/content/sxastarter/sxastarter/home/ab/calgary";
const config: PricingConfig = { environment: "dev", host: "https://dev.test", endpoint: "https://dev.test/sitecore/api/authoring/graphql/v1/", clientId: "id", clientSecret: "secret", root, timezone: "America/Toronto", propertyTemplateId: "property-template", suiteTemplateId: "suite-template", hash: "hash", fields: { regularPrice: "Regular SuitePrice", promotionPrice: "Promotion Price", startDate: "Start Date", endDate: "End Date" } };
const source: PricingSource = { rowNumber: 599, propertyId: "11295", residence: "The Edward", careLevel: "il", suiteTitle: "studio", values: { regularPrice: "4700" }, errors: [], warnings: [] };
const property = (name = "the-edward"): SitecoreItem => ({ id: name, name, path: `${root}/${name}`, templateId: config.propertyTemplateId, version: 1, language: "en", propertyId: source.propertyId, revision: "revision", locked: false, values: {}, fieldsPresent: false });
const suite = (name = "studios"): SitecoreItem => ({ id: name, name, path: `${root}/the-edward/Data/SuitePlans/il/${name}`, templateId: config.suiteTemplateId, version: 1, language: "en", propertyId: "", revision: "revision", locked: false, values: { regularPrice: "4500" }, fieldsPresent: true });

describe("Calgary SuitePlan matching", () => {
  it("sends an explicit empty promotion field to Sitecore without resetting regular prices or dates", async () => {
    const api = new SitecoreAuthoring(config); const target = suite();
    target.values = { regularPrice: "4500", promotionPrice: "4000", startDate: "20260101T050000Z", endDate: "20260201T045959Z" };
    const graphql = vi.spyOn(api, "graphql").mockResolvedValue({ updateItem: { item: { itemId: target.id } } });
    const row = { language: "en", after_values: { ...target.values, promotionPrice: "" } } as PricingRow;
    await api.update(row, target);
    expect(graphql).toHaveBeenCalledWith(expect.stringContaining("mutation PricingUpdate"), { input: { database: "master", itemId: target.id, language: "en", version: 1, fields: [{ name: "Promotion Price", value: "", reset: false }] } });
  });
  it("treats a missing residence care-level folder as a neutral skip", async () => {
    const api = new SitecoreAuthoring(config);
    vi.spyOn(api, "children").mockRejectedValue(new ContentFolderNotFoundError(`${property().path}/Data/SuitePlans/al`));
    await expect(api.resolve({ ...source, careLevel: "al" }, "en", [property()])).rejects.toBeInstanceOf(MissingSuiteFolderError);
  });
  it.each(["en", "fr"])("resolves a TH townhouse under SuitePlans/th in %s", async language => {
    const api = new SitecoreAuthoring(config);
    const folder = `${property().path}/Data/SuitePlans/th`;
    const target = { ...suite("townhouse-1bed-2beds"), language, path: `${folder}/townhouse-1bed-2beds` };
    const children = vi.spyOn(api, "children").mockResolvedValue([target]);
    const get = vi.spyOn(api, "get").mockResolvedValue(target);
    expect(await api.resolve({ ...source, careLevel: "th", suiteTitle: "townhouse-1bed-2beds" }, language, [property()])).toEqual(target);
    expect(children).toHaveBeenCalledWith(folder); expect(get).toHaveBeenCalledWith(target.id, language);
  });
  it("does not hide a missing catalog root as a row skip", async () => {
    const api = new SitecoreAuthoring(config);
    vi.spyOn(api, "verifyTemplates").mockResolvedValue({ property: property(), suite: suite() });
    vi.spyOn(api, "children").mockRejectedValue(new ContentFolderNotFoundError(root));
    await expect(api.residences()).rejects.toBeInstanceOf(ContentFolderNotFoundError);
  });
  it("skips missing or fallback versions for either requested language", () => {
    const api = new SitecoreAuthoring(config);
    expect(() => api.validateTarget(null, "fr")).toThrow(MissingSuiteVersionError);
    expect(() => api.validateTarget(suite(), "fr")).toThrow(MissingSuiteVersionError);
    expect(() => api.validateTarget({ ...suite(), language: "fr", version: 0 }, "fr")).toThrow(MissingSuiteVersionError);
    expect(() => api.validateTarget(null, "en")).toThrow("No English SuitePlan version; skipped.");
    expect(() => api.validateTarget({ ...suite(), language: "fr" }, "en")).toThrow(MissingSuiteVersionError);
    expect(() => api.validateTarget({ ...suite(), version: 0 }, "en")).toThrow(MissingSuiteVersionError);
  });
  it("matches the confirmed studios item-name alias", async () => {
    const api = new SitecoreAuthoring(config); const target = suite();
    vi.spyOn(api, "children").mockResolvedValue([target]);
    vi.spyOn(api, "get").mockResolvedValue(target);
    expect(await api.resolve(source, "en", [property()])).toEqual(target);
  });
  it.each(["2bed", "2beds", "2bedroom"])("matches %s to a Sitecore 2bedroom item", async title => {
    const api = new SitecoreAuthoring(config); const target = suite("2bedroom");
    vi.spyOn(api, "children").mockResolvedValue([suite("studios"), suite("1bed"), target]);
    vi.spyOn(api, "get").mockResolvedValue(target);
    expect(await api.resolve({ ...source, suiteTitle: title }, "en", [property()])).toEqual(target);
  });
  it.each([
    ["1bed", "1 bed"], ["2bed", "2 beds"], ["1 bed", "1bed"], ["2 beds", "2bedroom"],
  ])("matches the spaced suite alias %s to %s", async (title, itemName) => {
    const api = new SitecoreAuthoring(config); const target = suite(itemName);
    vi.spyOn(api, "children").mockResolvedValue([suite("deluxe-studio"), target]);
    vi.spyOn(api, "get").mockResolvedValue(target);
    expect(await api.resolve({ ...source, suiteTitle: title }, "en", [property()])).toEqual(target);
  });
  it.each([["2bed", "2bedroom"], ["1bed", "1 bed"], ["2bed", "2 beds"]])("blocks an ambiguous folder containing %s and %s", async (first, second) => {
    const api = new SitecoreAuthoring(config);
    vi.spyOn(api, "children").mockResolvedValue([suite(first), suite(second)]);
    await expect(api.resolve({ ...source, suiteTitle: first }, "en", [property()])).rejects.toThrow("More than one SuitePlan");
  });
  it("does not pick one of two residence items sharing a Web Property ID", async () => {
    const api = new SitecoreAuthoring(config);
    const get = vi.spyOn(api, "get").mockResolvedValue(null);
    const result = api.resolve(source, "en", [property(), property("the-edward-boutique")]);
    await expect(result).rejects.toThrow(`${root}/the-edward-boutique`);
    expect(get).not.toHaveBeenCalled();
  });
  it("blocks two SuitePlans that share one canonical title", async () => {
    const api = new SitecoreAuthoring(config);
    vi.spyOn(api, "children").mockResolvedValue([suite("studio"), suite("studios")]);
    await expect(api.resolve(source, "en", [property()])).rejects.toThrow("More than one SuitePlan");
  });
  it("distinguishes a wrong template filter from an absent suite name", async () => {
    const api = new SitecoreAuthoring(config);
    vi.spyOn(api, "children").mockResolvedValue([{ ...suite(), templateId: "other-template" }]);
    await expect(api.resolve(source, "en", [property()])).rejects.toThrow("none of its 1 items use the configured SuitePlan template");
  });
  it("reports the configured root when a national-workbook residence cannot match", async () => {
    const api = new SitecoreAuthoring(config);
    await expect(api.resolve({ ...source, propertyId: "11263", residence: "Allandale Station" }, "en", [property()])).rejects.toThrow(`under the configured root ${root}`);
  });
  it("rejects SuiteType credentials setup before a preview marks all rows invalid", async () => {
    const api = new SitecoreAuthoring(config);
    vi.spyOn(api, "connect").mockResolvedValue();
    vi.spyOn(api, "get").mockImplementation(async id => id === config.propertyTemplateId
      ? { ...property(), name: "PropertyPage", path: "/sitecore/templates/PropertyPage" }
      : { ...suite(), name: "SuiteType", path: "/sitecore/templates/SuiteType" });
    await expect(api.verifyTemplates()).rejects.toThrow('currently identifies "SuiteType"');
  });
});
