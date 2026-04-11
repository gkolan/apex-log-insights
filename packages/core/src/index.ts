/**
 * @apex-log-insights/core — Salesforce Apex Debug Log Parser
 *
 * The shared parsing engine. Zero runtime dependencies, pure TypeScript.
 * Every other package in the monorepo depends on this.
 */

// Parser — vendor Certinia engine (public API)
export {
  ApexLogParser,
  DebugLevel,
  parse,
} from './certinia/index.js';

export type {
  CPUType,
  DebugCategory,
  GovernorLimits,
  GovernorSnapshot,
  IssueType,
  Limits,
  LineNumber,
  LogCategory,
  LogEventType,
  LogIssue,
  LogLineConstructor,
  LogSubCategory,
  SelfTotal,
} from './certinia/index.js';

export {
  ApexLog,
  CodeUnitStartedLine,
  DMLBeginLine,
  ExecutionStartedLine,
  LogEvent,
  MethodEntryLine,
  SOQLExecuteBeginLine,
  SOQLExecuteExplainLine,
  parseObjectNamespace,
  parseRows,
  parseVfNamespace,
} from './certinia/index.js';

export { getLogEventClass, lineTypeMap } from './certinia/index.js';

// Parser Core — high-level parse entry point
export {
  parseLog,
} from './parserCore.js';

export type {
  ParseLogOptions,
  ParseSourceType,
  NormalizedParseResult,
  NormalizedTimelineEvent,
  RawLogLine,
} from './parserCore.js';

// Reports
export { buildInsightsReport } from './insightsReport.js';
export { buildOfflineReport } from './offlineReport.js';
export type { OfflineReportInput, ReportLimits } from './offlineReport.js';
export type { JsonValue, JsonPrimitive } from './report.js';

// Phases
export {
  EXECUTION_PHASE_DEFINITIONS,
} from './phases.js';

export type {
  ExecutionPhaseId,
  EvidenceConfidence,
} from './phases.js';

// Insights — execution context detection
export { VALID_CONTEXT_VALUES } from './insights/execution.js';
