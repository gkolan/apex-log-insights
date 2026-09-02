/**
 * Browser-safe shim for node:perf_hooks.
 */
export const performance: { now(): number } = (
  globalThis as unknown as { performance?: { now(): number } }
).performance ?? { now: () => Date.now() };
