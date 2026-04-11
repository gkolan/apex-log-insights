#!/usr/bin/env tsx
/**
 * check-version-sync.ts
 * Verifies that all version strings in the project are in sync.
 * Exits 0 if all match, exits 1 with a diff table if any mismatch.
 *
 * Sources checked:
 *   - package.json                              (version field)
 *   - packages/core/package.json                (version field)
 *   - packages/cli/package.json                 (version field)
 *   - packages/mcp/package.json                 (version field)
 *   - packages/browser-ext/package.json         (version field)
 *   - packages/browser-ext/manifests/chrome     (version field)
 *   - packages/browser-ext/manifests/edge       (version field)
 *   - packages/browser-ext/manifests/firefox    (version field)
 *   - viewer/app.js                             (APP_VERSION constant)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const root = resolve(import.meta.dirname, '..');

// filePath is always a hardcoded literal — no user input reaches this function.
function readVersion(label: string, filePath: string, reader: (content: string) => string | null): { label: string; path: string; version: string | null } {
  const absPath = resolve(root, filePath);
  if (!existsSync(absPath)) {
    return { label, path: filePath, version: null };
  }
  const content = readFileSync(absPath, 'utf8');
  return { label, path: filePath, version: reader(content) };
}

const jsonVersionReader = (c: string) => {
  const m = c.match(/"version":\s*"([^"]+)"/);
  return m ? m[1] : null;
};

const sources = [
  readVersion('root package.json', 'package.json', jsonVersionReader),
  readVersion('core package.json', 'packages/core/package.json', jsonVersionReader),
  readVersion('cli package.json', 'packages/cli/package.json', jsonVersionReader),
  readVersion('mcp package.json', 'packages/mcp/package.json', jsonVersionReader),
  readVersion('ext package.json', 'packages/browser-ext/package.json', jsonVersionReader),
  readVersion('chrome manifest', 'packages/browser-ext/manifests/chrome/manifest.json', jsonVersionReader),
  readVersion('edge manifest', 'packages/browser-ext/manifests/edge/manifest.json', jsonVersionReader),
  readVersion('firefox manifest', 'packages/browser-ext/manifests/firefox/manifest.json', jsonVersionReader),
  readVersion('viewer/app.js', 'viewer/app.js', (c) => {
    const m = c.match(/^const APP_VERSION = "([^"]+)";/m);
    return m ? m[1] : null;
  }),
];

const versions = sources.map((s) => s.version);
const allMatch = versions.every((v) => v !== null && v === versions[0]);

const maxLabel = Math.max(...sources.map((s) => s.label.length));
const maxPath = Math.max(...sources.map((s) => s.path.length));

console.log('\nVersion sync check:\n');
for (const s of sources) {
  const status = s.version === versions[0] ? '✓' : '✗';
  console.log(`  ${status}  ${s.label.padEnd(maxLabel + 2)}${s.path.padEnd(maxPath + 2)}${s.version ?? '(not found)'}`);
}
console.log('');

if (allMatch) {
  console.log(`All versions match: ${versions[0]}\n`);
  process.exit(0);
} else {
  console.error('Version mismatch detected. Run `pnpm export:extension` to re-sync.\n');
  process.exit(1);
}
