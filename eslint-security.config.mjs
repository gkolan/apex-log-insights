import security from "eslint-plugin-security";

export default [
  {
    files: ["**/*.js", "**/*.ts"],
    plugins: { security },
    rules: {
      "security/detect-eval-with-expression": "warn",
      // Dynamic patterns are escaped at their construction sites; the rule
      // cannot distinguish those bounded inputs from raw user input.
      "security/detect-non-literal-regexp": "off",
      "security/detect-non-literal-require": "warn",
      // Report rendering intentionally indexes validated maps and arrays.
      // Prototype-sensitive maps use null prototypes at their trust boundary.
      "security/detect-object-injection": "off",
      "security/detect-possible-timing-attacks": "warn",
      // Parser expressions are covered by malformed-input and size-limit tests;
      // this heuristic flags their bounded alternations indiscriminately.
      "security/detect-unsafe-regex": "off",
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
