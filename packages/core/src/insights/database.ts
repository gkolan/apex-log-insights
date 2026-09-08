// Named credential extraction, SOQL pattern analysis, savepoint tracking,
// and issue type formatting. Used by insightsReport.ts.

import type {
  FlatEvent,
  NamedCredentialEntry,
  DatabaseSoqlEntry,
  SoqlPatternGroup,
  SavepointEntry,
  ExecutionPhase,
  CursorOperationEntry,
} from "./types.js";
import { parseCalloutResponseText } from "./utils.js";
import { parseSafeIntegerToken, splitLogFields } from "../logFields.js";

function parseCursorInteger(
  text: string,
  field: "rows" | "offset",
): number | null {
  const pattern =
    field === "rows"
      ? /\b(?:Rows?|Row Count|Number of rows(?: in (?:the )?result set)?|Size)\s*[:=]\s*([^\s|]+)/i
      : /\b(?:Offset|Cursor Offset(?: Position)?)\s*[:=]\s*([^\s|]+)/i;
  const match = pattern.exec(text);
  if (!match) return null;
  const token = match[1]!.replace(/,$/, "");
  return parseSafeIntegerToken(token);
}

function parseCursorQueryId(text: string): string | null {
  const labeled =
    /\b(?:Query|Cursor)(?:\s*Id|\s*ID)?\s*[:=]\s*([^|,\s]+)/i.exec(text);
  if (labeled?.[1]) return labeled[1];

  // Some API versions emit the query ID as an unlabeled positional field.
  return (
    splitLogFields(text)
      .map((part) => part.trim())
      .find(
        (part) => /^[A-Za-z0-9_-]{6,}$/.test(part) && !/^\d+$/.test(part),
      ) ?? null
  );
}

