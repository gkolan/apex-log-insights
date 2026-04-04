#!/usr/bin/env tsx
/**
 * auto-export-extension.ts
 *
 * Watches extension source files and auto-runs export on save.
 *
 * Behavior:
 * - Any change under packages/core/src/ => full export (worker rebuild + version bump)
 * - Changes to viewer/app.js, viewer/styles.css,
 *   packages/browser-ext/shared/app-extension-only.js, packages/browser-ext/shared/styles-extension-only.css
 *   => UI-only export (version bump, no worker rebuild)
 *
 * Loop protection:
 * - export-extension.ts rewrites viewer/app.js APP_VERSION on each run.
 * - This watcher ignores APP_VERSION-only changes to avoid self-trigger loops.
 */

import { watch } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

type ExportMode = "ui" | "full";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..");

const SRC_DIR = resolve(root, "packages/core/src");
const VIEWER_APP = resolve(root, "viewer/app.js");
const VIEWER_STYLES = resolve(root, "viewer/styles.css");
const EXT_APP_ONLY = resolve(root, "packages/browser-ext/shared/app-extension-only.js");
const EXT_STYLES_ONLY = resolve(root, "packages/browser-ext/shared/styles-extension-only.css");

const watchedUiFiles = new Set([VIEWER_APP, VIEWER_STYLES, EXT_APP_ONLY, EXT_STYLES_ONLY]);
const watchedRoots = new Set([resolve(root, "packages/core/src"), resolve(root, "viewer"), resolve(root, "packages/browser-ext/shared")]);

const fingerprintByFile = new Map<string, string>();
const knownFiles = new Set<string>();

let pendingMode: ExportMode | null = null;
let exportRunning = false;
let debounceTimer: NodeJS.Timeout | null = null;
let initialized = false;

function isPathInside(candidate: string, parent: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`));
}

function shouldTrackFile(absPath: string): boolean {
  if (isPathInside(absPath, SRC_DIR)) {
    return absPath.endsWith(".ts");
  }
  return watchedUiFiles.has(absPath);
}

function modeForFile(absPath: string): ExportMode | null {
  if (isPathInside(absPath, SRC_DIR)) return "full";
  if (watchedUiFiles.has(absPath)) return "ui";
  return null;
}

function normalizeForFingerprint(absPath: string, content: string): string {
  if (absPath === VIEWER_APP) {
    return content.replace(/^const APP_VERSION = "[^"]*";/m, 'const APP_VERSION = "__VERSION__";');
  }
  return content;
}

async function fingerprintFile(absPath: string): Promise<string | null> {
  try {
    const content = await readFile(absPath, "utf8");
    return normalizeForFingerprint(absPath, content);
  } catch {
    return null;
  }
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const abs = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(abs));
      continue;
    }
    if (entry.isFile()) files.push(abs);
  }
  return files;
}

function queueMode(nextMode: ExportMode): void {
  if (pendingMode === "full") return;
  if (pendingMode === "ui" && nextMode === "full") {
    pendingMode = "full";
    return;
  }
  if (!pendingMode) pendingMode = nextMode;
}

async function refreshFile(absPath: string): Promise<void> {
  if (!shouldTrackFile(absPath)) return;

  const nextFingerprint = await fingerprintFile(absPath);
  if (nextFingerprint === null) {
    knownFiles.delete(absPath);
    fingerprintByFile.delete(absPath);
    return;
  }

  const prevFingerprint = fingerprintByFile.get(absPath);
  knownFiles.add(absPath);
  fingerprintByFile.set(absPath, nextFingerprint);

  if (!initialized) return;
  if (prevFingerprint === undefined) {
    const mode = modeForFile(absPath);
    if (mode) queueMode(mode);
    return;
  }
  if (prevFingerprint !== nextFingerprint) {
    const mode = modeForFile(absPath);
    if (mode) queueMode(mode);
  }
}

async function primeSnapshot(): Promise<void> {
  const srcFiles = await walkFiles(SRC_DIR);
  const initialFiles = [
    ...srcFiles.filter((f) => f.endsWith(".ts")),
    VIEWER_APP,
    VIEWER_STYLES,
    EXT_APP_ONLY,
    EXT_STYLES_ONLY,
  ];
  for (const file of initialFiles) {
    const fp = await fingerprintFile(file);
    if (fp !== null) {
      knownFiles.add(file);
      fingerprintByFile.set(file, fp);
    }
  }
}

function scheduleRun(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    maybeRunExport().catch((err) => {
      console.error('[auto-export] Unexpected error:', err instanceof Error ? err.message : String(err));
    });
  }, 220);
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

async function maybeRunExport(): Promise<void> {
  if (exportRunning || !pendingMode) return;
  const mode = pendingMode;
  pendingMode = null;
  exportRunning = true;
  const label = mode === "full" ? "FULL" : "UI";

  try {
    if (mode === "full") {
      console.log(`[auto-export] ${new Date().toLocaleTimeString()} full export…`);
      await runCommand("npm", ["run", "export:extension"]);
    } else {
      console.log(`[auto-export] ${new Date().toLocaleTimeString()} ui export…`);
      await runCommand("npm", ["run", "export:extension:ui"]);
    }
    await refreshFile(VIEWER_APP);
    await refreshFile(VIEWER_STYLES);
    await refreshFile(EXT_APP_ONLY);
    await refreshFile(EXT_STYLES_ONLY);
    console.log(`[auto-export] ${label} export complete.`);
  } catch (err) {
    console.error(`[auto-export] ${label} export failed:`, err instanceof Error ? err.message : String(err));
  } finally {
    exportRunning = false;
    if (pendingMode) scheduleRun();
  }
}

function onFsEvent(rootDir: string, changedPath?: string | Buffer): void {
  if (!changedPath) return;
  const abs = resolve(rootDir, String(changedPath));
  const isInsideAnyWatchedRoot = Array.from(watchedRoots).some((parent) => isPathInside(abs, parent));
  if (!isInsideAnyWatchedRoot) return;
  void refreshFile(abs).then(() => {
    if (pendingMode) scheduleRun();
  });
}

async function main(): Promise<void> {
  console.log("[auto-export] priming file snapshot…");
  await primeSnapshot();
  initialized = true;

  const watchers = [
    watch(SRC_DIR, { recursive: true }, (_eventType, filename) => onFsEvent(SRC_DIR, filename)),
    watch(resolve(root, "viewer"), { recursive: true }, (_eventType, filename) => onFsEvent(resolve(root, "viewer"), filename)),
    watch(resolve(root, "packages/browser-ext/shared"), { recursive: true }, (_eventType, filename) => onFsEvent(resolve(root, "packages/browser-ext/shared"), filename)),
  ];

  console.log("[auto-export] watching saves:");
  console.log("  packages/core/src/**/*.ts -> npm run export:extension");
  console.log("  viewer/app.js, viewer/styles.css, packages/browser-ext/shared/*-extension-only.* -> npm run export:extension:ui");
  console.log("  Press Ctrl+C to stop.");

  process.on("SIGINT", () => {
    for (const w of watchers) w.close();
    process.exit(0);
  });
}

void main().catch((err) => {
  console.error("[auto-export] failed to start:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
