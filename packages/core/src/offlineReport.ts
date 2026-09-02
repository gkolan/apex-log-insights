import {
  buildInsightsReport,
  type InsightsReportLimits,
} from "./insightsReport.js";
import type { JsonValue } from "./report.js";
import { parseSafeIntegerToken } from "./logFields.js";
import { cloneJsonLike } from "./jsonClone.js";
import type { NormalizedParseResult, RawLogLine } from "./parserCore.js";
import {
  EXECUTION_PHASE_DEFINITIONS,
  type EvidenceConfidence,
  type ExecutionPhaseId,
} from "./phases.js";

type UnknownRecord = Record<string, unknown>;

/**
 * Controls how many items of each kind are included in the offline report.
 * Keeps report JSON from growing unbounded on very large logs.
 */
export interface ReportLimits extends InsightsReportLimits {
  /** Max events of each event type to include in phase signal lists. @default 20 */
  eventsPerType?: number;
}

const REPORT_LIMIT_DEFAULTS = {
  eventsPerType: 20,
  triggerNames: 50,
  soqlPatterns: 25,
  triggerCascadeChildren: 20,
  spanHotspots: 25,
  recordsPerSObject: 100,
  cursorOperations: 100,
  errorItems: 500,
  recursiveTriggers: 50,
} as const satisfies Required<ReportLimits>;

function boundedLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : fallback;
}

/** Normalize caller-controlled collection caps before report construction. */
function normalizeReportLimits(limits: ReportLimits): ReportLimits {
  const normalized: ReportLimits = {};
  for (const key of Object.keys(REPORT_LIMIT_DEFAULTS) as Array<
    keyof ReportLimits
  >) {
    if (limits[key] !== undefined) {
      normalized[key] = boundedLimit(limits[key], REPORT_LIMIT_DEFAULTS[key]);
    }
  }
  return normalized;
}

/**
 * Input required to build an offline-compatible report via
 * {@link buildOfflineReport}.
 */
export interface OfflineReportInput {
  /** Metadata about the log file itself. */
  source: {
    /** Name of the log file (e.g. `'MyTrigger.log'`). */
    fileName: string;
    /** File size in bytes. */
    bytes: number;
    /** ISO 8601 timestamp when the log was generated. Defaults to `new Date().toISOString()`. */
    generatedAt?: string;
  };

  /** The normalised parse result from {@link parseLog}. */
  parseResult: NormalizedParseResult;

  /**
   * Original raw log text. Only needed when `parseResult.rawLines` is
   * not populated; the builder will split this text into lines as a fallback.
   */
  rawLogText?: string;

  /** Optional caps on how many items appear in each report section. */
  limits?: ReportLimits;
}

interface TruncatedEventsResult {
  events: Array<{ id: string; type: string; lineNumber: number | null }>;
  totalCount: number;
  truncated: boolean;
}

function buildLogCompleteness(
  parseResult: NormalizedParseResult,
  rawLines: RawLogLine[],
) {
  const reasons: string[] = [];
  let hasMaximumSizeMarker = false;
  let hasSkippedLinesMarker = false;
  let hasStart = false;
  let hasFinish = false;
  for (const line of rawLines) {
    const text = line.text;
    hasMaximumSizeMarker ||= /MAXIMUM DEBUG LOG SIZE REACHED/i.test(text);
    hasSkippedLinesMarker ||= /^\*\*\* Skipped .* Bytes of detailed log/i.test(
      text,
    );
    hasStart ||= /\|EXECUTION_STARTED(?:\||\s|$)/.test(text);
    hasFinish ||= /\|EXECUTION_FINISHED(?:\||\s|$)/.test(text);
  }
  if (hasMaximumSizeMarker)
    reasons.push(
      "Salesforce reported that the maximum debug log size was reached.",
    );
  if (hasSkippedLinesMarker)
    reasons.push("Salesforce reported skipped log lines.");
  if (
    parseResult.issues.some((issue) =>
      /truncat|skipped.lines|max.size|timestamp/i.test(
        `${issue.summary} ${issue.description}`,
      ),
    )
  ) {
    reasons.push("The parser detected a gap or truncation signal.");
  }
  const parserDiagnostics = Array.isArray(parseResult.parserDiagnostics)
    ? parseResult.parserDiagnostics
    : [];
  const diagnosticCount = parserDiagnostics.reduce(
    (total, diagnostic) => total + diagnostic.count,
    0,
  );
  if (diagnosticCount > 0) {
    reasons.push(
      `The parser could not fully interpret ${diagnosticCount} log ${diagnosticCount === 1 ? "record" : "records"}.`,
    );
  }
  // Boundary markers are structural lines and may not become timeline nodes.
  // Inspect the source text so a complete log is not marked uncertain merely
  // because the normalized timeline intentionally omits wrapper events.
  if (!hasStart) reasons.push("EXECUTION_STARTED was not observed.");
  if (!hasFinish) reasons.push("EXECUTION_FINISHED was not observed.");
  const uniqueReasons = Array.from(new Set(reasons));
  return {
    status:
      uniqueReasons.length === 0
        ? "complete"
        : /maximum|skipped|truncation/i.test(uniqueReasons.join(" "))
          ? "incomplete"
          : "uncertain",
    hasExecutionStart: hasStart,
    hasExecutionFinish: hasFinish,
    reasons: uniqueReasons,
  };
}

