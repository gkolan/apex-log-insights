// Governor limit burn rate analysis, trajectory tracking, and per-phase headroom assessment.
// Used by insightsReport.ts to track resource consumption and project limit saturation.

import type {
  UnknownRecord,
  LimitTrajectoryPoint,
  LimitBurnRateEntry,
  GovernorBurnRate,
} from "./types.js";
import { isRecord, asNumber, asString, readPath } from "./utils.js";

function firstPointAtOrAfter(
  trajectory: LimitTrajectoryPoint[],
  timestampNs: number,
): LimitTrajectoryPoint | undefined {
  let low = 0;
  let high = trajectory.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (trajectory[middle]!.timestampNs < timestampNs) low = middle + 1;
    else high = middle;
  }
  return trajectory[low];
}

/**
 * Calculates the rate at which governor limits are consumed over the transaction timespan.
 *
 * Builds a comprehensive burn rate analysis including trajectory points over time, per-limit burn rates (delta per second),
 * namespace aggregation of limit usage, and phase-by-phase headroom warnings when limits approach saturation.
 *
 * @param snapshotsRaw - Array of raw governor limit snapshots from the log
 * @param allEvents - Array of all parsed events (reserved for future use)
 * @param executionPhases - Array of execution phases with timing information
 * @param durationMs - Total execution duration in milliseconds (reserved for future use)
 * @param governorLimits - Object containing limit definitions and maximum values
 * @returns GovernorBurnRate with trajectory, burn rates, namespace breakdown, and phase headroom analysis
 */