/** Build bounded-report-ready records for Apex cursor creation and fetches. */
export function extractCursorOperations(
  allEvents: FlatEvent[],
): CursorOperationEntry[] {
  const cursorEvents = allEvents.filter((event) =>
    ["CURSOR_CREATE_BEGIN", "CURSOR_FETCH", "CURSOR_FETCH_PAGE"].includes(
      event.type,
    ),
  );

  return cursorEvents.map((event, index) => {
    const operation =
      event.type === "CURSOR_CREATE_BEGIN"
        ? "create"
        : event.type === "CURSOR_FETCH_PAGE"
          ? "fetchPage"
          : "fetch";
    const endPayload = event.exitLogLine
      ? (splitLogFields(event.exitLogLine, 4)[3] ?? "")
      : "";
    const detailText = operation === "create" ? endPayload : event.text;
    const durationNs = operation === "create" ? event.durationTotalNs : null;

    return {
      id: `cursor-${index + 1}`,
      operation,
      queryId: parseCursorQueryId(detailText),
      query: operation === "create" ? event.text || null : null,
      offset: parseCursorInteger(detailText, "offset"),
      rows: parseCursorInteger(detailText, "rows"),
      durationNs,
      durationMs:
        durationNs !== null
          ? Math.round((durationNs / 1_000_000) * 1000) / 1000
          : null,
      namespace: event.namespace,
      evidence: {
        lineNumber: event.lineNumber,
        endLineNumber: event.exitLineNumber,
        sourceLineNumber: event.sourceLineNumber,
        timestampNs: event.timestampNs,
        raw: event.logLine || null,
        endRaw: event.exitLogLine,
      },
    };
  });
}

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
export function extractNamedCredentials(
  allEvents: FlatEvent[],
): NamedCredentialEntry[] {
  const requestEvents = allEvents.filter(
    (e) => e.type === "NAMED_CREDENTIAL_REQUEST" && !e.isContinuation,
  );
  const responses = allEvents.filter(
    (e) => e.type === "NAMED_CREDENTIAL_RESPONSE" && !e.isContinuation,
  );
  const responseDetails = allEvents.filter(
    (e) => e.type === "NAMED_CREDENTIAL_RESPONSE_DETAIL",
  );
  let responseCursor = 0;
  let detailCursor = 0;

  return requestEvents.map((e, i) => {
    // text format from LogEvents.ts: `${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`
    // typically: "NamedCredentialLabel : ENDPOINT_URL : METHOD : body"
    const parts = String(e.text || "").split(" : ");
    const credentialName = e.credentialName ?? parts[0]?.trim() ?? null;
    const endpoint = e.endpoint ?? parts[1]?.trim() ?? null;
    const methodRaw = e.method ?? parts[2]?.trim() ?? null;
    const method = methodRaw ? methodRaw.toUpperCase() : null;

    // Consume the first response after this request and before the next request.
    // Both collections preserve log order, so a monotonic cursor keeps matching O(n)
    // while ensuring every response is used at most once.
    const nextRequestTs =
      requestEvents[i + 1]?.timestampNs ?? Number.MAX_SAFE_INTEGER;
    while (
      responseCursor < responses.length &&
      responses[responseCursor]!.timestampNs < e.timestampNs
    ) {
      responseCursor += 1;
    }
    const candidate = responses[responseCursor];
    const response =
      candidate && candidate.timestampNs < nextRequestTs
        ? candidate
        : undefined;
    if (response) responseCursor += 1;

    while (
      detailCursor < responseDetails.length &&
      responseDetails[detailCursor]!.timestampNs < e.timestampNs
    ) {
      detailCursor += 1;
    }
    const detailCandidate = responseDetails[detailCursor];
    const responseDetail =
      detailCandidate && detailCandidate.timestampNs < nextRequestTs
        ? detailCandidate
        : undefined;
    if (responseDetail) detailCursor += 1;

    let statusCode: number | null = null;
    let statusText: string | null = null;
    if (response) {
      const parsed = parseCalloutResponseText(response.text);
      statusCode = parsed.statusCode;
      statusText = parsed.statusText;
    }
    if (
      responseDetail?.statusCode !== null &&
      responseDetail?.statusCode !== undefined
    ) {
      statusCode = responseDetail.statusCode;
    }

    const durationMs =
      responseDetail?.overallCalloutTimeMs ??
      (e.durationTotalNs !== null
        ? Math.round((e.durationTotalNs / 1_000_000) * 1000) / 1000
        : null);

    return {
      id: `named-credential-${i + 1}`,
      credentialId: e.credentialId ?? responseDetail?.credentialId ?? null,
      credentialName,
      endpoint,
      method,
      externalCredentialType: e.externalCredentialType ?? null,
      requestSizeBytes: e.requestSizeBytes ?? null,
      retryOn401: e.retryOn401 ?? null,
      statusCode,
      statusText,
      responseSizeBytes: responseDetail?.responseSizeBytes ?? null,
      connectTimeMs: responseDetail?.connectTimeMs ?? null,
      durationNs:
        responseDetail?.overallCalloutTimeMs !== null &&
        responseDetail?.overallCalloutTimeMs !== undefined
          ? responseDetail.overallCalloutTimeMs * 1_000_000
          : e.durationTotalNs,
      durationMs,
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
  const raw = String(type || "").trim();
  if (!raw) return "Issue";
  return raw
    .replace(/_WARNING$/i, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

// ─── SOQL Pattern Analysis ──────────────────────────────────────────────────

function normalizeSoqlPattern(query: string | null): string {
  if (!query) return "";
  let normalized = "";
  for (let index = 0; index < query.length; index += 1) {
    const char = query[index]!;

    if (char === "'") {
      normalized += "'?'";
      for (index += 1; index < query.length; index += 1) {
        const literalChar = query[index]!;
        if (literalChar === "\\") {
          index += 1;
          continue;
        }
        if (literalChar === "'") {
          if (query[index + 1] === "'") {
            index += 1;
            continue;
          }
          break;
        }
      }
      continue;
    }

    if (char === ":") {
      let bindEnd = index + 1;
      while (/\s/.test(query[bindEnd] || "")) bindEnd += 1;
      if (/[A-Z_]/i.test(query[bindEnd] || "")) {
        bindEnd += 1;
        while (/[A-Z0-9_.]/i.test(query[bindEnd] || "")) bindEnd += 1;
        normalized += ":?";
        index = bindEnd - 1;
        continue;
      }
    }

    normalized += char;
  }

  return normalized
    .replace(/\b\d+\b/g, "?") // replace numeric literals
    .replace(/\s+/g, " ") // normalize whitespace
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
  const timestampsByPattern = new Map<string, number[]>();

  for (const query of databaseSoql) {
    const pattern = normalizeSoqlPattern(query.query);
    if (!pattern) continue;

    const existing = groups.get(pattern);
    if (existing) {
      existing.executionCount += 1;
      if (existing.totalRows !== null && query.rows !== null) {
        const nextTotal = existing.totalRows + query.rows;
        existing.totalRows = Number.isSafeInteger(nextTotal) ? nextTotal : null;
      } else {
        existing.totalRows = null;
      }
      if (
        existing.totalDurationMs !== null &&
        query.durationMs !== null &&
        Number.isFinite(query.durationMs) &&
        query.durationMs >= 0
      ) {
        const nextDuration = existing.totalDurationMs + query.durationMs;
        existing.totalDurationMs = Number.isFinite(nextDuration)
          ? nextDuration
          : null;
      } else {
        existing.totalDurationMs = null;
      }
      existing.queryIds.push(query.id);
    } else {
      groups.set(pattern, {
        pattern,
        targetObject: query.targetObject,
        executionCount: 1,
        totalRows: query.rows,
        totalDurationMs:
          query.durationMs !== null &&
          Number.isFinite(query.durationMs) &&
          query.durationMs >= 0
            ? query.durationMs
            : null,
        avgDurationMs: null,
        queryIds: [query.id],
        isLoopSuspect: false,
        loopEvidence: null,
      });
    }
    const timestamp = query.evidence.timestampNs;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
      const timestamps = timestampsByPattern.get(pattern);
      if (timestamps) timestamps.push(timestamp);
      else timestampsByPattern.set(pattern, [timestamp]);
    }
  }

  const result: SoqlPatternGroup[] = [];
  let singleExecutionCount = 0;

  for (const group of groups.values()) {
    group.avgDurationMs =
      group.executionCount > 0 && group.totalDurationMs !== null
        ? Math.round((group.totalDurationMs / group.executionCount) * 1000) /
          1000
        : null;

    // N+1 detection: if the same pattern executed 3+ times, flag as loop suspect
    if (group.executionCount >= 3) {
      group.isLoopSuspect = true;

      const queryTimestamps = timestampsByPattern.get(group.pattern) ?? [];

      if (queryTimestamps.length >= 2) {
        let earliest = queryTimestamps[0]!;
        let latest = earliest;
        for (let index = 1; index < queryTimestamps.length; index += 1) {
          earliest = Math.min(earliest, queryTimestamps[index]!);
          latest = Math.max(latest, queryTimestamps[index]!);
        }
        const burstNs = latest - earliest;
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
    if (event.type !== "SAVEPOINT_SET" && event.type !== "SAVEPOINT_ROLLBACK")
      continue;

    const spType: "set" | "rollback" =
      event.type === "SAVEPOINT_SET" ? "set" : "rollback";
    const name = event.text || "unnamed";

    // Event-native parent link (no span dependency).
    const enclosingEventId =
      event.parentIdx !== null ? `event-${event.parentIdx + 1}` : null;

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
