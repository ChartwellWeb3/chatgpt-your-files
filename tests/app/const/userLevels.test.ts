import { describe, expect, it } from "vitest";
import {
  LEVEL1_ALLOWED_PREFIXES,
  LEVEL2_ALLOWED_PREFIXES,
  LEVEL3_ALLOWED_PREFIXES,
} from "@/app/const/userLevels";

const isAllowedForPrefixes = (pathname: string, prefixes: { path: string }[]) =>
  prefixes.some((item) =>
    item.path === "/" ? pathname === "/" : pathname.startsWith(item.path),
  );

describe("userLevels", () => {
  it("keeps level 1 with API access", () => {
    expect(LEVEL1_ALLOWED_PREFIXES.some((item) => item.path === "/api")).toBe(true);
  });

  it("does not grant generic API access to levels 2 and 3", () => {
    expect(LEVEL2_ALLOWED_PREFIXES.some((item) => item.path === "/api")).toBe(false);
    expect(LEVEL3_ALLOWED_PREFIXES.some((item) => item.path === "/api")).toBe(false);
  });

  it("grants level 2 the specific Sitecore residence selector API", () => {
    expect(
      LEVEL2_ALLOWED_PREFIXES.some(
        (item) => item.path === "/api/sitecore/residence-selector",
      ),
    ).toBe(true);
    expect(
      LEVEL3_ALLOWED_PREFIXES.some(
        (item) => item.path === "/api/sitecore/residence-selector",
      ),
    ).toBe(false);
  });

  it("maintains increasing access by level", () => {
    const level2Paths = LEVEL2_ALLOWED_PREFIXES.map((item) => item.path);
    const level3Paths = LEVEL3_ALLOWED_PREFIXES.map((item) => item.path);

    expect(
      level2Paths.every((path) => isAllowedForPrefixes(path, LEVEL1_ALLOWED_PREFIXES)),
    ).toBe(true);
    expect(
      level3Paths.every((path) => isAllowedForPrefixes(path, LEVEL2_ALLOWED_PREFIXES)),
    ).toBe(true);
  });
});
