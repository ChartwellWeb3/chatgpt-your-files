import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("lib/utils cn", () => {
  it("merges tailwind classes correctly", () => {
    expect(cn("px-2", "px-4", "text-sm")).toBe("px-4 text-sm");
  });

  it("ignores falsy class values", () => {
    expect(cn("font-bold", false && "hidden", undefined, "text-white")).toBe(
      "font-bold text-white",
    );
  });
});
