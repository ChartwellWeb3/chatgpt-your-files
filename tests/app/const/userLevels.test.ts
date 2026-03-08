import { describe, expect, it } from "vitest";
import {
  LEVEL1_ALLOWED_PREFIXES,
  LEVEL2_ALLOWED_PREFIXES,
  LEVEL3_ALLOWED_PREFIXES,
} from "@/app/const/userLevels";

describe("userLevels", () => {
  it("keeps level 1 with API access", () => {
    expect(LEVEL1_ALLOWED_PREFIXES.some((item) => item.path === "/api")).toBe(true);
  });

  it("does not grant API access to levels 2 and 3", () => {
    expect(LEVEL2_ALLOWED_PREFIXES.some((item) => item.path === "/api")).toBe(false);
    expect(LEVEL3_ALLOWED_PREFIXES.some((item) => item.path === "/api")).toBe(false);
  });

  it("maintains increasing access by level", () => {
    expect(LEVEL1_ALLOWED_PREFIXES.length).toBeGreaterThan(LEVEL2_ALLOWED_PREFIXES.length);
    expect(LEVEL2_ALLOWED_PREFIXES.length).toBeGreaterThan(LEVEL3_ALLOWED_PREFIXES.length);
  });
});
