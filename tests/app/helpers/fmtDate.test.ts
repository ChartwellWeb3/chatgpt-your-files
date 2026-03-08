import { describe, expect, it, vi } from "vitest";
import { fmtDate } from "@/app/helpers/fmtDate";

describe("fmtDate", () => {
  it("returns a formatted value for valid dates", () => {
    const result = fmtDate("2026-03-01T12:00:00.000Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe("2026-03-01T12:00:00.000Z");
  });

  it("returns an Invalid Date string for invalid inputs", () => {
    const result = fmtDate("not-a-date");
    expect(result).toContain("Invalid");
  });

  it("returns the original input if Date construction throws", () => {
    const RealDate = Date;

    class ThrowingDate extends RealDate {
      constructor(...args: any[]) {
        if (args[0] === "boom") {
          throw new Error("Date constructor failed");
        }
        super(...(args as ConstructorParameters<typeof Date>));
      }
    }

    vi.stubGlobal("Date", ThrowingDate as unknown as DateConstructor);

    expect(fmtDate("boom")).toBe("boom");

    vi.unstubAllGlobals();
  });
});
