import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    files: [
      "packages/*/src/**/*.ts",
      "packages/*/src/**/*.tsx",
      "scripts/**/*.ts",
      "vitest.config.mts",
    ],
    extends: [...tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["viewer/**/*.js", "packages/browser-ext/shared/**/*.js"],
    rules: {
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-useless-escape": "warn",
    },
  },
  {
    files: [
      "viewer/app.js",
      "packages/browser-ext/shared/app-extension-only.js",
    ],
    rules: {
      // These plain scripts are concatenated at build time and deliberately
      // share globals with the assembled runtime.
      "no-unused-vars": "off",
    },
  },
  {
    files: ["scripts/**/*.ts"],
    rules: {
      // Build and audit scripts use stdout as their user interface.
      "no-console": "off",
    },
  },
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/shared/app.js",
      "**/apex-parser-worker.js",
      ".claude/**",
    ],
  },
);
