import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/__tests__/**/*.test.ts",
      "__tests__/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "viewer/modules/**/*.js"],
      exclude: ["**/__tests__/**", "**/*.test.ts", "**/index.ts"],
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        statements: 68,
        branches: 65,
        functions: 59,
        lines: 68,
        "packages/core/src/**": {
          statements: 70,
          branches: 60,
          functions: 40,
          lines: 70,
        },
        "packages/mcp/src/tools/**": {
          statements: 90,
          branches: 60,
          functions: 100,
          lines: 90,
        },
        "packages/browser-ext/src/worker-entry.ts": {
          statements: 80,
          branches: 50,
          functions: 90,
          lines: 80,
        },
        "packages/vscode-ext/src/{log-detection,parse-report,source-limits,webview-protocol}.ts":
          {
            statements: 90,
            branches: 80,
            functions: 90,
            lines: 90,
          },
      },
    },
  },
});
