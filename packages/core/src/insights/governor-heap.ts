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
} from './types.js';

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
    if (event.type !== 'HEAP_ALLOCATE' && event.type !== 'HEAP_DEALLOCATE') continue;

    const bytesMatch = String(event.text || '').match(/Bytes:(\d+)/i);
    const bytes = bytesMatch ? Number(bytesMatch[1]) : 0;
    if (bytes === 0 && event.type === 'HEAP_ALLOCATE') continue;

    const parentSpanId = event.parentIdx !== null ? spanIdByEventIdx.get(event.parentIdx) ?? null : null;

    const entry: HeapAllocationEntry = {
      lineNumber: event.lineNumber,
      bytes,
      timestampNs: event.timestampNs,
      parentSpanId,
      namespace: event.namespace,
    };

    if (event.type === 'HEAP_ALLOCATE') {
      allocations.push(entry);
    } else {
      deallocations.push(entry);
    }
  }

  const totalAllocatedBytes = allocations.reduce((sum, a) => sum + a.bytes, 0);
  const totalDeallocatedBytes = deallocations.reduce((sum, d) => sum + d.bytes, 0);

  // Build watermark timeline (sample every ~200 events to keep payload reasonable)
  const allHeapEvents = [...allocations, ...deallocations].sort((a, b) => a.timestampNs - b.timestampNs);
  const allocationSet = new Set(allocations);
  const sampleInterval = Math.max(1, Math.floor(allHeapEvents.length / 200));
  const watermarkSamples: HeapWatermarkSample[] = [];
  let runningTotal = 0;
  let peakBytes = 0;
  let peakTimestampNs: number | null = null;

  for (let i = 0; i < allHeapEvents.length; i++) {
    const ev = allHeapEvents[i]!;
    const isAllocation = allocationSet.has(ev);
    runningTotal += isAllocation ? ev.bytes : -ev.bytes;
    if (runningTotal < 0) runningTotal = 0; // clamp

    if (runningTotal > peakBytes) {
      peakBytes = runningTotal;
      peakTimestampNs = ev.timestampNs;
    }

    if (i % sampleInterval === 0 || i === allHeapEvents.length - 1) {
      watermarkSamples.push({ timestampNs: ev.timestampNs, cumulativeBytes: runningTotal });
    }
  }

  // Ensure peak is included in samples; insert if missing
  if (peakTimestampNs !== null && !watermarkSamples.some((s) => s.timestampNs === peakTimestampNs)) {
    watermarkSamples.push({ timestampNs: peakTimestampNs, cumulativeBytes: peakBytes });
    watermarkSamples.sort((a, b) => a.timestampNs - b.timestampNs);
  }

  // Group allocations by line number for hotspots
  const byLine = new Map<string, { bytes: number; count: number; namespace: string; parentSpanId: string | null }>();
  for (const alloc of allocations) {
    const key = `${alloc.lineNumber ?? 'unknown'}|${alloc.namespace}`;
    const existing = byLine.get(key);
    if (existing) {
      existing.bytes += alloc.bytes;
      existing.count += 1;
    } else {
      byLine.set(key, { bytes: alloc.bytes, count: 1, namespace: alloc.namespace, parentSpanId: alloc.parentSpanId });
    }
  }

  const hotspotsByLine: HeapHotspot[] = Array.from(byLine.entries())
    .map(([key, data]) => {
      const lineNumber = key.split('|')[0];
      const num = Number(lineNumber);
      return {
        lineNumber: lineNumber === 'unknown' || isNaN(num) ? null : num,
        totalBytes: data.bytes,
        count: data.count,
        avgBytes: Math.round(data.bytes / data.count),
        namespace: data.namespace,
        parentSpanId: data.parentSpanId,
      };
    })
    .sort((a, b) => b.totalBytes - a.totalBytes)
    .slice(0, 25);

  // Heap by namespace
  const byNamespace: Record<string, { totalBytes: number; count: number }> = {};
  for (const alloc of allocations) {
    const ns = alloc.namespace || 'default';
    if (!byNamespace[ns]) byNamespace[ns] = { totalBytes: 0, count: 0 };
    byNamespace[ns].totalBytes += alloc.bytes;
    byNamespace[ns].count += 1;
  }

  // Heap by execution phase
  const byPhase = executionPhases.map((phase) => {
    const phaseStart = phase.timing.startNs;
    const phaseEnd = phase.timing.endNs ?? phaseStart;
    let allocatedBytes = 0;
    let allocationCount = 0;
    for (const alloc of allocations) {
      if (alloc.timestampNs >= phaseStart && alloc.timestampNs <= phaseEnd) {
        allocatedBytes += alloc.bytes;
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
    netAllocatedBytes: totalAllocatedBytes - totalDeallocatedBytes,
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
