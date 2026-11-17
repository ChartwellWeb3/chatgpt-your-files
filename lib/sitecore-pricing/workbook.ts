import JSZip from "jszip";
import { SaxesParser } from "saxes";
import path from "node:path";
import { PricingError, PRICING_CARE_LEVELS, canonicalSuite, type PricingSource } from "./types.ts";

type Cell = { value: string; type: string; formula: boolean };
type SheetRow = { number: number; cells: Record<string, Cell> };
export const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;
const HEADERS = { propertyId: "Web Property ID - Yardi Number", residence: "Residence", careLevel: "Marketing Care Level", suiteTitle: "Web SuiteTitle", regularPrice: "Regular SuitePrice", promotionPrice: "PromotionPrice", startDate: "Start Date", endDate: "End Date" };
const normalize = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();

function parseXml(xml: string, open: (name: string, attrs: Record<string, string>) => void, text: (v: string) => void, close: (name: string) => void) {
  const parser = new SaxesParser({ xmlns: false });
  parser.on("doctype", () => { throw new PricingError("Workbook XML must not contain a document type."); });
  parser.on("opentag", tag => open(tag.name.split(":").pop()!, tag.attributes));
  parser.on("text", text); parser.on("cdata", text);
  parser.on("closetag", tag => close(tag.name.split(":").pop()!));
  try { parser.write(xml).close(); } catch (error) { if (error instanceof PricingError) throw error; throw new PricingError("The workbook contains invalid XML."); }
}

// Bound expanded XML as well as compressed uploads. Never follow external relationships.
async function readXml(zip: JSZip, name: string, budget: { bytes: number }): Promise<string> {
  const entry = zip.file(name);
  if (!entry) throw new PricingError(`Required workbook part is missing: ${name}.`);
  try {
    return await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []; let size = 0; let settled = false;
      // JSZip uses readable-stream 2.x, which has stream events but no async
      // iterator. Casting it to Node's Readable does not add that capability.
      const stream = entry.nodeStream("nodebuffer");
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        chunks.length = 0;
        stream.pause();
        if ("destroy" in stream && typeof stream.destroy === "function") stream.destroy();
        reject(error);
      };
      stream.on("error", fail);
      stream.on("end", () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
      stream.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length; budget.bytes += chunk.length;
        if (size > 24 * 1024 * 1024 || budget.bytes > 48 * 1024 * 1024) {
          fail(new PricingError("The expanded workbook is too large.", 413));
          return;
        }
        chunks.push(chunk);
      });
    });
  } catch (error) {
    if (error instanceof PricingError) throw error;
    throw new PricingError(`The workbook could not be decompressed (${name}).`);
  }
}

function worksheet(xml: string, strings: string[]): SheetRow[] {
  const rows: SheetRow[] = []; let row: SheetRow | null = null; let cell: Cell | null = null; let col = ""; let capture = false;
  parseXml(xml, (name, attrs) => {
    if (name === "row") { if (rows.length >= 5000) throw new PricingError("The pricing sheet exceeds 5,000 rows."); row = { number: Number(attrs.r), cells: {} }; }
    if (name === "c") { col = attrs.r?.replace(/\d/g, "") || ""; cell = { value: "", type: attrs.t || "n", formula: false }; }
    if (name === "f" && cell) cell.formula = true;
    if (name === "v" || name === "t") capture = true;
  }, value => { if (capture && cell) { cell.value += value; if (cell.value.length > 12000) throw new PricingError("A workbook cell is too long."); } }, name => {
    if (name === "v" || name === "t") capture = false;
    if (name === "c" && row && cell) { if (cell.type === "s") cell.value = strings[Number(cell.value)] ?? ""; row.cells[col] = cell; cell = null; }
    if (name === "row" && row) { if (!Number.isSafeInteger(row.number) || row.number < 1) throw new PricingError("Invalid worksheet row number."); rows.push(row); row = null; }
  });
  return rows;
}

function price(cell: Cell, label: string): string | undefined {
  if (!cell.value.trim()) { if (cell.formula) throw new Error(`${label} has a formula without a saved result. Recalculate and save in Excel.`); return; }
  const input = cell.value.trim().replace(/^\$\s*/, "");
  const value = input.replace(/,/g, "");
  if (cell.type === "e" || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(\.\d{1,2})?$/.test(input) || Number(value) <= 0 || Number(value) > 1000000) throw new Error(`${label} must be a positive price with at most two decimal places.`);
  return String(Number(value));
}

function calendarDay(cell: Cell, date1904: boolean): string | undefined {
  const value = cell.value.trim();
  if (!value) { if (cell.formula) throw new Error("A date formula has no saved result. Recalculate and save in Excel."); return; }
  let day: string;
  if (cell.type === "n" && /^\d+(\.\d+)?$/.test(value)) {
    const serial = Number(value);
    if (!Number.isInteger(serial)) throw new Error("Promotion dates must be whole calendar dates, without times.");
    if (!date1904 && serial === 60) throw new Error("Invalid Excel calendar date.");
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
    day = new Date(epoch + (serial - (!date1904 && serial > 60 ? 1 : 0)) * 86400000).toISOString().slice(0, 10);
  } else {
    day = value;
    if (cell.type === "d") day = value.replace(/T00:00:00(?:\.000)?Z?$/, "");
  }
  const parsed = new Date(`${day}T12:00:00Z`);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) throw new Error("Use an Excel date or an unambiguous YYYY-MM-DD promotion date.");
  return day;
}

