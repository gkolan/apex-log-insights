import { describe, expect, it } from "vitest";

import {
  assessDebugLevelQuality,
  buildCpuAttribution,
  buildManagedPackageImpact,
} from "./governor-quality.js";
import type { FlatEvent } from "./types.js";

describe("assessDebugLevelQuality", () => {
  it("explains missing foundational debug-level evidence", () => {
    const result = assessDebugLevelQuality({ debugLevels: [] });

    expect(result.overallQuality).toBe("low");
    expect(result.warnings).toEqual([
      expect.objectContaining({
        category: "APEX_CODE",
        currentLevel: "Not configured",
      }),
      expect.objectContaining({
        category: "DATABASE",
        currentLevel: "Not configured",
      }),
    ]);
  });

  it("uses the last configured category value without duplicate warnings", () => {
    const result = assessDebugLevelQuality({
      debugLevels: [
        { logCategory: " APEX_CODE ", logLevel: "INFO" },
        { logCategory: "apex_code", logLevel: " FINEST " },
        { logCategory: "DATABASE", logLevel: "FINEST" },
      ],
    });

    expect(result).toMatchObject({
      levels: [
        { category: "apex_code", level: "FINEST" },
        { category: "DATABASE", level: "FINEST" },
      ],
      warnings: [],
      overallQuality: "high",
    });
  });

  it("treats inherited object-property names as unknown levels", () => {
    const result = assessDebugLevelQuality({
      debugLevels: [
        { logCategory: "APEX_CODE", logLevel: "constructor" },
        { logCategory: "DATABASE", logLevel: "FINE" },
      ],
    });

    expect(result.overallQuality).toBe("low");
    expect(result.warnings).toEqual([
      expect.objectContaining({
        category: "APEX_CODE",
        currentLevel: "constructor",
      }),
    ]);
  });

  it("reports each configured category below its evidence threshold", () => {
    const result = assessDebugLevelQuality({
      debugLevels: [
        { logCategory: "APEX_CODE", logLevel: "DEBUG" },
        { logCategory: "DATABASE", logLevel: "INFO" },
        { logCategory: "CALLOUT", logLevel: "INFO" },
        { logCategory: "SYSTEM", logLevel: "WARN" },
        { logCategory: "VALIDATION", logLevel: "WARN" },
        { logCategory: "WORKFLOW", logLevel: "ERROR" },
        { logCategory: "DATA_ACCESS", logLevel: "NONE" },
      ],
    });

    expect(result.warnings.map((warning) => warning.category)).toEqual([
      "APEX_CODE",
      "DATABASE",
      "CALLOUT",
      "SYSTEM",
      "VALIDATION",
      "WORKFLOW",
      "DATA_ACCESS",
    ]);
  });
});

function databaseEvent(
  type: "SOQL_EXECUTE_BEGIN" | "DML_BEGIN",
  pairingStatus: FlatEvent["pairingStatus"],
  rows: number,
  namespace = "pkg",
): FlatEvent {
  return {
    type,
    namespace,
    pairingStatus,
    soqlRowCountTotal: type === "SOQL_EXECUTE_BEGIN" ? rows : 0,
    dmlRowCountTotal: type === "DML_BEGIN" ? rows : 0,
  } as FlatEvent;
}

