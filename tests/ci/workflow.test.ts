import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

function readWorkspaceFile(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

describe("CI configuration", () => {
  it("keeps the local ci script aligned with the required app checks", () => {
    const packageJson = JSON.parse(readWorkspaceFile("package.json")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.typecheck).toBe("tsc --noEmit");
    expect(packageJson.scripts?.ci).toContain("npm run typecheck");
    expect(packageJson.scripts?.ci).toContain("npm test");
    expect(packageJson.scripts?.ci).toContain("npm run build");
  });

  it("runs app and Supabase Edge Function checks in GitHub Actions", () => {
    const workflow = readWorkspaceFile(".github/workflows/ci.yml");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("denoland/setup-deno@v2");
    expect(workflow).toContain("deno check");
    expect(workflow).toContain("supabase/functions/analyze-conversations/index.ts");
    expect(workflow).toContain("supabase/functions/search-vector/index.ts");
  });
});
