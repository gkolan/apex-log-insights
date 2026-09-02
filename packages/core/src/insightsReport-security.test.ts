import { describe, expect, it } from "vitest";

import { buildInsightsReport } from "./insightsReport.js";

describe("insights report prototype safety", () => {
  it("retains prototype-named event dimensions as ordinary histogram keys", () => {
    const report = buildInsightsReport({
      filePath: "hostile-dimensions.log",
      fileBytes: 1,
      generatedAt: "2026-08-18T00:00:00.000Z",
      parseTimeMs: 0,
      parserResult: {
        children: [
          {
            type: "__proto__",
            namespace: "constructor",
            category: "__proto__",
            debugCategory: "constructor",
            timestamp: 1,
            exitStamp: 2,
            duration: { self: 1 },
            children: [],
          },
          {
            type: "__proto__",
            namespace: "constructor",
            category: "__proto__",
            debugCategory: "constructor",
            timestamp: 3,
            exitStamp: 4,
            duration: { self: 1 },
            children: [],
          },
        ],
        logIssues: [],
        parsingErrors: [],
        parsingDiagnostics: [],
        namespaces: [],
        governorLimits: {},
      },
    }) as unknown as {
      components: {
        byType: Record<string, number>;
        byNamespace: Record<string, number>;
        byCategory: Record<string, number>;
        byDebugCategory: Record<string, number>;
      };
    };

    expect(Object.hasOwn(report.components.byType, "__proto__")).toBe(true);
    expect(report.components.byType["__proto__"]).toBe(2);
    expect(Object.hasOwn(report.components.byNamespace, "constructor")).toBe(
      true,
    );
    expect(report.components.byNamespace.constructor).toBe(2);
    expect(report.components.byCategory["__proto__"]).toBe(2);
    expect(report.components.byDebugCategory.constructor).toBe(2);
  });

  it("does not turn inherited parser-result fields into report evidence", () => {
    const inheritedResult = Object.create({
      children: [{ type: "INHERITED_EVENT", timestamp: 1, children: [] }],
      namespaces: ["inherited"],
      parsingErrors: ["inherited error"],
      governorLimits: { cpuTime: { used: 999, limit: 1_000 } },
    });

    const report = buildInsightsReport({
      filePath: "inherited-evidence.log",
      fileBytes: 0,
      generatedAt: "2026-08-18T00:00:00.000Z",
      parseTimeMs: 0,
      parserResult: inheritedResult,
    }) as unknown as {
      components: { byType: Record<string, number>; namespaces: string[] };
      overview: {
        topMetrics: { cpuTimeMs: number | null };
        status: { warningCount: number };
      };
      trace: { events: unknown[] };
    };

    expect(report.trace.events).toEqual([]);
    expect(report.components.byType).toEqual({});
    expect(report.components.namespaces).toEqual([]);
    expect(report.overview.topMetrics.cpuTimeMs).toBeNull();
    expect(report.overview.status.warningCount).toBe(0);
  });
});
