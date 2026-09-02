// All shared interfaces, type aliases, and constants for the Apex Log Insights
// report builder. Imported by utils.ts, parsing.ts, governor.ts, execution.ts,
// database.ts, and insightsReport.ts.

export type UnknownRecord = Record<string, unknown>;

export const SALESFORCE_ID_RE = /\b[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?\b/;

/** True only when the complete value is a 15- or 18-character Salesforce ID token. */
export function isSalesforceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:[a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/.test(value)
  );
}

export interface FlatEvent {
  idx: number;
  parentIdx: number | null;
  type: string;
  timestampNs: number;
  timestampIsInferred: boolean;
  endTimestampNs: number | null;
  durationSelfNs: number | null;
  durationTotalNs: number | null;
  /** How the parser bounded this operation; only `complete` proves an observed typed end record. */
  pairingStatus?:
    | "not_applicable"
    | "complete"
    | "missing_end"
    | "orphan_end"
    | "closed_by_exception"
    | "closed_at_truncation"
    | "depth_limit";
  namespace: string;
  category: string;
  debugCategory: string;
  cpuType: string;
  /** 1-based physical line in the debug log, used for evidence navigation. */
  lineNumber: number | null;
  /** Apex source-code line from values such as `[87]`, when present. */
  sourceLineNumber: number | null;
  text: string;
  logLine: string;
  /** Physical log line containing the matched exit record. */
  exitLineNumber: number | null;
  /** Original matched exit record, when the parser paired one. */
  exitLogLine: string | null;
  credentialId?: string | null;
  credentialName?: string | null;
  endpoint?: string | null;
  method?: string | null;
  externalCredentialType?: string | null;
  requestSizeBytes?: number | null;
  retryOn401?: boolean | null;
  statusCode?: number | null;
  responseSizeBytes?: number | null;
  overallCalloutTimeMs?: number | null;
  connectTimeMs?: number | null;
  responseText?: string | null;
  responseLineNumber?: number | null;
  responseTimestampNs?: number | null;
  responseLogLine?: string | null;
  isContinuation?: boolean;
  isParent: boolean;
  aggregations: number | null;
  soqlCountTotal: number | null;
  soqlRowCountTotal: number | null;
  soslCountTotal: number | null;
  soslRowCountTotal: number | null;
  dmlCountTotal: number | null;
  dmlRowCountTotal: number | null;
}

export interface ParsedVariableAssignment {
  variableName: string;
  rawValue: string;
  parsedValue: unknown;
  isEmptyCollection: boolean;
}

export interface ParsedVariableScope {
  variableName: string;
  typeName: string;
}

export interface ParsedExplainPlan {
  available: boolean;
  indexed: boolean;
  indexFields?: string[];
  cardinality?: number;
  sobjectCardinality?: number;
  relativeCost?: number;
  raw: string;
}

export interface ParsedCumulativeEntry {
  className: string | null;
  lineNumber: number | null;
  executionCount: number;
  timeMs: number;
  rawLine: string;
}

export interface ParsedCumulativeDmlEntry extends ParsedCumulativeEntry {
  operation: string | null;
  sObject: string | null;
}

// ─── Execution Phase + Record Graph interfaces ──────────────────────────────

export interface RecordFieldValue {
  field: string;
  value: unknown;
}

export interface RecordInfo {
  id: string;
  sObjectType: string | null;
  keyPrefix: string;
  fields: RecordFieldValue[];
  relationships: Array<{
    field: string;
    relatedId: string;
    relatedSObject: string | null;
  }>;
  provenance: {
    variableName: string;
    timestampNs: number | null;
    lineNumber: number | null;
    source: "variable_assignment" | "soql_bind" | "dml_target";
  };
}

export interface RecordGraphEntry {
  sObjectType: string;
  keyPrefix: string;
  recordCount: number;
  records: RecordInfo[];
}

export interface GovernorDelta {
  soqlBefore: number | null;
  soqlAfter: number | null;
  soqlRowsBefore: number | null;
  soqlRowsAfter: number | null;
  dmlBefore: number | null;
  dmlAfter: number | null;
}

export interface PhaseDataFlow {
  inputIds: string[];
  outputIds: string[];
  recordsProcessed: number;
  emptyResults: string[];
  significantAssignments: Array<{
    variableName: string;
    sObjectType: string | null;
    recordCount: number;
    timestampNs: number | null;
  }>;
}

