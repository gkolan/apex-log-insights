// Barrel re-export of parsing modules:
// - parsing-prefix.ts: ID prefix resolution and sObject type inference
// - parsing-records.ts: Record graph extraction
// - parsing-variables.ts: Variable assignment, explain plan, cumulative profiling

export {
  inferSObjectFromVarName,
  buildDynamicPrefixMap,
} from "./parsing-prefix.js";

export { RecordGraphResult, extractRecordGraph } from "./parsing-records.js";

export {
  extractTargetObject,
  parseExplainPlan,
  parseVariableAssignment,
  parseVariableScope,
  collectCumulativeProfilingSections,
} from "./parsing-variables.js";
