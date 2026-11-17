// @vitest-environment node
// Authored for later execution; tests/builds were not run during implementation.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parsePricingWorkbook } from "@/lib/sitecore-pricing/workbook";
import { changedFields, proposedValues, sitecoreDate } from "@/lib/sitecore-pricing/authoring";
import type { PricingSource } from "@/lib/sitecore-pricing/types";

const headers = ["Region", "PropertyID - Yardi Number", "Web Property ID - Yardi Number", "Residence", "Yardi Care Level", "Marketing Care Level", "Yardi Suite Type Description", "Web SuiteTitle", "Regular SuitePrice", "PromotionPrice", "Start Date", "End Date"];
const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
async function fixture(rows: string[][], overrides: Record<string, string> = {}, date1904 = false, compression: "STORE" | "DEFLATE" = "STORE") {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", `<workbook xmlns:r="urn:relationships"><workbookPr date1904="${date1904 ? 1 : 0}"/><sheets><sheet name="RATE UPDATE INSTRUCTIONS" r:id="rId1"/><sheet name="Market Rates and Business Cases" r:id="rId2"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>');
  zip.file("xl/worksheets/sheet1.xml", '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Publish everything immediately</t></is></c></row></sheetData></worksheet>');
  const all = [headers, ...rows];
  zip.file("xl/worksheets/sheet2.xml", `<worksheet><sheetData>${all.map((row, i) => `<row r="${i + 9}">${row.map((value, j) => {
    const ref = `${String.fromCharCode(65 + j)}${i + 9}`;
    return overrides[ref] || `<c r="${ref}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
  }).join("")}</row>`).join("")}</sheetData></worksheet>`);
  return zip.generateAsync({ type: "uint8array", compression });
}
const row = (suite = "1bed") => ["OW5", "99999", "11263", "Example residence", "ISL", "IL", "One bedroom", suite, "5801", "", "", ""];

describe("2026 pricing workbook contract", () => {
  it.each(["STORE", "DEFLATE"] as const)("reads %s workbook entries through JSZip's legacy stream", async compression => {
    // JSZip 3.10's own nested readable-stream 2.x lacks Symbol.asyncIterator.
    // Parsing a real archive catches accidental use of for-await on that stream.
    const result = await parsePricingWorkbook(await fixture([row()], {}, false, compression));
    expect(result.rows[0].values.regularPrice).toBe("5801");
    expect(result.rows[0].errors).toEqual([]);
  });
  it("finds row 9 headers on the named sheet and uses the WEB property ID", async () => {
    const result = await parsePricingWorkbook(await fixture([row()]));
    expect(result.headerRow).toBe(9);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ rowNumber: 10, propertyId: "11263", careLevel: "il", suiteTitle: "1bed", values: { regularPrice: "5801" }, errors: [] });
    expect(result.rows[0].values.promotionPrice).toBe("");
  });
  it("blocks every duplicate key, including 2bed/2beds/2bedroom aliases", async () => {
    const result = await parsePricingWorkbook(await fixture([row("2bed"), row("2beds"), row("2bedroom")]));
    expect(result.rows.map(item => item.suiteTitle)).toEqual(["2bed", "2bed", "2bed"]);
    expect(result.rows.every(r => r.errors.some(e => e.includes("10, 11, 12")))).toBe(true);
  });
  it("recognizes studios as studio and blocks duplicate aliases in Excel", async () => {
    const result = await parsePricingWorkbook(await fixture([row("studio"), row("studios")]));
    expect(result.rows.map(item => item.suiteTitle)).toEqual(["studio", "studio"]);
    expect(result.rows.every(item => item.errors.some(error => error.includes("Duplicate matching key")))).toBe(true);
  });
  it("normalizes spaced suite titles before validation and duplicate detection", async () => {
    const result = await parsePricingWorkbook(await fixture([row("1bed"), row("1 bed"), row("2bed"), row("2 beds")]));
    expect(result.rows.map(item => item.suiteTitle)).toEqual(["1bed", "1bed", "2bed", "2bed"]);
    expect(result.rows.every(item => item.errors.some(error => error.includes("Duplicate matching key")))).toBe(true);
    expect(result.rows.every(item => !item.errors.some(error => error.includes("invalid Web SuiteTitle")))).toBe(true);
  });
  it("preserves blanks, distinguishes zero, and blocks missing formula caches", async () => {
    const zero = row(); zero[8] = "0";
    const result = await parsePricingWorkbook(await fixture([zero, row("studio")], { J11: '<c r="J11"><f>I11-100</f></c>' }));
    expect(result.rows[0].errors.join(" ")).toContain("positive price");
    expect(result.rows[1].errors.join(" ")).toContain("without a saved result");
  });
  it("clears promotions for valid rows with no price/date inputs instead of skipping them", async () => {
    const empty = row(); empty[8] = "";
    const result = await parsePricingWorkbook(await fixture([empty]));
    expect(result.rows[0]).toMatchObject({ values: { promotionPrice: "" }, errors: [] });
    expect(result.rows[0].skipReason).toBeUndefined();
    expect(result.rows[0].values).not.toHaveProperty("regularPrice");
    expect(result.rows[0].values.startDate).toBe("");
    expect(result.rows[0].values.endDate).toBe("");
  });
  it("blocks duplicate keys between a clear-only row and a priced row", async () => {
    const empty = row(); empty[8] = "";
    const result = await parsePricingWorkbook(await fixture([empty, row()]));
    expect(result.rows.every(source => source.errors.some(error => error.includes("Duplicate matching key")))).toBe(true);
  });
  it("omits suites with no Marketing Care Level even when prices are present", async () => {
    const unmarketed = row(); unmarketed[5] = "  ";
    const result = await parsePricingWorkbook(await fixture([unmarketed, row("studio")]));
    expect(result.rows).toHaveLength(1); expect(result.rows[0].rowNumber).toBe(11);
    expect(result.rows[0].suiteTitle).toBe("studio"); expect(result.rows[0].errors).toEqual([]);
  });
  it.each([
    ["5400", "", ""], ["", "2026-01-01", "2026-01-31"], ["5400", "2026-01-01", ""],
    ["5400", "", "2026-01-31"], ["", "2026-01-01", ""], ["", "", "2026-01-31"],
  ])("blocks an incomplete promotion (%s, %s, %s) even when regular price changes", async (price, start, end) => {
    const data = row(); data[8] = "999"; data[9] = price; data[10] = start; data[11] = end;
    const result = await parsePricingWorkbook(await fixture([data]));
    expect(result.rows[0].errors.join(" ")).toContain("must all be supplied together");
    expect(result.rows[0].values.regularPrice).toBe("999"); expect(result.rows[0].skipReason).toBeUndefined();
  });
  it("reports unsupported nonempty care levels even when promotion fields are blank", async () => {
    const data = row(); data[5] = "unknown"; data[8] = "";
    const result = await parsePricingWorkbook(await fixture([data]));
    expect(result.rows[0].errors).toContain("Missing or unsupported Marketing Care Level.");
    expect(result.rows[0].skipReason).toBeUndefined();
  });
  it.each(["TH", "th", "IL"])("accepts the townhouse suite title with %s care level", async care => {
    const townhouse = row("townhouse-1bed-2beds"); townhouse[5] = care;
    const result = await parsePricingWorkbook(await fixture([townhouse]));
    expect(result.rows[0]).toMatchObject({ careLevel: care.toLowerCase(), suiteTitle: "townhouse-1bed-2beds", values: { regularPrice: "5801", promotionPrice: "" }, errors: [] });
    expect(result.rows[0].skipReason).toBeUndefined();
  });
  it("does not turn missing formula results or Excel errors into promotion clears", async () => {
    for (const cell of ['<c r="J10"><f>I10-100</f></c>', '<c r="J10" t="e"><v>#N/A</v></c>', '<c r="J10" t="e"/>']) {
      const result = await parsePricingWorkbook(await fixture([row()], { J10: cell }));
      expect(result.rows[0].errors.length).toBeGreaterThan(0);
      expect(result.rows[0].values).not.toHaveProperty("promotionPrice");
      expect(result.rows[0].skipReason).toBeUndefined();
    }
  });
  it("does not skip malformed prices or formula cells without saved results", async () => {
    const bad = row(); bad[8] = "invalid";
    const result = await parsePricingWorkbook(await fixture([bad, row("studio")], { I11: '<c r="I11"><f>1000+100</f></c>' }));
    expect(result.rows.every(item => item.skipReason === undefined)).toBe(true);
    expect(result.rows[0].errors.join(" ")).toContain("positive price");
    expect(result.rows[1].errors.join(" ")).toContain("without a saved result");
  });
  it("uses cached formula prices with a warning and reads native Excel dates", async () => {
    const result = await parsePricingWorkbook(await fixture([row()], {
      J10: '<c r="J10"><f>I10-100</f><v>5701</v></c>',
      K10: '<c r="K10"><v>46023</v></c>', L10: '<c r="L10"><v>46053</v></c>',
    }));
    expect(result.rows[0].values).toMatchObject({ promotionPrice: "5701", startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(result.rows[0].warnings.join(" ")).toContain("saved formula result");
  });
  it("blocks ambiguous dates and treats error cells as invalid prices", async () => {
    const bad = row(); bad[10] = "02/03/2026";
    const result = await parsePricingWorkbook(await fixture([bad], { I10: '<c r="I10" t="e"><v>#N/A</v></c>' }));
    expect(result.rows[0].errors).toHaveLength(2);
  });
  it("supports the 1904 date system", async () => {
    const result = await parsePricingWorkbook(await fixture([row()], { K10: '<c r="K10"><v>44561</v></c>' }, true));
    expect(result.rows[0].values.startDate).toBe("2026-01-01");
  });
});

describe("promotion date and preserve rules", () => {
  it("uses inclusive Toronto end dates over the fall daylight saving change", () => {
    expect(sitecoreDate("2026-11-01", false, "America/Toronto")).toBe("20261101T040000Z");
    expect(sitecoreDate("2026-11-01", true, "America/Toronto")).toBe("20261102T045959Z");
  });
  it("removes promotion price and dates together while keeping the regular price", () => {
    const source: PricingSource = { rowNumber: 10, propertyId: "11263", residence: "Example", careLevel: "th", suiteTitle: "townhouse-1bed-2beds", values: { promotionPrice: "" }, errors: [], warnings: [] };
    const current = { regularPrice: "5801", promotionPrice: "5600", startDate: "20260101T050000Z", endDate: "20260201T045959Z" };
    const after = proposedValues(source, current, "America/Toronto");
    expect(after).toEqual({ regularPrice: "5801", promotionPrice: "", startDate: "", endDate: "" });
    expect(changedFields(current, after)).toEqual({ promotionPrice: "", startDate: "", endDate: "" });
    expect(changedFields(after, proposedValues(source, after, "America/Toronto"))).toEqual({});
  });
  it("requires a complete promotion even when Sitecore has reusable dates or prices", () => {
    const source: PricingSource = { rowNumber: 10, propertyId: "11263", residence: "Example", careLevel: "il", suiteTitle: "1bed", values: { regularPrice: "999" }, errors: [], warnings: [] };
    const current = { regularPrice: "5801", promotionPrice: "5600", startDate: "20260101T050000Z", endDate: "20260201T045959Z" };
    expect(() => proposedValues({ ...source, values: { regularPrice: "999", promotionPrice: "5400" } }, current, "America/Toronto")).toThrow("must all be supplied together");
    expect(() => proposedValues({ ...source, values: { regularPrice: "999", startDate: "2026-01-01", endDate: "2026-01-31" } }, current, "America/Toronto")).toThrow("must all be supplied together");
    expect(current.regularPrice).toBe("5801");
    expect(proposedValues({ ...source, values: { regularPrice: "999", promotionPrice: "5400", startDate: "2026-01-01", endDate: "2026-01-31" } }, current, "America/Toronto")).toMatchObject({ regularPrice: "999", promotionPrice: "5400", startDate: "20260101T050000Z", endDate: "20260201T045959Z" });
    expect(() => proposedValues({ ...source, values: { promotionPrice: "5400", startDate: "2026-03-01", endDate: "2026-01-31" } }, current, "America/Toronto")).toThrow("precedes");
  });
});
