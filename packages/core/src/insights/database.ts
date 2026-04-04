// Named credential extraction, SOQL pattern analysis, savepoint tracking,
// and issue type formatting. Used by insightsReport.ts.

import type {
  FlatEvent,
  NamedCredentialEntry,
  DatabaseSoqlEntry,
  SoqlPatternGroup,
  SavepointEntry,
  ExecutionPhase,
} from './types.js';
import { parseCalloutResponseText } from './utils.js';

// ─── Named credential extraction ─────────────────────────────────────────────

/**
 * Extracts named credential callout entries from log events.
 *
 * Pairs NAMED_CREDENTIAL_REQUEST events with their corresponding NAMED_CREDENTIAL_RESPONSE events,
 * extracts endpoint URLs, HTTP methods, and status codes. Returns array of named credential callout records
 * preserving request order from the log.
 *
 * @param allEvents - Array of all parsed events from the log
 * @returns Array of NamedCredentialEntry objects with request/response metadata
 */
export function extractNamedCredentials(allEvents: FlatEvent[]): NamedCredentialEntry[] {
  const requestEvents = allEvents.filter((e) => e.type === 'NAMED_CREDENTIAL_REQUEST');
  // Mutable copy so each response is consumed by at most one request (fix: BUG-002)
  const pendingResponses = allEvents.filter((e) => e.type === 'NAMED_CREDENTIAL_RESPONSE');

  return requestEvents.map((e, i) => {
    // text format from LogEvents.ts: `${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`
    // typically: "NamedCredentialLabel : ENDPOINT_URL : METHOD : body"
    const parts = String(e.text || '').split(' : ');
    const credentialName = parts[0]?.trim() || null;
    const endpoint = parts[1]?.trim() || null;
    const methodRaw = parts[2]?.trim() || null;
    const method = methodRaw ? methodRaw.toUpperCase() : null;

    // Find the first matching response after this request and before the next request.
    // Strict upper bound (<) ensures a response on the next request's timestamp isn't claimed
    // by this request. Consuming splice ensures each response is used at most once.
    const nextRequestTs = requestEvents[i + 1]?.timestampNs ?? Number.MAX_SAFE_INTEGER;
    const responseIdx = pendingResponses.findIndex(
      (r) => r.timestampNs >= e.timestampNs && r.timestampNs < nextRequestTs,
    );
    const response = responseIdx !== -1 ? pendingResponses.splice(responseIdx, 1)[0] : undefined;

    let statusCode: number | null = null;
    let statusText: string | null = null;
    if (response) {
      const parsed = parseCalloutResponseText(response.text);
      statusCode = parsed.statusCode;
      statusText = parsed.statusText;
    }

    return {
      id: `named-credential-${i + 1}`,
      credentialName,
      endpoint,
      method,
      statusCode,
      statusText,
      durationNs: e.durationTotalNs,
      durationMs: e.durationTotalNs !== null ? Math.round((e.durationTotalNs / 1_000_000) * 1000) / 1000 : null,
      namespace: e.namespace,
      evidence: {
        lineNumber: e.lineNumber,
        timestampNs: e.timestampNs,
        raw: e.logLine || null,
      },
    };
  });
}

/**
 * Normalises raw issue type strings into human-readable form.
 *
 * Converts strings like 'DML_WARNING' to 'DML Warning' by removing trailing _WARNING suffix,
 * replacing underscores with spaces, and applying title case. Handles null and empty strings gracefully.
 *
 * @param type - Raw issue type string, or null
 * @returns Normalized, human-readable issue type string
 */
