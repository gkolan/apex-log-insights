#!/usr/bin/env node
/**
 * sync-versions.mjs
 *
 * Reads the version from the root package.json and writes it into every
 * packages/[name]/package.json and browser extension manifest.json files.
 *
 * Usage:  node scripts/sync-versions.mjs
 * Called by:  pnpm version:bump  (in root package.json)
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Read root version
let rootPkg;
try {
  rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
} catch (err) {
  console.error(`Failed to parse root package.json: ${err.message}`);
  process.exit(1);
}
const version = rootPkg.version;

if (!version) {
  console.error('No version found in root package.json');
  process.exit(1);
}

console.log(`Syncing version: ${version}`);

// Update all packages/*/package.json
const packagesDir = join(root, 'packages');
const packageDirs = ['core', 'cli', 'mcp', 'browser-ext'];

for (const dir of packageDirs) {
  const pkgPath = join(packagesDir, dir, 'package.json');
  if (!existsSync(pkgPath)) {
    console.warn(`  SKIP  ${pkgPath} (not found)`);
    continue;
  }
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    console.error(`  FAIL  ${pkgPath}: ${err.message}`);
    continue;
  }
  pkg.version = version;
  const tmpPath = pkgPath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  renameSync(tmpPath, pkgPath);
  console.log(`  OK  ${pkg.name} → ${version}`);
}

// Update browser extension manifests
const manifestPaths = [
  'packages/browser-ext/manifests/chrome/manifest.json',
  'packages/browser-ext/manifests/edge/manifest.json',
  'packages/browser-ext/manifests/firefox/manifest.json',
];

for (const rel of manifestPaths) {
  const manifestPath = join(root, rel);
  if (!existsSync(manifestPath)) continue;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error(`  FAIL  ${rel}: ${err.message}`);
    continue;
  }
  manifest.version = version;
  const tmpManifest = manifestPath + '.tmp';
  writeFileSync(tmpManifest, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  renameSync(tmpManifest, manifestPath);
  console.log(`  OK  ${rel} → ${version}`);
}

// Update viewer/app.js APP_VERSION
const appJsPath = join(root, 'viewer/app.js');
let appJs = readFileSync(appJsPath, 'utf8');
const appJsUpdated = appJs.replace(
  /^const APP_VERSION = "[^"]+";/m,
  `const APP_VERSION = "${version}";`
);
if (appJsUpdated !== appJs) {
  writeFileSync(appJsPath, appJsUpdated, 'utf8');
  console.log(`  OK  viewer/app.js APP_VERSION → ${version}`);
}

// Verify all versions are now in sync
const allFiles = [
  join(packagesDir, 'core', 'package.json'),
  join(packagesDir, 'cli', 'package.json'),
  join(packagesDir, 'mcp', 'package.json'),
  join(packagesDir, 'browser-ext', 'package.json'),
];

let verifyFailed = false;
for (const file of allFiles) {
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  if (pkg.version !== version) {
    console.error(`  FAIL  Version mismatch in ${file}: expected ${version}, got ${pkg.version}`);
    verifyFailed = true;
  }
}

if (verifyFailed) {
  console.error('\nVersion sync verification failed. Some files may be out of sync.');
  process.exit(1);
}

console.log('Done.');
