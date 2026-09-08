#!/usr/bin/env tsx
/**
 * assemble-extension-ui.ts — Merge viewer sources into extension shared/ assets.
 *
 * This script handles ONLY the UI assembly step (no version bump, no zipping):
 *   1. Reads the viewer module files imported by app.js, strips export/import keywords,
 *      and inlines them so the extension can load everything as a single non-module script.
 *   2. Reads viewer/app.js, strips ESM import lines, and appends app-extension-only.js.
 *   3. Merges viewer/styles.css + styles-extension-only.css → shared/styles.css.
 *
 * Called automatically by the browser-ext `build` script so that `pnpm build`
 * (which runs `pnpm -r build`) keeps the extension UI in sync with the viewer.
 *
 * Also called by export-extension.ts as part of the full release pipeline.
 *
 * Usage:
 *   node --import tsx scripts/assemble-extension-ui.ts
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const extShared = resolve(root, "packages/browser-ext/shared");
const viewerDir = resolve(root, "viewer");
const modulesDir = resolve(viewerDir, "modules");

// Read current version from root package.json
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version: string = pkg.version;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read a viewer module file and convert it to a plain (non-ESM) script block
 * by stripping `export` keywords and `import` statements.
 */
function inlineModule(filename: string): string {
  const filePath = resolve(modulesDir, filename);
  if (!existsSync(filePath)) {
    throw new Error(
      `[assemble] Error: module ${filename} not found at ${filePath}`,
    );
  }
  let src = readFileSync(filePath, "utf8");
  const originalLength = src.length;
  // Remove both single-line and Prettier-formatted multiline imports.
  src = src.replace(
    /^import\s+(?:[\s\S]*?\s+from\s+)?["'][^"'\n]+["'];\s*/gm,
    "",
  );
  // Strip `export ` prefix from declarations (export function, export const, export async)
  src = src.replace(/^export\s+/gm, "");
  // Remove top-level const blocks that duplicate declarations in viewer/app.js.
  // DEFAULT_REDACTION_SETTINGS is defined in both redact-pii.js and viewer/app.js.
  src = src.replace(
    /^const DEFAULT_REDACTION_SETTINGS\s*=\s*\{[\s\S]*?\};\s*/m,
    "",
  );

  src = src.trim();

  // Validate output is not empty or suspiciously small
  if (!src) {
    throw new Error(
      `[assemble] Error: module ${filename} became empty after processing. ` +
        `Check that it contains valid declarations.`,
    );
  }
  if (src.length < originalLength * 0.1) {
    console.warn(
      `[assemble] Warning: module ${filename} shrank by >90% ` +
        `(${originalLength} → ${src.length} bytes). Output may be incomplete.`,
    );
  }

  return src;
}

// ─── 1. Merge app.js ──────────────────────────────────────────────────────────

const appJsPath = resolve(viewerDir, "app.js");
let viewerContent = readFileSync(appJsPath, "utf8");
const marker = viewerContent.indexOf("// === VIEWER_INIT_START ===");
if (marker === -1) {
  console.error("Error: VIEWER_INIT_START marker missing from viewer/app.js");
  process.exit(1);
}
// Take everything before the viewer-only init block
viewerContent = viewerContent.slice(0, marker).trimEnd();

// Strip both single-line and Prettier-formatted multiline ESM imports. The
// extension bundle inlines those modules below and runs as a plain script.
viewerContent = viewerContent
  .replace(/^import\s+(?:[\s\S]*?\s+from\s+)?["'][^"'\n]+["'];\s*/gm, "")
  .replace(/^export\s+/gm, "")
  .trimStart();

// Inline the viewer module files that app.js imports.
// Order matters: shared-format before shared-evidence (evidence imports escapeHtml).
const inlinedModules = [
  "shared-format.js",
  "redact-pii.js",
  "shared-dom.js",
  "shared-evidence.js",
  "sidebar.js",
  "compare-reports.js",
  "investigation-summary.js",
  "normalize-helpers.js",
  "normalize-evidence-mapping.js",
  "normalize-database.js",
  "normalize-execution.js",
  "normalize-summary-diagnostics.js",
  "normalize-report.js",
  "render-limits.js",
  "render-queries.js",
  "render-triage.js",
  "render-execution.js",
  "render-data.js",
  "render-diagnostics.js",
  "render-evidence.js",
]
  .map(inlineModule)
  .filter(Boolean)
  .join("\n\n");

const overlayPath = resolve(extShared, "app-extension-only.js");
if (!existsSync(overlayPath)) {
  console.error("Error: shared/app-extension-only.js not found");
  process.exit(1);
}
const overlay = readFileSync(overlayPath, "utf8");

const header = `/**\n * GENERATED — DO NOT EDIT.\n * Version: ${version}\n * Source: viewer/app.js + viewer/modules/* + shared/app-extension-only.js\n */\n`;
const assembled = [
  header,
  viewerContent,
  "\n// ─── Inlined viewer modules (ESM exports stripped) ──────────────────────────\n",
  inlinedModules,
  "\n// ─── Extension-only overlay ──────────────────────────────────────────────────\n",
  overlay,
].join("\n");

const assembledAppPath = resolve(extShared, "app.js");
writeFileSync(assembledAppPath, assembled, "utf8");
try {
  execFileSync(process.execPath, ["--check", assembledAppPath], {
    stdio: "pipe",
  });
} catch (error) {
  const detail =
    error instanceof Error && "stderr" in error
      ? String((error as Error & { stderr?: Buffer }).stderr ?? error.message)
      : String(error);
  throw new Error(
    `[assemble] Generated app.js is invalid JavaScript:\n${detail}`,
  );
}
console.log(
  "  [assemble] shared/app.js ← viewer/app.js + modules + app-extension-only.js",
);

// ─── 2. Merge styles.css ──────────────────────────────────────────────────────

const baseStyles = readFileSync(resolve(viewerDir, "styles.css"), "utf8");
const stylesOverlayPath = resolve(extShared, "styles-extension-only.css");
const stylesOverlay = existsSync(stylesOverlayPath)
  ? readFileSync(stylesOverlayPath, "utf8")
  : "";
const stylesHeader = `/* GENERATED — DO NOT EDIT. Version: ${version}\n   Source: viewer/styles.css + shared/styles-extension-only.css */\n\n`;
writeFileSync(
  resolve(extShared, "styles.css"),
  stylesHeader + baseStyles + (stylesOverlay ? "\n\n" + stylesOverlay : ""),
  "utf8",
);
console.log(
  "  [assemble] shared/styles.css ← viewer/styles.css + styles-extension-only.css",
);