export async function parsePricingWorkbook(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_WORKBOOK_BYTES) throw new PricingError("Upload an XLSX file up to 10 MB.", 413);
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new PricingError("Upload a valid, unencrypted XLSX workbook."); }
  if (Object.keys(zip.files).length > 2000 || zip.file("xl/vbaProject.bin")) throw new PricingError("Upload an XLSX workbook without macros.");
  const budget = { bytes: 0 }; const sheets: { name: string; relation: string }[] = []; let date1904 = false;
  parseXml(await readXml(zip, "xl/workbook.xml", budget), (name, attrs) => {
    if (name === "sheet") sheets.push({ name: attrs.name, relation: attrs["r:id"] });
    if (name === "workbookPr") date1904 = ["1", "true"].includes(attrs.date1904);
  }, () => {}, () => {});
  const sheet = sheets.find(s => s.name === "Market Rates and Business Cases");
  if (!sheet) throw new PricingError("The workbook must contain the Market Rates and Business Cases sheet.");
  let target = "";
  parseXml(await readXml(zip, "xl/_rels/workbook.xml.rels", budget), (name, attrs) => {
    if (name === "Relationship" && attrs.Id === sheet.relation && attrs.TargetMode !== "External") target = attrs.Target;
  }, () => {}, () => {});
  const part = target.startsWith("/") ? target.slice(1) : path.posix.normalize(`xl/${target}`);
  if (!/^xl\/worksheets\/[^/]+\.xml$/.test(part)) throw new PricingError("Invalid pricing worksheet relationship.");
  const strings: string[] = []; let current: string | null = null; let capture = false;
  if (zip.file("xl/sharedStrings.xml")) parseXml(await readXml(zip, "xl/sharedStrings.xml", budget), name => {
    if (name === "si") current = ""; if (name === "t") capture = true;
  }, value => { if (capture && current !== null) current += value; }, name => {
    if (name === "t") capture = false; if (name === "si" && current !== null) { strings.push(current); current = null; }
  });
  const raw = worksheet(await readXml(zip, part, budget), strings);
  const header = raw.slice(0, 30).find(row => Object.values(HEADERS).every(label => Object.values(row.cells).some(cell => normalize(cell.value) === normalize(label))));
  if (!header) throw new PricingError("The pricing sheet is missing required column headers.");
  const columns = Object.fromEntries(Object.entries(HEADERS).map(([key, label]) => {
    const matches = Object.entries(header.cells).filter(([, cell]) => normalize(cell.value) === normalize(label));
    if (matches.length !== 1) throw new PricingError(`Duplicate column header: ${label}.`);
    return [key, matches[0][0]];
  }));
  const rows: PricingSource[] = [];
  for (const row of raw.filter(r => r.number > header.number)) {
    const get = (key: keyof typeof HEADERS): Cell => row.cells[columns[key]] || { value: "", type: "n", formula: false };
    if (!Object.keys(HEADERS).some(key => get(key as keyof typeof HEADERS).value.trim())) continue;
    const source: PricingSource = { rowNumber: row.number, propertyId: get("propertyId").value.trim(), residence: get("residence").value.trim(), careLevel: get("careLevel").value.trim().toLowerCase(), suiteTitle: canonicalSuite(get("suiteTitle").value), values: {}, errors: [], warnings: [] };
    const updateFields = ["regularPrice", "promotionPrice", "startDate", "endDate"] as const;
    const noInputs = updateFields.every(field => { const cell = get(field); return !cell.value.trim() && !cell.formula && cell.type !== "e"; });
    if (!/^\d{1,12}$/.test(source.propertyId)) source.errors.push("Missing or invalid Web Property ID.");
    if (!PRICING_CARE_LEVELS.some(level => level === source.careLevel)) source.errors.push("Missing or unsupported Marketing Care Level.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.suiteTitle)) source.errors.push("Missing or invalid Web SuiteTitle.");
    // Keep note/incomplete rows with no update inputs as neutral skips. A valid
    // target with no inputs now has an actionable promotion-clear operation.
    if (noInputs && source.errors.length) source.skipReason = "empty_update";
    for (const field of ["regularPrice", "promotionPrice", "startDate", "endDate"] as const) {
      try {
        const cell = get(field);
        if (cell.type === "e") throw new Error(`${HEADERS[field]} contains an Excel error. Correct it before importing.`);
        const value = field.endsWith("Date") ? calendarDay(cell, date1904) : price(cell, HEADERS[field]);
        if (value !== undefined) source.values[field] = value;
        // An explicit empty string survives SQL empty-row detection and becomes
        // a normal audited field update. Never clear unresolved formula/error cells.
        else if (field === "promotionPrice" && !source.skipReason) source.values.promotionPrice = "";
        if (cell.formula) source.warnings.push(`${HEADERS[field]} uses Excel's saved formula result. Recalculate and save before uploading.`);
      } catch (error) { source.errors.push(error instanceof Error ? error.message : "Invalid cell value."); }
    }
    if (source.values.startDate && source.values.endDate && source.values.endDate < source.values.startDate) source.errors.push("Promotion end date precedes its start date.");
    if (source.values.promotionPrice && source.values.regularPrice && Number(source.values.promotionPrice) > Number(source.values.regularPrice)) source.warnings.push("Promotion price exceeds the regular price.");
    rows.push(source);
  }
  if (!rows.length) throw new PricingError("The pricing sheet has no data rows.");
  const keys = new Map<string, PricingSource[]>();
  for (const row of rows) { if (row.skipReason === "empty_update") continue; const key = `${row.propertyId}|${row.careLevel}|${row.suiteTitle}`; keys.set(key, [...(keys.get(key) || []), row]); }
  keys.forEach(duplicates => { if (duplicates.length > 1) for (const row of duplicates) row.errors.push(`Duplicate matching key on Excel rows ${duplicates.map(r => r.rowNumber).join(", ")}.`); });
  return { sheetName: sheet.name, headerRow: header.number, rows };
}
