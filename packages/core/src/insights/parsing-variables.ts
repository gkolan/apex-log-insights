// Variable assignment, explain plan, and cumulative profiling parsing.
// Used by execution.ts and insightsReport.ts.

import type {
  FlatEvent,
  ParsedVariableAssignment,
  ParsedVariableScope,
  ParsedExplainPlan,
  ParsedCumulativeEntry,
  ParsedCumulativeDmlEntry,
} from "./types.js";
import { parseSafeIntegerToken, splitLogFields } from "../logFields.js";
import { isRecord } from "./utils.js";

// ─── Variable + Explain Plan Parsing ─────────────────────────────────────────

/**
 * Extracts the target SObject name from a SOQL query string.
 *
 * Parses the FROM clause to identify the object being queried (e.g., 'SELECT Id FROM Account' → 'Account').
 * Returns null if no FROM clause is found or the query is null.
 *
 * @param query - SOQL query string, or null
 * @returns SObject name from the FROM clause, or null if not found
 */
export function extractTargetObject(query: string | null): string | null {
  const q = String(query || "");
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < q.length; index += 1) {
    const char = q[index]!;
    const next = q[index + 1];

    if (lineComment) {
      if (char === "\n" || char === "\r") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        // Accept doubled SQL-style quote escaping as well as Apex backslashes.
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }

    if ((char === "'" || char === '"') && !quote) {
      quote = char;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0 || q.slice(index, index + 4).toUpperCase() !== "FROM") {
      continue;
    }

    const before = q[index - 1];
    const after = q[index + 4];
    if (
      (before && /[A-Z0-9_]/i.test(before)) ||
      (after && /[A-Z0-9_]/i.test(after))
    ) {
      continue;
    }

    let objectStart = index + 4;
    while (/\s/.test(q[objectStart] || "")) objectStart += 1;
    const objectMatch = q.slice(objectStart).match(/^[A-Z_][A-Z0-9_]*/i);
    return objectMatch?.[0] ?? null;
  }

  return null;
}

/**
 * Parses SOQL EXPLAIN plan output into a structured object with index info and cardinality.
 *
 * Extracts availability flag, index usage status, indexed fields list, cardinality metrics (record count, cost).
 * Handles "No explain plan is available" messages gracefully. Returns structured data for visualization and analysis.
 *
 * @param text - Raw EXPLAIN plan output text from the log
 * @returns ParsedExplainPlan with availability, indexing status, and metrics
 */
export function parseExplainPlan(text: string): ParsedExplainPlan {
  const raw = String(text || "");
  if (/No explain plan is available/i.test(raw)) {
    return {
      available: false,
      indexed: false,
      raw,
    };
  }

  const out: ParsedExplainPlan = {
    available: true,
    indexed: /Index on /i.test(raw),
    raw,
  };

  const indexMatch = raw.match(/Index on [^:]+ : \[([^\]]+)\]/i);
  if (indexMatch?.[1]) {
    out.indexFields = indexMatch[1]
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
  }

  const metricToken = (label: string): string | null => {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const token = raw.match(
      new RegExp(
        `\\b${escapedLabel}\\s*:?\\s*([^\\s;{}\\[\\]]+?)(?=,\\s*(?:[A-Za-z_]|$)|\\s|;|[{}\\[\\]]|$)`,
        "i",
      ),
    )?.[1];
    return token ?? null;
  };

  const cardinality = parseSafeIntegerToken(metricToken("cardinality"));
  const sobjectCardinality = parseSafeIntegerToken(
    metricToken("sobjectCardinality"),
  );
  const relativeCostToken = metricToken("relativeCost");

  if (cardinality !== null) out.cardinality = cardinality;
  if (sobjectCardinality !== null) out.sobjectCardinality = sobjectCardinality;
  if (
    relativeCostToken !== null &&
    /^(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(relativeCostToken)
  ) {
    const relativeCost = Number(relativeCostToken);
    if (Number.isFinite(relativeCost) && relativeCost >= 0) {
      out.relativeCost = relativeCost;
    }
  }

  return out;
}

/**
 * Parses a VARIABLE_ASSIGNMENT debug log event into a structured variable name, raw value, and parsed value.
 *
 * Splits the event text on '|' separator to extract variable name and raw value. Attempts to JSON-parse the value
 * if it looks like JSON (starts with {, [, or "). Detects empty collections (empty arrays/objects).
 * Returns null if variable name is missing.
 *
 * @param event - FlatEvent of type VARIABLE_ASSIGNMENT
 * @returns ParsedVariableAssignment with parsed structure, or null if parsing fails
 */
export function parseVariableAssignment(
  event: FlatEvent,
): ParsedVariableAssignment | null {
  if (event.type !== "VARIABLE_ASSIGNMENT") return null;

  const logParts = splitLogFields(String(event.logLine || ""), 5);
  const hasRawTokens =
    logParts[1] === "VARIABLE_ASSIGNMENT" && logParts.length >= 5;
  const variableName = hasRawTokens
    ? logParts[3]?.trim() || ""
    : String(event.text || "")
        .split("|", 1)[0]
        ?.trim() || "";
  let rawValue: string;
  if (hasRawTokens) {
    rawValue = (logParts[4] || "").replace(/\|0x[\da-f]+\s*$/i, "").trim();
  } else {
    const separator = String(event.text || "").indexOf("|");
    rawValue = separator >= 0 ? event.text.slice(separator + 1).trim() : "";
  }
  if (!variableName) return null;

  let parsedValue: unknown = rawValue;
  if (rawValue === "null") {
    parsedValue = null;
  } else if (
    rawValue.startsWith("{") ||
    rawValue.startsWith("[") ||
    rawValue.startsWith('"')
  ) {
    try {
      parsedValue = JSON.parse(rawValue);
    } catch {
      parsedValue = rawValue;
    }
  }

  let isEmptyCollection = false;
  if (Array.isArray(parsedValue)) isEmptyCollection = parsedValue.length === 0;
  else if (isRecord(parsedValue))
    isEmptyCollection = Object.keys(parsedValue).length === 0;

  return {
    variableName,
    rawValue,
    parsedValue,
    isEmptyCollection,
  };
}

