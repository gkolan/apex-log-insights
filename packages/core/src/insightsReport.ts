import type { JsonValue } from "./report.js";
import type {
  FlatEvent,
  UnknownRecord,
  ParsedVariableAssignment,
  ParsedVariableScope,
  ParsedExplainPlan,
  DatabaseSoqlEntry,
  DatabaseSoslEntry,
  DatabaseDmlEntry,
  DatabaseCalloutEntry,
  IntegrationOperation,
  ExecutionContextDetection,
} from "./insights/types.js";
import {
  basename,
  isRecord,
  asNumber,
  asString,
  asArray,
  readPath,
  cloneJsonLike,
  parseLogId,
  eventClockFromLogLine,
  parseUserInfoFromLogLine,
  countByKey,
  toLimit,
  flattenEvents,
  parseDmlText,
  parseCalloutRequestText,
  parseCalloutResponseText,
  queueableClassFromText,
  isErrorEventType,
  isSpanCandidate,
  buildSpanLabel,
  parseValidationCodeUnitLabel,
} from "./insights/utils.js";
import {
  buildDynamicPrefixMap,
  extractRecordGraph,
  extractTargetObject,
  parseExplainPlan,
  parseVariableAssignment,
  parseVariableScope,
} from "./insights/parsing.js";
import {
  buildHeapAnalysis,
  buildGovernorBurnRate,
  assessDebugLevelQuality,
  buildCpuAttribution,
  buildManagedPackageImpact,
} from "./insights/governor.js";
import {
  buildExecutionPhases,
  collectSalesforceIds,
  detectExecutionContext,
  buildContextOverride,
  detectMixedDml,
  detectRecursiveTriggers,
  extractSystemModeTransitions,
  buildTriggerCascade,
} from "./insights/execution.js";
import {
  extractNamedCredentials,
  compactIssueType,
  buildSoqlPatternAnalysis,
  extractSavepoints,
  extractCursorOperations,
} from "./insights/database.js";

// Re-export types used downstream (offlineReport.ts, cli.ts only import buildInsightsReport,
// but ensure type-only re-exports don't break anything)
export type {
  FlatEvent,
  UnknownRecord,
  ParsedVariableAssignment,
  ParsedVariableScope,
  ParsedExplainPlan,
  DatabaseSoqlEntry,
  DatabaseDmlEntry,
  DatabaseCalloutEntry,
  ExecutionContextDetection,
};

function parseViewstateBytes(text: string | null | undefined): number | null {
  const source = String(text || "").trim();
  if (!source) return null;

  const sizeWithUnit = source.match(
    /(?<![\d.+-])(\d+(?:\.\d+)?)\s*(bytes?|kb|mb|b)\b/i,
  );
  if (!sizeWithUnit) return null;
  const value = Number(sizeWithUnit[1]!);
  const unit = sizeWithUnit[2]!.toLowerCase();
  if (!Number.isFinite(value) || value < 0) return null;
  if ((unit === "b" || unit.startsWith("byte")) && !Number.isSafeInteger(value))
    return null;
  const multiplier = unit === "mb" ? 1024 * 1024 : unit === "kb" ? 1024 : 1;
  const bytes = Math.round(value * multiplier);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

/** Sum complete, exact row evidence without turning an unknown or overflow into zero. */
function sumExactRows(entries: Array<{ rows: number | null }>): number | null {
  let total = 0;
  for (const entry of entries) {
    if (entry.rows === null) return null;
    total += entry.rows;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

/**
 * Builds a comprehensive insights report from the raw parser result.
 *
 * This is the main analysis entry point that produces the full JSON report
 * consumed by both the CLI viewer and the browser extension. It analyses:
 *
 * - **Execution context** — auto-detects trigger, batch, queueable, future, scheduled, etc.
 * - **Execution phases** — maps events to the Salesforce Order of Execution lifecycle.
 * - **Governor limits** — cumulative usage, per-namespace breakdown, burn rate, heap analysis.
 * - **Database operations** — SOQL queries, DML statements, callouts, named credentials.
 * - **Performance** — CPU attribution, span hotspots, managed package impact.
 * - **Issues** — parser warnings, errors, and detected anti-patterns.
 *
 * @param params - Input parameters describing the log file and its parsed result.
 * @param params.filePath - Path or name of the log file (used for display and ID extraction).
 * @param params.fileBytes - Size of the log file in bytes.
 * @param params.generatedAt - ISO 8601 timestamp when the report is being generated.
 * @param params.parseTimeMs - How long parsing took, in milliseconds.
 * @param params.parserResult - The raw parser result from the Certinia vendor parser.
 * @param params.contextOverride - Optional execution context override (e.g. `'trigger'`).
 *   When provided, skips auto-detection and uses this value directly.
 * @returns A JSON-serialisable report object keyed by section name.
 *
 * @example
 * ```ts
 * import { parse, buildInsightsReport, utf8ByteLength } from '@apex-log-insights/core';
 *
 * const parserResult = parse(logText);
 * const report = buildInsightsReport({
 *   filePath: 'debug.log',
 *   fileBytes: utf8ByteLength(logText),
 *   generatedAt: new Date().toISOString(),
 *   parseTimeMs: 42,
 *   parserResult,
 * });
 * ```
 */
export interface InsightsReportLimits {
  /** Maximum unique trigger names in the overview. @default 50 */
  triggerNames?: number;
  /** Maximum grouped SOQL patterns in the database section. @default 25 */
  soqlPatterns?: number;
  /** Maximum child triggers attached to each cascade DML node. @default 20 */
  triggerCascadeChildren?: number;
  /** Maximum entries in the performance hotspot collection. @default 25 */
  spanHotspots?: number;
  /** Maximum detailed records retained for each SObject. @default 100 */
  recordsPerSObject?: number;
  /** Maximum Apex cursor create/fetch operations in the database section. @default 100 */
  cursorOperations?: number;
  /** Maximum detailed error, warning, and parser-issue items. @default 500 */
  errorItems?: number;
  /** Maximum recursive-trigger groups retained in analysis. @default 50 */
  recursiveTriggers?: number;
}

function boundedLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : fallback;
}

interface ReportErrorItem {
  type: string;
  summary: string;
  description: string;
  namespace: string;
  severity?: "warn" | "info";
  occurrences?: number;
  eventType?: string | null;
  enclosingCodeUnit?: string | null;
  firstOccurrence?: { timestampNs: number | null; lineNumber: number | null };
  lastOccurrence?: { timestampNs: number | null; lineNumber: number | null };
  evidence: {
    lineNumber: number | null;
    lineNumbers?: number[];
    rawLogLineTexts?: string[];
    timestampNs: number | null;
    raw: string | null;
  };
}

/** Retain the smallest N values without materializing the complete collection. */
class BoundedCollector<T> {
  readonly retained: T[] = [];
  totalCount = 0;

  constructor(
    private readonly limit: number,
    private readonly compare: (left: T, right: T) => number,
  ) {}

  add(value: T): void {
    this.totalCount += 1;
    if (this.limit === 0) return;
    if (this.retained.length < this.limit) {
      this.retained.push(value);
      this.bubbleUp(this.retained.length - 1);
      return;
    }
    if (this.compare(value, this.retained[0]!) >= 0) return;
    this.retained[0] = value;
    this.sinkDown(0);
  }

  values(): T[] {
    return this.retained.slice().sort(this.compare);
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.retained[parent]!, this.retained[index]!) >= 0)
        return;
      [this.retained[parent], this.retained[index]] = [
        this.retained[index]!,
        this.retained[parent]!,
      ];
      index = parent;
    }
  }

  private sinkDown(index: number): void {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let largest = index;
      if (
        left < this.retained.length &&
        this.compare(this.retained[left]!, this.retained[largest]!) > 0
      ) {
        largest = left;
      }
      if (
        right < this.retained.length &&
        this.compare(this.retained[right]!, this.retained[largest]!) > 0
      ) {
        largest = right;
      }
      if (largest === index) return;
      [this.retained[index], this.retained[largest]] = [
        this.retained[largest]!,
        this.retained[index]!,
      ];
      index = largest;
    }
  }
}

