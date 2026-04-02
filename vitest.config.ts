import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      exclude: [
        ".tmp-runtime-dist/**",
        "artifacts/**",
        "scripts/**",
        "src/contracts/types.ts",
        "src/runtime/cli-main.ts",
        "src/skills/contracts.ts",
        "vitest.config.ts",
      ],
      reporter: ["text", "text-summary", "lcov"],
      thresholds: {
        lines: 100,
        statements: 100,
        functions: 100,
        branches: 100,
      },
    },
  },
});
