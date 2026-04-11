#!/usr/bin/env tsx
/**
 * watch-extension.ts
 *
 * Runs esbuild in watch mode for the Chrome extension parser worker.
 * Use during active development of TypeScript parser files.
 *
 * Usage:
 *   npm run dev:extension
 *
 * What it does:
 *   - Watches packages/browser-ext/src/ for TypeScript changes
 *   - Rebuilds apex-parser-worker.js on every save (typically < 200ms)
 *   - Does NOT bump the version (use npm run export:extension when done)
 *   - After each rebuild: reload the extension in chrome://extensions
 *
 * Workflow:
 *   1. npm run dev:extension        ← start watching
 *   2. Edit packages/core/src/certinia/LogEvents.ts, packages/core/src/insightsReport.ts, etc.
 *   3. Each save rebuilds the worker automatically
 *   4. Reload extension in chrome://extensions (Ctrl+R on the card)
 *   5. Ctrl+C to stop watching
 *   6. npm run export:extension     ← do the official versioned release
 */

import { context } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

const entryPoint = resolve(root, 'packages/cli/src/worker-entry.ts');
const outFile = resolve(root, 'viewer/apex-parser-worker.js');
const perfShim = resolve(root, 'packages/cli/src/perf-shim.ts');

console.log('[watch-extension] Starting esbuild watcher…');
console.log(`  Entry:   ${entryPoint}`);
console.log(`  Output:  ${outFile}`);
console.log('  Watching for TypeScript changes. Ctrl+C to stop.\n');

const ctx = await context({
  entryPoints: [entryPoint],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  outfile: outFile,
  alias: {
    'node:perf_hooks': perfShim,
  },
  banner: {
    js: [
      '/**',
      ' * Apex Log Insights — Chrome Extension Parser Worker (DEV BUILD)',
      ' *',
      ' * THIS FILE IS A BUILD ARTIFACT — DO NOT EDIT DIRECTLY.',
      ' * Source: packages/browser-ext/src/worker-entry.ts',
      ' * Dev watch: npm run dev:extension',
      ' * Release:   npm run export:extension',
      ' */',
    ].join('\n'),
  },
  logLevel: 'info',
});

try {
  await ctx.watch();
} catch (err) {
  console.error('[watch-extension] Failed to start watcher:', err instanceof Error ? err.message : String(err));
  await ctx.dispose().catch(() => {});
  process.exit(1);
}

// Keep the process alive; esbuild's watcher runs async.
// Ctrl+C triggers SIGINT and stops cleanly.
process.on('SIGINT', async () => {
  console.log('\n[watch-extension] Stopping watcher…');
  try {
    await ctx.dispose();
  } catch (err) {
    console.error('[watch-extension] Error during cleanup:', err instanceof Error ? err.message : String(err));
  }
  process.exit(0);
});