function buildFailureContexts(parseResult: NormalizedParseResult) {
  const failureTypes = new Set([
    "EXCEPTION_THROWN",
    "FATAL_ERROR",
    "VF_FATAL_ERROR",
  ]);
  return parseResult.normalizedTimeline.flatMap((event, index) => {
    if (!failureTypes.has(event.type)) return [];
    const precedingEvents = parseResult.normalizedTimeline
      .slice(Math.max(0, index - 8), index)
      .map((entry) => ({
        id: entry.id,
        type: entry.type,
        text: entry.text,
        lineNumber: entry.evidence.startLine,
      }));
    return [
      {
        id: event.id,
        type: event.type,
        message: event.text,
        lineNumber: event.evidence.startLine,
        precedingEvents,
      },
    ];
  });
}

/**
 * The self-contained offline report produced by {@link buildOfflineReport}.
 *
 * Contains everything the viewer needs to render a full analysis without
 * network access: timeline, execution phases, governor limits, issues,
 * and an evidence index linking every insight back to raw log lines.
 */
export interface OfflineReportV2 extends Record<string, JsonValue> {
  /** Schema version for forward-compatibility checks. */
  reportVersion: "3.0.0";
}

interface PhaseOutput {
  id: ExecutionPhaseId;
  name: string;
  index: number;
  status: "observed" | "inferred" | "not_observed";
  confidence: EvidenceConfidence;
  inputs: Record<string, JsonValue>;
  outputs: Record<string, JsonValue>;
  events: Array<{
    id: string;
    type: string;
    lineNumber: number | null;
  }>;
  warnings: string[];
  evidence: {
    startLine: number | null;
    endLine: number | null;
    lineIds?: number[];
    confidence: EvidenceConfidence;
  };
  syntheticDoc: string;
}

