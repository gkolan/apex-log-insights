import { describe, expect, it } from "vitest";

import { buildHeapAnalysis } from "./governor-heap.js";
import type { ExecutionPhase, FlatEvent } from "./types.js";

function heapEvent(
  idx: number,
  timestampNs: number,
  bytes = Number.MAX_SAFE_INTEGER,
  namespace = "default",
): FlatEvent {
  return {
    idx,
    parentIdx: null,
    type: "HEAP_ALLOCATE",
    timestampNs,
    timestampIsInferred: false,
    endTimestampNs: null,
    durationSelfNs: null,
    durationTotalNs: null,
    namespace,
    category: "",
    debugCategory: "",
    cpuType: "",
    lineNumber: 7,
    sourceLineNumber: null,
    text: `Bytes:${bytes}`,
    logLine: "",
    exitLineNumber: null,
    exitLogLine: null,
    isParent: false,
    aggregations: null,
    soqlCountTotal: null,
    soqlRowCountTotal: null,
    soslCountTotal: null,
    soslRowCountTotal: null,
    dmlCountTotal: null,
    dmlRowCountTotal: null,
  };
}

const phase: ExecutionPhase = {
  id: "phase-1",
  label: "Test phase",
  phaseIndex: 1,
  calledFrom: { className: null, lineNumber: null },
  timing: {
    startNs: 0,
    endNs: 10,
    durationMs: null,
    selfDurationMs: null,
    pctOfTotal: null,
  },
  database: {
    soqlInPhase: [],
    dmlInPhase: [],
    totalSoqlRows: null,
    totalDmlRows: null,
  },
  governorDelta: {
    soqlBefore: null,
    soqlAfter: null,
    soqlRowsBefore: null,
    soqlRowsAfter: null,
    dmlBefore: null,
    dmlAfter: null,
  },
  dataFlow: {
    inputIds: [],
    outputIds: [],
    recordsProcessed: 0,
    emptyResults: [],
    significantAssignments: [],
  },
  warnings: [],
  childPhaseIds: [],
};

describe("buildHeapAnalysis", () => {
  it("returns unknown instead of rounded heap aggregates after safe-integer overflow", () => {
    const analysis = buildHeapAnalysis(
      [heapEvent(0, 1), heapEvent(1, 2)],
      [],
      [phase],
      new Map(),
    );

    expect(analysis).toMatchObject({
      totalAllocatedBytes: null,
      totalDeallocatedBytes: 0,
      netAllocatedBytes: null,
      peakCumulativeBytes: null,
      peakTimestampNs: null,
      byNamespace: { default: { totalBytes: null, count: 2 } },
      byPhase: [
        {
          phaseId: "phase-1",
          allocatedBytes: null,
          allocationCount: 2,
        },
      ],
    });
    expect(analysis.hotspotsByLine).toEqual([
      expect.objectContaining({
        lineNumber: 7,
        totalBytes: null,
        avgBytes: null,
        count: 2,
      }),
    ]);
    expect(analysis.watermarkSamples).toEqual([
      { timestampNs: 1, cumulativeBytes: Number.MAX_SAFE_INTEGER },
      { timestampNs: 2, cumulativeBytes: null },
    ]);
  });

  it("assigns a phase-boundary allocation only to the next phase", () => {
    const firstPhase = {
      ...phase,
      id: "phase-1",
      timing: { ...phase.timing, startNs: 0, endNs: 10 },
    };
    const secondPhase = {
      ...phase,
      id: "phase-2",
      timing: { ...phase.timing, startNs: 10, endNs: 20 },
    };

    const analysis = buildHeapAnalysis(
      [heapEvent(0, 10, 64)],
      [],
      [firstPhase, secondPhase],
      new Map(),
    );

    expect(analysis.byPhase).toEqual([
      expect.objectContaining({ phaseId: "phase-1", allocatedBytes: 0 }),
      expect.objectContaining({ phaseId: "phase-2", allocatedBytes: 64 }),
    ]);
  });

  it("retains prototype-named namespaces as ordinary aggregate keys", () => {
    const analysis = buildHeapAnalysis(
      [
        heapEvent(0, 1, 64, "__proto__"),
        heapEvent(1, 2, 32, "constructor"),
        heapEvent(2, 3, 16, "__proto__"),
      ],
      [],
      [phase],
      new Map(),
    );

    expect(Object.hasOwn(analysis.byNamespace, "__proto__")).toBe(true);
    expect(analysis.byNamespace["__proto__"]).toEqual({
      totalBytes: 80,
      count: 2,
    });
    expect(analysis.byNamespace.constructor).toEqual({
      totalBytes: 32,
      count: 1,
    });
  });

  it("rejects partial and incorrectly grouped heap byte tokens", () => {
    const partial = heapEvent(0, 1, 1);
    partial.text = "Bytes:128oops";
    const malformedGrouping = heapEvent(1, 2, 1);
    malformedGrouping.text = "Bytes:1,02";
    const grouped = heapEvent(2, 3, 1);
    grouped.text = "Bytes:1,024";

    const analysis = buildHeapAnalysis(
      [partial, malformedGrouping, grouped],
      [],
      [phase],
      new Map(),
    );

    expect(analysis).toMatchObject({
      totalAllocatedBytes: 1_024,
      allocationCount: 1,
    });
  });
});