export function buildInsightsReport(params: {
  filePath: string;
  fileBytes: number;
  generatedAt: string;
  parseTimeMs: number;
  parserResult: unknown;
  /** Optional CLI --context override. When set, skips auto-detection. */
  contextOverride?: string;
  /** Optional caps for potentially large report collections. */
  limits?: InsightsReportLimits;
}): Record<string, JsonValue> {
  const {
    filePath,
    fileBytes,
    generatedAt,
    parseTimeMs,
    parserResult,
    contextOverride,
    limits = {},
  } = params;
  const triggerNamesLimit = boundedLimit(limits.triggerNames, 50);
  const soqlPatternsLimit = boundedLimit(limits.soqlPatterns, 25);
  const triggerCascadeChildrenLimit = boundedLimit(
    limits.triggerCascadeChildren,
    20,
  );
  const spanHotspotsLimit = boundedLimit(limits.spanHotspots, 25);
  const recordsPerSObjectLimit = boundedLimit(limits.recordsPerSObject, 100);
  const cursorOperationsLimit = boundedLimit(limits.cursorOperations, 100);
  const errorItemsLimit = boundedLimit(limits.errorItems, 500);
  const recursiveTriggersLimit = boundedLimit(limits.recursiveTriggers, 50);
  const fileName = basename(filePath);
  const logId = parseLogId(fileName);
  const allEvents = flattenEvents(parserResult);
  const allCursorOperations = extractCursorOperations(allEvents);
  const cursorOperations = allCursorOperations.slice(0, cursorOperationsLimit);

  const issues = asArray(readPath(parserResult, ["logIssues"]));
  const parsingErrors = asArray(readPath(parserResult, ["parsingErrors"]));
  const parsingDiagnostics = asArray(
    readPath(parserResult, ["parsingDiagnostics"]),
  );
  const parsingErrorOverflowCount =
    asNumber(readPath(parserResult, ["parsingErrorOverflowCount"])) ?? 0;
  const namespaces = asArray(readPath(parserResult, ["namespaces"])).filter(
    (v): v is string => typeof v === "string",
  );
  const governorLimits = readPath(parserResult, ["governorLimits"]) ?? {};

  const executionStartEvent = allEvents.find(
    (event) => event.type === "EXECUTION_STARTED",
  );
  const hasCompleteExecutionBoundary =
    executionStartEvent?.pairingStatus === "complete" &&
    executionStartEvent.durationTotalNs !== null &&
    !executionStartEvent.timestampIsInferred;
  const relativeStartNs = executionStartEvent?.timestampIsInferred
    ? null
    : (executionStartEvent?.timestampNs ?? null);
  const relativeEndNs = hasCompleteExecutionBoundary
    ? executionStartEvent.endTimestampNs
    : null;

  // Compute execution duration.  The Certinia parser exposes startTime (wall-clock ms)
  // and executionEndTime (ns counter), but they live on different time bases, so
  // subtracting them is unreliable.  Instead, prefer the per-event nanosecond
  // counters embedded in each log line — these give elapsed execution time directly.
  const durationMs = hasCompleteExecutionBoundary
    ? Math.round(executionStartEvent.durationTotalNs! / 1_000_000)
    : null;
  const userInfoEvent = allEvents.find((e) => e.type === "USER_INFO");
  const parsedUserInfo = parseUserInfoFromLogLine(userInfoEvent?.logLine ?? "");
  const startTimestamp = executionStartEvent
    ? eventClockFromLogLine(executionStartEvent.logLine)
    : null;
  const endTimestamp = hasCompleteExecutionBoundary
    ? eventClockFromLogLine(executionStartEvent.exitLogLine!)
    : null;

  const rootCodeUnit =
    allEvents.find((e) => e.type === "CODE_UNIT_STARTED")?.text ?? null;

  const allTriggerNames = Array.from(
    new Set(
      allEvents
        .filter(
          (e) =>
            e.type === "CODE_UNIT_STARTED" && e.text.includes("trigger event"),
        )
        .map((e) => e.text.replace(/.*?\|/, "").trim()),
    ),
  );
  const triggerNames = allTriggerNames.slice(0, triggerNamesLimit);
  const triggerNamesMeta = {
    items: triggerNames,
    totalCount: allTriggerNames.length,
    truncated: allTriggerNames.length > triggerNamesLimit,
    limit: triggerNamesLimit,
  };

  const flowInterviews = allEvents
    .filter((e) => e.type === "FLOW_START_INTERVIEW_BEGIN")
    .map((e, i) => ({
      flowInterviewId: `flow-${i + 1}`,
      flowApiName: e.text || "Unknown Flow",
      status: "started",
      evidence: {
        lineStart: e.lineNumber,
        lineEnd: e.lineNumber,
      },
    }));

  const debugEvents = allEvents
    .filter(
      (e) =>
        e.type === "USER_DEBUG" ||
        e.type.startsWith("USER_DEBUG_") ||
        e.type === "DATAWEAVE_USER_DEBUG",
    )
    .map((e, i) => ({
      id: `debug-${i + 1}`,
      eventType: e.type,
      level:
        e.type === "DATAWEAVE_USER_DEBUG"
          ? null
          : e.type === "USER_DEBUG"
            ? (e.text.match(
                /^(FINEST|FINER|FINE|DEBUG|INFO|WARN|ERROR)\s*\|/,
              )?.[1] ?? null)
            : e.type.slice("USER_DEBUG_".length),
      timestampNs: e.timestampNs,
      lineNumber: e.lineNumber,
      sourceLineNumber: e.sourceLineNumber,
      namespace: e.namespace,
      message: e.text,
      evidence: e.logLine || null,
    }));

  const traceEvents = allEvents.map((e, i) => {
    const durationNs = e.durationTotalNs ?? null;
    const endNs = e.endTimestampNs ?? null;
    // Pre-compute milliseconds from the boundary-derived duration so null and
    // an observed zero remain distinct throughout the canonical report.
    let durationMs: number | null = null;
    if (durationNs !== null) {
      durationMs = Math.round((durationNs / 1_000_000) * 1000) / 1000;
    }
    return {
      id: `event-${i + 1}`,
      idx: e.idx,
      type: e.type,
      timestampNs: e.timestampNs,
      timestampIsInferred: e.timestampIsInferred,
      endNs,
      durationNs,
      durationMs,
      lineNumber: e.lineNumber,
      sourceLineNumber: e.sourceLineNumber,
      namespace: e.namespace,
      text: e.text || null,
      raw: e.logLine || null,
    };
  });

  const soqlEvents = allEvents.filter((e) => e.type === "SOQL_EXECUTE_BEGIN");
  const soslEvents = allEvents.filter((e) => e.type === "SOSL_EXECUTE_BEGIN");
  const dmlEvents = allEvents.filter((e) => e.type === "DML_BEGIN");
  const calloutEvents = allEvents.filter(
    (e) => e.type === "CALLOUT_REQUEST" && !e.isContinuation,
  );
  const calloutFragmentsByParent = new Map<number, string[]>();
  for (const event of allEvents) {
    if (
      event.type !== "CALLOUT_REQUEST" ||
      !event.isContinuation ||
      event.parentIdx === null
    ) {
      continue;
    }
    const fragments = calloutFragmentsByParent.get(event.parentIdx) ?? [];
    fragments.push(event.text);
    calloutFragmentsByParent.set(event.parentIdx, fragments);
  }
  const soqlExplainByParent = new Map<number, ParsedExplainPlan>();
  const soqlExplainByLine = new Map<number, ParsedExplainPlan>();
  for (const explainEvent of allEvents.filter(
    (e) => e.type === "SOQL_EXECUTE_EXPLAIN",
  )) {
    const plan = parseExplainPlan(explainEvent.text);
    if (explainEvent.parentIdx !== null) {
      soqlExplainByParent.set(explainEvent.parentIdx, plan);
    } else if (explainEvent.sourceLineNumber !== null) {
      soqlExplainByLine.set(explainEvent.sourceLineNumber, plan);
    }
  }

  const databaseSoql: DatabaseSoqlEntry[] = soqlEvents.map((e, i) => ({
    id: `soql-${i + 1}`,
    query: e.text || null,
    targetObject: extractTargetObject(e.text || null),
    aggregations: e.aggregations,
    // A begin node owns a zero-initialized counter even when its end record is
    // missing. Only a typed, completely paired end proves that Salesforce
    // observed a row count (including an actual zero).
    rows: e.pairingStatus === "complete" ? e.soqlRowCountTotal : null,
    count: e.soqlCountTotal,
    durationNs: e.durationTotalNs,
    durationMs:
      e.durationTotalNs !== null
        ? Math.round((e.durationTotalNs / 1_000_000) * 1000) / 1000
        : null,
    explain:
      soqlExplainByParent.get(e.idx) ??
      (e.sourceLineNumber !== null
        ? (soqlExplainByLine.get(e.sourceLineNumber) ?? null)
        : null),
    namespace: e.namespace,
    category: e.category || null,
    debugCategory: e.debugCategory || null,
    evidence: {
      lineNumber: e.lineNumber,
      sourceLineNumber: e.sourceLineNumber,
      timestampNs: e.timestampNs,
      raw: e.logLine || null,
    },
  }));

  const databaseSosl: DatabaseSoslEntry[] = soslEvents.map((e, i) => ({
    id: `sosl-${i + 1}`,
    query: e.text || null,
    rows: e.pairingStatus === "complete" ? e.soslRowCountTotal : null,
    count: e.soslCountTotal,
    durationNs: e.durationTotalNs,
    durationMs:
      e.durationTotalNs !== null
        ? Math.round((e.durationTotalNs / 1_000_000) * 1000) / 1000
        : null,
    namespace: e.namespace,
    category: e.category || null,
    debugCategory: e.debugCategory || null,
    evidence: {
      lineNumber: e.lineNumber,
      sourceLineNumber: e.sourceLineNumber,
      timestampNs: e.timestampNs,
      raw: e.logLine || null,
    },
  }));

  const databaseDmlFromEvents: DatabaseDmlEntry[] = dmlEvents.map((e, i) => {
    const parsed = parseDmlText(e.text);
    return {
      id: `dml-${i + 1}`,
      operation: parsed.operation,
      sObject: parsed.sobject,
      rows: e.pairingStatus === "complete" ? e.dmlRowCountTotal : null,
      count: e.dmlCountTotal,
      durationNs: e.durationTotalNs,
      durationMs:
        e.durationTotalNs !== null
          ? Math.round((e.durationTotalNs / 1_000_000) * 1000) / 1000
          : null,
      namespace: e.namespace,
      category: e.category || null,
      debugCategory: e.debugCategory || null,
      text: e.text || null,
      source: "event",
      evidence: {
        lineNumber: e.lineNumber,
        sourceLineNumber: e.sourceLineNumber,
        timestampNs: e.timestampNs,
        raw: e.logLine || null,
      },
    };
  });

  const databaseDml: DatabaseDmlEntry[] = databaseDmlFromEvents;

  const databaseCallouts: DatabaseCalloutEntry[] = calloutEvents.map((e, i) => {
    const requestText = [
      e.text,
      ...(calloutFragmentsByParent.get(e.idx) ?? []),
    ].join("\n");
    const parsed = parseCalloutRequestText(requestText);
    const responseParsed = e.responseText
      ? parseCalloutResponseText(e.responseText)
      : { statusCode: null, statusText: null };

    return {
      id: `callout-${i + 1}`,
      endpoint: parsed.endpoint,
      host: parsed.host,
      method: parsed.method,
      statusCode: responseParsed.statusCode,
      statusText: responseParsed.statusText,
      responseLineNumber: e.responseLineNumber ?? null,
      durationNs: e.durationTotalNs,
      durationMs:
        e.durationTotalNs !== null
          ? Math.round((e.durationTotalNs / 1_000_000) * 1000) / 1000
          : null,
      namespace: e.namespace,
      category: e.category || null,
      debugCategory: e.debugCategory || null,
      text: requestText || null,
      evidence: {
        lineNumber: e.lineNumber,
        sourceLineNumber: e.sourceLineNumber,
        timestampNs: e.timestampNs,
        raw: e.logLine || null,
      },
    };
  });

  const spanCandidates = allEvents.filter(isSpanCandidate);
  const unitIdByEventIdx = new Map<number, string>();
  const spans = spanCandidates.map((event, i) => {
    const unitId = `unit-${i + 1}`;
    unitIdByEventIdx.set(event.idx, unitId);
    return {
      id: unitId,
      eventId: `event-${event.idx + 1}`,
      parentId:
        event.parentIdx !== null
          ? (unitIdByEventIdx.get(event.parentIdx) ?? null)
          : null,
      eventType: event.type,
      label: buildSpanLabel(event),
      namespace: event.namespace,
      category: event.category || null,
      debugCategory: event.debugCategory || null,
      cpuType: event.cpuType || null,
      startNs: event.timestampNs,
      endNs: event.endTimestampNs,
      durationNs: event.durationTotalNs,
      durationMs:
        event.durationTotalNs !== null
          ? Math.round((event.durationTotalNs / 1_000_000) * 1000) / 1000
          : null,
      selfDurationNs: event.durationSelfNs,
      selfDurationMs:
        event.durationSelfNs !== null
          ? Math.round((event.durationSelfNs / 1_000_000) * 1000) / 1000
          : null,
      evidence: {
        lineNumber: event.lineNumber,
        raw: event.logLine || null,
      },
    };
  });

  const validationUnits = spans.filter(
    (s) =>
      s.eventType === "CODE_UNIT_STARTED" &&
      String(s.label || "").startsWith("Validation:"),
  );

  const validationBlocks = validationUnits.map((unit) => {
    const startNs = unit.startNs;
    const endNs = unit.endNs ?? unit.startNs;
    const meta = parseValidationCodeUnitLabel(String(unit.label || ""));
    const eventsInWindow = allEvents
      .filter(
        (event) => event.timestampNs >= startNs && event.timestampNs <= endNs,
      )
      .filter((event) => event.type.startsWith("VALIDATION_"))
      .sort((a, b) => a.timestampNs - b.timestampNs);

    const rules: Array<{
      ruleName: string | null;
      formula: string | null;
      outcome: "PASS" | "ERROR" | "UNKNOWN";
      errorText: string | null;
      timestampNs: number;
    }> = [];
    let currentRule: (typeof rules)[number] | null = null;

    for (const event of eventsInWindow) {
      if (event.type === "VALIDATION_RULE") {
        currentRule = {
          ruleName: event.text || null,
          formula: null,
          outcome: "UNKNOWN",
          errorText: null,
          timestampNs: event.timestampNs,
        };
        rules.push(currentRule);
        continue;
      }

      if (!currentRule) {
        currentRule = {
          ruleName: null,
          formula: null,
          outcome: "UNKNOWN",
          errorText: null,
          timestampNs: event.timestampNs,
        };
        rules.push(currentRule);
      }

      if (event.type === "VALIDATION_FORMULA")
        currentRule.formula = event.text || null;
      if (event.type === "VALIDATION_PASS") currentRule.outcome = "PASS";
      if (event.type === "VALIDATION_ERROR") {
        currentRule.outcome = "ERROR";
        currentRule.errorText = event.text || null;
      }
    }

    return {
      eventId: unit.eventId,
      label: unit.label,
      namespace: unit.namespace,
      startNs,
      endNs,
      sobject: meta.sobject,
      context: meta.context,
      totals: {
        ruleCount: rules.length,
        passCount: rules.filter((rule) => rule.outcome === "PASS").length,
        errorCount: rules.filter((rule) => rule.outcome === "ERROR").length,
      },
      rules,
    };
  });

  const flowUnits = spans.filter(
    (s) =>
      s.eventType === "CODE_UNIT_STARTED" &&
      String(s.label || "").startsWith("Flow:"),
  );
  const flowBlocks = flowUnits.map((unit) => {
    const startNs = unit.startNs;
    const endNs = unit.endNs ?? unit.startNs;
    const eventsInWindow = allEvents
      .filter(
        (event) => event.timestampNs >= startNs && event.timestampNs <= endNs,
      )
      .filter((event) => event.type.startsWith("FLOW_"))
      .sort((a, b) => a.timestampNs - b.timestampNs);

    return {
      eventId: unit.eventId,
      label: unit.label,
      namespace: unit.namespace,
      startNs,
      endNs,
      totals: {
        eventCount: eventsInWindow.length,
        errorCount: eventsInWindow.filter(
          (event) =>
            event.type.includes("ERROR") || event.type.includes("FAULT"),
        ).length,
      },
      steps: eventsInWindow.map((event) => ({
        timestampNs: event.timestampNs,
        type: event.type,
        text: event.text || null,
        lineNumber: event.lineNumber,
      })),
    };
  });

  const workflowUnits = spans.filter(
    (s) =>
      s.eventType === "CODE_UNIT_STARTED" &&
      String(s.label || "").startsWith("Workflow:"),
  );
  const workflowBlocks = workflowUnits.map((unit) => {
    const startNs = unit.startNs;
    const endNs = unit.endNs ?? unit.startNs;
    const eventsInWindow = allEvents
      .filter(
        (event) => event.timestampNs >= startNs && event.timestampNs <= endNs,
      )
      .filter(
        (event) =>
          event.type.startsWith("WF_") ||
          event.type === "EVENT_SERVICE_PUB_BEGIN",
      )
      .sort((a, b) => a.timestampNs - b.timestampNs);

    return {
      eventId: unit.eventId,
      label: unit.label,
      namespace: unit.namespace,
      startNs,
      endNs,
      totals: {
        eventCount: eventsInWindow.length,
        errorCount: eventsInWindow.filter((event) =>
          event.type.includes("ERROR"),
        ).length,
      },
      steps: eventsInWindow.map((event) => ({
        timestampNs: event.timestampNs,
        type: event.type,
        text: event.text || null,
        lineNumber: event.lineNumber,
      })),
    };
  });

  const eventIdsByType = new Map<string, string[]>();
  const eventIdsByLine = new Map<string, string[]>();
  const eventRangesByTimestamp: Array<{
    eventId: string;
    type: string;
    startNs: number;
    endNs: number;
    lineNumber: number | null;
  }> = [];

  for (let i = 0; i < traceEvents.length; i += 1) {
    const eventView = traceEvents[i]!;
    const sourceEvent = allEvents[i];
    const eventId = String(eventView.id);
    const type = String(eventView.type || "UNKNOWN");

    const idsForType = eventIdsByType.get(type);
    if (idsForType) idsForType.push(eventId);
    else eventIdsByType.set(type, [eventId]);

    if (
      typeof eventView.lineNumber === "number" &&
      Number.isFinite(eventView.lineNumber) &&
      eventView.lineNumber >= 1
    ) {
      const lineKey = String(eventView.lineNumber);
      const idsForLine = eventIdsByLine.get(lineKey);
      if (idsForLine) idsForLine.push(eventId);
      else eventIdsByLine.set(lineKey, [eventId]);
    }

    const startNs = Number(sourceEvent?.timestampNs ?? 0);
    const endNs = Number(
      sourceEvent?.endTimestampNs ?? sourceEvent?.timestampNs ?? 0,
    );
    eventRangesByTimestamp.push({
      eventId,
      type,
      startNs,
      endNs: endNs >= startNs ? endNs : startNs,
      lineNumber:
        typeof eventView.lineNumber === "number" ? eventView.lineNumber : null,
    });
  }

  const eventsByType = Object.fromEntries(eventIdsByType);
  const lineToEventIds = Object.fromEntries(eventIdsByLine);

  const boundIssueText = (value: string, maxChars: number): string =>
    value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}…`;
  const errorItemOrder = new WeakMap<ReportErrorItem, number>();
  const nextErrorItemOrder = [0, 0, 0, 0];
  const compareErrorItems = (
    left: ReportErrorItem,
    right: ReportErrorItem,
  ): number => {
    const timestampDifference =
      (left.evidence.timestampNs ?? 0) - (right.evidence.timestampNs ?? 0);
    if (timestampDifference !== 0) return timestampDifference;
    const lineDifference =
      (left.evidence.lineNumber ?? 0) - (right.evidence.lineNumber ?? 0);
    if (lineDifference !== 0) return lineDifference;
    return (errorItemOrder.get(left) ?? 0) - (errorItemOrder.get(right) ?? 0);
  };
  const errorItems = new BoundedCollector<ReportErrorItem>(
    errorItemsLimit,
    compareErrorItems,
  );
  const collectErrorItem = (
    item: ReportErrorItem,
    category: 0 | 1 | 2 | 3,
  ): void => {
    errorItemOrder.set(
      item,
      category * 1_000_000_000 + nextErrorItemOrder[category]!,
    );
    nextErrorItemOrder[category]! += 1;
    errorItems.add(item);
  };

  let rawEventErrorCount = 0;
  const firstEventByTimestamp = new Map<number, FlatEvent>();
  for (const event of allEvents) {
    if (!firstEventByTimestamp.has(event.timestampNs)) {
      firstEventByTimestamp.set(event.timestampNs, event);
    }
    if (!isErrorEventType(event.type)) continue;
    rawEventErrorCount += 1;
    collectErrorItem(
      {
        type: event.type,
        summary: boundIssueText(event.text || event.type, 500),
        description:
          event.text && event.text.includes("\n")
            ? boundIssueText(event.text, 2_000)
            : "",
        namespace: event.namespace,
        evidence: {
          lineNumber: event.lineNumber,
          timestampNs: event.timestampNs,
          raw: event.logLine ? boundIssueText(event.logLine, 2_000) : null,
        },
      },
      2,
    );
  }

  let issueErrorCount = 0;
  for (const issue of issues) {
    issueErrorCount += 1;
    const timestampNs = asNumber(readPath(issue, ["startTime"])) ?? null;
    const supportingEvent =
      timestampNs === null
        ? null
        : (firstEventByTimestamp.get(timestampNs) ?? null);
    const lastTimestampNs =
      asNumber(readPath(issue, ["lastTime"])) ?? timestampNs;
    const lastSupportingEvent =
      lastTimestampNs === null
        ? null
        : (firstEventByTimestamp.get(lastTimestampNs) ?? null);
    collectErrorItem(
      {
        type: asString(readPath(issue, ["type"])) ?? "issue",
        summary: boundIssueText(
          asString(readPath(issue, ["summary"])) ?? "Log issue",
          500,
        ),
        description: boundIssueText(
          asString(readPath(issue, ["description"])) ?? "",
          2_000,
        ),
        occurrences: asNumber(readPath(issue, ["occurrences"])) ?? 1,
        eventType: supportingEvent?.type ?? null,
        enclosingCodeUnit:
          supportingEvent && supportingEvent.parentIdx !== null
            ? (allEvents[supportingEvent.parentIdx]?.text ?? null)
            : null,
        firstOccurrence: {
          timestampNs,
          lineNumber: supportingEvent?.lineNumber ?? null,
        },
        lastOccurrence: {
          timestampNs: lastTimestampNs,
          lineNumber: lastSupportingEvent?.lineNumber ?? null,
        },
        namespace: supportingEvent?.namespace ?? "default",
        evidence: {
          lineNumber: supportingEvent?.lineNumber ?? null,
          timestampNs,
          raw: supportingEvent?.logLine
            ? boundIssueText(supportingEvent.logLine, 2_000)
            : null,
        },
      },
      0,
    );
  }

  let parseErrorCount = 0;
  for (const entry of parsingErrors) {
    parseErrorCount += 1;
    collectErrorItem(
      {
        type: "parsing_error",
        summary: "Parser warning",
        description: boundIssueText(String(entry), 2_000),
        namespace: "default",
        evidence: { lineNumber: null, timestampNs: null, raw: null },
      },
      1,
    );
  }
  if (parsingErrorOverflowCount > 0) {
    parseErrorCount += 1;
    collectErrorItem(
      {
        type: "parsing_error",
        summary: "Additional parser warnings omitted",
        description: `${parsingErrorOverflowCount} additional diagnostics exceeded the parser safety cap.`,
        namespace: "default",
        evidence: { lineNumber: null, timestampNs: null, raw: null },
      },
      1,
    );
  }

  const variableAssignments = allEvents
    .map(parseVariableAssignment)
    .filter((entry): entry is ParsedVariableAssignment => entry !== null);
  const variableScopes = allEvents
    .map(parseVariableScope)
    .filter((entry): entry is ParsedVariableScope => entry !== null);
  const variableTypeByName = new Map<string, string>();
  for (const scope of variableScopes) {
    if (!variableTypeByName.has(scope.variableName)) {
      variableTypeByName.set(scope.variableName, scope.typeName);
    }
  }

  const scopeRecordIds = new Set<string>();
  for (const va of variableAssignments) {
    const name = va.variableName.toLowerCase();
    if (name === "scope" || name.endsWith("ids") || name.endsWith("id")) {
      collectSalesforceIds(va.parsedValue ?? va.rawValue, scopeRecordIds);
    }
  }

  const eventDml = databaseDml.filter((dml) => dml.source === "event");
  const dmlEventRows = sumExactRows(eventDml);
  const dmlByObject = eventDml.reduce<Record<string, number | null>>(
    (acc, dml) => {
      const key = dml.sObject || dml.operation || "Unknown";
      const current = acc[key];
      if (current === null || dml.rows === null) {
        acc[key] = null;
      } else {
        const next = (current ?? 0) + dml.rows;
        acc[key] = Number.isSafeInteger(next) ? next : null;
      }
      return acc;
    },
    {},
  );

  const executionContext =
    (contextOverride ? buildContextOverride(contextOverride) : null) ??
    detectExecutionContext(rootCodeUnit, allEvents, variableAssignments);
  const executionType = executionContext.label;
  const mixedDml = detectMixedDml(databaseDml);
  const recursiveTriggerDetection = detectRecursiveTriggers(
    spans,
    recursiveTriggersLimit,
  );
  const namedCredentials = extractNamedCredentials(allEvents);

  // ── Pair Named Credentials with their CALLOUT_REQUEST/RESPONSE counterpart ─
  // Each NC_REQUEST is immediately followed by a CALLOUT_REQUEST within a small
  // time window. We match by timestamp proximity, consuming each callout at most once.
  const NC_PAIR_WINDOW_NS = 20_000_000; // 20 ms
  const pairedCalloutIds = new Set<string>();
  const pairedNcIds = new Set<string>();
  const integrationOperations: IntegrationOperation[] = [];
  let integrationIdCounter = 0;
  let calloutCursor = 0;

  for (const nc of namedCredentials) {
    const ncTs = nc.evidence.timestampNs ?? -1;
    while (
      calloutCursor < databaseCallouts.length &&
      (databaseCallouts[calloutCursor]!.evidence.timestampNs ?? -1) < ncTs
    ) {
      calloutCursor += 1;
    }
    const candidate = databaseCallouts[calloutCursor];
    const candidateTs = candidate?.evidence.timestampNs ?? -1;
    const lineDistance =
      candidate?.evidence.lineNumber !== null &&
      candidate?.evidence.lineNumber !== undefined &&
      nc.evidence.lineNumber !== null
        ? candidate.evidence.lineNumber - nc.evidence.lineNumber
        : Number.MAX_SAFE_INTEGER;
    const paired =
      candidate &&
      candidateTs < ncTs + NC_PAIR_WINDOW_NS &&
      lineDistance > 0 &&
      lineDistance <= 3
        ? candidate
        : undefined;
    if (paired) {
      calloutCursor += 1;
      pairedCalloutIds.add(paired.id);
      pairedNcIds.add(nc.id);
      integrationIdCounter += 1;
      integrationOperations.push({
        id: `integration-${integrationIdCounter}`,
        credentialName: nc.credentialName,
        endpoint: paired.endpoint ?? nc.endpoint,
        host: paired.host,
        method: paired.method ?? nc.method,
        statusCode: paired.statusCode ?? nc.statusCode,
        statusText: paired.statusText ?? nc.statusText,
        durationMs: paired.durationMs ?? nc.durationMs,
        namespace: paired.namespace,
        evidence: paired.evidence,
        calloutId: paired.id,
        namedCredentialId: nc.id,
      });
    }
  }
  // Unpaired callouts (direct Http.send() without Named Credential)
  for (const c of databaseCallouts) {
    if (pairedCalloutIds.has(c.id)) continue;
    integrationIdCounter += 1;
    integrationOperations.push({
      id: `integration-${integrationIdCounter}`,
      credentialName: null,
      endpoint: c.endpoint,
      host: c.host,
      method: c.method,
      statusCode: c.statusCode,
      statusText: c.statusText,
      durationMs: c.durationMs,
      namespace: c.namespace,
      evidence: c.evidence,
      calloutId: c.id,
      namedCredentialId: null,
    });
  }
  // Unpaired Named Credentials (NC event present but no corresponding callout in log)
  for (const nc of namedCredentials) {
    if (pairedNcIds.has(nc.id)) continue;
    integrationIdCounter += 1;
    integrationOperations.push({
      id: `integration-${integrationIdCounter}`,
      credentialName: nc.credentialName,
      endpoint: nc.endpoint,
      host: null,
      method: nc.method,
      statusCode: nc.statusCode,
      statusText: nc.statusText,
      durationMs: nc.durationMs,
      namespace: nc.namespace,
      evidence: nc.evidence,
      calloutId: null,
      namedCredentialId: nc.id,
    });
  }

  let syntheticWarningCount = 0;
  const addSyntheticWarning = (warning: ReportErrorItem): void => {
    syntheticWarningCount += 1;
    collectErrorItem(warning, 3);
  };

  let emptyQueryCount = 0;

  // ── Per-query consolidated warnings ────────────────────────────────────────
  // Instead of separate passes for empty/slow/noExplain that produce
  // duplicate rows for the same query, we walk databaseSoql once and
  // collect all findings per query into a single warning entry.
  for (const query of databaseSoql) {
    const findings: string[] = [];
    let highestSeverity: "warn" | "info" = "info";

    const isEmptyResult = query.rows === 0;
    if (isEmptyResult) emptyQueryCount += 1;
    const isSlow = (query.durationMs ?? 0) >= 50;
    const noExplain = query.explain?.available === false;

    if (isEmptyResult) {
      findings.push("returned 0 rows");
    }
    if (isSlow) {
      findings.push(`took ${query.durationMs?.toFixed(1)} ms`);
      highestSeverity = "warn";
    }
    if (noExplain) {
      findings.push("no explain plan available (likely empty bind variables)");
      highestSeverity = "warn";
    }

    if (findings.length === 0) continue;

    // Promote severity: empty+slow together is more concerning than empty alone
    if (isEmptyResult && isSlow) highestSeverity = "warn";
    if (isEmptyResult && !isSlow && !noExplain) highestSeverity = "info";

    const objectName = query.targetObject ?? "SOQL query";
    const findingsSummary = findings.join(", ");

    const queryType =
      isEmptyResult && isSlow
        ? "SOQL_QUERY_WARNING"
        : isEmptyResult
          ? "EMPTY_QUERY_WARNING"
          : isSlow
            ? "SLOW_QUERY_WARNING"
            : "NO_EXPLAIN_PLAN_WARNING";

    // Descriptions add new context beyond the summary — they do NOT repeat the
    // object name or finding already shown in the summary line.
    const queryDescription =
      queryType === "SOQL_QUERY_WARNING"
        ? "A query that returns nothing but still runs slowly often means Salesforce scanned many rows before filtering — a sign the filter fields may not be indexed."
        : queryType === "NO_EXPLAIN_PLAN_WARNING"
          ? "Query ran with empty or null bind variables — Salesforce skips explain plan generation when all inputs are empty at runtime."
          : ""; // summary is self-explanatory for pure empty or pure slow

    addSyntheticWarning({
      type: queryType,
      summary: `${objectName}: ${findingsSummary}`,
      description: queryDescription,
      severity: highestSeverity,
      namespace: query.namespace,
      evidence: {
        lineNumber: query.evidence.lineNumber,
        timestampNs: query.evidence.timestampNs,
        raw: query.evidence.raw,
      },
    });
  }

  const seenEmptyMaps = new Set<string>();
  let emptyMapCandidates = 0;
  for (const entry of variableAssignments) {
    if (!entry.isEmptyCollection || !/^map/i.test(entry.variableName)) continue;
    emptyMapCandidates += 1;
    if (emptyMapCandidates > 50) break;
    if (seenEmptyMaps.has(entry.variableName)) continue;
    seenEmptyMaps.add(entry.variableName);

    const evidenceEvent = allEvents.find(
      (event) =>
        event.type === "VARIABLE_ASSIGNMENT" &&
        event.text.startsWith(`${entry.variableName} |`),
    );

    const variableType = variableTypeByName.get(entry.variableName) ?? null;
    const displayType = variableType || "Map";
    addSyntheticWarning({
      type: "EMPTY_RESULT_MAP_WARNING",
      summary: `${displayType} ${entry.variableName} is empty`,
      description: `${displayType} "${entry.variableName}" was assigned an empty collection, which can short-circuit downstream processing.`,
      severity: "warn",
      namespace: evidenceEvent?.namespace ?? "default",
      evidence: {
        lineNumber: evidenceEvent?.lineNumber ?? null,
        timestampNs: evidenceEvent?.timestampNs ?? null,
        raw: evidenceEvent?.logLine ?? null,
      },
    });
  }

  const noOpDml = databaseDml.find(
    (dml) =>
      dml.operation?.toLowerCase() === "update" &&
      dml.durationMs === 0 &&
      dml.rows === 0,
  );
  if (noOpDml) {
    addSyntheticWarning({
      type: "NO_OP_DML_WARNING",
      summary: `${noOpDml.sObject ?? "Update"}: wrote 0 rows`,
      description: "",
      severity: "warn",
      namespace: noOpDml.namespace,
      evidence: {
        lineNumber: noOpDml.evidence.lineNumber,
        timestampNs: noOpDml.evidence.timestampNs,
        raw: noOpDml.evidence.raw,
      },
    });
  }

  // Mixed DML warning
  if (mixedDml.detected) {
    addSyntheticWarning({
      type: "MIXED_DML_OPERATION",
      summary: `Mixed DML: setup objects (${mixedDml.setupObjects.join(", ")}) and non-setup objects (${mixedDml.nonSetupObjects.slice(0, 3).join(", ")}) in same transaction`,
      description: `Salesforce does not allow DML on setup objects (${mixedDml.setupObjects.join(", ")}) and non-setup objects in the same transaction context. This typically causes a System.MixedDmlException.`,
      severity: "warn",
      namespace: "default",
      evidence: {
        lineNumber: mixedDml.evidence[0]?.lineNumber ?? null,
        timestampNs: mixedDml.evidence[0]?.timestampNs ?? null,
        raw: null,
      },
    });
  }

  // Recursive trigger warning
  for (const rt of recursiveTriggerDetection.recursiveTriggers) {
    addSyntheticWarning({
      type: "RECURSIVE_TRIGGER",
      summary: `Trigger "${rt.triggerName}" fired ${rt.count} times in this transaction`,
      description:
        "Repeated trigger execution can increase CPU usage, repeat DML, and create unintended re-entry behavior.",
      severity: "warn",
      namespace: "default",
      evidence: {
        // lineNumber intentionally omitted — rt.lineNumbers are Apex source lines, not raw log rows.
        // Use rawLogLineTexts for raw log row lookup in the viewer instead.
        lineNumber: null,
        timestampNs: null,
        raw: rt.rawLogLineTexts[0] ?? null,
        rawLogLineTexts: rt.rawLogLineTexts,
      },
    });
  }

  // Visualforce viewstate size warning
  const VIEWSTATE_WARN_BYTES = 120 * 1024;
  for (const event of allEvents) {
    if (event.type !== "VF_SERIALIZE_VIEWSTATE_END") continue;
    const bytes =
      parseViewstateBytes(event.text) ?? parseViewstateBytes(event.logLine);
    if (bytes === null || bytes < VIEWSTATE_WARN_BYTES) continue;
    const kb = Math.round((bytes / 1024) * 10) / 10;
    addSyntheticWarning({
      type: "VF_VIEWSTATE_SIZE_WARNING",
      summary: `Visualforce viewstate is ${kb} KB`,
      description:
        "Large viewstate payloads increase page weight and can cause state-size limit issues. Reduce serialized component state where possible.",
      severity: "warn",
      namespace: event.namespace || "default",
      evidence: {
        lineNumber: event.lineNumber,
        timestampNs: event.timestampNs,
        raw: event.logLine || null,
      },
    });
  }

  // Note: errorItems are assembled later as `allErrorItems` after all synthetic
  // warnings (including those from new v0.12.0 analyses) have been collected.

  const soql = isRecord(governorLimits)
    ? readPath(governorLimits, ["soqlQueries"])
    : undefined;
  const rows = isRecord(governorLimits)
    ? readPath(governorLimits, ["queryRows"])
    : undefined;
  const dmlStatements = isRecord(governorLimits)
    ? readPath(governorLimits, ["dmlStatements"])
    : undefined;
  const dmlRows = isRecord(governorLimits)
    ? readPath(governorLimits, ["dmlRows"])
    : undefined;
  const cpu = isRecord(governorLimits)
    ? readPath(governorLimits, ["cpuTime"])
    : undefined;
  const heap = isRecord(governorLimits)
    ? readPath(governorLimits, ["heapSize"])
    : undefined;
  const callouts = isRecord(governorLimits)
    ? readPath(governorLimits, ["callouts"])
    : undefined;
  const queueables = isRecord(governorLimits)
    ? readPath(governorLimits, ["queueableJobsAddedToQueue"])
    : undefined;
  const emailInvocations = isRecord(governorLimits)
    ? readPath(governorLimits, ["emailInvocations"])
    : undefined;
  const futureCalls = isRecord(governorLimits)
    ? readPath(governorLimits, ["futureCalls"])
    : undefined;

  const soqlUsed = asNumber(readPath(soql, ["used"]));
  const soqlRowsUsed = asNumber(readPath(rows, ["used"]));
  const dmlStatementsUsed = asNumber(readPath(dmlStatements, ["used"]));
  const dmlRowsUsed = asNumber(readPath(dmlRows, ["used"]));
  const hasSoqlUsageEvidence = (asNumber(readPath(soql, ["limit"])) ?? 0) > 0;
  const hasSoqlRowsUsageEvidence =
    (asNumber(readPath(rows, ["limit"])) ?? 0) > 0;
  const hasDmlUsageEvidence =
    (asNumber(readPath(dmlStatements, ["limit"])) ?? 0) > 0;
  const hasDmlRowsUsageEvidence =
    (asNumber(readPath(dmlRows, ["limit"])) ?? 0) > 0;

  const snapshotsRaw = isRecord(governorLimits)
    ? asArray(readPath(governorLimits, ["snapshots"]))
    : [];

  const byType = countByKey(allEvents, (e) => e.type);
  const byNamespace = countByKey(allEvents, (e) => e.namespace);
  const byCategory = countByKey(allEvents, (e) => e.category || "unknown");
  const byDebugCategory = countByKey(
    allEvents,
    (e) => e.debugCategory || "unknown",
  );

  const spanHotspots = [...spans]
    .sort((a, b) => (b.durationNs ?? 0) - (a.durationNs ?? 0))
    .slice(0, spanHotspotsLimit)
    .map((span) => ({
      eventId: span.eventId,
      eventType: span.eventType,
      label: span.label,
      durationMs: span.durationMs,
      namespace: span.namespace,
      startNs: span.startNs,
      lineNumber: isRecord(span.evidence)
        ? (asNumber(span.evidence.lineNumber) ?? null)
        : null,
      parentId: span.parentId,
    }));

  const queueableBeginEvents = allEvents.filter(
    (event) => event.type === "QUEUEABLE_BEGIN",
  );
  const asynchronousEventTypes = new Set([
    "QUEUEABLE_BEGIN",
    "FUTURE_METHOD_BEGIN",
    "BATCH_APEX_START_BEGIN",
    "BATCH_APEX_EXECUTE_BEGIN",
    "EVENT_SERVICE_PUB_BEGIN",
    "EVENT_SERVICE_SUB_BEGIN",
  ]);
  const asynchronousContinuations = allEvents
    .filter((event) => asynchronousEventTypes.has(event.type))
    .map((event) => ({
      kind: event.type,
      identity: event.text || null,
      jobIds: Array.from(
        new Set(
          event.logLine.match(/\b707[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?\b/g) ??
            [],
        ),
      ),
      evidence: {
        lineNumber: event.lineNumber,
        timestampNs: event.timestampNs,
        raw: event.logLine || null,
      },
      relationship: event.type.endsWith("_SUB_BEGIN") ? "current" : "related",
      guidance: event.type.endsWith("_SUB_BEGIN")
        ? "This event is part of the current transaction."
        : "Analyze the related transaction's separate debug log to continue the execution chain.",
    }));
  const queueableHotspots = queueableBeginEvents.map((queueableEvent, i) => {
    const queueableClass =
      queueableClassFromText(queueableEvent.text ?? "") ??
      `Queueable #${i + 1}`;
    return {
      eventId: `event-${queueableEvent.idx + 1}`,
      eventType: "QUEUEABLE_BEGIN",
      label: `${queueableClass} (queued)`,
      durationMs:
        queueableEvent.durationTotalNs !== null
          ? Math.round((queueableEvent.durationTotalNs / 1_000_000) * 1000) /
            1000
          : null,
      namespace: queueableEvent.namespace,
      startNs: queueableEvent.timestampNs,
      lineNumber: queueableEvent.lineNumber,
      parentId: null,
    };
  });

  const queueableByLabel = new Map<
    string,
    (typeof queueableHotspots)[number]
  >();
  for (const hotspot of queueableHotspots) {
    if (!queueableByLabel.has(hotspot.label))
      queueableByLabel.set(hotspot.label, hotspot);
  }

  const hotspots = [...queueableByLabel.values(), ...spanHotspots]
    .sort(
      (a, b) =>
        (a.startNs ?? Number.MAX_SAFE_INTEGER) -
        (b.startNs ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, spanHotspotsLimit);

  // ── Build dynamic ID prefix map ──────────────────────────────────────────
  const prefixMap = buildDynamicPrefixMap(databaseSoql, variableAssignments);

  // ── Build execution phases ───────────────────────────────────────────────
  const executionPhases = buildExecutionPhases(
    spans,
    databaseSoql,
    databaseDml,
    variableAssignments,
    allEvents,
    snapshotsRaw,
    durationMs,
    prefixMap,
  );

  // ── Build record graph ───────────────────────────────────────────────────
  const { entries: recordGraph } = extractRecordGraph(
    allEvents,
    variableAssignments,
    prefixMap,
  );

  // ── Phase summary for top-level overview ─────────────────────────────────
  const phaseSummary = executionPhases.map((phase) => ({
    id: phase.id,
    label: phase.label,
    durationMs: phase.timing.durationMs,
    pctOfTotal: phase.timing.pctOfTotal,
    soqlCount: phase.database.soqlInPhase.length,
    soqlRows: phase.database.totalSoqlRows,
    dmlCount: phase.database.dmlInPhase.length,
    dmlRows: phase.database.totalDmlRows,
    warningCount: phase.warnings.length,
    hasErrors: phase.warnings.some((w) => w.toLowerCase().includes("error")),
  }));

  // ── v0.12.0: New analysis sections ──────────────────────────────────────

  // Heap allocation analysis
  const heapAnalysis = buildHeapAnalysis(
    allEvents,
    spans,
    executionPhases,
    unitIdByEventIdx,
  );

  // Governor limit burn rate and trajectory
  const governorBurnRate = buildGovernorBurnRate(
    snapshotsRaw,
    allEvents,
    executionPhases,
    durationMs,
    governorLimits,
  );

  // SOQL pattern grouping and N+1 detection
  const { patterns: allSoqlPatterns } = buildSoqlPatternAnalysis(databaseSoql);
  const soqlPatterns = allSoqlPatterns.slice(0, soqlPatternsLimit);

  // Savepoint tracking
  const savepoints = extractSavepoints(allEvents, executionPhases);

  // System mode transitions
  const systemModeTransitions = extractSystemModeTransitions(
    allEvents,
    unitIdByEventIdx,
  );

  // Trigger cascade map
  const triggerCascadeResult = buildTriggerCascade(
    allEvents,
    databaseDml,
    triggerCascadeChildrenLimit,
  );
  const triggerCascade = triggerCascadeResult.cascades;

  // Debug level quality assessment
  const debugLevelQuality = assessDebugLevelQuality(parserResult);

  // CPU attribution by type and namespace
  const cpuAttribution = buildCpuAttribution(spans);

  // Managed package impact summary
  const managedPackageImpact = buildManagedPackageImpact(
    namespaces,
    spans,
    allEvents,
    durationMs,
  );

  // ── Add new synthetic warnings from new analyses ────────────────────────

  // Warn on SOQL N+1 suspects
  for (const pattern of soqlPatterns) {
    if (!pattern.isLoopSuspect) continue;
    addSyntheticWarning({
      type: "SOQL_LOOP_SUSPECT",
      summary: `${pattern.targetObject ?? "SOQL"}: same pattern executed ${pattern.executionCount} times (possible N+1)`,
      description:
        pattern.loopEvidence ??
        `Query pattern on ${pattern.targetObject ?? "unknown"} executed ${pattern.executionCount} times.`,
      severity: "warn",
      namespace: "default",
      evidence: {
        lineNumber: null,
        timestampNs: null,
        raw: null,
      },
    });
  }

  // Warn on savepoint rollbacks
  let rollbackCount = 0;
  for (const rb of savepoints) {
    if (rb.type !== "rollback") continue;
    rollbackCount += 1;
    addSyntheticWarning({
      type: "SAVEPOINT_ROLLBACK",
      summary: `Savepoint "${rb.name}" was rolled back`,
      description: `A savepoint rollback was detected, indicating a partial transaction failure or defensive error handling.`,
      severity: "warn",
      namespace: "default",
      evidence: {
        lineNumber: rb.lineNumber,
        timestampNs: rb.timestampNs,
        raw: null,
      },
    });
  }

  // Warn on governor limits at critical burn rate
  for (const br of governorBurnRate.burnRates) {
    if (br.status === "critical") {
      addSyntheticWarning({
        type: "GOVERNOR_LIMIT_CRITICAL",
        summary: `${br.limitName} at ${br.pctUsed}% (${br.used}/${br.max})`,
        description: `Governor limit "${br.limitName}" is at critical level. Burn rate: ${br.burnRatePerSec}/sec.${br.projectedHeadroom !== null ? ` Projected headroom: ${br.projectedHeadroom}s at current rate.` : ""}`,
        severity: "warn",
        namespace: "default",
        evidence: {
          lineNumber: null,
          timestampNs: null,
          raw: null,
        },
      });
    }
  }

  const allErrorItems = errorItems.values();

  return {
    schema: {
      name: "apex-log-insights",
      version: "3.0.0",
      generatedAtUtc: generatedAt,
      notes: [
        "Generated by Apex Log Insights (apex-log-insights).",
        "Facts are extracted from parser output with evidence pointers where available.",
        "v3.0.0: Hard schema cutover to event-native indexes. Removed trace.spans/spanTree and span-based indexes.",
        "v0.12.0: Added heapAnalysis, governorBurnRate, soqlPatterns, savepoints, systemModeTransitions, triggerCascade, debugLevelQuality, cpuAttribution, managedPackageImpact.",
        "v0.13.0: Added context.executionContext, database.namedCredentials, callout response details (statusCode/statusText/responseLineNumber), mixedDmlAnalysis, recursiveTriggerAnalysis.",
        "v0.14.0: Evidence model fix — evidence.raw now set on rawEventErrors and recursive trigger warnings; recursiveTriggers include rawLogLineTexts for raw-log-row lookup; highlights carry raw through. Viewer resolves rawLogLineNumber via text lookup for trust-worthy clickable links.",
        "v0.15.0: Added database.integrationOperations — paired callout + named credential entries into a unified model. Unpaired callouts and NCs remain as standalone entries. Old callouts/namedCredentials arrays retained for backward compat.",
      ],
      compat: "breaking schema change",
    },
    source: {
      origin: "node-cli",
      input: {
        type: "salesforce-apex-debug-log",
        logId,
        fileName,
        ingestion: {
          mode: "local-file",
          network: "disabled",
        },
      },
      integrity: {
        rawTextSha256: null,
        parserVersion: "apex-log-insights@1.0.0",
        upstreamParser: {
          name: "certinia/debug-log-analyzer apex-log-parser",
          source: "vendored",
        },
      },
    },
    context: {
      org: {
        orgId: null,
        instance: null,
        namespaceContext: namespaces,
      },
      user: {
        userId: parsedUserInfo.userId,
        username: parsedUserInfo.username,
        profile: null,
        locale: null,
        timezone: parsedUserInfo.timezone,
      },
      transaction: {
        startTimestamp,
        endTimestamp,
        durationMs,
        requestType: executionType,
        sObject: null,
        operation: null,
        recordIds: Array.from(scopeRecordIds).slice(0, 50),
        rootCodeUnit,
      },
      executionContext: cloneJsonLike(executionContext) as unknown as JsonValue,
    },
    overview: {
      status: {
        outcome:
          rawEventErrorCount > 0 || issueErrorCount > 0
            ? "error"
            : syntheticWarningCount > 0
              ? "warn"
              : "ok",
        errorCount: rawEventErrorCount + issueErrorCount,
        warningCount: parseErrorCount + syntheticWarningCount,
      },
      highlights: allErrorItems.slice(0, 10).map((item) => {
        const sev = "severity" in item ? String(item.severity || "") : "";
        const kind =
          sev === "info" ? "info" : sev === "warn" ? "warning" : "error";
        return {
          kind,
          title: compactIssueType(item.type ?? null),
          summary: item.summary,
          evidence: {
            lineStart: item.evidence.lineNumber ?? 0,
            lineEnd: item.evidence.lineNumber ?? 0,
            timestampNs: item.evidence.timestampNs ?? null,
            raw: (item.evidence as { raw?: string | null }).raw ?? null,
          },
        };
      }),
      whatRan: {
        observedComponents: {
          apexClassesCount: byType.CODE_UNIT_STARTED ?? 0,
          triggersCount: triggerNamesMeta.totalCount,
          flowsCount: Object.entries(byType)
            .filter(([key]) => key.startsWith("FLOW_"))
            .reduce((sum, [, value]) => sum + value, 0),
          validationRulesCount: Object.entries(byType)
            .filter(([key]) => key.startsWith("VALIDATION_"))
            .reduce((sum, [, value]) => sum + value, 0),
          managedPackagesCount: namespaces.filter((n) => n !== "default")
            .length,
        },
        triggerNames: triggerNamesMeta.items,
        triggerNamesMeta,
        flowInterviews,
        managedPackages: namespaces
          .filter((n) => n !== "default")
          .map((namespace) => ({ namespace, package: namespace })),
      },
      topMetrics: {
        totalDurationMs: durationMs,
        cpuTimeMs: asNumber(readPath(cpu, ["used"])) ?? null,
        heapBytesMax: asNumber(readPath(heap, ["used"])) ?? null,
        soql: {
          count:
            hasSoqlUsageEvidence && soqlUsed !== undefined
              ? soqlUsed
              : databaseSoql.length,
          rows:
            hasSoqlRowsUsageEvidence && soqlRowsUsed !== undefined
              ? soqlRowsUsed
              : sumExactRows(databaseSoql),
        },
        sosl: {
          count: databaseSosl.length,
          rows: sumExactRows(databaseSosl),
        },
        dml: {
          statements:
            hasDmlUsageEvidence && dmlStatementsUsed !== undefined
              ? dmlStatementsUsed
              : databaseDml.length,
          rows:
            hasDmlRowsUsageEvidence && dmlRowsUsed !== undefined
              ? dmlRowsUsed
              : sumExactRows(databaseDml),
        },
        callouts: {
          count: asNumber(readPath(callouts, ["used"])) ?? null,
          timeMs: null,
        },
        wallClock: {
          start: startTimestamp,
          end: endTimestamp,
        },
        relativeTimeNs: {
          start: relativeStartNs,
          end: relativeEndNs,
        },
        emailInvocations: {
          count: asNumber(readPath(emailInvocations, ["used"])) ?? null,
        },
        futureCalls: {
          count: asNumber(readPath(futureCalls, ["used"])) ?? null,
        },
        queueablesEnqueued: {
          count: asNumber(readPath(queueables, ["used"])) ?? null,
        },
      },
      trust: {
        policy: "facts-only",
        noAiInference: true,
        evidenceFirst: true,
      },
      phaseSummary,
    },
    limits: {
      cumulative: {
        defaultNamespace: {
          soqlQueries: toLimit(
            asNumber(readPath(soql, ["used"])),
            asNumber(readPath(soql, ["limit"])),
          ),
          soqlRows: toLimit(
            asNumber(readPath(rows, ["used"])),
            asNumber(readPath(rows, ["limit"])),
          ),
          dmlStatements: toLimit(
            asNumber(readPath(dmlStatements, ["used"])),
            asNumber(readPath(dmlStatements, ["limit"])),
          ),
          dmlRows: toLimit(
            asNumber(readPath(dmlRows, ["used"])),
            asNumber(readPath(dmlRows, ["limit"])),
          ),
          cpuTimeMs: toLimit(
            asNumber(readPath(cpu, ["used"])),
            asNumber(readPath(cpu, ["limit"])),
          ),
          heapBytes: toLimit(
            asNumber(readPath(heap, ["used"])),
            asNumber(readPath(heap, ["limit"])),
          ),
          callouts: toLimit(
            asNumber(readPath(callouts, ["used"])),
            asNumber(readPath(callouts, ["limit"])),
          ),
          queueables: toLimit(
            asNumber(readPath(queueables, ["used"])),
            asNumber(readPath(queueables, ["limit"])),
          ),
        },
      },
      snapshots: snapshotsRaw.map((s, i) => ({
        id: `lim-${i + 1}`,
        timestampNs: asNumber(readPath(s, ["timestamp"])) ?? null,
        namespace: asString(readPath(s, ["namespace"])) ?? "default",
        scope: "snapshot",
        raw: null,
        limits: cloneJsonLike(readPath(s, ["limits"]) ?? {}) as JsonValue,
      })),
    },
    performance: {
      parseTimeMs,
      timelineEventCount: allEvents.length,
      hotspots,
      hotspotsMeta: {
        totalCount: queueableByLabel.size + spans.length,
        truncated: queueableByLabel.size + spans.length > spanHotspotsLimit,
        limit: spanHotspotsLimit,
      },
    },
    analysis: {
      executionType,
      scopeRecordIds: Array.from(scopeRecordIds).slice(0, 50),
      dmlImpact: {
        totalRows: dmlEventRows,
        byObject: dmlByObject,
      },
      findings: {
        zeroRowQueries: emptyQueryCount,
        missingExplainPlans: databaseSoql.reduce(
          (count, query) =>
            count + (query.explain?.available === false ? 1 : 0),
          0,
        ),
        slowQueries: databaseSoql.reduce(
          (count, query) => count + ((query.durationMs ?? 0) >= 50 ? 1 : 0),
          0,
        ),
        loopSuspectQueries: allSoqlPatterns.reduce(
          (count, pattern) => count + (pattern.isLoopSuspect ? 1 : 0),
          0,
        ),
        savepointRollbacks: rollbackCount,
        criticalLimits: governorBurnRate.burnRates.reduce(
          (count, burnRate) => count + (burnRate.status === "critical" ? 1 : 0),
          0,
        ),
        peakHeapBytes: heapAnalysis.peakCumulativeBytes,
      },
      recordSummary: {
        totalUniqueRecords: recordGraph.reduce(
          (sum, g) => sum + g.recordCount,
          0,
        ),
        bySObject: recordGraph.map((g) => ({
          sObjectType: g.sObjectType,
          keyPrefix: g.keyPrefix,
          count: g.recordCount,
        })),
      },
    },
    executionPhases: cloneJsonLike(executionPhases) as unknown as JsonValue,
    asynchronousContinuations: cloneJsonLike(
      asynchronousContinuations,
    ) as unknown as JsonValue,
    recordGraph: cloneJsonLike(
      recordGraph.map((entry) => ({
        sObjectType: entry.sObjectType,
        keyPrefix: entry.keyPrefix,
        recordCount: entry.recordCount,
        recordsTruncated: entry.records.length > recordsPerSObjectLimit,
        recordLimit: recordsPerSObjectLimit,
        records: entry.records.slice(0, recordsPerSObjectLimit).map((r) => ({
          id: r.id,
          sObjectType: r.sObjectType,
          fields: r.fields.slice(0, 30), // cap fields per record
          relationships: r.relationships,
          provenance: r.provenance,
        })),
      })),
    ) as unknown as JsonValue,
    components: {
      namespaces,
      byType,
      byNamespace,
      byCategory,
      byDebugCategory,
    },
    trace: {
      events: traceEvents,
      debugEvents,
      validationBlocks,
      flowBlocks,
      workflowBlocks,
    },
    database: {
      soql: cloneJsonLike(databaseSoql) as unknown as JsonValue,
      sosl: cloneJsonLike(databaseSosl) as unknown as JsonValue,
      dml: cloneJsonLike(databaseDml) as unknown as JsonValue,
      callouts: cloneJsonLike(databaseCallouts) as unknown as JsonValue,
      namedCredentials: cloneJsonLike(namedCredentials) as unknown as JsonValue,
      integrationOperations: cloneJsonLike(
        integrationOperations,
      ) as unknown as JsonValue,
      cursors: cloneJsonLike(cursorOperations) as unknown as JsonValue,
      cursorsMeta: {
        totalCount: allCursorOperations.length,
        truncated: allCursorOperations.length > cursorOperationsLimit,
        limit: cursorOperationsLimit,
      },
      soqlPatterns: cloneJsonLike(soqlPatterns) as unknown as JsonValue,
      soqlPatternsMeta: {
        totalCount: allSoqlPatterns.length,
        truncated: allSoqlPatterns.length > soqlPatternsLimit,
        limit: soqlPatternsLimit,
      },
    },
    heapAnalysis: cloneJsonLike(heapAnalysis) as unknown as JsonValue,
    governorBurnRate: cloneJsonLike(governorBurnRate) as unknown as JsonValue,
    savepoints: cloneJsonLike(savepoints) as unknown as JsonValue,
    systemModeTransitions: cloneJsonLike(
      systemModeTransitions,
    ) as unknown as JsonValue,
    triggerCascade: cloneJsonLike(triggerCascade) as unknown as JsonValue,
    triggerCascadeMeta: cloneJsonLike(
      triggerCascadeResult.meta,
    ) as unknown as JsonValue,
    debugLevelQuality: cloneJsonLike(debugLevelQuality) as unknown as JsonValue,
    cpuAttribution: cloneJsonLike(cpuAttribution) as unknown as JsonValue,
    managedPackageImpact: cloneJsonLike(
      managedPackageImpact,
    ) as unknown as JsonValue,
    mixedDmlAnalysis: cloneJsonLike(mixedDml) as unknown as JsonValue,
    recursiveTriggerAnalysis: cloneJsonLike(
      recursiveTriggerDetection,
    ) as unknown as JsonValue,
    errors: {
      count: errorItems.totalCount,
      items: allErrorItems as unknown as JsonValue,
      truncated: allErrorItems.length < errorItems.totalCount,
      limit: errorItemsLimit,
    },
    parserDiagnostics: cloneJsonLike(
      parsingDiagnostics,
    ) as unknown as JsonValue,
    rawLog: {
      available: true,
      bytes: fileBytes,
    },
    indexes: {
      eventCount: traceEvents.length,
      eventsByType,
      lineToEventIds,
      eventRangesByTimestamp,
      byNamespace,
      byCategory,
      byDebugCategory,
    },
    uiNavigation: {
      deepLinks: {
        overview: "report.html?tab=overview",
        components: "report.html?tab=components",
        performance: "report.html?tab=performance",
        database: "report.html?tab=database",
        callTree: "report.html?tab=call-tree",
        errors: "report.html?tab=errors",
        rawLog: "report.html?tab=raw-log",
        heap: "report.html?tab=heap",
        governorLimits: "report.html?tab=governor-limits",
        triggers: "report.html?tab=triggers",
        packages: "report.html?tab=packages",
      },
      filters: {
        supported: [
          { key: "minDurationMs", type: "number" },
          { key: "type", type: "string" },
          { key: "namespace", type: "string" },
          { key: "hasError", type: "boolean" },
          { key: "text", type: "string" },
          { key: "cpuType", type: "string" },
          { key: "isLoopSuspect", type: "boolean" },
        ],
      },
    },
    parser: {
      mode: "facts-only",
      upstream: {
        name: "Certinia Apex Log Parser",
        keyOutputs: [
          "ApexLog event tree",
          "durations self/total",
          "soql/dml aggregate counters per event",
          "governor limits with snapshots",
          "log issues and parsing errors",
        ],
      },
      provenance: {
        spanSource:
          "Parent events from Certinia ApexLog tree with duration.total > 0",
        databaseSource:
          "SOQL_EXECUTE_BEGIN and DML_BEGIN events with text/count/duration fields",
        errorSource: "logIssues + parsingErrors + error-like event types",
        executionPhasesSource:
          "Direct method/constructor children of root CODE_UNIT_STARTED span, enriched with time-windowed SOQL/DML/variable data",
        recordGraphSource:
          "VARIABLE_ASSIGNMENT events with parsed JSON values; ID prefix resolution from standard lookup + dynamic SOQL target correlation",
        heapAnalysisSource:
          "HEAP_ALLOCATE and HEAP_DEALLOCATE events with byte sizes; watermark is cumulative running total sampled at ~200 points",
        governorBurnRateSource:
          "LIMIT_USAGE_FOR_NS snapshot data with linear burn rate extrapolation between first and last snapshots",
        soqlPatternsSource:
          "Normalized SOQL query text (bind vars and literals replaced) grouped by pattern; N+1 flagged at 3+ executions",
        savepointsSource:
          "SAVEPOINT_SET and SAVEPOINT_ROLLBACK events with enclosing event and execution phase correlation",
        systemModeSource:
          "SYSTEM_MODE_ENTER and SYSTEM_MODE_EXIT events with mode value (true=system, false=user)",
        triggerCascadeSource:
          "CODE_UNIT_STARTED trigger events correlated with DML_BEGIN event timing and parent-event ancestry to build DML→trigger chains",
        debugLevelQualitySource:
          "debugLevels from ApexLog header line, assessed against recommended thresholds per category",
        cpuAttributionSource:
          "Span durations grouped by cpuType and namespace from Certinia parser output",
        managedPackageImpactSource:
          "Spans and events filtered by non-default namespace with aggregated SOQL/DML/duration metrics",
        executionContextSource:
          "Heuristic classification from CODE_UNIT_STARTED text, FUTURE_METHOD_BEGIN, BATCH_APEX_EXECUTE_BEGIN, QueueableContextImpl, and root code unit name patterns",
        namedCredentialsSource:
          "NAMED_CREDENTIAL_REQUEST and NAMED_CREDENTIAL_RESPONSE events with credential name, endpoint, method, and response status",
        calloutResponseSource:
          "CALLOUT_RESPONSE events paired with CALLOUT_REQUEST spans by timestamp proximity; status code and text parsed from response text",
        mixedDmlAnalysisSource:
          "DML_BEGIN events classified as setup vs non-setup sObjects; mixed_dml detected when both types appear in the same transaction",
        recursiveTriggerAnalysisSource:
          "Trigger CODE_UNIT_STARTED spans grouped by normalized trigger name; count > 1 indicates possible recursive execution",
      },
    },
  };
}
