// Execution phase builder.
//
// Identifies the root CODE_UNIT_STARTED span, finds its direct method-level
// children (the "phases"), and enriches each with database ops, governor
// limit deltas, data flow, and warnings — all scoped to the phase's time window.

import type {
  FlatEvent,
  UnknownRecord,
  ExecutionPhase,
  PhaseDataFlow,
  ParsedVariableAssignment,
  DatabaseSoqlEntry,
  DatabaseDmlEntry,
} from "./types.js";
import { SALESFORCE_ID_RE } from "./types.js";
import { isRecord } from "./utils.js";
import { buildLimitTimeline, computeGovernorDelta } from "./governor.js";
import { inferSObjectFromVarName } from "./parsing.js";

function sumExactRows(entries: Array<{ rows: number | null }>): number | null {
  let total = 0;
  for (const entry of entries) {
    if (entry.rows === null) return null;
    total += entry.rows;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function findPhaseIndex(
  phaseStarts: number[],
  finalPhaseEndNs: number,
  timestampNs: number,
): number {
  let low = 0;
  let high = phaseStarts.length - 1;
  let result = -1;

  // Find the rightmost phase start at or before the timestamp. This preserves
  // the existing half-open windows, including zero-width duplicate starts.
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    if (phaseStarts[middle]! <= timestampNs) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (result === phaseStarts.length - 1 && timestampNs > finalPhaseEndNs) {
    return -1;
  }
  return result;
}

function createPhaseBuckets<T>(phaseCount: number): T[][] {
  return Array.from({ length: phaseCount }, () => []);
}

/**
 * Maps parsed events into the Salesforce 20-phase Order of Execution lifecycle using context model and governor limits.
 *
 * Identifies the root CODE_UNIT_STARTED span, extracts its direct method-level children as phases, and enriches each phase
 * with database operations (SOQL/DML), governor limit deltas, data flow analysis (input/output record IDs, variable assignments),
 * and phase-specific warnings. All metrics are scoped to the phase's time window.
 *
 * @param spans - Array of timing spans with metadata (id, parent, duration, category, etc.)
 * @param databaseSoql - Array of parsed SOQL entries
 * @param databaseDml - Array of parsed DML entries
 * @param variableAssignments - Array of parsed variable assignments with values
 * @param allEvents - Array of all parsed events from the log
 * @param snapshotsRaw - Array of raw governor limit snapshots
 * @param totalDurationMs - Total execution duration in milliseconds (used for percentage calculations)
 * @param prefixMap - Map of Salesforce ID key prefixes to sObject types
 * @returns Array of ExecutionPhase objects with enriched data for each phase
 */
export function buildExecutionPhases(
  spans: Array<{
    id: string;
    parentId: string | null;
    eventType: string;
    label: string;
    namespace: string;
    startNs: number;
    endNs: number | null;
    durationNs: number | null;
    durationMs: number | null;
    selfDurationNs: number | null;
    selfDurationMs: number | null;
    evidence: { lineNumber: number | null; raw: string | null };
    category: string | null;
    debugCategory: string | null;
    cpuType: string | null;
  }>,
  databaseSoql: DatabaseSoqlEntry[],
  databaseDml: DatabaseDmlEntry[],
  variableAssignments: ParsedVariableAssignment[],
  allEvents: FlatEvent[],
  snapshotsRaw: unknown[],
  totalDurationMs: number | null,
  prefixMap: Map<string, string>,
): ExecutionPhase[] {
  // Find the root span — first CODE_UNIT_STARTED
  const rootSpan = spans.find((s) => s.eventType === "CODE_UNIT_STARTED");
  if (!rootSpan) return [];

  // Find the primary execute method — first METHOD_ENTRY or CONSTRUCTOR_ENTRY
  // that is a direct child of the root code unit
  const directChildren = spans.filter(
    (s) =>
      s.parentId === rootSpan.id &&
      (s.eventType.startsWith("METHOD_") ||
        s.eventType.startsWith("CONSTRUCTOR_")),
  );

  // If the root has a single execute() child, we want ITS children as phases.
  // If the root has multiple direct method children, those ARE the phases.
  let phaseSpans: typeof spans;
  let parentLabel: string;

  if (directChildren.length === 1) {
    // Single execute() method — its children are the phases
    const executeSpan = directChildren[0]!;
    parentLabel = executeSpan.label;
    phaseSpans = spans.filter(
      (s) =>
        s.parentId === executeSpan.id &&
        (s.eventType.startsWith("METHOD_") ||
          s.eventType.startsWith("CONSTRUCTOR_") ||
          s.eventType === "SOQL_EXECUTE_BEGIN" ||
          s.eventType === "DML_BEGIN"),
    );
    // If execute() has no children (flat log), fall back to direct children
    if (phaseSpans.length === 0) {
      phaseSpans = directChildren;
      parentLabel = rootSpan.label;
    }
  } else {
    phaseSpans = directChildren;
    parentLabel = rootSpan.label;
  }

  // Parse the parent class name
  const parentClassName =
    parentLabel.split(".")[0]?.replace(/^.*?[\\/]/, "") ?? null;

  // Build governor limit timeline for delta computation
  const limitTimeline = buildLimitTimeline(snapshotsRaw);

  // Ensure phaseSpans are sorted by startNs for consistent phase boundary calculations
  phaseSpans.sort((a, b) => a.startNs - b.startNs);

  // Pre-compute variable assignment timestamps for data flow.
  // Build per-name queues in log order so repeated names (e.g. `records` assigned
  // twice in different phases) each consume their own matching event rather than
  // always resolving to the first occurrence.
  const vaEventQueues = new Map<string, typeof allEvents>();
  for (const event of allEvents) {
    if (event.type !== "VARIABLE_ASSIGNMENT") continue;
    const sep = event.text.indexOf("|");
    const name = sep !== -1 ? event.text.slice(0, sep) : event.text;
    if (!vaEventQueues.has(name)) vaEventQueues.set(name, []);
    vaEventQueues.get(name)!.push(event);
  }
  const vaByTimestamp = variableAssignments
    .map((va) => {
      const queue = vaEventQueues.get(va.variableName) ?? [];
      const event = queue.shift(); // consume in log order
      return {
        ...va,
        timestampNs: event?.timestampNs ?? null,
        lineNumber: event?.lineNumber ?? null,
      };
    })
    .sort((a, b) => (a.timestampNs ?? 0) - (b.timestampNs ?? 0));

  const phaseStarts = phaseSpans.map((span) => span.startNs);
  const finalPhase = phaseSpans.at(-1);
  const finalPhaseEndNs = finalPhase
    ? (finalPhase.endNs ?? finalPhase.startNs + 1_000_000_000)
    : 0;
  const soqlByPhase = createPhaseBuckets<DatabaseSoqlEntry>(phaseSpans.length);
  const dmlByPhase = createPhaseBuckets<DatabaseDmlEntry>(phaseSpans.length);
  const vaByPhase = createPhaseBuckets<(typeof vaByTimestamp)[number]>(
    phaseSpans.length,
  );

  // Attribute each large collection once. Iterating the source arrays retains
  // their established within-phase ordering while avoiding one full scan per
  // phase (Salesforce executions can expose up to 20 phases).
  for (const query of databaseSoql) {
    const timestampNs = query.evidence.timestampNs;
    if (timestampNs === null) continue;
    const phaseIndex = findPhaseIndex(
      phaseStarts,
      finalPhaseEndNs,
      timestampNs,
    );
    if (phaseIndex >= 0) soqlByPhase[phaseIndex]!.push(query);
  }
  for (const operation of databaseDml) {
    const timestampNs = operation.evidence.timestampNs;
    if (operation.source !== "event" || timestampNs === null) continue;
    const phaseIndex = findPhaseIndex(
      phaseStarts,
      finalPhaseEndNs,
      timestampNs,
    );
    if (phaseIndex >= 0) dmlByPhase[phaseIndex]!.push(operation);
  }
  for (const assignment of vaByTimestamp) {
    if (assignment.timestampNs === null) continue;
    const phaseIndex = findPhaseIndex(
      phaseStarts,
      finalPhaseEndNs,
      assignment.timestampNs,
    );
    if (phaseIndex >= 0) vaByPhase[phaseIndex]!.push(assignment);
  }

  // Track which IDs have been seen before each phase (for input/output analysis)
  const seenIdsBefore = new Set<string>();

  return phaseSpans.map((span, index) => {
    const phaseStartNs = span.startNs;
    // For unclosed spans, use the next phase's start as an upper bound instead of
    // MAX_SAFE_INTEGER to avoid absorbing all subsequent operations.
    const nextPhaseStart =
      index < phaseSpans.length - 1 ? phaseSpans[index + 1]!.startNs : null;
    const phaseEndNs =
      span.endNs ?? nextPhaseStart ?? phaseStartNs + 1_000_000_000;
    // ── Database ops in this phase's time window ─────────────────
    const soqlInPhase = soqlByPhase[index]!;
    const dmlInPhase = dmlByPhase[index]!;

    const totalSoqlRows = sumExactRows(soqlInPhase);
    const totalDmlRows = sumExactRows(dmlInPhase);

    // ── Governor limit deltas ────────────────────────────────────
    const govDelta = computeGovernorDelta(
      limitTimeline,
      phaseStartNs,
      phaseEndNs,
    );

    // ── Data flow: variable assignments in this phase ────────────
    const vasInPhase = vaByPhase[index]!;

    const phaseIds = new Set<string>();
    const emptyResults: string[] = [];
    const significantAssignments: PhaseDataFlow["significantAssignments"] = [];

    for (const va of vasInPhase) {
      // Collect IDs from this phase
      collectSalesforceIds(va.parsedValue ?? va.rawValue, phaseIds);

      // Track empty collections
      if (va.isEmptyCollection && /^map/i.test(va.variableName)) {
        emptyResults.push(va.variableName);
      }

      // Track significant assignments (records with data)
      if (
        isRecord(va.parsedValue) &&
        Object.keys(va.parsedValue as UnknownRecord).length > 0
      ) {
        const keys = Object.keys(va.parsedValue as UnknownRecord);
        const recordCount = keys.length;
        // Check if values look like records (have Id fields or are keyed by IDs)
        const firstVal = Object.values(va.parsedValue as UnknownRecord)[0];
        const firstKey = keys[0];
        const looksLikeRecordMap =
          isRecord(firstVal) ||
          (typeof firstKey === "string" && firstKey.length >= 15);

        if (looksLikeRecordMap) {
          significantAssignments.push({
            variableName: va.variableName,
            sObjectType: inferSObjectFromVarName(va.variableName),
            recordCount,
            timestampNs: va.timestampNs,
          });
        }
      }
    }

    // Compute input vs output IDs
    const inputIds = Array.from(phaseIds).filter((id) => seenIdsBefore.has(id));
    const outputIds = Array.from(phaseIds).filter(
      (id) => !seenIdsBefore.has(id),
    );

    // Add this phase's IDs to the running "seen" set
    for (const id of phaseIds) seenIdsBefore.add(id);

    // ── Phase-specific warnings (consolidated per query) ───────────
    const warnings: string[] = [];

    for (const q of soqlInPhase) {
      const qFindings: string[] = [];
      if (q.rows === 0) qFindings.push("returned 0 rows");
      if ((q.durationMs ?? 0) >= 50)
        qFindings.push(`took ${q.durationMs?.toFixed(1)}ms`);
      if (q.explain?.available === false) qFindings.push("no explain plan");

      if (qFindings.length > 0) {
        warnings.push(
          `SOQL on ${q.targetObject ?? "unknown"}: ${qFindings.join(", ")}`,
        );
      }
    }

    if (emptyResults.length > 0) {
      warnings.push(`Empty result maps: ${emptyResults.join(", ")}`);
    }

    const phaseDmlNoOp = dmlInPhase.find(
      (d) =>
        d.operation?.toLowerCase() === "update" &&
        d.durationMs === 0 &&
        d.rows === 0,
    );
    if (phaseDmlNoOp) {
      warnings.push(
        `DML update on ${phaseDmlNoOp.sObject ?? "unknown"} was a no-op`,
      );
    }

    // ── Child phases (sub-methods within this phase) ─────────────
    const childPhaseIds = spans
      .filter(
        (s) =>
          s.parentId === span.id &&
          (s.eventType.startsWith("METHOD_") ||
            s.eventType.startsWith("CONSTRUCTOR_")),
      )
      .map((s) => s.id);

    // suppress unused param warning
    void prefixMap;

    return {
      id: span.id,
      label: span.label,
      phaseIndex: index,
      calledFrom: {
        className: parentClassName,
        lineNumber: span.evidence.lineNumber,
      },
      timing: {
        startNs: phaseStartNs,
        endNs: phaseEndNs,
        durationMs: span.durationMs,
        selfDurationMs: span.selfDurationMs,
        pctOfTotal:
          totalDurationMs !== null &&
          totalDurationMs > 0 &&
          span.durationMs !== null
            ? Math.round((span.durationMs / totalDurationMs) * 10000) / 100
            : null,
      },
      database: {
        soqlInPhase: soqlInPhase.map((q) => ({
          id: q.id,
          targetObject: q.targetObject,
          rows: q.rows,
          durationMs: q.durationMs,
          explain: q.explain,
        })),
        dmlInPhase: dmlInPhase.map((d) => ({
          id: d.id,
          operation: d.operation,
          sObject: d.sObject,
          rows: d.rows,
          durationMs: d.durationMs,
        })),
        totalSoqlRows,
        totalDmlRows,
      },
      governorDelta: govDelta,
      dataFlow: {
        inputIds: inputIds.slice(0, 50),
        outputIds: outputIds.slice(0, 50),
        recordsProcessed: phaseIds.size,
        emptyResults,
        significantAssignments,
      },
      warnings,
      childPhaseIds,
    } satisfies ExecutionPhase;
  });
}

// ─── Salesforce ID Collection ─────────────────────────────────────────────────

/**
 * Recursively extracts Salesforce record IDs from a value into a Set.
 *
 * Traverses strings, arrays, and objects to find 15/18-character ID tokens. Because a
 * 15-character API name can satisfy the same broad alphanumeric shape, free-form
 * matches must contain at least one digit. This prevents field names such as
 * `CurrencyIsoCode` from being reported as transaction scope IDs.
 *
 * @param value - The value to search (string, array, object, or primitive)
 * @param out - Set to accumulate found IDs (mutated in place)
 */
export function collectSalesforceIds(value: unknown, out: Set<string>): void {
  const stack: unknown[] = [value];
  const visited = new WeakSet<object>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string") {
      const matches = current.match(new RegExp(SALESFORCE_ID_RE.source, "g"));
      if (matches) {
        for (const id of matches) {
          if (/\d/.test(id)) out.add(id);
        }
      }
      continue;
    }
    if (Array.isArray(current)) {
      if (visited.has(current)) continue;
      visited.add(current);
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push(current[index]);
      }
      continue;
    }
    if (isRecord(current)) {
      if (visited.has(current)) continue;
      visited.add(current);
      for (const [key, nestedValue] of Object.entries(current)) {
        stack.push(nestedValue, key);
      }
    }
  }
}
