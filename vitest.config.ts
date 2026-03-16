import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules", ".next", "supabase/functions"],
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
      include: [
        "app/api/**/*.ts",
        "app/auth/callback/route.ts",
        "app/login/actions.ts",
        "app/team/team.actions.ts",
        "app/hooks/useDeleteVisitor.tsx",
        "app/hooks/useProfileLevel.ts",
        "app/hooks/useReplay.tsx",
        "app/const/userLevels.tsx",
        "app/helpers/fmtDate.tsx",
        "app/chatbot-content-management/helpers/index.ts",
        "components/NavLink/NavLink.tsx",
        "lib/utils.ts",
        "lib/chatbot/analyzerPrompt.ts",
      ],
      exclude: [
        "**/*.d.ts",
        "supabase/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