export interface ExecutionPhase {
  id: string;
  label: string;
  phaseIndex: number;
  calledFrom: {
    className: string | null;
    lineNumber: number | null;
  };
  timing: {
    startNs: number;
    endNs: number | null;
    durationMs: number | null;
    selfDurationMs: number | null;
    pctOfTotal: number | null;
  };
  database: {
    soqlInPhase: Array<{
      id: string;
      targetObject: string | null;
      rows: number | null;
      durationMs: number | null;
      explain: ParsedExplainPlan | null;
    }>;
    dmlInPhase: Array<{
      id: string;
      operation: string | null;
      sObject: string | null;
      rows: number | null;
      durationMs: number | null;
    }>;
    totalSoqlRows: number | null;
    totalDmlRows: number | null;
  };
  governorDelta: GovernorDelta;
  dataFlow: PhaseDataFlow;
  warnings: string[];
  childPhaseIds: string[];
}

// ─── Database entry interfaces ───────────────────────────────────────────────

export interface DatabaseSoqlEntry {
  id: string;
  query: string | null;
  targetObject: string | null;
  aggregations: number | null;
  rows: number | null;
  count: number | null;
  durationNs: number | null;
  durationMs: number | null;
  explain: ParsedExplainPlan | null;
  namespace: string;
  category: string | null;
  debugCategory: string | null;
  evidence: {
    lineNumber: number | null;
    sourceLineNumber: number | null;
    timestampNs: number;
    raw: string | null;
  };
}

export interface DatabaseSoslEntry {
  id: string;
  query: string | null;
  rows: number | null;
  count: number | null;
  durationNs: number | null;
  durationMs: number | null;
  namespace: string;
  category: string | null;
  debugCategory: string | null;
  evidence: {
    lineNumber: number | null;
    sourceLineNumber: number | null;
    timestampNs: number;
    raw: string | null;
  };
}

export interface DatabaseDmlEntry {
  id: string;
  operation: string | null;
  sObject: string | null;
  rows: number | null;
  count: number | null;
  durationNs: number | null;
  durationMs: number | null;
  namespace: string;
  category: string | null;
  debugCategory: string | null;
  text: string | null;
  source: "event" | "cumulative_profiling";
  evidence: {
    lineNumber: number | null;
    sourceLineNumber: number | null;
    timestampNs: number | null;
    raw: string | null;
  };
}

export interface DatabaseCalloutEntry {
  id: string;
  endpoint: string | null;
  host: string | null;
  method: string | null;
  statusCode: number | null;
  statusText: string | null;
  responseLineNumber: number | null;
  durationNs: number | null;
  durationMs: number | null;
  namespace: string;
  category: string | null;
  debugCategory: string | null;
  text: string | null;
  evidence: {
    lineNumber: number | null;
    sourceLineNumber: number | null;
    timestampNs: number | null;
    raw: string | null;
  };
}

export interface CursorOperationEntry {
  id: string;
  operation: "create" | "fetch" | "fetchPage";
  queryId: string | null;
  query: string | null;
  offset: number | null;
  rows: number | null;
  durationNs: number | null;
  durationMs: number | null;
  namespace: string;
  evidence: {
    lineNumber: number | null;
    endLineNumber: number | null;
    sourceLineNumber: number | null;
    timestampNs: number;
    raw: string | null;
    endRaw: string | null;
  };
}

// ─── Heap Analysis interfaces ───────────────────────────────────────────────

export interface HeapAllocationEntry {
  lineNumber: number | null;
  bytes: number;
  timestampNs: number;
  parentSpanId: string | null;
  namespace: string;
}

export interface HeapHotspot {
  lineNumber: number | null;
  totalBytes: number | null;
  count: number;
  avgBytes: number | null;
  namespace: string;
  parentSpanId: string | null;
}

export interface HeapWatermarkSample {
  timestampNs: number;
  cumulativeBytes: number | null;
}

