// Barrel export — re-exports governor analysis functions split across specialized modules
// for better code organization and maintainability.
// Used by execution.ts and insightsReport.ts.

export { buildLimitTimeline, computeGovernorDelta, type LimitTimelineEntry } from './governor-timeline.js';
export { buildHeapAnalysis } from './governor-heap.js';
export { buildGovernorBurnRate } from './governor-burnrate.js';
export { assessDebugLevelQuality, buildCpuAttribution, buildManagedPackageImpact } from './governor-quality.js';