describe("buildManagedPackageImpact", () => {
  it("preserves unknown package timing and row aggregates", () => {
    const result = buildManagedPackageImpact(
      ["default", "pkg"],
      [
        {
          id: "span-1",
          namespace: "pkg",
          durationMs: null,
          selfDurationMs: null,
        },
      ],
      [
        databaseEvent("SOQL_EXECUTE_BEGIN", "missing_end", 0),
        databaseEvent("DML_BEGIN", "complete", 0),
      ],
      10,
    );

    expect(result[0]).toMatchObject({
      namespace: "pkg",
      totalDurationMs: null,
      selfDurationMs: null,
      soqlRows: null,
      dmlRows: 0,
      pctOfTotalDuration: null,
    });
  });

  it("rejects negative row operands instead of allowing cancellation", () => {
    const result = buildManagedPackageImpact(
      ["pkg"],
      [],
      [
        databaseEvent("DML_BEGIN", "complete", 5),
        databaseEvent("DML_BEGIN", "complete", -1),
      ],
      1,
    );

    expect(result[0]).toMatchObject({ dmlCount: 2, dmlRows: null });
  });

  it("aggregates large namespace sets in shared span and event passes", () => {
    const packageCount = 5_000;
    const namespaces = Array.from(
      { length: packageCount },
      (_, index) => `pkg-${index}`,
    );
    const spans = namespaces.map((namespace, index) => ({
      id: `span-${index}`,
      namespace,
      durationMs: index === 0 ? null : index % 7,
      selfDurationMs: index === 0 ? null : index % 5,
    }));
    const events = namespaces.flatMap((namespace, index) => [
      databaseEvent(
        "SOQL_EXECUTE_BEGIN",
        index === 0 ? "missing_end" : "complete",
        index % 11,
        namespace,
      ),
      databaseEvent("DML_BEGIN", "complete", index % 13, namespace),
    ]);

    const result = buildManagedPackageImpact(
      ["default", ...namespaces, namespaces[0]!],
      spans,
      events,
      100,
    );

    expect(result).toHaveLength(packageCount);
    expect(result.find((entry) => entry.namespace === "pkg-0")).toMatchObject({
      spanCount: 1,
      totalDurationMs: null,
      selfDurationMs: null,
      soqlCount: 1,
      soqlRows: null,
      dmlCount: 1,
      dmlRows: 0,
    });
    expect(
      result.find((entry) => entry.namespace === "pkg-4999"),
    ).toMatchObject({
      spanCount: 1,
      soqlCount: 1,
      dmlCount: 1,
    });
  });
});

describe("buildCpuAttribution", () => {
  it("does not present unmeasured spans as zero-duration CPU work", () => {
    const result = buildCpuAttribution([
      {
        id: "span-1",
        eventType: "METHOD_ENTRY",
        namespace: "pkg",
        cpuType: "method",
        durationMs: null,
        selfDurationMs: null,
      },
    ]);

    expect(result).toEqual({
      byType: { method: { durationMs: null, count: 1 } },
      byNamespace: {
        pkg: {
          selfDurationMs: null,
          totalDurationMs: null,
          spanCount: 1,
        },
      },
    });
  });

  it("stores untrusted CPU and namespace keys without prototype collisions", () => {
    const result = buildCpuAttribution([
      {
        id: "span-1",
        eventType: "METHOD_ENTRY",
        namespace: "constructor",
        cpuType: "__proto__",
        durationMs: 2,
        selfDurationMs: 1,
      },
    ]);

    expect(Object.hasOwn(result.byType, "__proto__")).toBe(true);
    expect(Object.hasOwn(result.byNamespace, "constructor")).toBe(true);
    expect(result.byType["__proto__"]).toEqual({ durationMs: 1, count: 1 });
    expect(result.byNamespace["constructor"]).toEqual({
      selfDurationMs: 1,
      totalDurationMs: 2,
      spanCount: 1,
    });
    expect(
      (Object.prototype as { durationMs?: number }).durationMs,
    ).toBeUndefined();
  });

  it("keeps a group unknown after any invalid or unmeasured duration", () => {
    const result = buildCpuAttribution([
      {
        id: "known",
        eventType: "METHOD_ENTRY",
        namespace: "default",
        cpuType: "method",
        durationMs: 2,
        selfDurationMs: 1,
      },
      {
        id: "unknown",
        eventType: "METHOD_ENTRY",
        namespace: "default",
        cpuType: "method",
        durationMs: Number.POSITIVE_INFINITY,
        selfDurationMs: -1,
      },
    ]);

    expect(result.byType.method).toEqual({ durationMs: null, count: 2 });
    expect(result.byNamespace.default).toEqual({
      selfDurationMs: null,
      totalDurationMs: null,
      spanCount: 2,
    });
  });

  it("aggregates a large span collection in one pass", () => {
    const spans = Array.from({ length: 100_000 }, (_, index) => ({
      id: `span-${index}`,
      eventType: "METHOD_ENTRY",
      namespace: `pkg-${index % 10}`,
      cpuType: `type-${index % 5}`,
      durationMs: 2,
      selfDurationMs: 1,
    }));

    const result = buildCpuAttribution(spans);

    expect(result.byType["type-0"]).toEqual({
      durationMs: 20_000,
      count: 20_000,
    });
    expect(result.byNamespace["pkg-0"]).toEqual({
      selfDurationMs: 10_000,
      totalDurationMs: 20_000,
      spanCount: 10_000,
    });
  });
});