export interface HeapAnalysis {
  totalAllocatedBytes: number | null;
  totalDeallocatedBytes: number | null;
  netAllocatedBytes: number | null;
  allocationCount: number;
  deallocationCount: number;
  peakCumulativeBytes: number | null;
  peakTimestampNs: number | null;
  hotspotsByLine: HeapHotspot[];
  watermarkSamples: HeapWatermarkSample[];
  byNamespace: Record<string, { totalBytes: number | null; count: number }>;
  byPhase: Array<{
    phaseId: string;
    phaseLabel: string;
    allocatedBytes: number | null;
    allocationCount: number;
  }>;
}

// ─── Governor Burn Rate interfaces ──────────────────────────────────────────

export interface LimitBurnRateEntry {
  limitName: string;
  used: number | null;
  max: number | null;
  pctUsed: number | null;
  burnRatePerSec: number | null;
  projectedHeadroom: number | null;
  status: "ok" | "warn" | "critical" | "unknown";
}

export interface LimitTrajectoryPoint {
  timestampNs: number;
  namespace: string;
  soqlUsed: number | null;
  soqlRowsUsed: number | null;
  dmlUsed: number | null;
  dmlRowsUsed: number | null;
  cpuUsed: number | null;
  heapUsed: number | null;
  calloutsUsed: number | null;
  futureCallsUsed: number | null;
  queueablesUsed: number | null;
}

export interface GovernorBurnRate {
  trajectory: LimitTrajectoryPoint[];
  burnRates: LimitBurnRateEntry[];
  byNamespace: Record<
    string,
    {
      soqlUsed: number | null;
      soqlRowsUsed: number | null;
      dmlUsed: number | null;
      dmlRowsUsed: number | null;
      cpuUsed: number | null;
      heapUsed: number | null;
      calloutsUsed: number | null;
      futureCallsUsed: number | null;
      queueablesUsed: number | null;
    }
  >;
  phaseHeadroom: Array<{
    phaseId: string;
    phaseLabel: string;
    soqlPctAfter: number | null;
    soqlRowsPctAfter: number | null;
    dmlPctAfter: number | null;
    cpuPctAfter: number | null;
    heapPctAfter: number | null;
    calloutsPctAfter: number | null;
    futureCallsPctAfter: number | null;
    queueablesPctAfter: number | null;
    phasesRemaining: number;
    warning: string | null;
  }>;
}

// ─── SOQL Pattern Analysis interfaces ───────────────────────────────────────

export interface SoqlPatternGroup {
  pattern: string;
  targetObject: string | null;
  executionCount: number;
  /** Exact total when every grouped execution reported rows; otherwise null. */
  totalRows: number | null;
  /** Exact total when every grouped execution has a valid measured duration. */
  totalDurationMs: number | null;
  /** Exact average when totalDurationMs is known; otherwise null. */
  avgDurationMs: number | null;
  queryIds: string[];
  isLoopSuspect: boolean;
  loopEvidence: string | null;
}

// ─── Savepoint Tracking interfaces ──────────────────────────────────────────

export interface SavepointEntry {
  id: string;
  type: "set" | "rollback";
  name: string;
  timestampNs: number;
  lineNumber: number | null;
  rawLine: string | null;
  /** Legacy field retained during migration; no longer populated from spans. */
  enclosingSpanId: string | null;
  /** Event-native parent reference (`event-<n>`). */
  enclosingEventId?: string | null;
  enclosingPhaseId: string | null;
}

// ─── System Mode Transition interfaces ──────────────────────────────────────

export interface SystemModeTransition {
  timestampNs: number;
  lineNumber: number | null;
  entering: boolean;
  isSystemMode: boolean;
  enclosingSpanId: string | null;
}

// ─── Trigger Cascade interfaces ─────────────────────────────────────────────

export interface TriggerCascadeNode {
  id: string;
  label: string;
  type: "trigger" | "dml" | "code_unit";
  sObject: string | null;
  operation: string | null;
  namespace: string;
  durationMs: number | null;
  children: TriggerCascadeNode[];
  depth: number;
}

// ─── Debug Level Quality interfaces ─────────────────────────────────────────

export interface DebugLevelEntry {
  category: string;
  level: string;
}

export interface DataQualityWarning {
  category: string;
  currentLevel: string;
  recommendation: string;
  impact: string;
}

export interface DebugLevelQuality {
  levels: DebugLevelEntry[];
  warnings: DataQualityWarning[];
  overallQuality: "high" | "medium" | "low";
}

