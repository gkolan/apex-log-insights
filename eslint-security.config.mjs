import security from "eslint-plugin-security";

export default [
  {
    files: ["**/*.js", "**/*.ts"],
    plugins: { security },
    rules: {
      "security/detect-eval-with-expression": "warn",
      "security/detect-non-literal-regexp": "warn",
      "security/detect-non-literal-require": "warn",
      "security/detect-object-injection": "warn",
      "security/detect-possible-timing-attacks": "warn",
      "security/detect-unsafe-regex": "warn",
      "security/detect-buffer-noassert": "warn",
      "security/detect-child-process": "warn",
      "security/detect-new-buffer": "warn",
      "security/detect-pseudoRandomBytes": "warn",
    },
  },
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.pnpm-store/**",
      "**/shared/app.js",
      "**/shared/app-extension-only.js",
      "**/_backup-pre-monorepo/**",
    ],
  },
];
