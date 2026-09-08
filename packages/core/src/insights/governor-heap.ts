// Heap allocation analysis, hotspot detection, watermark tracking, and phase-based
// heap consumption reporting.
// Used by insightsReport.ts to understand memory allocation patterns.

import type {
  FlatEvent,
  ExecutionPhase,
  HeapAllocationEntry,
  HeapHotspot,
  HeapWatermarkSample,
  HeapAnalysis,
} from "./types.js";
import { parseSafeIntegerToken } from "../logFields.js";

function addExactBytes(total: number | null, delta: number): number | null {
  if (total === null) return null;
  const next = total + delta;
  return Number.isSafeInteger(next) ? next : null;
}

function exactDifference(
  left: number | null,
  right: number | null,
): number | null {
  if (left === null || right === null) return null;
  const difference = left - right;
  return Number.isSafeInteger(difference) ? difference : null;
}

/**
 * Analyses heap allocation and deallocation patterns from log events to identify memory hotspots.
 *
 * Extracts HEAP_ALLOCATE and HEAP_DEALLOCATE events, computes total and net allocation, identifies peak memory usage,
 * groups allocations by line number to find hotspots, breaks down heap usage by namespace and by execution phase.
 * Returns comprehensive heap analysis including watermark samples for timeline visualization.
 *
 * @param allEvents - Array of all parsed events from the log
 * @param spans - Array of timing spans (unused, reserved for future enhancement)
 * @param executionPhases - Array of execution phases for phase-based heap breakdown
 * @param spanIdByEventIdx - Map from event index to enclosing span ID
 * @returns HeapAnalysis with allocation metrics, hotspots, watermark samples, and namespace breakdown
 */