// ─── CPU Attribution interfaces ─────────────────────────────────────────────

export interface CpuAttribution {
  byType: Record<string, { durationMs: number | null; count: number }>;
  byNamespace: Record<
    string,
    {
      selfDurationMs: number | null;
      totalDurationMs: number | null;
      spanCount: number;
    }
  >;
}

// ─── Managed Package Impact interfaces ──────────────────────────────────────

export interface ManagedPackageImpact {
  namespace: string;
  spanCount: number;
  totalDurationMs: number | null;
  selfDurationMs: number | null;
  soqlCount: number;
  soqlRows: number | null;
  dmlCount: number;
  dmlRows: number | null;
  pctOfTotalDuration: number | null;
}

// ─── Execution Context Detection interfaces ──────────────────────────────────

export type ExecutionContextType =
  | "synchronous_trigger"
  | "anonymous_apex"
  | "queueable"
  | "future_method"
  | "batch_execute"
  | "scheduled"
  | "platform_event"
  | "apex_class"
  | "unknown";

/** The lifecycle phase model to use for labelling execution phases in the viewer. */
export type PhaseModelId =
  "trigger" | "batch" | "async" | "anonymous" | "scheduled";

export interface ExecutionContextDetection {
  type: ExecutionContextType;
  label: string;
  confidence: "direct" | "derived" | "inferred" | "override";
  signals: string[];
  /** "auto" when context was detected by heuristics; "override" when set via --context CLI flag */
  contextSource: "auto" | "override";
  /** Phase model to use when rendering execution phases in the viewer. */
  phaseModel: PhaseModelId;
}

// ─── Named Credential interfaces ─────────────────────────────────────────────

export interface NamedCredentialEntry {
  id: string;
  credentialId: string | null;
  credentialName: string | null;
  endpoint: string | null;
  method: string | null;
  externalCredentialType: string | null;
  requestSizeBytes: number | null;
  retryOn401: boolean | null;
  statusCode: number | null;
  statusText: string | null;
  responseSizeBytes: number | null;
  connectTimeMs: number | null;
  durationNs: number | null;
  durationMs: number | null;
  namespace: string;
  evidence: {
    lineNumber: number | null;
    timestampNs: number | null;
    raw: string | null;
  };
}

// ─── Integration Operation (paired callout + named credential) ───────────────

export interface IntegrationOperation {
  id: string;
  /** Named credential name, or null for direct Http.send() callouts */
  credentialName: string | null;
  endpoint: string | null;
  host: string | null;
  method: string | null;
  statusCode: number | null;
  statusText: string | null;
  durationMs: number | null;
  namespace: string;
  evidence: {
    lineNumber: number | null;
    timestampNs: number | null;
    raw: string | null;
  };
  /** ID of the source DatabaseCalloutEntry, null if NC-only */
  calloutId: string | null;
  /** ID of the source NamedCredentialEntry, null if callout-only */
  namedCredentialId: string | null;
}

// ─── Mixed DML Detection interfaces ─────────────────────────────────────────

export interface MixedDmlDetection {
  detected: boolean;
  setupObjects: string[];
  nonSetupObjects: string[];
  evidence: Array<{
    lineNumber: number | null;
    timestampNs: number | null;
    sObject: string;
  }>;
}

// ─── Recursive Trigger Detection interfaces ──────────────────────────────────

export interface RecursiveTriggerDetection {
  detected: boolean;
  meta: {
    totalCount: number;
    truncated: boolean;
    limit: number;
    evidenceLimit: number;
  };
  recursiveTriggers: Array<{
    triggerName: string;
    count: number;
    /** Apex source line numbers — NOT raw log row numbers. Display-only; do not use as jump targets. */
    lineNumbers: number[];
    /** Raw log line texts for each trigger occurrence — look these up in the raw line map to get actual row numbers. */
    rawLogLineTexts: string[];
    evidenceMeta: {
      /** Trigger occurrences carrying a valid Apex source line. */
      lineNumberCount: number;
      /** Trigger occurrences carrying non-empty raw evidence. */
      rawLogLineTextCount: number;
      lineNumbersTruncated: boolean;
      rawLogLineTextsTruncated: boolean;
    };
  }>;
}
