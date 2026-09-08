#!/usr/bin/env tsx
/** Copies the canonical viewer into the CLI package for npm distribution. */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "viewer");
const destination = resolve(root, "packages/cli/dist/viewer");

if (!existsSync(source)) {
  throw new Error(`Viewer source not found: ${source}`);
}

rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
console.log("  [cli] dist/viewer ← viewer/");
