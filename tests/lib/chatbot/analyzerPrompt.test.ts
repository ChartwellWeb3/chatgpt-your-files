import { describe, expect, it } from "vitest";
import { analyzerInstructions } from "@/lib/chatbot/analyzerPrompt";

describe("analyzerInstructions", () => {
  it("contains required output keys and rubric", () => {
    const text = analyzerInstructions();

    expect(text).toContain("satisfaction_1_to_10");
    expect(text).toContain("missed_or_weak_answers");
    expect(text).toContain("Scoring rubric");
    expect(text).toContain("JSON only");
  });
});
