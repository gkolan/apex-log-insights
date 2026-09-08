#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
).version;
const output = resolve(
  root,
  `packages/browser-ext/dist/firefox-source-v${version}.zip`,
);
const stagingRoot = mkdtempSync(
  join(tmpdir(), "apex-log-insights-firefox-source-"),
);
const staging = join(stagingRoot, `apex-log-insights-${version}-source`);

const include = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "LICENSE",
  "THIRD-PARTY-NOTICES.md",
  "scripts/assemble-extension-ui.ts",
  "packages/core/package.json",
  "packages/core/tsconfig.json",
  "packages/core/tsup.config.ts",
  "packages/core/src",
  "packages/browser-ext/FIREFOX-SOURCE-README.md",
  "packages/browser-ext/package.json",
  "packages/browser-ext/tsconfig.json",
  "packages/browser-ext/scripts/build-firefox.sh",
  "packages/browser-ext/manifests/firefox",
  "packages/browser-ext/src",
  "packages/browser-ext/shared",
  "viewer/app.js",
  "viewer/config.json",
  "viewer/index.html",
  "viewer/modules",
  "viewer/styles.css",
];

const generatedFiles = new Set([
  "packages/browser-ext/shared/app.js",
  "packages/browser-ext/shared/styles.css",
  "packages/browser-ext/shared/content/apex-parser-worker.js",
]);

try {
  for (const sourceRelative of include) {
    const source = resolve(root, sourceRelative);
    if (!existsSync(source)) {
      throw new Error(
        `Required Firefox source file is missing: ${sourceRelative}`,
      );
    }
    const destination = resolve(staging, sourceRelative);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, {
      recursive: true,
      filter: (candidate) => {
        const candidateRelative = relative(root, candidate);
        return !generatedFiles.has(candidateRelative);
      },
    });
  }

  const reviewerReadme = resolve(
    staging,
    "packages/browser-ext/FIREFOX-SOURCE-README.md",
  );
  const reviewerInstructions = readFileSync(reviewerReadme, "utf8").replaceAll(
    "{{VERSION}}",
    version,
  );
  if (reviewerInstructions.includes("{{VERSION}}")) {
    throw new Error(
      "Firefox reviewer instructions contain an unresolved version",
    );
  }
  writeFileSync(reviewerReadme, reviewerInstructions, "utf8");

  mkdirSync(dirname(output), { recursive: true });
  rmSync(output, { force: true });
  execFileSync("zip", ["-q", "-r", output, relative(stagingRoot, staging)], {
    cwd: stagingRoot,
  });
  console.log(`Firefox reviewer source: ${output}`);
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