export function buildHeapAnalysis(
  allEvents: FlatEvent[],
  spans: Array<{ id: string; startNs: number; endNs: number | null }>,
  executionPhases: ExecutionPhase[],
  spanIdByEventIdx: Map<number, string>,
): HeapAnalysis {
  const allocations: HeapAllocationEntry[] = [];
  const deallocations: HeapAllocationEntry[] = [];

  for (const event of allEvents) {
    if (event.type !== "HEAP_ALLOCATE" && event.type !== "HEAP_DEALLOCATE")
      continue;

    const bytesToken = String(event.text || "").match(
      /(?:^|\|)\s*Bytes:\s*([^|\s]+)/i,
    )?.[1];
    const parsedBytes = parseSafeIntegerToken(bytesToken);
    const bytes = parsedBytes !== null && parsedBytes > 0 ? parsedBytes : 0;
    if (bytes === 0) continue;

    const parentSpanId =
      event.parentIdx !== null
        ? (spanIdByEventIdx.get(event.parentIdx) ?? null)
        : null;

    const entry: HeapAllocationEntry = {
      lineNumber: event.lineNumber,
      bytes,
      timestampNs: event.timestampNs,
      parentSpanId,
      namespace: event.namespace,
    };

    if (event.type === "HEAP_ALLOCATE") {
      allocations.push(entry);
    } else {
      deallocations.push(entry);
    }
  }

  const totalAllocatedBytes = allocations.reduce<number | null>(
    (sum, allocation) => addExactBytes(sum, allocation.bytes),
    0,
  );
  const totalDeallocatedBytes = deallocations.reduce<number | null>(
    (sum, deallocation) => addExactBytes(sum, deallocation.bytes),
    0,
  );

  // Build watermark timeline (sample every ~200 events to keep payload reasonable)
  const allHeapEvents = [...allocations, ...deallocations].sort(
    (a, b) => a.timestampNs - b.timestampNs,
  );
  const allocationSet = new Set(allocations);
  const sampleInterval = Math.max(1, Math.floor(allHeapEvents.length / 200));
  const watermarkSamples: HeapWatermarkSample[] = [];
  let runningTotal: number | null = 0;
  let peakBytes: number | null = 0;
  let peakTimestampNs: number | null = null;

  for (let i = 0; i < allHeapEvents.length; i++) {
    const ev = allHeapEvents[i]!;
    const isAllocation = allocationSet.has(ev);
    runningTotal = addExactBytes(
      runningTotal,
      isAllocation ? ev.bytes : -ev.bytes,
    );
    if (runningTotal !== null && runningTotal < 0) runningTotal = 0; // clamp

    if (runningTotal === null) {
      peakBytes = null;
      peakTimestampNs = null;
    } else if (peakBytes !== null && runningTotal > peakBytes) {
      peakBytes = runningTotal;
      peakTimestampNs = ev.timestampNs;
    }

    if (i % sampleInterval === 0 || i === allHeapEvents.length - 1) {
      watermarkSamples.push({
        timestampNs: ev.timestampNs,
        cumulativeBytes: runningTotal,
      });
    }
  }

  // Ensure peak is included in samples; insert if missing
  if (
    peakTimestampNs !== null &&
    !watermarkSamples.some((s) => s.timestampNs === peakTimestampNs)
  ) {
    watermarkSamples.push({
      timestampNs: peakTimestampNs,
      cumulativeBytes: peakBytes,
    });
    watermarkSamples.sort((a, b) => a.timestampNs - b.timestampNs);
  }

  // Group allocations by line number for hotspots
  const byLine = new Map<
    string,
    {
      bytes: number | null;
      count: number;
      namespace: string;
      parentSpanId: string | null;
    }
  >();
  for (const alloc of allocations) {
    const key = `${alloc.lineNumber ?? "unknown"}|${alloc.namespace}`;
    const existing = byLine.get(key);
    if (existing) {
      existing.bytes = addExactBytes(existing.bytes, alloc.bytes);
      existing.count += 1;
    } else {
      byLine.set(key, {
        bytes: alloc.bytes,
        count: 1,
        namespace: alloc.namespace,
        parentSpanId: alloc.parentSpanId,
      });
    }
  }

  const hotspotsByLine: HeapHotspot[] = Array.from(byLine.entries())
    .map(([key, data]) => {
      const lineNumber = key.split("|")[0];
      const num = Number(lineNumber);
      return {
        lineNumber:
          lineNumber === "unknown" || !Number.isSafeInteger(num) ? null : num,
        totalBytes: data.bytes,
        count: data.count,
        avgBytes:
          data.bytes === null ? null : Math.round(data.bytes / data.count),
        namespace: data.namespace,
        parentSpanId: data.parentSpanId,
      };
    })
    .sort((a, b) => (b.totalBytes ?? -1) - (a.totalBytes ?? -1))
    .slice(0, 25);

  // Heap by namespace
  const namespaceTotals = new Map<
    string,
    { totalBytes: number | null; count: number }
  >();
  for (const alloc of allocations) {
    const ns = alloc.namespace || "default";
    const aggregate = namespaceTotals.get(ns) ?? { totalBytes: 0, count: 0 };
    aggregate.totalBytes = addExactBytes(aggregate.totalBytes, alloc.bytes);
    aggregate.count += 1;
    namespaceTotals.set(ns, aggregate);
  }
  const byNamespace = Object.fromEntries(namespaceTotals);

  // Heap by execution phase
  const byPhase = executionPhases.map((phase, index) => {
    const phaseStart = phase.timing.startNs;
    const phaseEnd = phase.timing.endNs ?? phaseStart;
    const nextPhaseStart = executionPhases[index + 1]?.timing.startNs ?? null;
    let allocatedBytes: number | null = 0;
    let allocationCount = 0;
    for (const alloc of allocations) {
      if (
        alloc.timestampNs >= phaseStart &&
        (nextPhaseStart === null
          ? alloc.timestampNs <= phaseEnd
          : alloc.timestampNs < nextPhaseStart)
      ) {
        allocatedBytes = addExactBytes(allocatedBytes, alloc.bytes);
        allocationCount += 1;
      }
    }
    return {
      phaseId: phase.id,
      phaseLabel: phase.label,
      allocatedBytes,
      allocationCount,
    };
  });

  return {
    totalAllocatedBytes,
    totalDeallocatedBytes,
    netAllocatedBytes: exactDifference(
      totalAllocatedBytes,
      totalDeallocatedBytes,
    ),
    allocationCount: allocations.length,
    deallocationCount: deallocations.length,
    peakCumulativeBytes: peakBytes,
    peakTimestampNs,
    hotspotsByLine,
    watermarkSamples,
    byNamespace,
    byPhase,
  };
}