interface PhaseSignal {
  observed: boolean;
  inferred: boolean;
  confidence?: EvidenceConfidence;
  events: Array<{ id: string; type: string; lineNumber: number | null }>;
  warnings: string[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return value;
  if (typeof value === "string")
    return parseSafeIntegerToken(value) ?? undefined;
  return undefined;
}

function lineEvidence(entry: unknown): {
  startLine: number | null;
  endLine: number | null;
  lineIds?: number[];
} {
  const lineNumber =
    asNumber(
      asRecord(entry).lineNumber ??
        asRecord(asRecord(entry).evidence).lineNumber,
    ) ?? null;
  if (lineNumber === null) {
    return {
      startLine: null,
      endLine: null,
    };
  }
  return {
    startLine: lineNumber,
    endLine: lineNumber,
    lineIds: [lineNumber],
  };
}

function firstPhaseEvidence(
  events: Array<{ lineNumber: number | null }>,
  fallbackLine: number | null,
  confidence: EvidenceConfidence,
) {
  const lines = events
    .map((event) => event.lineNumber)
    .filter(
      (line): line is number =>
        typeof line === "number" && Number.isFinite(line),
    );

  if (lines.length === 0 && fallbackLine === null) {
    return {
      startLine: null,
      endLine: null,
      confidence,
    };
  }

  const unique = Array.from(new Set(lines));
  const startLine = unique.length > 0 ? Math.min(...unique) : fallbackLine;
  const endLine = unique.length > 0 ? Math.max(...unique) : fallbackLine;

  return {
    startLine,
    endLine,
    ...(unique.length > 0 ? { lineIds: unique } : {}),
    confidence,
  };
}

function coerceRawLines(
  rawLines: RawLogLine[] | undefined,
  rawLogText?: string,
): RawLogLine[] {
  if (rawLines) return rawLines;
  if (typeof rawLogText === "string") {
    return rawLogText.split(/\r\n|\r|\n/).map((text, index) => ({
      id: index + 1,
      lineNumber: index + 1,
      text,
    }));
  }
  return [];
}

function pickEventsByType(
  parseResult: NormalizedParseResult,
  matcher: (
    event: NormalizedParseResult["normalizedTimeline"][number],
  ) => boolean,
  limit: number = 20,
): TruncatedEventsResult {
  const matched = parseResult.normalizedTimeline.filter(matcher);
  return {
    events: matched.slice(0, limit).map((event) => ({
      id: event.id,
      type: event.type,
      lineNumber: event.evidence.startLine,
    })),
    totalCount: matched.length,
    truncated: matched.length > limit,
  };
}

function findRawLineMatches(
  rawLines: RawLogLine[],
  matcher: (line: RawLogLine) => boolean,
  limit: number = 20,
) {
  const matched = rawLines.filter(matcher);
  return {
    lines: matched.slice(0, limit),
    totalCount: matched.length,
    truncated: matched.length > limit,
  };
}

function rawLineEvents(prefix: string, lines: RawLogLine[]) {
  return lines.map((line, index) => ({
    id: `${prefix}-${index + 1}`,
    type: prefix,
    lineNumber: line.lineNumber,
  }));
}

interface PhaseSignalsResult {
  signals: Record<ExecutionPhaseId, PhaseSignal>;
  truncationWarnings: string[];
}

function buildPhaseSignals(
  base: UnknownRecord,
  parseResult: NormalizedParseResult,
  rawLines: RawLogLine[],
  limits: ReportLimits = {},
): PhaseSignalsResult {
  const context = asRecord(base.context);
  const transaction = asRecord(context.transaction);
  const rootCodeUnit = asString(transaction.rootCodeUnit) ?? "";
  const executionType = asString(transaction.requestType) ?? "";
  const database = asRecord(base.database);
  const errors = asRecord(base.errors);
  const warnings = asArray(errors.items)
    .map((item) => asRecord(item))
    .filter((item) => {
      const severity = asString(item.severity);
      return severity === "warn" || severity === "info";
    });

  // Keep this boundary defensive even though buildOfflineReport normalizes its
  // public input. This helper must never allow Infinity or negative values to
  // disable the collection cap through slice/match semantics.
  const eventsPerTypeLimit = boundedLimit(
    limits.eventsPerType,
    REPORT_LIMIT_DEFAULTS.eventsPerType,
  );
  const truncationWarnings: string[] = [];

  const byTypePrefix = (prefix: string) =>
    pickEventsByType(
      parseResult,
      (event) => event.type.startsWith(prefix),
      eventsPerTypeLimit,
    );
  const byText = (regex: RegExp) =>
    findRawLineMatches(
      rawLines,
      (line) => regex.test(line.text),
      eventsPerTypeLimit,
    ).lines;
  const byTextWithMeta = (regex: RegExp) =>
    findRawLineMatches(
      rawLines,
      (line) => regex.test(line.text),
      eventsPerTypeLimit,
    );
  const hasText = (regex: RegExp) =>
    rawLines.some((line) => regex.test(line.text));
  const dmlRows = asArray(database.dml).filter(
    (entry) => asString(asRecord(entry).source) === "event",
  );

  const wfEventsResult = byTypePrefix("WF_");
  const wfEvents = wfEventsResult.events;
  if (wfEventsResult.truncated) {
    truncationWarnings.push(
      `Workflow events truncated: showing ${wfEvents.length} of ${wfEventsResult.totalCount}`,
    );
  }

  const flowEventsResult = byTypePrefix("FLOW_");
  const flowEvents = flowEventsResult.events;
  if (flowEventsResult.truncated) {
    truncationWarnings.push(
      `Flow events truncated: showing ${flowEvents.length} of ${flowEventsResult.totalCount}`,
    );
  }

  const validationEventsResult = pickEventsByType(
    parseResult,
    (event) =>
      event.type.startsWith("VALIDATION_") ||
      /validation/i.test(String(event.text || "")),
    eventsPerTypeLimit,
  );
  const validationEvents = validationEventsResult.events;
  if (validationEventsResult.truncated) {
    truncationWarnings.push(
      `Validation events truncated: showing ${validationEvents.length} of ${validationEventsResult.totalCount}`,
    );
  }

  const escalationEventsResult = pickEventsByType(
    parseResult,
    (event) =>
      event.type === "WF_ESCALATION_RULE" ||
      event.type === "WF_ESCALATION_ACTION",
    eventsPerTypeLimit,
  );
  const escalationEvents = escalationEventsResult.events;

  const entitlementEventsResult = pickEventsByType(
    parseResult,
    (event) =>
      event.type === "SLA_PROCESS_CASE" ||
      event.type === "SLA_EVAL_MILESTONE" ||
      event.type === "SLA_END",
    eventsPerTypeLimit,
  );
  const entitlementEvents = entitlementEventsResult.events;

  const sharingEventsResult = pickEventsByType(
    parseResult,
    (event) =>
      (event.type === "WF_RULE_EVAL_BEGIN" ||
        event.type === "WF_RULE_EVAL_END" ||
        event.type === "WF_RULE_EVAL") &&
      /sharing/i.test(String(event.text || "")),
    eventsPerTypeLimit,
  );
  const sharingEvents = sharingEventsResult.events;

  const duplicateResult = byTextWithMeta(
    /DUPLICATE|MATCHING_RULE|duplicate rule/i,
  );
  const duplicateEvents = rawLineEvents(
    "DUPLICATE_RULE",
    duplicateResult.lines,
  );
  if (duplicateResult.truncated) {
    truncationWarnings.push(
      `Duplicate rule matches truncated: showing ${duplicateResult.lines.length} of ${duplicateResult.totalCount}`,
    );
  }

  const assignmentResult = byTextWithMeta(
    /ASSIGNMENT_RULE|Assignment rule|assigned to/i,
  );
  const assignmentEvents = rawLineEvents(
    "ASSIGNMENT_RULE",
    assignmentResult.lines,
  );
  if (assignmentResult.truncated) {
    truncationWarnings.push(
      `Assignment rule matches truncated: showing ${assignmentResult.lines.length} of ${assignmentResult.totalCount}`,
    );
  }

  const autoResponseResult = byTextWithMeta(
    /AUTO_RESPONSE|Auto-Response|auto response/i,
  );
  const autoResponseEvents = rawLineEvents(
    "AUTO_RESPONSE_RULE",
    autoResponseResult.lines,
  );

  const processBuilderResult = byTextWithMeta(
    /PROCESS_BUILDER|Process Builder|launched by process/i,
  );
  const processBuilderEvents = rawLineEvents(
    "PROCESS_BUILDER",
    processBuilderResult.lines,
  );

  const rollupResult = byTextWithMeta(
    /ROLLUP|Roll-Up|grandparent|parent record/i,
  );
  const rollupEvents = rawLineEvents("ROLLUP_SUMMARY", rollupResult.lines);

  const criteriaResult = byTextWithMeta(/criteria/i);
  const criteriaEvents = rawLineEvents("CRITERIA_EVAL", criteriaResult.lines);

  // Phase 17 sub-phases: Process Builder events and Workflow criteria events
  const processBldEventsResult = pickEventsByType(
    parseResult,
    (event) =>
      event.type === "PROCESS_STARTED" ||
      event.type === "PROCESS_INSTANCE_DETAIL",
    eventsPerTypeLimit,
  );
  const processBldEvents = [
    ...processBldEventsResult.events,
    ...processBuilderEvents,
  ];

  const wfCriteriaEventsResult = pickEventsByType(
    parseResult,
    (event) =>
      event.type === "WF_CRITERIA_BEGIN" ||
      event.type === "WF_CRITERIA_END" ||
      event.type === "WF_RULE_EVAL_BEGIN" ||
      event.type === "WF_RULE_EVAL_END" ||
      event.type === "WF_RULE_EVAL",
    eventsPerTypeLimit,
  );
  const wfCriteriaEvents = wfCriteriaEventsResult.events;

  const postCommitEventsResult = pickEventsByType(
    parseResult,
    (event) =>
      /EMAIL_QUEUE|FUTURE_METHOD_BEGIN|BATCH_APEX_START|FLOW_CREATE_INTERVIEW_BEGIN/.test(
        event.type,
      ) ||
      /queueable|future method|post-commit|email queued/i.test(
        String(event.text || ""),
      ),
    eventsPerTypeLimit,
  );
  const postCommitEvents = postCommitEventsResult.events;

  const beforeTriggerEventsResult = pickEventsByType(
    parseResult,
    (event) =>
      event.type === "CODE_UNIT_STARTED" &&
      /trigger event Before/i.test(String(event.text || "")),
    eventsPerTypeLimit,
  );
  const beforeTriggerEvents = beforeTriggerEventsResult.events;
  if (beforeTriggerEventsResult.truncated) {
    truncationWarnings.push(
      `Before-trigger events truncated: showing ${beforeTriggerEvents.length} of ${beforeTriggerEventsResult.totalCount}`,
    );
  }

  const afterTriggerEventsResult = pickEventsByType(
    parseResult,
    (event) =>
      event.type === "CODE_UNIT_STARTED" &&
      /trigger event After/i.test(String(event.text || "")),
    eventsPerTypeLimit,
  );
  const afterTriggerEvents = afterTriggerEventsResult.events;
  if (afterTriggerEventsResult.truncated) {
    truncationWarnings.push(
      `After-trigger events truncated: showing ${afterTriggerEvents.length} of ${afterTriggerEventsResult.totalCount}`,
    );
  }

  // Build a lookup map for raw lines by lineNumber to avoid O(n²) scanning
  const rawLineByNumber = new Map<number, RawLogLine>();
  for (const line of rawLines) {
    if (!rawLineByNumber.has(line.lineNumber)) {
      rawLineByNumber.set(line.lineNumber, line);
    }
  }

  const beforeSaveFlowEvents = flowEvents.filter((event) =>
    /before save/i.test(
      event.lineNumber != null
        ? (rawLineByNumber.get(event.lineNumber)?.text ?? "")
        : "",
    ),
  );
  const afterSaveFlowEvents = flowEvents.filter((event) =>
    /after save|Case_Notification_Flow|High_Priority_Escalation_Flow/i.test(
      event.lineNumber != null
        ? (rawLineByNumber.get(event.lineNumber)?.text ?? "")
        : "",
    ),
  );

  const fatalErrorResult = pickEventsByType(
    parseResult,
    (event) => event.type === "FATAL_ERROR",
    eventsPerTypeLimit,
  );
  const hasFatalError = fatalErrorResult.events.length > 0;
  const hasExecution = Boolean(
    rootCodeUnit || executionType || parseResult.normalizedTimeline.length > 0,
  );

  const signals: Record<ExecutionPhaseId, PhaseSignal> = {
    "phase-01-load-original-record": {
      observed: false,
      inferred: hasExecution,
      confidence: "inferred",
      events: rawLineEvents(
        "LOAD_ORIGINAL",
        byText(/trigger\.old|Phase1 - trigger\.old/i),
      ),
      warnings: parseResult.capabilities.phaseInferenceEnabled
        ? [
            "Phase inferred from transaction context because Salesforce does not emit a direct event for this load step.",
          ]
        : [],
    },
    "phase-02-system-validation": {
      observed:
        validationEvents.length > 0 ||
        hasText(
          /system validation phase active|layout rules|required fields|foreign key|self-referential/i,
        ),
      inferred: !validationEvents.length && hasExecution,
      confidence: validationEvents.length > 0 ? "direct" : "derived",
      events:
        validationEvents.length > 0
          ? validationEvents
          : rawLineEvents(
              "SYSTEM_VALIDATION",
              byText(/system validation|foreign key|self-reference/i),
            ),
      warnings: [],
    },
    "phase-03-before-triggers": {
      observed: beforeTriggerEvents.length > 0,
      inferred: false,
      confidence: "direct",
      events: beforeTriggerEvents,
      warnings: [],
    },
    "phase-04-before-save-flows": {
      observed:
        beforeSaveFlowEvents.length > 0 ||
        hasText(/Before-Save|BeforeSave|Opportunity_BeforeSave_Enrichment/i),
      inferred: false,
      confidence: beforeSaveFlowEvents.length > 0 ? "direct" : "derived",
      events:
        beforeSaveFlowEvents.length > 0
          ? beforeSaveFlowEvents
          : rawLineEvents(
              "FLOW_BEFORE_SAVE",
              byText(
                /Before-Save|BeforeSave|Opportunity_BeforeSave_Enrichment/i,
              ),
            ),
      warnings: [],
    },
    "phase-05-validation-rules": {
      observed: validationEvents.length > 0,
      inferred: false,
      confidence: "direct",
      events: validationEvents,
      warnings: [],
    },
    "phase-06-duplicate-rules": {
      observed: duplicateEvents.length > 0,
      inferred:
        duplicateEvents.length === 0 &&
        dmlRows.length > 0 &&
        hasText(/duplicate/i),
      confidence: duplicateEvents.length > 0 ? "direct" : "derived",
      events: duplicateEvents,
      warnings: [],
    },
    "phase-07-save-to-database": {
      observed: dmlRows.length > 0,
      inferred:
        dmlRows.length === 0 &&
        (afterTriggerEvents.length > 0 ||
          hasText(/trigger\.new IDs|soft-save|soft save/i)),
      confidence: dmlRows.length > 0 ? "direct" : "inferred",
      events:
        dmlRows.length > 0
          ? dmlRows.slice(0, 10).map((entry, index) => ({
              id: asString(asRecord(entry).id) ?? `dml-${index + 1}`,
              type: "DML_BEGIN",
              lineNumber:
                asNumber(asRecord(asRecord(entry).evidence).lineNumber) ?? null,
            }))
          : rawLineEvents(
              "SOFT_SAVE",
              byText(/trigger\.new IDs|soft-save|soft save/i),
            ),
      warnings:
        dmlRows.length === 0 &&
        (afterTriggerEvents.length > 0 ||
          hasText(/trigger\.new IDs|soft-save|soft save/i))
          ? [
              "Soft save inferred from after-trigger execution and post-save record IDs.",
            ]
          : [],
    },
    "phase-08-after-triggers": {
      observed: afterTriggerEvents.length > 0,
      inferred: false,
      confidence: "direct",
      events: afterTriggerEvents,
      warnings: [],
    },
    "phase-09-assignment-rules": {
      observed: assignmentEvents.length > 0,
      inferred: false,
      confidence: assignmentEvents.length > 0 ? "direct" : "derived",
      events: assignmentEvents,
      warnings: [],
    },
    "phase-10-auto-response-rules": {
      observed: autoResponseEvents.length > 0,
      inferred: false,
      confidence: autoResponseEvents.length > 0 ? "direct" : "derived",
      events: autoResponseEvents,
      warnings: [],
    },
    "phase-11-workflow-rules": {
      observed: wfEvents.length > 0,
      inferred: false,
      confidence: "direct",
      events: wfEvents,
      warnings: [],
    },
    "phase-12-escalation-rules": {
      observed: escalationEvents.length > 0,
      inferred: false,
      confidence: escalationEvents.length > 0 ? "direct" : "derived",
      events: escalationEvents,
      warnings: [],
    },
    "phase-13-process-builder": {
      observed: processBuilderEvents.length > 0,
      inferred:
        processBuilderEvents.length === 0 &&
        hasText(/Flow Automations|launched by processes/i),
      confidence: processBuilderEvents.length > 0 ? "direct" : "derived",
      events: processBuilderEvents,
      warnings: [],
    },
    "phase-14-after-save-flows": {
      observed:
        afterSaveFlowEvents.length > 0 ||
        (flowEvents.length > 0 && afterTriggerEvents.length > 0),
      inferred: false,
      confidence: afterSaveFlowEvents.length > 0 ? "direct" : "derived",
      events: afterSaveFlowEvents.length > 0 ? afterSaveFlowEvents : flowEvents,
      warnings: [],
    },
    "phase-15-entitlement-rules": {
      observed: entitlementEvents.length > 0,
      inferred: false,
      confidence: entitlementEvents.length > 0 ? "direct" : "derived",
      events: entitlementEvents,
      warnings: [],
    },
    "phase-16-rollup-summary": {
      observed: rollupEvents.length > 0,
      inferred:
        rollupEvents.length === 0 && hasText(/Roll-Up Summary|parent record/i),
      confidence: rollupEvents.length > 0 ? "direct" : "derived",
      events: rollupEvents,
      warnings: [],
    },
    "phase-17-criteria-evaluation": {
      observed:
        criteriaEvents.length > 0 ||
        hasText(
          /Grandparent RUS cascade|Grandparent save complete|OpportunityGroup__c/i,
        ),
      inferred:
        criteriaEvents.length === 0 &&
        !hasText(
          /Grandparent RUS cascade|Grandparent save complete|OpportunityGroup__c/i,
        ) &&
        hasText(/Criteria-Based|criteria/i),
      confidence:
        criteriaEvents.length > 0
          ? "derived"
          : hasText(
                /Grandparent RUS cascade|Grandparent save complete|OpportunityGroup__c/i,
              )
            ? "derived"
            : "derived",
      events:
        criteriaEvents.length > 0
          ? criteriaEvents
          : rawLineEvents(
              "GRANDPARENT_RUS",
              byText(
                /Grandparent RUS cascade|Grandparent save complete|OpportunityGroup__c/i,
              ),
            ),
      warnings: [],
    },
    "phase-17a-process-builder": {
      observed: processBldEvents.length > 0,
      inferred: false,
      confidence: processBldEvents.length > 0 ? "direct" : "derived",
      events: processBldEvents,
      warnings: [],
    },
    "phase-17b-workflow-criteria": {
      observed: wfCriteriaEvents.length > 0,
      inferred: false,
      confidence: wfCriteriaEvents.length > 0 ? "direct" : "derived",
      events: wfCriteriaEvents,
      warnings: [],
    },
    "phase-18-sharing-rules": {
      observed: sharingEvents.length > 0,
      inferred:
        sharingEvents.length === 0 &&
        hasText(/Criteria-Based Sharing Rules|sharing rules/i),
      confidence: sharingEvents.length > 0 ? "direct" : "derived",
      events: sharingEvents,
      warnings: [],
    },
    "phase-19-dml-commit": {
      observed: false,
      inferred: dmlRows.length > 0 && !hasFatalError && hasExecution,
      confidence: "inferred",
      events: rawLineEvents(
        "DML_COMMIT",
        byText(/EXECUTION_FINISHED|LIMIT_USAGE_FOR_NS/i),
      ),
      warnings:
        parseResult.capabilities.phaseInferenceEnabled &&
        dmlRows.length > 0 &&
        !hasFatalError
          ? [
              "Commit inferred from successful transaction completion and absence of FATAL_ERROR before EXECUTION_FINISHED.",
            ]
          : [],
    },
    "phase-20-post-commit-logic": {
      observed: postCommitEvents.length > 0,
      inferred: false,
      confidence: postCommitEvents.length > 0 ? "direct" : "derived",
      events: postCommitEvents,
      warnings: warnings
        .filter((warning) =>
          /queueable|future|email|post-commit/i.test(
            asString(warning.summary) ?? "",
          ),
        )
        .slice(0, 5)
        .map((warning) => asString(warning.summary) ?? "Post-commit activity"),
    },
  };

  return { signals, truncationWarnings };
}

function buildPhaseOutputs(
  base: UnknownRecord,
  parseResult: NormalizedParseResult,
  rawLines: RawLogLine[],
  limits: ReportLimits = {},
): { outputs: PhaseOutput[]; truncationWarnings: string[] } {
  const context = asRecord(base.context);
  const transaction = asRecord(context.transaction);
  const database = asRecord(base.database);
  const rootCodeUnit = asString(transaction.rootCodeUnit) ?? "";
  const executionType = asString(transaction.requestType) ?? "";
  const defaultFallbackLine =
    asNumber(
      asRecord(asArray(asRecord(asRecord(base.trace).events))[0])["lineNumber"],
    ) ?? null;
  const { signals, truncationWarnings } = buildPhaseSignals(
    base,
    parseResult,
    rawLines,
    limits,
  );
  const soqlCount = asArray(database.soql).length;
  const dmlCount = asArray(database.dml).filter(
    (entry) => asString(asRecord(entry).source) === "event",
  ).length;

  const outputs = EXECUTION_PHASE_DEFINITIONS.map((definition) => {
    const signal = signals[definition.id];
    const observed = signal.observed;
    const inferred =
      !observed &&
      signal.inferred &&
      parseResult.capabilities.phaseInferenceEnabled;
    const status: PhaseOutput["status"] = observed
      ? "observed"
      : inferred
        ? "inferred"
        : "not_observed";
    const confidence: EvidenceConfidence = observed
      ? "direct"
      : inferred
        ? "inferred"
        : definition.defaultConfidence === "direct"
          ? "derived"
          : definition.defaultConfidence;
    const evidence = firstPhaseEvidence(
      signal.events,
      defaultFallbackLine,
      confidence,
    );

    return {
      id: definition.id,
      name: definition.name,
      index: definition.index,
      status,
      confidence,
      inputs: {
        executionType,
        rootCodeUnit,
      },
      outputs: {
        observedEventCount: signal.events.length,
        soqlCount,
        dmlCount,
      },
      events: signal.events,
      warnings: signal.warnings,
      evidence,
      syntheticDoc: definition.syntheticDoc,
    };
  });

  return { outputs, truncationWarnings };
}

function buildEvidenceIndex(
  rawLines: RawLogLine[],
  base: UnknownRecord,
  phases: PhaseOutput[],
) {
  const indexedLines = rawLines.map((line) => ({
    id: line.id,
    lineNumber: line.lineNumber,
    text: line.text,
  }));

  const events = asArray(asRecord(asRecord(base.trace).events)).map((event) =>
    asRecord(event),
  );
  const eventRefs = events.map((event, index) => ({
    id: asString(event.id) ?? `event-${index + 1}`,
    lineNumber: asNumber(event.lineNumber) ?? null,
    label: asString(event.text) ?? asString(event.type) ?? "Event",
    type: asString(event.type) ?? "UNKNOWN",
  }));

  const issueRefs = asArray(asRecord(base.errors).items).map((item, index) => {
    const issue = asRecord(item);
    return {
      id: `issue-${index + 1}`,
      lineNumber: asNumber(asRecord(issue.evidence).lineNumber) ?? null,
      summary: asString(issue.summary) ?? asString(issue.type) ?? "Issue",
    };
  });

  return {
    lines: indexedLines,
    events: eventRefs,
    issues: issueRefs,
    phases: phases.map((phase) => ({
      id: phase.id,
      startLine: phase.evidence.startLine,
      endLine: phase.evidence.endLine,
      confidence: phase.evidence.confidence,
    })),
    lineToEvents: cloneJsonLike(
      asRecord(asRecord(base.indexes).lineToEventIds),
    ),
  };
}

/**
 * Builds a self-contained offline report from a normalised parse result.
 *
 * The report includes the full event timeline, Salesforce Order of Execution
 * phase analysis, governor limit snapshots, database operation summaries,
 * and an evidence index that maps every insight back to the raw log lines.
 *
 * Designed to be serialised as JSON and rendered by the viewer without
 * any network access.
 *
 * @param input - Log source metadata, the normalised parse result, and
 *   optional truncation limits.
 * @returns A {@link OfflineReportV2} object ready for JSON serialisation.
 *
 * @example
 * ```ts
 * import { parseLog, buildOfflineReport, utf8ByteLength } from '@apex-log-insights/core';
 *
 * const parseResult = await parseLog(logText, { includeRawLines: true });
 * const report = buildOfflineReport({
 *   source: { fileName: 'debug.log', bytes: utf8ByteLength(logText) },
 *   parseResult,
 * });
 * fs.writeFileSync('report.json', JSON.stringify(report));
 * ```
 */
export function buildOfflineReport(input: OfflineReportInput): OfflineReportV2 {
  const generatedAt = input.source.generatedAt ?? new Date().toISOString();
  const limits = normalizeReportLimits(input.limits ?? {});
  const base = buildInsightsReport({
    filePath: input.source.fileName,
    fileBytes: input.source.bytes,
    generatedAt,
    parseTimeMs: input.parseResult.parseTimeMs,
    parserResult: input.parseResult.parserResult,
    limits,
  }) as unknown as UnknownRecord;

  const rawLines = coerceRawLines(input.parseResult.rawLines, input.rawLogText);

  const { outputs: phases, truncationWarnings: phaseTruncationWarnings } =
    buildPhaseOutputs(base, input.parseResult, rawLines, limits);
  const source = {
    ...cloneJsonLike(asRecord(base.source)),
    fileName: input.source.fileName,
    bytes: input.source.bytes,
    generatedAt,
    sourceType: input.parseResult.sourceType,
    parserCore: "parseLog",
    includeRawLines: input.parseResult.capabilities.includeRawLines,
  };

  const metadata = {
    generatedAt,
    parser: {
      parseTimeMs: input.parseResult.parseTimeMs,
      mode: asString(asRecord(base.parser).mode) ?? "facts-only",
      phaseInferenceEnabled:
        input.parseResult.capabilities.phaseInferenceEnabled,
      logIssueOverflowCount: input.parseResult.logIssueOverflowCount,
    },
    namespaces: cloneJsonLike(
      asArray(asRecord(asRecord(base.components).namespaces)).filter(
        (value): value is string => typeof value === "string",
      ),
    ),
    rawLineCount: rawLines.length,
    syntheticCoverage: {
      phaseCount: EXECUTION_PHASE_DEFINITIONS.length,
      docBacked: EXECUTION_PHASE_DEFINITIONS.map((phase) => ({
        id: phase.id,
        syntheticDoc: phase.syntheticDoc,
      })),
    },
    truncationWarnings: phaseTruncationWarnings,
    logCompleteness: buildLogCompleteness(input.parseResult, rawLines),
    limits: limits,
  };

  const entryPoint = {
    type:
      asString(asRecord(asRecord(base.context).transaction).requestType) ??
      null,
    name:
      asString(asRecord(asRecord(base.context).transaction).rootCodeUnit) ??
      null,
    recordIds: cloneJsonLike(
      asArray(asRecord(asRecord(base.context).transaction).recordIds).filter(
        (value): value is string => typeof value === "string",
      ),
    ),
    evidence: lineEvidence(asArray(asRecord(asRecord(base.trace).events))[0]),
  };

  const timeline = input.parseResult.normalizedTimeline.map((event) => ({
    id: event.id,
    type: event.type,
    timestampNs: event.timestampNs,
    timestampIsInferred: event.timestampIsInferred,
    endNs: event.endNs,
    durationNs: event.durationNs,
    lineNumber: event.lineNumber,
    text: event.text,
    namespace: event.namespace,
    parentId: event.parentId,
    pairingStatus: event.pairingStatus,
    durationIsPartial: event.durationIsPartial,
    classification: event.classification,
    evidence: event.evidence,
  }));

  const execution = {
    blocks: [],
    tree: [],
  };

  const database = cloneJsonLike(asRecord(base.database));
  const governorLimits = {
    current: cloneJsonLike(asRecord(asRecord(base.limits).cumulative)),
    snapshots: cloneJsonLike(asArray(asRecord(base.limits).snapshots)),
    burnRate: cloneJsonLike(asRecord(base.governorBurnRate)),
  };

  const issues = cloneJsonLike(asArray(asRecord(asRecord(base.errors).items)));
  const evidenceIndex = buildEvidenceIndex(rawLines, base, phases);
  const failureContexts = buildFailureContexts(input.parseResult);
  const uiHints = {
    brand: {
      productName: "Apex Log Insights",
    },
    offline: {
      localOnly: true,
      networkRequired: false,
    },
    navigation: cloneJsonLike(asRecord(base.uiNavigation)),
    truthLinks: {
      enabled: true,
      contextLinesDefault: 5,
    },
  };

  const baseSnapshot = cloneJsonLike(base);

  return {
    ...baseSnapshot,
    reportVersion: "3.0.0",
    generatedAt,
    source,
    metadata: metadata as unknown as JsonValue,
    entryPoint: entryPoint as unknown as JsonValue,
    execution: execution as unknown as JsonValue,
    timeline,
    phases: cloneJsonLike(phases) as unknown as JsonValue,
    database: database as unknown as JsonValue,
    governorLimits: governorLimits as unknown as JsonValue,
    issues: issues as unknown as JsonValue,
    parserDiagnostics: cloneJsonLike(
      Array.isArray(input.parseResult.parserDiagnostics)
        ? input.parseResult.parserDiagnostics
        : [],
    ) as unknown as JsonValue,
    evidenceIndex: evidenceIndex as unknown as JsonValue,
    failureContexts: failureContexts as unknown as JsonValue,
    uiHints: uiHints as unknown as JsonValue,
  };
}
