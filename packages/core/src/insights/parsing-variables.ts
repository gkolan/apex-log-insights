// Variable assignment, explain plan, and cumulative profiling parsing.
// Used by execution.ts and insightsReport.ts.

import type {
  FlatEvent,
  ParsedVariableAssignment,
  ParsedVariableScope,
  ParsedExplainPlan,
  ParsedCumulativeEntry,
  ParsedCumulativeDmlEntry,
} from './types.js';
import { isRecord } from './utils.js';

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
  const q = String(query || '');
  const m = q.match(/\bFROM\s+([a-zA-Z0-9_]+)/i);
  return m?.[1] ?? null;
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
  const raw = String(text || '');
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
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);
  }

  const cardinality = raw.match(/cardinality:\s*(\d+)/i)?.[1];
  const sobjectCardinality = raw.match(/sobjectCardinality:\s*(\d+)/i)?.[1];
  const relativeCost = raw.match(/relativeCost\s+(\d+(?:\.\d+)?)/i)?.[1];

  if (cardinality !== undefined) {
    const v = Number(cardinality);
    if (Number.isFinite(v)) out.cardinality = v;
  }
  if (sobjectCardinality !== undefined) {
    const v = Number(sobjectCardinality);
    if (Number.isFinite(v)) out.sobjectCardinality = v;
  }
  if (relativeCost !== undefined) {
    const v = Number(relativeCost);
    if (Number.isFinite(v)) out.relativeCost = v;
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
export function parseVariableAssignment(event: FlatEvent): ParsedVariableAssignment | null {
  if (event.type !== 'VARIABLE_ASSIGNMENT') return null;

  const parts = String(event.text || '')
    .split('|')
    .map((p) => p.trim());

  const variableName = parts[0] || '';
  const rawValue = parts[1] || '';
  if (!variableName) return null;

  let parsedValue: unknown = rawValue;
  if (rawValue === 'null') {
    parsedValue = null;
  } else if (rawValue.startsWith('{') || rawValue.startsWith('[') || rawValue.startsWith('"')) {
    try {
      parsedValue = JSON.parse(rawValue);
    } catch {
      parsedValue = rawValue;
    }
  }

  let isEmptyCollection = false;
  if (Array.isArray(parsedValue)) isEmptyCollection = parsedValue.length === 0;
  else if (isRecord(parsedValue)) isEmptyCollection = Object.keys(parsedValue).length === 0;

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
export function parseVariableScope(event: FlatEvent): ParsedVariableScope | null {
  if (event.type !== 'VARIABLE_SCOPE_BEGIN') return null;
  const parts = String(event.text || '')
    .split('|')
    .map((p) => p.trim());
  const variableName = parts[0] || '';
  const typeName = parts[1] || '';
  if (!variableName || !typeName) return null;
  return { variableName, typeName };
}

// ─── Cumulative Profiling ─────────────────────────────────────────────────────

function parseCumulativeProfilingLine(line: string): ParsedCumulativeEntry | null {
  const executionMatch = line.match(/executed\s+(\d+)\s+times?\s+in\s+(\d+)\s+ms/i);
  if (!executionMatch) return null;

  const executionCount = Number(executionMatch[1]);
  const timeMs = Number(executionMatch[2]);
  const classMatch = line.match(/Class\.([^:]+):\s*line\s*(\d+)/);

  return {
    className: classMatch?.[1] ?? null,
    lineNumber: classMatch?.[2] ? Number(classMatch[2]) : null,
    executionCount,
    timeMs,
    rawLine: line.trim(),
  };
}

function parseCumulativeDmlOperation(line: string): { operation: string | null; sObject: string | null } {
  const dmlMatch = line.match(/:\s*(Insert|Update|Upsert|Delete|Undelete|Merge):\s*([^:]+):\s*executed/i);
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

  const profilingEvents = allEvents.filter((event) => event.type === 'CUMULATIVE_PROFILING');
  for (const event of profilingEvents) {
    const lines = String(event.text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) continue;
    const header = lines[0]!.toLowerCase();
    const bodyLines = lines.slice(1);

    if (header.startsWith('dml operations')) {
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

    if (header.startsWith('method invocations')) {
      for (const line of bodyLines) {
        const parsed = parseCumulativeProfilingLine(line);
        if (parsed) out.methodInvocations.push(parsed);
      }
      continue;
    }

    if (header.startsWith('soql operations')) {
      for (const line of bodyLines) {
        const parsed = parseCumulativeProfilingLine(line);
        if (parsed) out.soqlOperations.push(parsed);
      }
    }
  }

  return out;
}
