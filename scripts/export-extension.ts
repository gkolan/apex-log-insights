#!/usr/bin/env tsx
/**
 * export-extension.ts — Single command to build everything.
 *
 * 1. Bumps version in package.json, all manifests, viewer/app.js, viewer/index.html
 * 2. Builds the CLI viewer Web Worker (viewer/apex-parser-worker.js)
 * 3. Generates shared/app.js and shared/styles.css from viewer sources + extension overlays
 * 4. Runs build-chrome.sh, build-edge.sh, build-firefox.sh to assemble + zip all extensions
 *
 * Usage:
 *   npx tsx scripts/export-extension.ts                  — patch bump + full rebuild
 *   npx tsx scripts/export-extension.ts --version minor  — minor bump
 *   npx tsx scripts/export-extension.ts --version 2.1.0  — explicit version
 *   npx tsx scripts/export-extension.ts --ui-only        — skip worker rebuilds
 */

import { build } from 'esbuild';
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ─── Resolved paths ─────────────────────────────────────────────────────────

const extPkg    = resolve(root, 'packages/browser-ext');
const extShared = resolve(extPkg, 'shared');
const viewerDir = resolve(root, 'viewer');

// ─── Args ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--no-extension') || process.env['CHROME_EXT'] === '0') {
    console.log('[export] Skipped (--no-extension or CHROME_EXT=0).');
    process.exit(0);
  }
  const uiOnly = args.includes('--ui-only');

  // ─── Version bump ──────────────────────────────────────────────────────────

  function bumpVersion(current: string, bump: string): string {
    if (/^\d+\.\d+\.\d+$/.test(bump)) {
      const parts = bump.split('.').map(Number);
      if (parts.some(p => !Number.isFinite(p) || p < 0 || p > 65535)) {
        throw new Error(`Version components must be integers 0–65535, got: ${bump}`);
      }
      return bump;
    }
    if (!/^\d+\.\d+\.\d+$/.test(current)) {
      throw new Error(`Current version is not valid semver: ${current}`);
    }
    const [major, minor, patch] = current.split('.').map(Number) as [number, number, number];
    if (bump === 'major') return `${major + 1}.0.0`;
    if (bump === 'minor') return `${major}.${minor + 1}.0`;
    if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
    throw new Error(`Unknown version bump type: "${bump}". Use major, minor, patch, or an explicit version like 1.2.3`);
  }

  const versionArgIdx = args.indexOf('--version');
  const versionBump = versionArgIdx !== -1 ? (args[versionArgIdx + 1] ?? 'patch') : 'patch';
  const pkgPath = resolve(root, 'package.json');
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const oldVersion = pkg.version as string;
  const newVersion = bumpVersion(oldVersion, versionBump);

  console.log(`\n[export] ${oldVersion} → ${newVersion}\n`);

  // ─── 1. Bump versions everywhere ──────────────────────────────────────────

  // Root package.json
  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  // APP_VERSION in viewer/app.js
  const appJsPath = resolve(viewerDir, 'app.js');
  writeFileSync(appJsPath, readFileSync(appJsPath, 'utf8').replace(
    /^const APP_VERSION = "[^"]*";/m,
    `const APP_VERSION = "${newVersion}";`,
  ), 'utf8');

  // Cache-busting in viewer/index.html
  const indexHtmlPath = resolve(viewerDir, 'index.html');
  writeFileSync(indexHtmlPath, readFileSync(indexHtmlPath, 'utf8').replace(
    /(\?v=)[^"']*/g,
    `$1${newVersion}`,
  ), 'utf8');

  // All browser manifests (source copies in manifests/)
  for (const browser of ['chrome', 'edge', 'firefox']) {
    const mfPath = resolve(extPkg, `manifests/${browser}/manifest.json`);
    if (existsSync(mfPath)) {
      let mf: Record<string, unknown>;
      try {
        mf = JSON.parse(readFileSync(mfPath, 'utf8'));
      } catch (err) {
        throw new Error(`Failed to parse ${mfPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
      mf.version = newVersion;
      writeFileSync(mfPath, JSON.stringify(mf, null, 2) + '\n', 'utf8');
    } else {
      console.warn(`  [export] Warning: manifest not found for ${browser} at ${mfPath}`);
    }
  }

  console.log('  Versions bumped: package.json, viewer/app.js, viewer/index.html, all manifests');

  // ─── 2. Build CLI viewer worker ───────────────────────────────────────────

  if (!uiOnly) {
    console.log('\n  Building CLI viewer worker…');
    await build({
      entryPoints: [resolve(root, 'packages/cli/src/worker-entry.ts')],
      bundle: true,
      minify: true, // Distribution only — store-submitted zips are minified for payload size
      platform: 'browser',
      target: 'es2022',
      format: 'esm',
      outfile: resolve(viewerDir, 'apex-parser-worker.js'),
      alias: {
        'node:perf_hooks': resolve(root, 'packages/cli/src/perf-shim.ts'),
        'perf_hooks': resolve(root, 'packages/cli/src/perf-shim.ts'),
        '@apex-log-insights/core': resolve(root, 'packages/core/dist/index.js'),
      },
      logLevel: 'info',
    });
  }

  // ─── 3. Generate shared extension UI assets ───────────────────────────────

  console.log('\n  Generating extension UI assets…');
  execFileSync('npx', ['tsx', 'scripts/assemble-extension-ui.ts'], { cwd: root, stdio: 'inherit' });

  // popup.html version footer
  const popupPath = resolve(extShared, 'popup.html');
  if (existsSync(popupPath)) {
    const original = readFileSync(popupPath, 'utf8');
    const updated = original.replace(
      /(<span class="popupVersion">v)[^<]*/,
      `$1${newVersion}`,
    );
    if (original === updated) {
      console.warn('  Warning: popup.html version tag not found — HTML structure may have changed');
    } else {
      writeFileSync(popupPath, updated, 'utf8');
      console.log('  → shared/popup.html version');
    }
  }

  // ─── 4. Build all three browser extensions ────────────────────────────────

  console.log('\n  Building browser extensions…\n');

  for (const browser of ['chrome', 'edge', 'firefox']) {
    const script = resolve(extPkg, `scripts/build-${browser}.sh`);
    if (!existsSync(script)) {
      console.log(`  Skipping ${browser}: build script not found`);
      continue;
    }
    execFileSync('bash', [script], { cwd: extPkg, stdio: 'inherit' });
  }

  // ─── 5. Copy release artifacts to docs/ ───────────────────────────────────

  const docsReleases = resolve(root, 'docs/releases');
  const artifactMap: Record<string, { src: string; dest: string }> = {
    chrome:  { src: `chrome-extension-v${newVersion}.zip`, dest: 'chrome' },
    edge:    { src: `edge-extension-v${newVersion}.zip`,   dest: 'edge' },
    firefox: { src: `firefox-extension-v${newVersion}.xpi`, dest: 'firefox' },
  };

  for (const [browser, { src, dest }] of Object.entries(artifactMap)) {
    const srcPath = resolve(extPkg, 'dist', src);
    const destDir = resolve(docsReleases, dest);
    if (!existsSync(srcPath)) continue;
    execSync(`mkdir -p "${destDir}"`);
    execSync(`cp "${srcPath}" "${destDir}/"`);
    console.log(`  [release] ${src} → docs/releases/${dest}/`);
  }

  // ─── Done ─────────────────────────────────────────────────────────────────

  console.log(`\n[export] Done. ${oldVersion} → ${newVersion}`);
  console.log(`  Extensions: packages/browser-ext/dist/{chrome-extension-v${newVersion}.zip, edge-extension-v${newVersion}.zip, firefox-extension-v${newVersion}.xpi}`);
  console.log(`  Releases:   docs/releases/{chrome,edge,firefox}/`);
  console.log(`  CLI worker:  viewer/apex-parser-worker.js`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
