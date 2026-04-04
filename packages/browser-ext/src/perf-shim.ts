/**
 * Browser-safe shim for node:perf_hooks.
 *
 * esbuild aliases `node:perf_hooks` to this file when bundling the extension
 * worker. Web Workers have `globalThis.performance` natively; this shim just
 * re-exports it so parserCore.ts can continue to `import { performance } from
 * 'node:perf_hooks'` without any source changes.
 */
export const performance: { now(): number } =
  (globalThis as unknown as { performance?: { now(): number } }).performance ??
  { now: () => Date.now() };
