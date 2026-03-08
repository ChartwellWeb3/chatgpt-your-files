import { describe, expect, it } from "vitest";
import { ChatbotLinks, Links } from "@/app/Links/Links";

describe("app/Links/Links", () => {
  it("includes prompt testing in chatbot links", () => {
    expect(ChatbotLinks.some((item) => item.href === "/chatbot-prompt-testing")).toBe(true);
  });

  it("keeps team management in utility links", () => {
    expect(Links).toContainEqual({ href: "/team", label: "Team Management" });
  });
});
