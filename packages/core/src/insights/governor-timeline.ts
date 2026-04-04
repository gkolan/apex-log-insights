// Governor limit timeline and delta computation.
// Used by execution.ts to measure governor usage changes across execution phases.

import type { UnknownRecord, GovernorDelta } from './types.js';
import { isRecord, asNumber, readPath } from './utils.js';

// ─── Governor Limit Timeline ─────────────────────────────────────────────────

export interface LimitTimelineEntry {
  timestampNs: number;
  soql: number | null;
  soqlRows: number | null;
  dml: number | null;
}

/**
 * Converts raw governor limit snapshots into a timeline of entries showing how limits changed over time.
 *
 * Parses snapshot events to extract SOQL queries, SOQL rows, and DML statement usage at each timestamp.
 * Returns a sorted timeline that enables tracking governor consumption across execution phases.
 *
 * @param snapshotsRaw - Array of raw snapshot objects from the log
 * @returns Array of LimitTimelineEntry objects sorted by timestamp
 */
export function buildLimitTimeline(snapshotsRaw: unknown[]): LimitTimelineEntry[] {
  const entries: LimitTimelineEntry[] = [];

  for (const snap of snapshotsRaw) {
    if (!isRecord(snap)) continue;
    const ts = asNumber(readPath(snap, ['timestamp'])) ?? 0;
    const limits = readPath(snap, ['limits']);
    if (!isRecord(limits)) continue;

    const soqlQ = readPath(limits, ['soqlQueries']);
    const queryRows = readPath(limits, ['queryRows']);
    const dmlS = readPath(limits, ['dmlStatements']);

    entries.push({
      timestampNs: ts,
      soql: isRecord(soqlQ) ? asNumber((soqlQ as UnknownRecord).used) ?? null : null,
      soqlRows: isRecord(queryRows) ? asNumber((queryRows as UnknownRecord).used) ?? null : null,
      dml: isRecord(dmlS) ? asNumber((dmlS as UnknownRecord).used) ?? null : null,
    });
  }

  return entries.sort((a, b) => a.timestampNs - b.timestampNs);
}

/**
 * Computes the delta (change) in governor limits between two snapshots for a specific phase window.
 *
 * Locates the closest timeline snapshot before the phase start (before state) and the closest snapshot at/after the phase end
 * (after state). Computes deltas for SOQL queries, SOQL rows, and DML statements used during the phase.
 *
 * @param timeline - Sorted array of LimitTimelineEntry from buildLimitTimeline
 * @param startNs - Phase start timestamp in nanoseconds
 * @param endNs - Phase end timestamp in nanoseconds
 * @returns GovernorDelta with before/after values for SOQL, SOQL rows, and DML limits
 */
export function computeGovernorDelta(
  timeline: LimitTimelineEntry[],
  startNs: number,
  endNs: number,
): GovernorDelta {
  // Validate phase boundaries
  if (startNs > endNs) {
    return {
      soqlBefore: null,
      soqlAfter: null,
      soqlRowsBefore: null,
      soqlRowsAfter: null,
      dmlBefore: null,
      dmlAfter: null,
    };
  }

  // Find the closest snapshot before and after/at the phase window
  let before: LimitTimelineEntry | null = null;
  let after: LimitTimelineEntry | null = null;

  for (const entry of timeline) {
    if (entry.timestampNs <= startNs) {
      before = entry;
    }
    if (entry.timestampNs >= startNs && entry.timestampNs <= endNs) {
      after = entry; // keep updating — last one in the window wins
    }
  }

  // If no snapshot in the window, look for the first one after
  if (!after) {
    for (const entry of timeline) {
      if (entry.timestampNs > endNs) {
        after = entry;
        break;
      }
    }
  }

  return {
    soqlBefore: before?.soql ?? null,
    soqlAfter: after?.soql ?? null,
    soqlRowsBefore: before?.soqlRows ?? null,
    soqlRowsAfter: after?.soqlRows ?? null,
    dmlBefore: before?.dml ?? null,
    dmlAfter: after?.dml ?? null,
  };
}
