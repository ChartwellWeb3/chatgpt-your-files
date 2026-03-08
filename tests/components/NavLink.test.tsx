import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pathnameMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import NavLink from "@/components/NavLink/NavLink";

describe("NavLink", () => {
  beforeEach(() => {
    pathnameMock.mockReset();
  });

  it("renders active classes for exact route matches", () => {
    pathnameMock.mockReturnValue("/team");
    render(<NavLink href="/team">Team</NavLink>);

    expect(screen.getByRole("button", { name: "Team" })).toHaveClass("bg-green-600");
  });

  it("renders inactive classes for other routes", () => {
    pathnameMock.mockReturnValue("/chat-bot-analytics");
    render(<NavLink href="/team">Team</NavLink>);

    expect(screen.getByRole("button", { name: "Team" })).toHaveClass("bg-green-800");
  });
});