export function compactIssueType(type: string | null): string {
  const raw = String(type || '').trim();
  if (!raw) return 'Issue';
  return raw
    .replace(/_WARNING$/i, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

// ─── SOQL Pattern Analysis ──────────────────────────────────────────────────

function normalizeSoqlPattern(query: string | null): string {
  if (!query) return '';
  return query
    .replace(/:\s*\w+/g, ':?')              // replace bind variables
    .replace(/'[^']*'/g, "'?'")             // replace string literals
    .replace(/\b\d+\b/g, '?')              // replace numeric literals
    .replace(/\s+/g, ' ')                   // normalize whitespace
    .trim();
}

export interface SoqlPatternAnalysisResult {
  patterns: SoqlPatternGroup[];
  meta: {
    totalDistinctPatterns: number;
    returnedPatterns: number;
    truncated: boolean;
    limit: number;
    singleExecutionPatterns: number;
  };
}

/**
 * Analyses SOQL query patterns to identify repeated queries, missing WHERE clauses, and other inefficiencies.
 *
 * Normalizes SOQL queries (replaces bind variables, literals, and numbers with placeholders) to group similar patterns.
 * Detects N+1 query patterns where the same query executes 3+ times within a short time window. Returns patterns sorted
 * by execution count, limited to top results for readability.
 *
 * @param databaseSoql - Array of parsed SOQL entries
 * @param limit - Maximum number of patterns to return (default 30)
 * @returns SoqlPatternAnalysisResult with grouped patterns and metadata about analysis
 */
export function buildSoqlPatternAnalysis(
  databaseSoql: DatabaseSoqlEntry[],
  limit: number = 30,
): SoqlPatternAnalysisResult {
  const groups = new Map<string, SoqlPatternGroup>();

  for (const query of databaseSoql) {
    const pattern = normalizeSoqlPattern(query.query);
    if (!pattern) continue;

    const existing = groups.get(pattern);
    if (existing) {
      existing.executionCount += 1;
      existing.totalRows += query.rows ?? 0;
      existing.totalDurationMs += query.durationMs ?? 0;
      existing.queryIds.push(query.id);
    } else {
      groups.set(pattern, {
        pattern,
        targetObject: query.targetObject,
        executionCount: 1,
        totalRows: query.rows ?? 0,
        totalDurationMs: query.durationMs ?? 0,
        avgDurationMs: 0,
        queryIds: [query.id],
        isLoopSuspect: false,
        loopEvidence: null,
      });
    }
  }

  const result: SoqlPatternGroup[] = [];
  let singleExecutionCount = 0;
  
  for (const group of groups.values()) {
    group.avgDurationMs = group.executionCount > 0
      ? Math.round((group.totalDurationMs / group.executionCount) * 1000) / 1000
      : 0;

    // N+1 detection: if the same pattern executed 3+ times, flag as loop suspect
    if (group.executionCount >= 3) {
      group.isLoopSuspect = true;

      const queryTimestamps = databaseSoql
        .filter((q) => group.queryIds.includes(q.id))
        .map((q) => q.evidence.timestampNs)
        .filter((ts): ts is number => typeof ts === 'number' && Number.isFinite(ts))
        .sort((a, b) => a - b);

      if (queryTimestamps.length >= 2) {
        const burstNs = queryTimestamps[queryTimestamps.length - 1]! - queryTimestamps[0]!;
        if (burstNs <= 500_000_000) {
          group.loopEvidence = `Pattern executed ${group.executionCount} times within ${Math.round((burstNs / 1_000_000) * 10) / 10} ms — likely loop-based SOQL`;
        } else {
          group.loopEvidence = `Pattern executed ${group.executionCount} times across different execution windows`;
        }
      }
    }

    result.push(group);
    if (group.executionCount === 1) singleExecutionCount++;
  }

  const filtered = result.filter((g) => g.executionCount > 1);
  const sorted = filtered.sort((a, b) => b.executionCount - a.executionCount);
  const truncated = sorted.slice(0, limit);

  return {
    patterns: truncated,
    meta: {
      totalDistinctPatterns: groups.size,
      returnedPatterns: truncated.length,
      truncated: sorted.length > limit,
      limit,
      singleExecutionPatterns: singleExecutionCount,
    },
  };
}

// ─── Savepoint Tracking ─────────────────────────────────────────────────────

/**
 * Extracts Database.setSavepoint() and Database.rollback() events from the log.
 *
 * Parses SAVEPOINT_SET and SAVEPOINT_ROLLBACK events, maps them to enclosing execution phases and parent events.
 * Returns array of savepoint records preserving the order they appear in the log.
 *
 * @param allEvents - Array of all parsed events from the log
 * @param executionPhases - Array of execution phases (used for phase membership lookup)
 * @returns Array of SavepointEntry objects with type, name, timing, and enclosing context
 */
export function extractSavepoints(
  allEvents: FlatEvent[],
  executionPhases: ExecutionPhase[],
): SavepointEntry[] {
  const entries: SavepointEntry[] = [];

  for (const event of allEvents) {
    if (event.type !== 'SAVEPOINT_SET' && event.type !== 'SAVEPOINT_ROLLBACK') continue;

    const spType: 'set' | 'rollback' = event.type === 'SAVEPOINT_SET' ? 'set' : 'rollback';
    const name = event.text || 'unnamed';

    // Event-native parent link (no span dependency).
    const enclosingEventId = event.parentIdx !== null ? `event-${event.parentIdx + 1}` : null;

    // Find enclosing phase
    const enclosingPhase = executionPhases.find((p) => {
      const end = p.timing.endNs ?? p.timing.startNs;
      return event.timestampNs >= p.timing.startNs && event.timestampNs <= end;
    });

    entries.push({
      id: `sp-${entries.length + 1}`,
      type: spType,
      name,
      timestampNs: event.timestampNs,
      lineNumber: event.lineNumber,
      rawLine: event.logLine || null,
      enclosingSpanId: null,
      enclosingEventId,
      enclosingPhaseId: enclosingPhase?.id ?? null,
    });
  }

  return entries;
}
