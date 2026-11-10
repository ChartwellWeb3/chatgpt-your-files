import { describe, expect, it } from "vitest";
import { EvidenceValidationError, MappingReviewRequired, normalizeMentions, providerEvidence } from "@/lib/geo/analysis";
import type { Brand } from "@/lib/geo/types";

const brand: Brand = { id: "chartwell-id", slug: "chartwell", name: "Chartwell", aliases: ["Chartwell Retirement Residences"], domains: ["chartwell.com"], is_chartwell: true };
const mention = (overrides: Record<string, unknown> = {}) => ({ brand_id: "chartwell-id", name: "Chartwell", observed_name: "Chartwell", is_recommendation: true, position: 2, evidence_quote: "2. Chartwell is an option.", ...overrides });
describe("GEO evidence extraction", () => {
  it("holds the whole answer for all unknown ownership pairs and preserves the extraction", () => {
    const text = "Chartwell. Example House. Another Residence.";
    const extraction = { mentions: [
      mention({ position: null, evidence_quote: "Chartwell" }),
      mention({ observed_name: "Example House", position: null, evidence_quote: "Example House" }),
      mention({ brand_id: null, name: "New Operator", observed_name: "Another Residence", position: null, evidence_quote: "Another Residence" }),
    ] };
    const original = structuredClone(extraction);
    let failure: unknown;
    try { normalizeMentions(extraction, text, [brand]); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(MappingReviewRequired);
    expect((failure as MappingReviewRequired).issues).toEqual([
      expect.objectContaining({ mention_index: 1, observed_name: "Example House", proposed_brand_id: brand.id, raw_mention: extraction.mentions[1] }),
      expect.objectContaining({ mention_index: 2, observed_name: "Another Residence", proposed_brand_id: null, proposed_brand_name: "New Operator" }),
    ]);
    expect(extraction).toEqual(original);
    expect(normalizeMentions(extraction, text, [{ ...brand, aliases: ["Example House"] },
      { ...brand, id: "new-id", slug: "new-operator", name: "New Operator", aliases: ["Another Residence"], is_chartwell: false }])).toHaveLength(2);
  });
  it("keeps fabricated quotes as hard failures even alongside unresolved ownership", () => {
    const extraction = { mentions: [
      mention({ observed_name: "Example House", position: null, evidence_quote: "Example House" }),
      mention({ position: null, evidence_quote: "Chartwell was recommended" }),
    ] };
    let failure: unknown;
    try { normalizeMentions(extraction, "Example House. Chartwell.", [brand]); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(EvidenceValidationError);
    expect(failure).not.toBeInstanceOf(MappingReviewRequired);
  });
  it("keeps exact supporting quotes and deduplicates parent brands", () => {
    const text = "2. Chartwell is an option.\nChartwell Retirement Residences also appears.";
    expect(normalizeMentions({ mentions: [mention(), mention({ observed_name: "Chartwell Retirement Residences", position: null, evidence_quote: "Chartwell Retirement Residences also appears." })] }, text, [brand]))
      .toHaveLength(1);
    expect(normalizeMentions({ mentions: [mention({ brand_id: null })] }, text, [brand])[0]).toMatchObject({ brand_id: "chartwell-id", position: 2 });
  });
  it("repairs the partial bold Amica quote while preserving the saved answer and raw analysis", () => {
    const amica: Brand = { id: "amica-id", slug: "amica", name: "Amica", aliases: [], domains: ["amica.ca"], is_chartwell: false };
    const text = "Options include **Amica Douglas House, Amica on the Gorge, Amica Somerset House, Berwick House, Berwick Royal Oak, and Wellesley Seniors Village**.";
    const extractedQuote = "**Amica Douglas House, Amica on the Gorge, Amica Somerset House**";
    const analysis = { mentions: [mention({ brand_id: amica.id, name: "Amica", observed_name: "Amica", is_recommendation: false, position: null, evidence_quote: extractedQuote })] };
    const result = normalizeMentions(analysis, text, [amica]);
    expect(result[0]).toMatchObject({ brand_id: amica.id, position: null, is_recommendation: false, evidence_quote: "Amica Douglas House, Amica on the Gorge, Amica Somerset House" });
    expect(text.includes(result[0].evidence_quote)).toBe(true);
    expect(analysis.mentions[0].evidence_quote).toBe(extractedQuote);
  });
  it.each(["**", "__", "*", "_", "***", "___"])("matches an exact saved phrase after removing outer %s markers", marker => {
    const text = "Chartwell is an option.";
    const result = normalizeMentions({ mentions: [mention({ position: null, evidence_quote: `${marker}${text}${marker}` })] }, text, [brand]);
    expect(result[0].evidence_quote).toBe(text);
  });
  it("preserves an already exact Markdown quote", () => {
    const quote = "**Chartwell**";
    expect(normalizeMentions({ mentions: [mention({ position: null, evidence_quote: quote })] }, `Consider ${quote} as an option.`, [brand])[0].evidence_quote).toBe(quote);
  });
  it.each(["**Chartwell is the best option.**", "**chartwell is an option.**", "**Chartwell, is an option.**", "**Chartwell **is** an option.**"])("rejects changed words, case, punctuation, or internal formatting in %s", evidence_quote => {
    expect(() => normalizeMentions({ mentions: [mention({ position: null, evidence_quote })] }, "Chartwell is an option.", [brand])).toThrow(/evidence quote.*verbatim/);
  });
  it("keeps ID, ownership, and ranking checks after repairing outer emphasis", () => {
    expect(() => normalizeMentions({ mentions: [mention({ brand_id: "someone-else", position: null, evidence_quote: "**Chartwell is an option.**" })] }, "Chartwell is an option.", [brand])).toThrow(/ID/);
    expect(() => normalizeMentions({ mentions: [mention({ observed_name: "Example House", position: null, evidence_quote: "**Example House**" })] }, "Example House", [brand])).toThrow(/ownership/);
    expect(() => normalizeMentions({ mentions: [mention({ evidence_quote: "**Chartwell is an option.**" })] }, "Chartwell is an option.", [brand])).toThrow(/rank/);
  });
  it("resolves a residence to its parent only when its name is a registered alias", () => {
    const sunrise: Brand = { id: "sunrise-id", slug: "sunrise-senior-living", name: "Sunrise Senior Living", aliases: [], domains: ["sunriseseniorliving.ca"], is_chartwell: false };
    const text = "- **Sunrise of Victoria** is an option.";
    const analysis = { mentions: [mention({ brand_id: sunrise.id, name: sunrise.name, observed_name: "Sunrise of Victoria", position: null, evidence_quote: text })] };
    expect(() => normalizeMentions(analysis, text, [sunrise])).toThrow(/ownership/);
    expect(normalizeMentions(analysis, text, [{ ...sunrise, aliases: ["Sunrise of Victoria"] }])[0])
      .toMatchObject({ brand_id: sunrise.id, name: sunrise.name, observed_name: "Sunrise of Victoria", position: null, evidence_quote: text });
  });
  it("does not assign ranks to unranked or negative mentions", () => {
    const text = "Chartwell is mentioned, without a recommendation.";
    const result = normalizeMentions({ mentions: [mention({ position: null, is_recommendation: false, evidence_quote: text })] }, text, [brand]);
    expect(result[0]).toMatchObject({ position: null, is_recommendation: false });
    expect(() => normalizeMentions({ mentions: [mention({ evidence_quote: text })] }, text, [brand])).toThrow(/rank/);
  });
  it("rejects fabricated evidence, unsupported IDs, and invalid ranks", () => {
    expect(() => normalizeMentions({ mentions: [mention()] }, "No brands here.", [brand])).toThrow(/evidence/);
    expect(() => normalizeMentions({ mentions: [mention({ brand_id: "someone-else" })] }, "2. Chartwell is an option.", [brand])).toThrow(/ID/);
    expect(() => normalizeMentions({ mentions: [mention({ position: 0 })] }, "2. Chartwell is an option.", [brand])).toThrow(/position/);
  });
  it("extracts actual citations and consulted URLs separately with safe ownership matching", () => {
    const response = { output: [
      { type: "web_search_call", status: "completed", action: { sources: [{ url: "https://chartwell.com/page?utm_source=search", title: "Chartwell page" }, { url: "https://chartwell.com.evil.test/page" }] } },
      { type: "message", content: [{ type: "output_text", text: "Answer [1]", annotations: [{ type: "url_citation", url: "https://www.chartwell.com/page?utm_source=search#section", title: "Citation", start_index: 7, end_index: 10 }, { type: "url_citation", url: "javascript:alert(1)" }] }] },
    ] };
    const evidence = providerEvidence(response, [brand]);
    expect(evidence.text).toBe("Answer [1]"); expect(evidence.searched).toBe(true);
    expect(evidence.sources).toHaveLength(3);
    expect(evidence.sources.find(row => row.source_kind === "cited")).toMatchObject({ normalized_url: "https://www.chartwell.com/page", citation_start: 7, citation_end: 10, owner_brand_id: "chartwell-id" });
    expect(evidence.sources.find(row => row.domain === "chartwell.com.evil.test")?.owner_brand_id).toBeNull();
  });
  it("preserves citation offsets across separate output-text blocks", () => {
    const result = providerEvidence({ output: [{ type: "message", content: [{ type: "output_text", text: "First", annotations: [] }, { type: "output_text", text: "Second[1]", annotations: [{ type: "url_citation", url: "https://example.com", start_index: 6, end_index: 9 }] }] }] }, []);
    expect(result.text).toBe("First\nSecond[1]");
    expect(result.sources[0]).toMatchObject({ citation_start: 12, citation_end: 15 });
    expect(result.searched).toBe(false);
  });
});