/**
 * Parses a VARIABLE_SCOPE_BEGIN event to extract the variable name and Apex type.
 *
 * Splits the event text on '|' separator to get variable name and type name. Returns null if either component is missing.
 * Used to track variable scope entry and type information throughout execution.
 *
 * @param event - FlatEvent of type VARIABLE_SCOPE_BEGIN
 * @returns ParsedVariableScope with variable name and type, or null if parsing fails
 */
export function parseVariableScope(
  event: FlatEvent,
): ParsedVariableScope | null {
  if (event.type !== "VARIABLE_SCOPE_BEGIN") return null;
  const logParts = splitLogFields(String(event.logLine || ""), 6);
  const hasRawTokens =
    logParts[1] === "VARIABLE_SCOPE_BEGIN" && logParts.length >= 5;
  const displayParts = splitLogFields(String(event.text || ""), 3);
  const variableName = hasRawTokens
    ? logParts[3]?.trim() || ""
    : displayParts[0]?.trim() || "";
  const typeName = hasRawTokens
    ? logParts[4]?.trim() || ""
    : displayParts[1]?.trim() || "";
  if (!variableName || !typeName) return null;
  return { variableName, typeName };
}

// ─── Cumulative Profiling ─────────────────────────────────────────────────────

function parseCumulativeProfilingLine(
  line: string,
): ParsedCumulativeEntry | null {
  const executionMatch = line.match(
    /executed\s+(\S+)\s+times?\s+in\s+(\S+)\s+ms/i,
  );
  if (!executionMatch) return null;

  const executionCount = parseSafeIntegerToken(executionMatch[1]);
  const timeMs = parseSafeIntegerToken(executionMatch[2]);
  const classMatch = line.match(/Class\.([^:]+):\s*line\s*([^,\s:]+)/);
  const lineNumber = classMatch?.[2]
    ? parseSafeIntegerToken(classMatch[2])
    : null;

  if (
    executionCount === null ||
    timeMs === null ||
    (classMatch?.[2] && lineNumber === null)
  ) {
    return null;
  }

  return {
    className: classMatch?.[1] ?? null,
    lineNumber,
    executionCount,
    timeMs,
    rawLine: line.trim(),
  };
}

function parseCumulativeDmlOperation(line: string): {
  operation: string | null;
  sObject: string | null;
} {
  const dmlMatch = line.match(
    /:\s*(Insert|Update|Upsert|Delete|Undelete|Merge):\s*([^:]+):\s*executed/i,
  );
  if (!dmlMatch) return { operation: null, sObject: null };
  return {
    operation: dmlMatch[1] ?? null,
    sObject: dmlMatch[2]?.trim() ?? null,
  };
}

/**
 * Collects cumulative profiling data from CUMULATIVE_PROFILING events.
 *
 * Parses CUMULATIVE_PROFILING events, which contain sections for DML operations, method invocations, and SOQL operations.
 * Each section lists invocation counts and execution times. Extracts and returns structured profiling data organized by operation type.
 *
 * @param allEvents - Array of all parsed events from the log
 * @returns Object with dmlOperations, methodInvocations, and soqlOperations arrays
 */
export function collectCumulativeProfilingSections(allEvents: FlatEvent[]): {
  dmlOperations: ParsedCumulativeDmlEntry[];
  methodInvocations: ParsedCumulativeEntry[];
  soqlOperations: ParsedCumulativeEntry[];
} {
  const out = {
    dmlOperations: [] as ParsedCumulativeDmlEntry[],
    methodInvocations: [] as ParsedCumulativeEntry[],
    soqlOperations: [] as ParsedCumulativeEntry[],
  };

  for (const event of allEvents) {
    if (event.type !== "CUMULATIVE_PROFILING") continue;
    const lines = String(event.text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) continue;
    const header = lines[0]!.toLowerCase();
    const bodyLines = lines.slice(1);

    if (header.startsWith("dml operations")) {
      for (const line of bodyLines) {
        const parsed = parseCumulativeProfilingLine(line);
        if (!parsed) continue;
        const dmlMeta = parseCumulativeDmlOperation(line);
        out.dmlOperations.push({
          ...parsed,
          operation: dmlMeta.operation,
          sObject: dmlMeta.sObject,
        });
      }
      continue;
    }

    if (header.startsWith("method invocations")) {
      for (const line of bodyLines) {
        const parsed = parseCumulativeProfilingLine(line);
        if (parsed) out.methodInvocations.push(parsed);
      }
      continue;
    }

    if (header.startsWith("soql operations")) {
      for (const line of bodyLines) {
        const parsed = parseCumulativeProfilingLine(line);
        if (parsed) out.soqlOperations.push(parsed);
      }
    }
  }

  return out;
}
