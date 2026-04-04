// Barrel file: re-exports all execution analysis modules.
//
// This file maintains backward compatibility for existing imports while
// organizing the implementation across focused, single-purpose modules:
//   - execution-phases.ts: execution phase building
//   - execution-context.ts: context detection and overrides
//   - execution-detection.ts: mixed DML, recursive triggers, system mode
//   - execution-cascade.ts: trigger cascade building

export {
  buildExecutionPhases,
  collectSalesforceIds,
} from './execution-phases.js';

export {
  detectExecutionContext,
  buildContextOverride,
  VALID_CONTEXT_VALUES,
} from './execution-context.js';

export {
  detectMixedDml,
  detectRecursiveTriggers,
  extractSystemModeTransitions,
} from './execution-detection.js';

export {
  buildTriggerCascade,
  type TriggerCascadeResult,
} from './execution-cascade.js';
