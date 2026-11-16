// @vitest-environment node
// Authored for later execution; tests/builds were not run during implementation.
import { describe, expect, it } from "vitest";
import { parseSitecoreLock } from "@/lib/sitecore-pricing/lock";

describe("Sitecore __Lock XML", () => {
  it.each([undefined, null, "", "  ", "<r />", "<r/>", "<r></r>", '<r owner="" date="20261113T120000Z" />'])
    ("does not treat an empty lock record as checked out: %s", value => {
      expect(parseSitecoreLock(value)).toEqual({ locked: false, known: true });
    });
  it("recognizes an actual lock and preserves its owner", () => {
    expect(parseSitecoreLock('<r owner="sitecore\\editor" date="20261113T120000Z" />')).toEqual({ locked: true, known: true, owner: "sitecore\\editor" });
  });
  it.each(["<r", "not XML", "<unexpected />", "<r><r /></r>", "<!DOCTYPE r><r />"])
    ("blocks unrecognized lock metadata: %s", value => {
      expect(parseSitecoreLock(value)).toEqual({ locked: true, known: false });
    });
});