export function buildGovernorBurnRate(
  snapshotsRaw: unknown[],
  allEvents: unknown[],
  executionPhases: Array<{
    id: string;
    label: string;
    timing: { startNs: number; endNs: number | null };
  }>,
  durationMs: number | null,
  governorLimits: unknown,
): GovernorBurnRate {
  // Build full trajectory from LIMIT_USAGE_FOR_NS events
  const trajectory: LimitTrajectoryPoint[] = [];

  // Extract namespace-level limit snapshots from the raw snapshots
  for (const snap of snapshotsRaw) {
    if (!isRecord(snap)) continue;
    const ts = asNumber(readPath(snap, ["timestamp"])) ?? 0;
    const ns = asString(readPath(snap, ["namespace"])) ?? "default";
    const limits = readPath(snap, ["limits"]);
    if (!isRecord(limits)) continue;

    const soqlQ = readPath(limits, ["soqlQueries"]);
    const queryRows = readPath(limits, ["queryRows"]);
    const dmlS = readPath(limits, ["dmlStatements"]);
    const dmlR = readPath(limits, ["dmlRows"]);
    const cpuT = readPath(limits, ["cpuTime"]);
    const heapS = readPath(limits, ["heapSize"]);
    const callouts = readPath(limits, ["callouts"]);
    const futureCalls = readPath(limits, ["futureCalls"]);
    const queueables = readPath(limits, ["queueableJobsAddedToQueue"]);

    trajectory.push({
      timestampNs: ts,
      namespace: ns,
      soqlUsed: isRecord(soqlQ)
        ? (asNumber((soqlQ as UnknownRecord).used) ?? null)
        : null,
      soqlRowsUsed: isRecord(queryRows)
        ? (asNumber((queryRows as UnknownRecord).used) ?? null)
        : null,
      dmlUsed: isRecord(dmlS)
        ? (asNumber((dmlS as UnknownRecord).used) ?? null)
        : null,
      dmlRowsUsed: isRecord(dmlR)
        ? (asNumber((dmlR as UnknownRecord).used) ?? null)
        : null,
      cpuUsed: isRecord(cpuT)
        ? (asNumber((cpuT as UnknownRecord).used) ?? null)
        : null,
      heapUsed: isRecord(heapS)
        ? (asNumber((heapS as UnknownRecord).used) ?? null)
        : null,
      calloutsUsed: isRecord(callouts)
        ? (asNumber((callouts as UnknownRecord).used) ?? null)
        : null,
      futureCallsUsed: isRecord(futureCalls)
        ? (asNumber((futureCalls as UnknownRecord).used) ?? null)
        : null,
      queueablesUsed: isRecord(queueables)
        ? (asNumber((queueables as UnknownRecord).used) ?? null)
        : null,
    });
  }

  trajectory.sort((a, b) => a.timestampNs - b.timestampNs);

  // Burn rates and phase headroom must compare one namespace. Prefer the
  // transaction/default namespace, then fall back deterministically to the
  // earliest observed namespace for logs that omit it.
  const rateNamespace = trajectory.some(
    (point) => point.namespace === "default",
  )
    ? "default"
    : trajectory[0]?.namespace;
  const rateTrajectory = rateNamespace
    ? trajectory.filter((point) => point.namespace === rateNamespace)
    : [];
  const first = rateTrajectory[0];
  const last = rateTrajectory[rateTrajectory.length - 1];
  const burnRates: LimitBurnRateEntry[] = [];

  if (first && last && isRecord(governorLimits)) {
    const elapsedNs = last.timestampNs - first.timestampNs;
    const elapsedSec = elapsedNs > 0 ? elapsedNs / 1_000_000_000 : null;

    const limitDefs: Array<{
      name: string;
      firstUsed: number | null;
      lastUsed: number | null;
      limitKey: string;
    }> = [
      {
        name: "soqlQueries",
        firstUsed: first.soqlUsed,
        lastUsed: last.soqlUsed,
        limitKey: "soqlQueries",
      },
      {
        name: "soqlRows",
        firstUsed: first.soqlRowsUsed,
        lastUsed: last.soqlRowsUsed,
        limitKey: "queryRows",
      },
      {
        name: "dmlStatements",
        firstUsed: first.dmlUsed,
        lastUsed: last.dmlUsed,
        limitKey: "dmlStatements",
      },
      {
        name: "dmlRows",
        firstUsed: first.dmlRowsUsed,
        lastUsed: last.dmlRowsUsed,
        limitKey: "dmlRows",
      },
      {
        name: "cpuTime",
        firstUsed: first.cpuUsed,
        lastUsed: last.cpuUsed,
        limitKey: "cpuTime",
      },
      {
        name: "heapSize",
        firstUsed: first.heapUsed,
        lastUsed: last.heapUsed,
        limitKey: "heapSize",
      },
      {
        name: "callouts",
        firstUsed: first.calloutsUsed,
        lastUsed: last.calloutsUsed,
        limitKey: "callouts",
      },
      {
        name: "futureCalls",
        firstUsed: first.futureCallsUsed,
        lastUsed: last.futureCallsUsed,
        limitKey: "futureCalls",
      },
      {
        name: "queueableJobsAddedToQueue",
        firstUsed: first.queueablesUsed,
        lastUsed: last.queueablesUsed,
        limitKey: "queueableJobsAddedToQueue",
      },
    ];

    for (const def of limitDefs) {
      const limObj = readPath(governorLimits, [def.limitKey]);
      const max = isRecord(limObj)
        ? (asNumber((limObj as UnknownRecord).limit) ?? null)
        : null;
      const used = def.lastUsed;
      const pctUsed =
        used !== null && max !== null && max > 0
          ? Math.round((used / max) * 10000) / 100
          : null;

      let burnRatePerSec: number | null = null;
      let projectedHeadroom: number | null = null;

      if (
        elapsedSec !== null &&
        def.firstUsed !== null &&
        def.lastUsed !== null &&
        def.lastUsed >= def.firstUsed
      ) {
        const delta = def.lastUsed - def.firstUsed;
        burnRatePerSec = Math.round((delta / elapsedSec) * 1000) / 1000;

        if (max !== null && burnRatePerSec > 0) {
          const remaining = Math.max(0, max - def.lastUsed);
          const raw = remaining / burnRatePerSec;
          projectedHeadroom = Number.isFinite(raw)
            ? Math.min(Math.round(raw * 1000) / 1000, 999999)
            : null;
        }
      }

      const status =
        pctUsed === null
          ? "unknown"
          : pctUsed >= 95
            ? "critical"
            : pctUsed >= 80
              ? "warn"
              : "ok";

      burnRates.push({
        limitName: def.name,
        used,
        max,
        pctUsed,
        burnRatePerSec,
        projectedHeadroom,
        status,
      });
    }
  }

  // Aggregate by namespace — use final (most recent) values
  const byNamespace = Object.create(null) as GovernorBurnRate["byNamespace"];
  for (const point of trajectory) {
    const ns = point.namespace;
    if (!byNamespace[ns]) {
      byNamespace[ns] = {
        soqlUsed: point.soqlUsed ?? null,
        soqlRowsUsed: point.soqlRowsUsed ?? null,
        dmlUsed: point.dmlUsed ?? null,
        dmlRowsUsed: point.dmlRowsUsed ?? null,
        cpuUsed: point.cpuUsed ?? null,
        heapUsed: point.heapUsed ?? null,
        calloutsUsed: point.calloutsUsed ?? null,
        futureCallsUsed: point.futureCallsUsed ?? null,
        queueablesUsed: point.queueablesUsed ?? null,
      };
    } else {
      // Keep the most recent observed value per namespace
      const existing = byNamespace[ns];
      if (point.soqlUsed !== null) existing.soqlUsed = point.soqlUsed;
      if (point.soqlRowsUsed !== null)
        existing.soqlRowsUsed = point.soqlRowsUsed;
      if (point.dmlUsed !== null) existing.dmlUsed = point.dmlUsed;
      if (point.dmlRowsUsed !== null) existing.dmlRowsUsed = point.dmlRowsUsed;
      if (point.cpuUsed !== null) existing.cpuUsed = point.cpuUsed;
      if (point.heapUsed !== null) existing.heapUsed = point.heapUsed;
      if (point.calloutsUsed !== null)
        existing.calloutsUsed = point.calloutsUsed;
      if (point.futureCallsUsed !== null)
        existing.futureCallsUsed = point.futureCallsUsed;
      if (point.queueablesUsed !== null)
        existing.queueablesUsed = point.queueablesUsed;
    }
  }

  // Phase headroom — after each phase, what pct of each limit is consumed?
  const phaseHeadroom: GovernorBurnRate["phaseHeadroom"] = [];
  const totalPhases = executionPhases.length;

  for (let i = 0; i < totalPhases; i++) {
    const phase = executionPhases[i]!;
    const phaseEndNs = phase.timing.endNs ?? phase.timing.startNs;

    // Find the closest same-namespace trajectory point at or after the phase
    // end. Binary lookup avoids rescanning a large snapshot timeline per phase.
    const closestPoint =
      firstPointAtOrAfter(rateTrajectory, phaseEndNs) ?? last;
    if (!closestPoint || !isRecord(governorLimits)) {
      phaseHeadroom.push({
        phaseId: phase.id,
        phaseLabel: phase.label,
        soqlPctAfter: null,
        soqlRowsPctAfter: null,
        dmlPctAfter: null,
        cpuPctAfter: null,
        heapPctAfter: null,
        calloutsPctAfter: null,
        futureCallsPctAfter: null,
        queueablesPctAfter: null,
        phasesRemaining: totalPhases - i - 1,
        warning: null,
      });
      continue;
    }

    const pctOf = (used: number | null, limitKey: string): number | null => {
      if (used === null) return null;
      const limObj = readPath(governorLimits, [limitKey]);
      const max = isRecord(limObj)
        ? (asNumber((limObj as UnknownRecord).limit) ?? null)
        : null;
      if (max === null || max <= 0) return null;
      return Math.round((used / max) * 10000) / 100;
    };

    const soqlPct = pctOf(closestPoint.soqlUsed, "soqlQueries");
    const soqlRowsPct = pctOf(closestPoint.soqlRowsUsed, "queryRows");
    const dmlPct = pctOf(closestPoint.dmlUsed, "dmlStatements");
    const cpuPct = pctOf(closestPoint.cpuUsed, "cpuTime");
    const heapPct = pctOf(closestPoint.heapUsed, "heapSize");
    const calloutsPct = pctOf(closestPoint.calloutsUsed, "callouts");
    const futureCallsPct = pctOf(closestPoint.futureCallsUsed, "futureCalls");
    const queueablesPct = pctOf(
      closestPoint.queueablesUsed,
      "queueableJobsAddedToQueue",
    );

    const phasesRemaining = totalPhases - i - 1;
    let warning: string | null = null;
    const criticalPcts = [
      soqlPct,
      soqlRowsPct,
      dmlPct,
      cpuPct,
      heapPct,
      calloutsPct,
      futureCallsPct,
      queueablesPct,
    ].filter((p) => p !== null && p >= 80);
    if (criticalPcts.length > 0 && phasesRemaining > 0) {
      warning = `${criticalPcts.length} limit(s) at ≥80% with ${phasesRemaining} phase(s) remaining`;
    }

    phaseHeadroom.push({
      phaseId: phase.id,
      phaseLabel: phase.label,
      soqlPctAfter: soqlPct,
      soqlRowsPctAfter: soqlRowsPct,
      dmlPctAfter: dmlPct,
      cpuPctAfter: cpuPct,
      heapPctAfter: heapPct,
      calloutsPctAfter: calloutsPct,
      futureCallsPctAfter: futureCallsPct,
      queueablesPctAfter: queueablesPct,
      phasesRemaining,
      warning,
    });
  }

  // suppress unused param warning — durationMs reserved for future use
  void durationMs;
  void allEvents;

  return { trajectory, burnRates, byNamespace, phaseHeadroom };
}
