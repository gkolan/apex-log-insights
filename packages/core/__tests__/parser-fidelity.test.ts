import { describe, expect, it } from "vitest";

import {
  getLogEventClass,
  LOG_EVENT_NAMES,
  parse,
  parseObjectNamespace,
  parseRows,
} from "../src/certinia/index.js";
import { buildInsightsReport } from "../src/insightsReport.js";
import { buildOfflineReport } from "../src/offlineReport.js";
import { parseLog } from "../src/parserCore.js";
import { MAX_LOG_BYTES, utf8ByteLength } from "../src/utf8.js";

describe("parser evidence fidelity", () => {
  it("rejects invalid and oversized input before line expansion", async () => {
    expect(() => parse(null as unknown as string)).toThrow(
      "Apex log input must be a string.",
    );
    const oversized = "x".repeat(MAX_LOG_BYTES + 1);
    expect(() => parse(oversized)).toThrow(
      "Log exceeds the 25 MiB parser input limit.",
    );
    await expect(parseLog(oversized)).rejects.toThrow(
      "Log exceeds the 25 MiB parser input limit.",
    );
  }, 15_000);

  it("keeps every declared Salesforce event type registered", () => {
    const missing = LOG_EVENT_NAMES.filter((type) => !getLogEventClass(type));
    expect(missing).toEqual([]);
  });

  it("rejects unsafe parser integers instead of losing precision", async () => {
    const unsafe = "9".repeat(40);
    const parsed = await parseLog(
      [
        "12:00:00.000 (1)|EXECUTION_STARTED",
        `12:00:00.001 (${unsafe})|USER_DEBUG|[1]|DEBUG|unsafe timestamp`,
        `12:00:00.002 (3)|USER_DEBUG|[${unsafe}]|DEBUG|unsafe source line`,
        "12:00:00.003 (4)|USER_DEBUG|[4]|DEBUG|continued",
        "12:00:00.004 (5)|EXECUTION_FINISHED",
      ].join("\n"),
    );
    const unsafeTimestamp = parsed.normalizedTimeline.find((event) =>
      event.text?.includes("unsafe timestamp"),
    );
    const unsafeSourceLine = parsed.normalizedTimeline.find((event) =>
      event.text?.includes("unsafe source line"),
    );

    expect(unsafeTimestamp).toMatchObject({
      timestampNs: 1,
      timestampIsInferred: true,
      lineNumber: null,
    });
    expect(unsafeSourceLine).toMatchObject({
      timestampNs: 3,
      timestampIsInferred: false,
      lineNumber: null,
    });
    expect(parsed.parserDiagnostics).toEqual([
      expect.objectContaining({
        type: "MALFORMED_EVENT",
        count: 2,
        firstLine: 2,
        lastLine: 3,
      }),
    ]);
    expect(parseRows("Rows:9,007,199,254,740,991")).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(parseRows("Rows:9,007,199,254,740,992")).toBeNull();
    expect(parseRows("-1")).toBeNull();
    expect(parseRows("1.5")).toBeNull();
    expect(parseRows("Rows:1.5")).toBeNull();
    expect(parseRows("Rows:12oops")).toBeNull();
    expect(parseRows("Rows:1,00")).toBeNull();
    expect(parseRows("Rows:1,,000")).toBeNull();
    expect(parseRows("Rows:1,000")).toBe(1_000);
    expect(parseRows("1,000")).toBe(1_000);
  });

  it("detects timestamp regressions on every event and rejects negative durations", async () => {
    const parsed = await parseLog(
      [
        "12:00:00.000 (1)|EXECUTION_STARTED",
        "12:00:00.001 (10)|USER_DEBUG|[1]|DEBUG|first",
        "12:00:00.002 (9)|USER_DEBUG|[2]|DEBUG|regressed ordinary event",
        "12:00:00.003 (20)|METHOD_ENTRY|[3]|01p000000000001AAA|Example.run()",
        "12:00:00.004 (19)|METHOD_EXIT|[3]|01p000000000001AAA|Example.run()",
        "12:00:00.005 (30)|EXECUTION_FINISHED",
      ].join("\n"),
    );

    const violations = parsed.issues.filter(
      (issue) => issue.summary === "Timestamp-Violation",
    );
    expect(violations).toEqual([
      expect.objectContaining({
        description: expect.stringContaining("Log line 3"),
        occurrences: 2,
        firstTimestampNs: 9,
        lastTimestampNs: 19,
      }),
    ]);
    expect(
      (
        parsed.parserResult as {
          logIssues: Array<{
            summary: string;
            occurrences: number;
            startTime: number;
            lastTime: number;
          }>;
        }
      ).logIssues.find((issue) => issue.summary === "Timestamp-Violation"),
    ).toMatchObject({ occurrences: 2, startTime: 9, lastTime: 19 });

    const method = parsed.normalizedTimeline.find(
      (event) => event.type === "METHOD_ENTRY",
    );
    expect(method).toMatchObject({
      timestampNs: 20,
      endNs: 19,
      durationNs: null,
      durationIsPartial: true,
      pairingStatus: "complete",
    });
    const rawMethod = (
      parsed.parserResult as {
        children: Array<{
          children: Array<{
            type: string;
            duration: { self: number; total: number };
          }>;
        }>;
      }
    ).children[0]?.children.find((event) => event.type === "METHOD_ENTRY");
    expect(rawMethod?.duration).toEqual({ self: 0, total: 0 });
  });

  it("retains pipe-heavy payloads without delimiter-proportional token arrays", async () => {
    const payload = `${"segment|".repeat(10_000)}end`;
    const parsed = await parseLog(
      [
        "12:00:00.000 (1)|EXECUTION_STARTED",
        `12:00:00.001 (2)|APP_ANALYTICS_WARN|${payload}`,
        "12:00:00.002 (3)|EXECUTION_FINISHED",
      ].join("\n"),
    );

    expect(
      parsed.normalizedTimeline.find(
        (event) => event.type === "APP_ANALYTICS_WARN",
      )?.text,
    ).toBe(payload);
    expect(parsed.parserDiagnostics).toEqual([]);
  });

  it("reports low-level log size as exact UTF-8 bytes", () => {
    const text = [
      "12:00:00.000 (0)|EXECUTION_STARTED",
      "12:00:00.001 (1)|USER_DEBUG|[1]|DEBUG|café 😀 \ud800",
      "12:00:00.002 (2)|EXECUTION_FINISHED",
    ].join("\n");

    expect(parse(text).size).toBe(utf8ByteLength(text));
    expect(parse(text).size).toBe(new TextEncoder().encode(text).byteLength);
    expect(parse(text).size).toBeGreaterThan(text.length);
  });

  it("reports duration only when an event has a valid end boundary", async () => {
    const text = [
      "12:00:00.000 (1)|EXECUTION_STARTED",
      "12:00:00.001 (2)|USER_DEBUG|[1]|DEBUG|instant",
      "12:00:00.002 (3)|SOQL_EXECUTE_BEGIN|[2]|SELECT Id FROM Account",
      "12:00:00.004 (5)|SOQL_EXECUTE_END|[2]|Rows:1",
      "12:00:00.005 (6)|METHOD_ENTRY|[3]|01p000000000001AAA|Example.zero()",
      "12:00:00.005 (6)|METHOD_EXIT|[3]|01p000000000001AAA|Example.zero()",
      "12:00:00.006 (7)|EXECUTION_FINISHED",
    ].join("\n");
    const parsed = await parseLog(text);
    const instant = parsed.normalizedTimeline.find(
      (event) => event.type === "USER_DEBUG",
    );
    const measured = parsed.normalizedTimeline.find(
      (event) => event.type === "SOQL_EXECUTE_BEGIN",
    );
    const measuredZero = parsed.normalizedTimeline.find(
      (event) => event.type === "METHOD_ENTRY",
    );

    expect(instant).toMatchObject({ endNs: null, durationNs: null });
    expect(measured).toMatchObject({
      timestampNs: 3,
      endNs: 5,
      durationNs: 2,
    });
    expect(measuredZero).toMatchObject({
      timestampNs: 6,
      endNs: 6,
      durationNs: 0,
    });

    const report = buildInsightsReport({
      filePath: "duration-boundaries.log",
      fileBytes: text.length,
      generatedAt: "2026-08-17T00:00:00.000Z",
      parseTimeMs: parsed.parseTimeMs,
      parserResult: parsed.parserResult,
    }) as {
      trace: {
        events: Array<{
          type: string;
          endNs: number | null;
          durationNs: number | null;
          durationMs: number | null;
        }>;
      };
    };
    expect(
      report.trace.events.find((event) => event.type === "USER_DEBUG"),
    ).toMatchObject({ endNs: null, durationNs: null, durationMs: null });
    expect(
      report.trace.events.find((event) => event.type === "SOQL_EXECUTE_BEGIN"),
    ).toMatchObject({ endNs: 5, durationNs: 2, durationMs: 0 });
    expect(
      report.trace.events.find((event) => event.type === "METHOD_ENTRY"),
    ).toMatchObject({ endNs: 6, durationNs: 0, durationMs: 0 });
  });

  it("retains current Salesforce generic events and pairs Formula and RLM spans", async () => {
    const result = await parseLog(
      [
        "12:00:00.000 (0)|EXECUTION_STARTED",
        "12:00:00.001 (1000000)|APP_ANALYTICS_WARN|analytics|payload|with pipes",
        "12:00:00.002 (2000000)|POLICY_RULE_EVALUATION_START|policy-1|Account",
        "12:00:00.003 (3000000)|FORMULA_EVALUATE_BEGIN|[12]|Account.Score__c",
        "12:00:00.004 (4000000)|STATEMENT_EXECUTE|[13]",
        "12:00:00.007 (7000000)|FORMULA_EVALUATE_END|[12]|true",
        "12:00:00.008 (8000000)|RLM_CONFIGURATOR_BEGIN|config-1|Cart",
        "12:00:00.013 (13000000)|RLM_CONFIGURATOR_END|config-1|Complete",
        "12:00:00.014 (14000000)|RLM_PRICING_BEGIN|pricing-1|Cart",
        "12:00:00.020 (20000000)|RLM_PRICING_END|pricing-1|Complete",
        "12:00:00.021 (21000000)|EXECUTION_FINISHED",
      ].join("\n"),
      { includeRawLines: true },
    );

    const generic = result.normalizedTimeline.find(
      (event) => event.type === "APP_ANALYTICS_WARN",
    );
    const formula = result.normalizedTimeline.find(
      (event) => event.type === "FORMULA_EVALUATE_BEGIN",
    );
    const formulaChild = result.normalizedTimeline.find(
      (event) => event.type === "STATEMENT_EXECUTE",
    );
    const configurator = result.normalizedTimeline.find(
      (event) => event.type === "RLM_CONFIGURATOR_BEGIN",
    );
    const pricing = result.normalizedTimeline.find(
      (event) => event.type === "RLM_PRICING_BEGIN",
    );

    expect(result.parserDiagnostics).toEqual([]);
    expect(generic).toMatchObject({
      text: "analytics|payload|with pipes",
      classification: "supported",
      evidence: expect.objectContaining({ startLine: 2, endLine: 2 }),
    });
    expect(formula).toMatchObject({
      text: "[12] | Account.Score__c",
      durationNs: 4_000_000,
      pairingStatus: "complete",
      evidence: expect.objectContaining({ startLine: 4, endLine: 6 }),
    });
    expect(formulaChild?.parentId).toBe(formula?.id);
    expect(configurator).toMatchObject({
      text: "config-1 | Cart",
      durationNs: 5_000_000,
      pairingStatus: "complete",
    });
    expect(pricing).toMatchObject({
      text: "pricing-1 | Cart",
      durationNs: 6_000_000,
      pairingStatus: "complete",
    });
  });

  it("keeps incomplete Formula and RLM boundaries explicit", async () => {
    const result = await parseLog(
      [
        "12:00:00.000 (0)|EXECUTION_STARTED",
        "12:00:00.001 (1000000)|RLM_PRICING_BEGIN|pricing-1|Cart",
        "12:00:00.003 (3000000)|FORMULA_EVALUATE_END|[12]|orphan-result",
        "12:00:00.006 (6000000)|EXECUTION_FINISHED",
      ].join("\n"),
      { includeRawLines: true },
    );
    const incomplete = result.normalizedTimeline.find(
      (event) => event.type === "RLM_PRICING_BEGIN",
    );
    const orphan = result.normalizedTimeline.find(
      (event) => event.type === "FORMULA_EVALUATE_END",
    );

    expect(incomplete).toMatchObject({
      pairingStatus: "missing_end",
      durationIsPartial: true,
      durationNs: null,
      evidence: expect.objectContaining({ startLine: 2, endLine: 2 }),
    });
    expect(orphan).toMatchObject({
      text: "[12]|orphan-result",
      pairingStatus: "orphan_end",
      durationIsPartial: true,
      evidence: expect.objectContaining({ startLine: 3, endLine: 3 }),
    });
  });

  it("pairs Future and Batch Apex execution spans with their children and end evidence", async () => {
    const result = await parseLog(
      [
        "12:00:00.000 (0)|EXECUTION_STARTED",
        "12:00:00.001 (1000000)|FUTURE_METHOD_BEGIN|[EXTERNAL]|707000000000001AAA|AsyncWorker.run",
        "12:00:00.002 (2000000)|METHOD_ENTRY|[8]|01p000000000001AAA|AsyncWorker.run()",
        "12:00:00.004 (4000000)|METHOD_EXIT|[8]|01p000000000001AAA|AsyncWorker.run()",
        "12:00:00.006 (6000000)|FUTURE_METHOD_END|[EXTERNAL]|707000000000001AAA",
        "12:00:00.010 (10000000)|BATCH_APEX_EXECUTE_BEGIN|[EXTERNAL]|707000000000002AAA|NightlyBatch.execute",
        "12:00:00.018 (18000000)|BATCH_APEX_EXECUTE_END|[EXTERNAL]|707000000000002AAA",
        "12:00:00.020 (20000000)|EXECUTION_FINISHED",
      ].join("\n"),
      { includeRawLines: true },
    );

    const future = result.normalizedTimeline.find(
      (event) => event.type === "FUTURE_METHOD_BEGIN",
    );
    const futureChild = result.normalizedTimeline.find(
      (event) => event.type === "METHOD_ENTRY",
    );
    const batch = result.normalizedTimeline.find(
      (event) => event.type === "BATCH_APEX_EXECUTE_BEGIN",
    );

    expect(result.parserDiagnostics).toEqual([]);
    expect(future).toMatchObject({
      text: "707000000000001AAA|AsyncWorker.run",
      durationNs: 5_000_000,
      pairingStatus: "complete",
      durationIsPartial: false,
      evidence: {
        startLine: 2,
        endLine: 5,
        lineIds: [2, 5],
        confidence: "direct",
      },
    });
    expect(futureChild?.parentId).toBe(future?.id);
    expect(batch).toMatchObject({
      text: "707000000000002AAA|NightlyBatch.execute",
      durationNs: 8_000_000,
      pairingStatus: "complete",
      durationIsPartial: false,
      evidence: {
        startLine: 6,
        endLine: 7,
        lineIds: [6, 7],
        confidence: "direct",
      },
    });
  });

  it("pairs Flow interview creation and workflow Flow action spans", async () => {
    const result = await parseLog(
      [
        "12:00:00.000 (0)|EXECUTION_STARTED",
        "12:00:00.001 (1000000)|FLOW_CREATE_INTERVIEW_BEGIN|[EXTERNAL]|Order_Flow|interview-1",
        "12:00:00.002 (2000000)|FLOW_ASSIGNMENT_DETAIL|interview-1|Set_Order_Status|status|Ready",
        "12:00:00.006 (6000000)|FLOW_CREATE_INTERVIEW_END|[EXTERNAL]|Order_Flow|interview-1",
        "12:00:00.010 (10000000)|WF_FLOW_ACTION_BEGIN|[EXTERNAL]|Order_Workflow|Launch_Order_Flow",
        "12:00:00.012 (12000000)|WF_FLOW_ACTION_DETAIL|Order_Workflow|Launch_Order_Flow|interview-2",
        "12:00:00.019 (19000000)|WF_FLOW_ACTION_END|[EXTERNAL]|Order_Workflow|Launch_Order_Flow",
        "12:00:00.020 (20000000)|EXECUTION_FINISHED",
      ].join("\n"),
      { includeRawLines: true },
    );

    const flowCreate = result.normalizedTimeline.find(
      (event) => event.type === "FLOW_CREATE_INTERVIEW_BEGIN",
    );
    const flowAssignment = result.normalizedTimeline.find(
      (event) => event.type === "FLOW_ASSIGNMENT_DETAIL",
    );
    const workflowAction = result.normalizedTimeline.find(
      (event) => event.type === "WF_FLOW_ACTION_BEGIN",
    );
    const workflowDetail = result.normalizedTimeline.find(
      (event) => event.type === "WF_FLOW_ACTION_DETAIL",
    );

    expect(result.parserDiagnostics).toEqual([]);
    expect(flowCreate).toMatchObject({
      text: "Order_Flow|interview-1",
      durationNs: 5_000_000,
      pairingStatus: "complete",
      evidence: expect.objectContaining({ startLine: 2, endLine: 4 }),
    });
    expect(flowAssignment?.parentId).toBe(flowCreate?.id);
    expect(workflowAction).toMatchObject({
      text: "Order_Workflow|Launch_Order_Flow",
      durationNs: 9_000_000,
      pairingStatus: "complete",
      evidence: expect.objectContaining({ startLine: 5, endLine: 7 }),
    });
    expect(workflowDetail?.parentId).toBe(workflowAction?.id);
  });

  it("keeps incomplete Automation spans partial and preserves orphan exits", async () => {
    const result = await parseLog(
      [
        "12:00:00.000 (0)|EXECUTION_STARTED",
        "12:00:00.001 (1000000)|FLOW_CREATE_INTERVIEW_BEGIN|[EXTERNAL]|Order_Flow|interview-1",
        "12:00:00.002 (2000000)|FLOW_ASSIGNMENT_DETAIL|interview-1|Set_Status|status|Ready",
        "12:00:00.003 (3000000)|WF_FLOW_ACTION_END|[EXTERNAL]|Orphan_Workflow|Launch_Flow",
        "12:00:00.005 (5000000)|EXECUTION_FINISHED",
      ].join("\n"),
      { includeRawLines: true },
    );

    const incomplete = result.normalizedTimeline.find(
      (event) => event.type === "FLOW_CREATE_INTERVIEW_BEGIN",
    );
    const orphan = result.normalizedTimeline.find(
      (event) => event.type === "WF_FLOW_ACTION_END",
    );

    expect(incomplete).toMatchObject({
      pairingStatus: "missing_end",
      durationIsPartial: true,
      durationNs: null,
      evidence: expect.objectContaining({ startLine: 2, endLine: 2 }),
    });
    expect(orphan).toMatchObject({
      pairingStatus: "orphan_end",
      durationIsPartial: true,
      evidence: expect.objectContaining({ startLine: 4, endLine: 4 }),
    });
  });

  it("preserves pre-execution user metadata without expanding transaction timing", async () => {
    const text = [
      "61.0 APEX_CODE,FINE;APEX_PROFILING,FINE",
      "Unstructured platform preamble that is not a log event",
      "11:59:59.999999999 (0)|USER_INFO|[EXTERNAL]|0058Z00000A1B2C|jane.admin@example.com|(GMT-05:00) Central Daylight Time (America/Chicago)|GMT-05:00",
      "12:00:00.100123456 (100000000)|EXECUTION_STARTED",
      "12:00:00.350987654 (350000000)|EXECUTION_FINISHED",
    ].join("\n");
    const parsed = await parseLog(text, { includeRawLines: true });
    const userInfo = parsed.normalizedTimeline.find(
      (event) => event.type === "USER_INFO",
    );
    const execution = parsed.normalizedTimeline.find(
      (event) => event.type === "EXECUTION_STARTED",
    );

    expect(userInfo?.evidence.startLine).toBe(3);
    expect(execution?.evidence).toMatchObject({
      startLine: 4,
      endLine: 5,
      lineIds: [4, 5],
    });
    expect(parsed.parserDiagnostics).toEqual([]);
    expect(
      parsed.parserResult as { timestamp: number; startTime: number | null },
    ).toMatchObject({ timestamp: 0, startTime: 43_199_999 });

    const report = buildInsightsReport({
      filePath: "user-info.log",
      fileBytes: Buffer.byteLength(text),
      generatedAt: "2026-08-17T00:00:00.000Z",
      parseTimeMs: parsed.parseTimeMs,
      parserResult: parsed.parserResult,
    }) as {
      context: {
        user: { userId: string; username: string; timezone: string };
        transaction: {
          startTimestamp: string;
          endTimestamp: string;
          durationMs: number;
        };
      };
      overview: {
        topMetrics: {
          relativeTimeNs: { start: number; end: number };
        };
      };
    };

    expect(report.context.user).toMatchObject({
      userId: "0058Z00000A1B2C",
      username: "jane.admin@example.com",
      timezone: "GMT-05:00",
    });
    expect(report.context.transaction).toMatchObject({
      startTimestamp: "12:00:00.100",
      endTimestamp: "12:00:00.350",
      durationMs: 250,
    });
    expect(report.overview.topMetrics.relativeTimeNs).toEqual({
      start: 100_000_000,
      end: 350_000_000,
    });
  });

  it("rejects noncanonical wall clocks and preserves a measured zero duration", () => {
    const validTenths = parse(
      [
        "01:02:03.4 (7)|EXECUTION_STARTED",
        "01:02:03.4 (7)|EXECUTION_FINISHED",
      ].join("\n"),
    );
    expect(validTenths.startTime).toBe(3_723_400);

    for (const prefix of [
      "1:02:03.400",
      "24:02:03.400",
      "01:60:03.400",
      "01:02:60.400",
      "01:02:03.1234567890",
    ]) {
      const parsed = parse(
        [
          `${prefix} (7)|EXECUTION_STARTED`,
          `${prefix} (7)|EXECUTION_FINISHED`,
        ].join("\n"),
      );
      expect(parsed.startTime, prefix).toBeNull();
    }

    const zeroText = [
      "23:59:59.999 (42)|EXECUTION_STARTED",
      "23:59:59.999 (42)|EXECUTION_FINISHED",
    ].join("\n");
    const parsedZero = parse(zeroText);
    const report = buildInsightsReport({
      filePath: "zero-duration.log",
      fileBytes: Buffer.byteLength(zeroText),
      generatedAt: "2026-08-18T00:00:00.000Z",
      parseTimeMs: 0,
      parserResult: parsedZero,
    }) as unknown as {
      context: { transaction: { durationMs: number } };
      overview: {
        topMetrics: {
          totalDurationMs: number;
          relativeTimeNs: { start: number; end: number };
        };
      };
    };

    expect(report.context.transaction.durationMs).toBe(0);
    expect(report.overview.topMetrics.totalDurationMs).toBe(0);
    expect(report.overview.topMetrics.relativeTimeNs).toEqual({
      start: 42,
      end: 42,
    });
  });

  it("keeps incomplete execution timing unknown instead of synthesizing zero", () => {
    for (const [filePath, text] of [
      [
        "missing-finish.log",
        [
          "12:00:00.000 (100)|EXECUTION_STARTED",
          "12:00:00.001 (200)|USER_DEBUG|[1]|DEBUG|still running",
        ].join("\n"),
      ],
      ["orphan-finish.log", "12:00:00.001 (200)|EXECUTION_FINISHED"],
    ] as const) {
      const parsed = parse(text);
      const report = buildInsightsReport({
        filePath,
        fileBytes: Buffer.byteLength(text),
        generatedAt: "2026-08-18T00:00:00.000Z",
        parseTimeMs: 0,
        parserResult: parsed,
      }) as unknown as {
        context: {
          transaction: {
            startTimestamp: string | null;
            endTimestamp: string | null;
            durationMs: number | null;
          };
        };
        overview: {
          topMetrics: {
            totalDurationMs: number | null;
            relativeTimeNs: { start: number | null; end: number | null };
          };
        };
      };

      expect(report.context.transaction.durationMs, filePath).toBeNull();
      expect(report.context.transaction.endTimestamp, filePath).toBeNull();
      expect(report.overview.topMetrics.totalDurationMs, filePath).toBeNull();
      expect(
        report.overview.topMetrics.relativeTimeNs.end,
        filePath,
      ).toBeNull();
    }
  });

  it("does not let a trailing zero-duration profiling span extend execution time", () => {
    const result = parse(
      [
        "12:00:00.000 (0)|EXECUTION_STARTED",
        "12:00:00.010 (10)|EXECUTION_FINISHED",
        "12:00:00.020 (20)|CUMULATIVE_PROFILING_BEGIN",
        "12:00:00.020 (20)|CUMULATIVE_PROFILING_END",
      ].join("\n"),
    );

    expect(result.executionEndTime).toBe(10);
    expect(result.exitStamp).toBe(20);
  });

  it("honors a max-size boundary observed at relative timestamp zero", async () => {
    const result = await parseLog(
      [
        "12:00:00.000 (0)|EXECUTION_STARTED",
        "12:00:00.000 (0)|METHOD_ENTRY|[1]|Example.run()",
        "*** MAXIMUM DEBUG LOG SIZE REACHED ***",
        "12:00:00.001 (1)|FATAL_ERROR|System.LimitException: log truncated",
        "12:00:00.002 (2)|EXECUTION_FINISHED",
      ].join("\n"),
    );
    const method = result.normalizedTimeline.find(
      (event) => event.type === "METHOD_ENTRY",
    );

    expect(method).toMatchObject({
      pairingStatus: "closed_at_truncation",
      durationIsPartial: true,
    });
    expect(
      (result.parserResult as { logIssues: Array<{ summary: string }> })
        .logIssues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ summary: "Max-Size-reached" }),
      ]),
    );
  });

  it("preserves pipe characters in exception and fatal-error messages", async () => {
    const result = await parseLog(
      [
        "12:00:00.000 (1)|EXECUTION_STARTED",
        "12:00:00.001 (2)|EXCEPTION_THROWN|[8]|System.Exception: expected A|received B",
        "12:00:00.002 (3)|FATAL_ERROR|System.Exception: expected A|received B",
        "12:00:00.003 (4)|EXECUTION_FINISHED",
      ].join("\n"),
      { includeRawLines: true },
    );

    const exception = result.normalizedTimeline.find(
      (event) => event.type === "EXCEPTION_THROWN",
    );
    const fatal = result.normalizedTimeline.find(
      (event) => event.type === "FATAL_ERROR",
    );
    expect(exception?.text).toBe("System.Exception: expected A|received B");
    expect(fatal?.text).toBe("System.Exception: expected A|received B");
  });

  it("preserves pipes in database queries and callout payloads", async () => {
    const text = [
      "12:00:00.000 (1)|EXECUTION_STARTED",
      "12:00:00.001 (2)|SOQL_EXECUTE_BEGIN|[8]|Aggregations:0|SELECT Id FROM Account WHERE Name = 'A|B'",
      "12:00:00.002 (3)|SOQL_EXECUTE_END|[8]|Rows:1",
      "12:00:00.003 (4)|SOSL_EXECUTE_BEGIN|[9]|FIND {A|B} IN ALL FIELDS RETURNING Account(Id)",
      "12:00:00.004 (5)|SOSL_EXECUTE_END|[9]|Rows:1",
      "12:00:00.005 (6)|CALLOUT_REQUEST|[10]|HttpRequest[Endpoint=https://example.test/items?q=A,B|C, Method=GET]",
      "12:00:00.006 (7)|CALLOUT_RESPONSE|[11]|HttpResponse[StatusCode=200, Status=OK, Body=A|B]",
      "12:00:00.007 (8)|EXECUTION_FINISHED",
    ].join("\n");
    const parsed = await parseLog(text, { includeRawLines: true });
    const byType = new Map(
      parsed.normalizedTimeline.map((event) => [event.type, event]),
    );

    expect(byType.get("SOQL_EXECUTE_BEGIN")?.text).toContain("Name = 'A|B'");
    expect(byType.get("SOSL_EXECUTE_BEGIN")?.text).toContain("FIND {A|B}");
    expect(byType.get("CALLOUT_REQUEST")?.text).toContain("q=A,B|C");

    const report = buildInsightsReport({
      filePath: "pipes.log",
      fileBytes: Buffer.byteLength(text),
      generatedAt: "2026-08-17T00:00:00.000Z",
      parseTimeMs: parsed.parseTimeMs,
      parserResult: parsed.parserResult,
    }) as {
      database: {
        soql: Array<{ query: string }>;
        sosl: Array<{ query: string }>;
        callouts: Array<{
          endpoint: string;
          text: string;
          statusCode: number;
          statusText: string;
          responseLineNumber: number;
        }>;
      };
    };
    expect(report.database.soql[0]?.query).toContain("Name = 'A|B'");
    expect(report.database.sosl[0]?.query).toContain("FIND {A|B}");
    expect(report.database.callouts[0]).toMatchObject({
      endpoint: "https://example.test/items?q=A,B|C",
      text: expect.stringContaining("q=A,B|C"),
      statusCode: 200,
      statusText: "OK",
      responseLineNumber: 7,
    });
  });

  it("attributes relationship subqueries to the outer SOQL object", async () => {
    const text = [
      "12:00:00.000 (1)|EXECUTION_STARTED",
      "12:00:00.001 (2)|SOQL_EXECUTE_BEGIN|[8]|Aggregations:1|SELECT Id, (SELECT Id FROM Contacts) FROM Account",
      "12:00:00.002 (3)|SOQL_EXECUTE_END|[8]|Rows:1",
      "12:00:00.003 (4)|EXECUTION_FINISHED",
    ].join("\n");
    const parsed = await parseLog(text);
    const report = buildInsightsReport({
      filePath: "relationship-query.log",
      fileBytes: Buffer.byteLength(text),
      generatedAt: "2026-08-17T00:00:00.000Z",
      parseTimeMs: parsed.parseTimeMs,
      parserResult: parsed.parserResult,
    }) as { database: { soql: Array<{ targetObject: string }> } };

    expect(report.database.soql[0]?.targetObject).toBe("Account");
  });

  it("parses and reports Apex cursor creation and paged fetches", async () => {
    const text = [
      "12:00:00.000 (1)|EXECUTION_STARTED",
      "12:00:00.001 (1000000)|CURSOR_CREATE_BEGIN|[8]|SELECT Id FROM Account ORDER BY Id",
      "12:00:00.004 (4000000)|CURSOR_CREATE_END|[8]|QueryId:01g000000000001AAA|Rows:250",
      "12:00:00.005 (5000000)|CURSOR_FETCH|[9]|QueryId:01g000000000001AAA|Offset:200|Rows:50",
      "12:00:00.006 (6000000)|CURSOR_FETCH_PAGE|[10]|QueryId:01g000000000001AAA|Cursor Offset Position:250|Number of rows:25",
      "12:00:00.007 (7000000)|EXECUTION_FINISHED",
    ].join("\n");
    const parsed = await parseLog(text, { includeRawLines: true });
    const cursorCreate = parsed.normalizedTimeline.find(
      (event) => event.type === "CURSOR_CREATE_BEGIN",
    );

    expect(parsed.parserDiagnostics).toEqual([]);
    expect(cursorCreate).toMatchObject({
      pairingStatus: "complete",
      durationNs: 3_000_000,
      evidence: {
        startLine: 2,
        endLine: 3,
        lineIds: [2, 3],
      },
    });

    const report = buildInsightsReport({
      filePath: "cursor.log",
      fileBytes: Buffer.byteLength(text),
      generatedAt: "2026-08-17T00:00:00.000Z",
      parseTimeMs: parsed.parseTimeMs,
      parserResult: parsed.parserResult,
      limits: { cursorOperations: 2 },
    }) as {
      database: {
        cursors: Array<Record<string, unknown>>;
        cursorsMeta: Record<string, unknown>;
      };
    };

    expect(report.database.cursors).toEqual([
      expect.objectContaining({
        operation: "create",
        queryId: "01g000000000001AAA",
        query: "SELECT Id FROM Account ORDER BY Id",
        rows: 250,
        durationMs: 3,
        evidence: expect.objectContaining({
          lineNumber: 2,
          endLineNumber: 3,
        }),
      }),
      expect.objectContaining({
        operation: "fetch",
        queryId: "01g000000000001AAA",
        offset: 200,
        rows: 50,
      }),
    ]);
    expect(report.database.cursorsMeta).toEqual({
      totalCount: 3,
      truncated: true,
      limit: 2,
    });
  });

  it("extracts modern labeled Named Credential metadata and timing", async () => {
    const text = [
      "12:00:00.000 (1)|EXECUTION_STARTED",
      "12:00:00.001 (1000000)|NAMED_CREDENTIAL_REQUEST|[8]|Named Credential Id=0XA000000000001AAA|Named Credential Name=ERP_NC|Endpoint=https://api.example.com/orders?q=A,B|Method=POST|External Credential Type=OAuth|Http Header Authorization=Bearer SECRET|Request Size bytes=1,024|Retry on 401=true",
      '12:00:00.002 (2000000)|NAMED_CREDENTIAL_RESPONSE|Body:{"ok":true}',
      "12:00:00.003 (3000000)|NAMED_CREDENTIAL_RESPONSE_DETAIL|Named Credential Id=0XA000000000001AAA|Named Credential Name=ERP_NC|Status Code=201|Response Size bytes=2,048|Overall Callout Time ms=135|Connect Time ms=22",
      "12:00:00.004 (4000000)|EXECUTION_FINISHED",
    ].join("\n");
    const parsed = await parseLog(text, { includeRawLines: true });
    const report = buildInsightsReport({
      filePath: "named-credential.log",
      fileBytes: Buffer.byteLength(text),
      generatedAt: "2026-08-17T00:00:00.000Z",
      parseTimeMs: parsed.parseTimeMs,
      parserResult: parsed.parserResult,
    }) as { database: { namedCredentials: Array<Record<string, unknown>> } };

    expect(parsed.parserDiagnostics).toEqual([]);
    expect(report.database.namedCredentials).toHaveLength(1);
    expect(report.database.namedCredentials[0]).toMatchObject({
      credentialId: "0XA000000000001AAA",
      credentialName: "ERP_NC",
      endpoint: "https://api.example.com/orders?q=A,B",
      method: "POST",
      externalCredentialType: "OAuth",
      requestSizeBytes: 1024,
      retryOn401: true,
      statusCode: 201,
      responseSizeBytes: 2048,
      durationNs: 135_000_000,
      durationMs: 135,
      connectTimeMs: 22,
    });
    expect(report.database.namedCredentials[0]).not.toHaveProperty(
      "httpHeaderAuthorization",
    );
  });

  it("rejects malformed comma grouping in Named Credential metrics", async () => {
    const text = [
      "12:00:00.000 (1)|EXECUTION_STARTED",
      "12:00:00.001 (2)|NAMED_CREDENTIAL_REQUEST|[8]|Named Credential Name=ERP_NC|Request Size bytes=1,02",
      "12:00:00.002 (3)|NAMED_CREDENTIAL_RESPONSE_DETAIL|Named Credential Name=ERP_NC|Status Code=2,01|Response Size bytes=2,,048|Overall Callout Time ms=1,3|Connect Time ms=2x",
      "12:00:00.003 (4)|EXECUTION_FINISHED",
    ].join("\n");
    const parsed = await parseLog(text);
    const report = buildInsightsReport({
      filePath: "malformed-credential-metrics.log",
      fileBytes: utf8ByteLength(text),
      generatedAt: "2026-08-17T00:00:00.000Z",
      parseTimeMs: parsed.parseTimeMs,
      parserResult: parsed.parserResult,
    }) as { database: { namedCredentials: Array<Record<string, unknown>> } };

    expect(report.database.namedCredentials[0]).toMatchObject({
      requestSizeBytes: null,
      statusCode: null,
      responseSizeBytes: null,
      durationNs: null,
      durationMs: null,
      connectTimeMs: null,
    });
  });

  it("normalizes compact DML records with LF, CRLF, and CR line endings", async () => {
    for (const newline of ["\n", "\r\n", "\r"]) {
      const result = await parseLog(
        [
          "12:00:00.000 (1)|EXECUTION_STARTED",
          "12:00:00.001 (2)|DML_BEGIN|[8]|Insert|Account|2",
          "12:00:00.002 (3)|DML_END|[9]",
          "12:00:00.003 (4)|EXECUTION_FINISHED",
        ].join(newline),
        { includeRawLines: true },
      );
      const dml = result.normalizedTimeline.find(
        (event) => event.type === "DML_BEGIN",
      );
      expect(dml?.text).toBe("DML Op:Insert Type:Account Rows:2");
      expect(dml?.pairingStatus).toBe("complete");
      expect(dml?.evidence.startLine).toBe(2);
      expect(dml?.evidence.endLine).toBe(3);
      expect(dml?.evidence.lineIds).toEqual([2, 3]);
      expect(result.rawLines).toHaveLength(4);
      expect(result.rawLines?.[2]?.text).toContain("DML_END");

      const parserRoot = parse(
        [
          "12:00:00.000 (1)|EXECUTION_STARTED",
          "12:00:00.001 (2)|DML_BEGIN|[8]|Insert|Account|2",
          "12:00:00.002 (3)|DML_END|[9]",
          "12:00:00.003 (4)|EXECUTION_FINISHED",
        ].join(newline),
      );
      const pending = [...parserRoot.children];
      let directDml: { type: string | null; text: string } | undefined;
      while (pending.length > 0) {
        const event = pending.pop();
        if (!event) continue;
        if (event.type === "DML_BEGIN") {
          directDml = event;
          break;
        }
        pending.push(...event.children);
      }
      expect(directDml?.text).toBe("DML Op:Insert Type:Account Rows:2");
    }
  });

  it("retains unknown event types as generic timeline evidence", async () => {
    const result = await parseLog(
      [
        "12:00:00.000 (1)|EXECUTION_STARTED",
        "12:00:00.001 (2)|FUTURE_SALESFORCE_EVENT|alpha|beta|gamma",
        "12:00:00.002 (3)|EXECUTION_FINISHED",
      ].join("\n"),
      { includeRawLines: true },
    );

    const unknown = result.normalizedTimeline.find(
      (event) => event.type === "FUTURE_SALESFORCE_EVENT",
    );
    expect(unknown?.text).toBe("alpha|beta|gamma");
    expect(unknown?.evidence.startLine).toBe(2);
    expect(unknown?.classification).toBe("unsupported");
    expect(
      result.issues.some((issue) => issue.summary.includes("Unsupported")),
    ).toBe(false);
    expect(
      (result.parserResult as { parsingErrors: string[] }).parsingErrors,
    ).toContain("Unsupported log event name: FUTURE_SALESFORCE_EVENT");
    expect(result.parserDiagnostics).toEqual([
      expect.objectContaining({
        type: "UNSUPPORTED_EVENT",
        count: 1,
        firstLine: 2,
        lastLine: 2,
      }),
    ]);
  });

  it("keeps Apex source lines separate from raw-log evidence lines", async () => {
    const result = await parseLog(
      [
        "61.0 APEX_CODE,FINE;APEX_PROFILING,FINE",
        "12:00:00.000 (1)|EXECUTION_STARTED",
        "12:00:00.001 (2)|STATEMENT_EXECUTE|[87]",
        "12:00:00.002 (3)|EXECUTION_FINISHED",
      ].join("\n"),
      { includeRawLines: true },
    );
    const statement = result.normalizedTimeline.find(
      (event) => event.type === "STATEMENT_EXECUTE",
    );
    expect(statement?.lineNumber).toBe(87);
    expect(statement?.evidence.startLine).toBe(3);
  });

  it("does not mistake ordinary class names for managed namespaces", async () => {
    const result = await parseLog(
      [
        "12:00:00.000 (1)|EXECUTION_STARTED",
        "12:00:00.001 (2)|METHOD_ENTRY|[4]|01p000000000001|ContactHelper.run()",
        "12:00:00.002 (3)|METHOD_EXIT|[4]|ContactHelper.run",
        "12:00:00.003 (4)|ENTERING_MANAGED_PKG|[5]|npe01",
        "12:00:00.004 (5)|METHOD_ENTRY|[6]|01p000000000002|npe01.Worker.run()",
        "12:00:00.005 (6)|METHOD_EXIT|[6]|npe01.Worker.run",
        "12:00:00.006 (7)|EXECUTION_FINISHED",
      ].join("\n"),
    );

    expect(
      (result.parserResult as { namespaces: string[] }).namespaces,
    ).toEqual(expect.arrayContaining(["default", "npe01"]));
    expect(
      (result.parserResult as { namespaces: string[] }).namespaces,
    ).not.toContain("ContactHelper");
    expect(
      result.normalizedTimeline.find(
        (event) => event.text === "npe01.Worker.run()",
      )?.namespace,
    ).toBe("npe01");
  });

  it("distinguishes unmanaged custom API names from managed-package names", async () => {
    expect(parseObjectNamespace("Account")).toBe("default");
    expect(parseObjectNamespace("Order_Event__e")).toBe("default");
    expect(parseObjectNamespace("Invoice__c")).toBe("default");
    expect(parseObjectNamespace("pkg__Order_Event__e")).toBe("pkg");
    expect(parseObjectNamespace("pkg__Invoice__c")).toBe("pkg");

    const text = [
      "12:00:00.000 (1)|EXECUTION_STARTED",
      "12:00:00.001 (2)|CODE_UNIT_STARTED|[EXTERNAL]|EventService:Order_Event__e",
      "12:00:00.002 (3)|CODE_UNIT_FINISHED|EventService:Order_Event__e",
      "12:00:00.003 (4)|CODE_UNIT_STARTED|[EXTERNAL]|EventService:pkg__Order_Event__e",
      "12:00:00.004 (5)|CODE_UNIT_FINISHED|EventService:pkg__Order_Event__e",
      "12:00:00.005 (6)|EXECUTION_FINISHED",
    ].join("\n");
    const result = await parseLog(text, { includeRawLines: true });
    const codeUnits = result.normalizedTimeline.filter(
      (event) => event.type === "CODE_UNIT_STARTED",
    );

    expect(codeUnits.map((event) => event.namespace)).toEqual([
      "default",
      "pkg",
    ]);
    expect(
      (result.parserResult as { namespaces: string[] }).namespaces,
    ).toEqual(expect.arrayContaining(["default", "pkg"]));
    expect(
      (result.parserResult as { namespaces: string[] }).namespaces,
    ).not.toContain("Order_Event");

    const report = buildInsightsReport({
      filePath: "event-service-namespaces.log",
      fileBytes: Buffer.byteLength(text),
      generatedAt: "2026-08-18T00:00:00.000Z",
      parseTimeMs: result.parseTimeMs,
      parserResult: result.parserResult,
    }) as unknown as {
      components: {
        namespaces: string[];
        byNamespace: Record<string, number>;
      };
      managedPackageImpact: Array<{ namespace: string }>;
    };

    expect(report.components.namespaces).not.toContain("Order_Event");
    expect(report.components.byNamespace.default).toBeGreaterThan(0);
    expect(report.components.byNamespace.pkg).toBeGreaterThan(0);
    expect(report.managedPackageImpact.map((entry) => entry.namespace)).toEqual(
      ["pkg"],
    );
  });

  it("does not classify dotted inner-class code units as managed packages", async () => {
    const text = [
      "12:00:00.000 (1)|EXECUTION_STARTED",
      "12:00:00.001 (2)|CODE_UNIT_STARTED|[EXTERNAL]|Outer.Inner.run()",
      "12:00:00.002 (3)|CODE_UNIT_FINISHED|Outer.Inner.run()",
      "12:00:00.003 (4)|ENTERING_MANAGED_PKG|[5]|pkg",
      "12:00:00.004 (5)|CODE_UNIT_STARTED|[EXTERNAL]|pkg.Worker.run()",
      "12:00:00.005 (6)|CODE_UNIT_FINISHED|pkg.Worker.run()",
      "12:00:00.006 (7)|EXECUTION_FINISHED",
    ].join("\n");
    const result = await parseLog(text, { includeRawLines: true });
    const codeUnits = result.normalizedTimeline.filter(
      (event) => event.type === "CODE_UNIT_STARTED",
    );

    expect(codeUnits.map((event) => event.namespace)).toEqual([
      "default",
      "pkg",
    ]);
    expect(
      (result.parserResult as { namespaces: string[] }).namespaces,
    ).not.toContain("Outer");

    const report = buildInsightsReport({
      filePath: "inner-class-namespaces.log",
      fileBytes: Buffer.byteLength(text),
      generatedAt: "2026-08-18T00:00:00.000Z",
      parseTimeMs: result.parseTimeMs,
      parserResult: result.parserResult,
    }) as unknown as {
      components: { namespaces: string[] };
      managedPackageImpact: Array<{ namespace: string }>;
    };

    expect(report.components.namespaces).not.toContain("Outer");
    expect(report.managedPackageImpact.map((entry) => entry.namespace)).toEqual(
      ["pkg"],
    );
  });

  it("does not treat an sfdc-trigger object path as a package namespace", async () => {
    const text = [
      "12:00:00.000 (1)|EXECUTION_STARTED",
      "12:00:00.001 (2)|CODE_UNIT_STARTED|[EXTERNAL]|__sfdc_trigger/Account/AccountTrigger",
      "12:00:00.002 (3)|CODE_UNIT_FINISHED|__sfdc_trigger/Account/AccountTrigger",
      "12:00:00.003 (4)|CODE_UNIT_STARTED|[EXTERNAL]|__sfdc_trigger/pkg__Ledger__c/pkg__LedgerTrigger",
      "12:00:00.004 (5)|CODE_UNIT_FINISHED|__sfdc_trigger/pkg__Ledger__c/pkg__LedgerTrigger",
      "12:00:00.005 (6)|ENTERING_MANAGED_PKG|[7]|known",
      "12:00:00.006 (7)|CODE_UNIT_STARTED|[EXTERNAL]|__sfdc_trigger/Account/known__AccountTrigger",
      "12:00:00.007 (8)|CODE_UNIT_FINISHED|__sfdc_trigger/Account/known__AccountTrigger",
      "12:00:00.008 (9)|EXECUTION_FINISHED",
    ].join("\n");
    const result = await parseLog(text, { includeRawLines: true });
    const codeUnits = result.normalizedTimeline.filter(
      (event) => event.type === "CODE_UNIT_STARTED",
    );

    expect(codeUnits.map((event) => event.text)).toEqual([
      "__sfdc_trigger/Account/AccountTrigger",
      "__sfdc_trigger/pkg__Ledger__c/pkg__LedgerTrigger",
      "__sfdc_trigger/Account/known__AccountTrigger",
    ]);
    expect(codeUnits.map((event) => event.namespace)).toEqual([
      "default",
      "pkg",
      "known",
    ]);
    expect(
      (result.parserResult as { namespaces: string[] }).namespaces,
    ).not.toContain("Account");

    const report = buildInsightsReport({
      filePath: "sfdc-trigger-namespaces.log",
      fileBytes: Buffer.byteLength(text),
      generatedAt: "2026-08-18T00:00:00.000Z",
      parseTimeMs: result.parseTimeMs,
      parserResult: result.parserResult,
    }) as unknown as {
      components: { namespaces: string[] };
      managedPackageImpact: Array<{ namespace: string }>;
    };

    expect(report.components.namespaces).not.toContain("Account");
    expect(report.managedPackageImpact.map((entry) => entry.namespace)).toEqual(
      ["pkg", "known"],
    );
  });

  it("marks unmatched operations instead of presenting their duration as exact", async () => {
    const result = await parseLog(
      [
        "12:00:00.000 (1)|EXECUTION_STARTED",
        "12:00:00.001 (2)|METHOD_ENTRY|[4]|01p000000000001|Example.run()",
      ].join("\n"),
      { includeRawLines: true },
    );
    const method = result.normalizedTimeline.find(
      (event) => event.type === "METHOD_ENTRY",
    );
    expect(method?.pairingStatus).toBe("missing_end");
    expect(method?.durationIsPartial).toBe(true);
    expect(method?.durationNs).toBeNull();

    const report = buildInsightsReport({
      filePath: "missing-method-end.log",
      fileBytes: 1,
      generatedAt: "2026-08-18T00:00:00.000Z",
      parseTimeMs: result.parseTimeMs,
      parserResult: result.parserResult,
    }) as unknown as {
      trace: {
        events: Array<{
          type: string;
          durationNs: number | null;
          durationMs: number | null;
        }>;
      };
    };
    expect(
      report.trace.events.find((event) => event.type === "METHOD_ENTRY"),
    ).toMatchObject({ durationNs: null, durationMs: null });
  });

  it("marks an unmatched exit as an orphan instead of a complete operation", async () => {
    const result = await parseLog(
      [
        "12:00:00.000 (1)|EXECUTION_STARTED",
        "12:00:00.001 (2)|METHOD_EXIT|[4]|Example.run()",
        "12:00:00.002 (3)|EXECUTION_FINISHED",
      ].join("\n"),
    );
    const exit = result.normalizedTimeline.find(
      (event) => event.type === "METHOD_EXIT",
    );
    expect(exit?.pairingStatus).toBe("orphan_end");
    expect(exit?.durationIsPartial).toBe(true);
  });

  it("does not feed an ancestor exit into a nested operation's typed end hook", async () => {
    const text = [
      "12:00:00.000 (1)|EXECUTION_STARTED",
      "12:00:00.001 (2)|METHOD_ENTRY|[4]|01p000000000001|Example.run()",
      "12:00:00.002 (3)|SOQL_EXECUTE_BEGIN|[8]|Aggregations:0|SELECT Id FROM Account",
      "12:00:00.003 (4)|METHOD_EXIT|[4]|Example.run()",
      "12:00:00.004 (5)|EXECUTION_FINISHED",
    ].join("\n");
    const parsed = await parseLog(text);
    const query = parsed.normalizedTimeline.find(
      (event) => event.type === "SOQL_EXECUTE_BEGIN",
    );

    expect(query?.pairingStatus).not.toBe("complete");
    expect(query?.durationIsPartial).toBe(true);
    expect(query?.durationNs).toBeNull();
    expect(query?.text).toBe("SELECT Id FROM Account");

    const report = buildInsightsReport({
      filePath: "mismatched-exit.log",
      fileBytes: Buffer.byteLength(text),
      generatedAt: "2026-08-17T00:00:00.000Z",
      parseTimeMs: parsed.parseTimeMs,
      parserResult: parsed.parserResult,
    }) as {
      database: { soql: Array<{ rows: number | null }> };
      analysis: { findings: { zeroRowQueries: number } };
      overview: { topMetrics: { soql: { rows: number | null } } };
    };
    expect(report.database.soql[0]?.rows).toBeNull();
    expect(report.analysis.findings.zeroRowQueries).toBe(0);
    expect(report.overview.topMetrics.soql.rows).toBeNull();
  });

  it("distinguishes observed zero-row operations from unknown truncated results", async () => {
    const text = [
      "12:00:00.000 (1)|EXECUTION_STARTED",
      "12:00:00.001 (2)|CODE_UNIT_STARTED|[EXTERNAL]|Example.run",
      "12:00:00.002 (3)|METHOD_ENTRY|[1]|Example.run()",
      "12:00:00.003 (4)|SOQL_EXECUTE_BEGIN|[2]|SELECT Id FROM Account",
      "12:00:00.004 (5)|SOQL_EXECUTE_END|[2]|Rows:0",
      "12:00:00.005 (6)|DML_BEGIN|[3]|Op:Update|Type:Account|Rows:1",
    ].join("\n");
    const parsed = await parseLog(text);
    const report = buildInsightsReport({
      filePath: "row-count-provenance.log",
      fileBytes: Buffer.byteLength(text),
      generatedAt: "2026-08-17T00:00:00.000Z",
      parseTimeMs: parsed.parseTimeMs,
      parserResult: parsed.parserResult,
    }) as {
      database: {
        soql: Array<{ rows: number | null }>;
        dml: Array<{ rows: number | null }>;
      };
      overview: {
        highlights: Array<{ title: string }>;
        topMetrics: {
          soql: { rows: number | null };
          dml: { rows: number | null };
        };
      };
      analysis: {
        findings: { zeroRowQueries: number };
        dmlImpact: {
          totalRows: number | null;
          byObject: Record<string, number | null>;
        };
      };
    };

    expect(report.database.soql[0]?.rows).toBe(0);
    expect(report.database.dml[0]?.rows).toBeNull();
    expect(report.overview.topMetrics.soql.rows).toBe(0);
    expect(report.overview.topMetrics.dml.rows).toBeNull();
    expect(report.analysis.dmlImpact).toEqual({
      totalRows: null,
      byObject: { Account: null },
    });
    expect(report.analysis.findings.zeroRowQueries).toBe(1);
    expect(report.overview.highlights.map((item) => item.title)).toContain(
      "Empty Query",
    );
    expect(report.overview.highlights.map((item) => item.title)).not.toContain(
      "No Op Dml",
    );
  });

  it("counts repeated parser issues and caps malformed-line diagnostics", async () => {
    const malformedLines = Array.from(
      { length: 250 },
      (_, index) => `malformed line ${index}`,
    );
    const result = await parseLog(
      [
        "12:00:00.000 (1)|EXECUTION_STARTED",
        ...malformedLines,
        "12:00:00.001 (2)|EXECUTION_FINISHED",
      ].join("\n"),
    );
    const parser = result.parserResult as {
      parsingErrors: string[];
      parsingErrorOverflowCount: number;
    };
    expect(parser.parsingErrors).toHaveLength(200);
    expect(parser.parsingErrorOverflowCount).toBe(50);
    expect(result.parsingErrorOverflowCount).toBe(50);
    expect(result.parserDiagnostics[0]).toMatchObject({
      type: "INVALID_LOG_LINE",
      count: 250,
      firstLine: 2,
      lastLine: 251,
    });
    expect(result.parserDiagnostics[0]?.samples).toHaveLength(3);
    expect(
      (
        parser as unknown as {
          parsingDiagnostics: Array<{
            type: string;
            count: number;
            firstLine: number;
            lastLine: number;
            samples: string[];
          }>;
        }
      ).parsingDiagnostics[0],
    ).toMatchObject({
      type: "INVALID_LOG_LINE",
      count: 250,
      firstLine: 2,
      lastLine: 251,
    });
  });

  it("bounds distinct log issues while retaining overflow occurrence evidence", async () => {
    const fatalErrors = Array.from(
      { length: 250 },
      (_, index) =>
        `12:00:00.${String(index).padStart(3, "0")} (${index + 1})|FATAL_ERROR|failure-${index}-${"x".repeat(2_500)}`,
    );
    const result = await parseLog(fatalErrors.join("\n"), {
      includeRawLines: true,
    });
    const parser = result.parserResult as {
      logIssues: Array<{
        summary: string;
        description: string;
        occurrences: number;
      }>;
      logIssueOverflowCount: number;
    };

    expect(parser.logIssues).toHaveLength(200);
    expect(parser.logIssueOverflowCount).toBe(51);
    expect(result.logIssueOverflowCount).toBe(51);
    expect(
      parser.logIssues.every(
        (issue) =>
          issue.summary.length <= 500 && issue.description.length <= 2_000,
      ),
    ).toBe(true);
    expect(
      parser.logIssues.find(
        (issue) => issue.summary === "Additional log issues omitted",
      ),
    ).toMatchObject({ occurrences: 51 });

    const report = buildOfflineReport({
      source: {
        fileName: "many-errors.log",
        bytes: utf8ByteLength(fatalErrors.join("\n")),
      },
      parseResult: result,
      rawLogText: fatalErrors.join("\n"),
      limits: { errorItems: 10 },
    }) as unknown as {
      metadata: {
        parser: { logIssueOverflowCount: number };
        limits: { errorItems: number };
      };
      issues: unknown[];
      errors: { count: number; truncated: boolean; limit: number };
    };
    expect(report.metadata.parser.logIssueOverflowCount).toBe(51);
    expect(report.metadata.limits.errorItems).toBe(10);
    expect(report.issues).toHaveLength(10);
    expect(report.errors).toMatchObject({
      count: 450,
      truncated: true,
      limit: 10,
    });
  });

  it("retains the earliest error details without materializing every report item", () => {
    const parserResult = {
      children: Array.from({ length: 1_000 }, (_, index) => ({
        type: "FATAL_ERROR",
        timestamp: 1_000 - index,
        text: `failure-${1_000 - index}`,
        logLine: `raw failure ${1_000 - index}`,
        rawLineNumber: index + 1,
        children: [],
      })),
      logIssues: [],
      parsingErrors: [],
    };
    const report = buildInsightsReport({
      filePath: "descending-errors.log",
      fileBytes: 1_000,
      generatedAt: "2026-08-18T00:00:00.000Z",
      parseTimeMs: 1,
      parserResult,
      limits: { errorItems: 3 },
    }) as unknown as {
      errors: {
        count: number;
        truncated: boolean;
        items: Array<{ evidence: { timestampNs: number } }>;
      };
    };

    expect(report.errors.count).toBe(1_000);
    expect(report.errors.truncated).toBe(true);
    expect(
      report.errors.items.map((item) => item.evidence.timestampNs),
    ).toEqual([1, 2, 3]);
  });

  it("preserves over-depth events through the iterative safety fallback", async () => {
    const lines = ["12:00:00.000 (1)|EXECUTION_STARTED"];
    for (let index = 0; index < 505; index += 1) {
      lines.push(
        `12:00:00.001 (${index + 2})|METHOD_ENTRY|[${index + 1}]|01p000000000001|Depth${index}.run()`,
      );
    }
    for (let index = 504; index >= 0; index -= 1) {
      lines.push(
        `12:00:00.002 (${1010 - index})|METHOD_EXIT|[${index + 1}]|Depth${index}.run()`,
      );
    }
    lines.push("12:00:00.003 (1011)|EXECUTION_FINISHED");
    const result = await parseLog(lines.join("\n"));
    expect(
      result.normalizedTimeline.filter(
        (event) => event.type === "METHOD_ENTRY",
      ),
    ).toHaveLength(505);
    expect(
      result.normalizedTimeline.some(
        (event) => event.pairingStatus === "depth_limit",
      ),
    ).toBe(true);
    expect(
      result.issues.some((issue) => issue.summary === "Maximum-Nesting-Depth"),
    ).toBe(true);
    expect(
      result.normalizedTimeline.find(
        (event) => event.text === "Depth503.run()",
      ),
    ).toMatchObject({ pairingStatus: "complete", durationNs: 2 });
  });

  it("retains typed end evidence inside the depth-limited fallback", async () => {
    const depth = 501;
    const lines = ["12:00:00.000 (1)|EXECUTION_STARTED"];
    for (let index = 0; index < depth; index += 1) {
      lines.push(
        `12:00:00.001 (${index + 2})|METHOD_ENTRY|[${index + 1}]|01p000000000001|Depth${index}.run()`,
      );
    }
    lines.push(
      "12:00:00.002 (600)|SOQL_EXECUTE_BEGIN|[700]|Aggregations:0|SELECT Id FROM Account",
      "12:00:00.003 (601)|SOQL_EXECUTE_END|[700]|Rows:7",
    );
    for (let index = depth - 1; index >= 0; index -= 1) {
      lines.push(
        `12:00:00.004 (${1200 - index})|METHOD_EXIT|[${index + 1}]|Depth${index}.run()`,
      );
    }
    lines.push("12:00:00.005 (1201)|EXECUTION_FINISHED");

    const text = lines.join("\n");
    const parsed = await parseLog(text);
    const query = parsed.normalizedTimeline.find(
      (event) => event.type === "SOQL_EXECUTE_BEGIN",
    );
    expect(query).toMatchObject({
      pairingStatus: "complete",
      durationNs: 1,
      durationIsPartial: false,
    });

    const report = buildInsightsReport({
      filePath: "depth-limited-query.log",
      fileBytes: utf8ByteLength(text),
      generatedAt: "2026-08-18T00:00:00.000Z",
      parseTimeMs: parsed.parseTimeMs,
      parserResult: parsed.parserResult,
    }) as { database: { soql: Array<{ rows: number | null }> } };
    expect(report.database.soql[0]?.rows).toBe(7);
  });

  it("marks every open depth-limited frame as partial at EOF", async () => {
    const lines = ["12:00:00.000 (1)|EXECUTION_STARTED"];
    for (let index = 0; index < 501; index += 1) {
      lines.push(
        `12:00:00.001 (${index + 2})|METHOD_ENTRY|[${index + 1}]|01p000000000001|Depth${index}.run()`,
      );
    }

    const parsed = await parseLog(lines.join("\n"));
    const deepest = parsed.normalizedTimeline.find(
      (event) => event.text === "Depth500.run()",
    );
    expect(deepest).toMatchObject({
      pairingStatus: "depth_limit",
      durationIsPartial: true,
      durationNs: null,
    });
  });

  it("leaves ancestor exits available when the depth fallback unwinds", async () => {
    const lines = ["12:00:00.000 (1)|EXECUTION_STARTED"];
    for (let index = 0; index < 500; index += 1) {
      lines.push(
        `12:00:00.001 (${index + 2})|METHOD_ENTRY|[${index + 1}]|01p000000000001|Depth${index}.run()`,
      );
    }
    lines.push(
      "12:00:00.002 (600)|METHOD_EXIT|[1]|Depth0.run()",
      "12:00:00.003 (601)|EXECUTION_FINISHED",
    );

    const parsed = await parseLog(lines.join("\n"));
    const outerMethod = parsed.normalizedTimeline.find(
      (event) => event.text === "Depth0.run()",
    );
    const execution = parsed.normalizedTimeline.find(
      (event) => event.type === "EXECUTION_STARTED",
    );
    expect(outerMethod).toMatchObject({
      pairingStatus: "complete",
      durationNs: 598,
    });
    expect(execution).toMatchObject({
      pairingStatus: "complete",
      durationNs: 600,
    });
    expect(
      parsed.normalizedTimeline.filter((event) => event.type === "METHOD_EXIT"),
    ).toHaveLength(0);
    expect(
      parsed.normalizedTimeline.filter(
        (event) => event.type === "EXECUTION_FINISHED",
      ),
    ).toHaveLength(0);
  });

  it("unwinds missing inner frames to a matching fallback frame", async () => {
    const lines = ["12:00:00.000 (1)|EXECUTION_STARTED"];
    for (let index = 0; index < 502; index += 1) {
      lines.push(
        `12:00:00.001 (${index + 2})|METHOD_ENTRY|[${index + 1}]|01p000000000001|Depth${index}.run()`,
      );
    }
    for (let index = 499; index >= 0; index -= 1) {
      lines.push(
        `12:00:00.002 (${1199 - index})|METHOD_EXIT|[${index + 1}]|Depth${index}.run()`,
      );
    }
    lines.push("12:00:00.003 (1200)|EXECUTION_FINISHED");

    const parsed = await parseLog(lines.join("\n"));
    const byText = new Map(
      parsed.normalizedTimeline.map((event) => [event.text, event]),
    );
    expect(byText.get("Depth501.run()")).toMatchObject({
      pairingStatus: "missing_end",
      durationNs: null,
    });
    expect(byText.get("Depth500.run()")).toMatchObject({
      pairingStatus: "missing_end",
      durationNs: null,
    });
    expect(byText.get("Depth499.run()")).toMatchObject({
      pairingStatus: "depth_limit",
      durationNs: null,
    });
    expect(byText.get("Depth498.run()")).toMatchObject({
      pairingStatus: "complete",
      durationNs: 201,
    });
    expect(
      parsed.normalizedTimeline.some((event) => event.type === "METHOD_EXIT"),
    ).toBe(false);
  });

  it("normalizes deeply nested fallback trees without recursive traversal", async () => {
    const depth = 2_000;
    const lines = ["12:00:00.000 (1)|EXECUTION_STARTED"];
    for (let index = 0; index < depth; index += 1) {
      lines.push(
        `12:00:00.001 (${index + 2})|METHOD_ENTRY|[${index + 1}]|01p000000000001|Depth${index}.run()`,
      );
    }
    for (let index = depth - 1; index >= 0; index -= 1) {
      lines.push(
        `12:00:00.002 (${depth * 2 + 1 - index})|METHOD_EXIT|[${index + 1}]|Depth${index}.run()`,
      );
    }
    lines.push(`12:00:00.003 (${depth * 2 + 2})|EXECUTION_FINISHED`);

    const result = await parseLog(lines.join("\n"));
    const methods = result.normalizedTimeline.filter(
      (event) => event.type === "METHOD_ENTRY",
    );
    expect(methods).toHaveLength(depth);
    expect(methods.at(-1)?.parentId).toBe(methods.at(-2)?.id);
  });

  it("builds reports from deeply nested fallback trees without recursive flattening", async () => {
    const depth = 2_000;
    const lines = ["12:00:00.000 (1)|EXECUTION_STARTED"];
    for (let index = 0; index < depth; index += 1) {
      lines.push(
        `12:00:00.001 (${index + 2})|METHOD_ENTRY|[${index + 1}]|01p000000000001|Depth${index}.run()`,
      );
    }
    for (let index = depth - 1; index >= 0; index -= 1) {
      lines.push(
        `12:00:00.002 (${depth * 2 + 1 - index})|METHOD_EXIT|[${index + 1}]|Depth${index}.run()`,
      );
    }
    lines.push(`12:00:00.003 (${depth * 2 + 2})|EXECUTION_FINISHED`);
    const text = lines.join("\n");
    const parsed = await parseLog(text);

    expect(() =>
      buildInsightsReport({
        filePath: "deep.log",
        fileBytes: Buffer.byteLength(text),
        generatedAt: "2026-08-17T00:00:00.000Z",
        parseTimeMs: parsed.parseTimeMs,
        parserResult: parsed.parserResult,
      }),
    ).not.toThrow();
  });

  it("preserves variable values containing pipes and record provenance", async () => {
    const pipeHeavyName = `${"A|".repeat(100)}B`;
    const text = [
      "12:00:00.000 (1)|EXECUTION_STARTED",
      "12:00:00.001 (2)|VARIABLE_SCOPE_BEGIN|[5]|account|Account|true|false",
      `12:00:00.002 (3)|VARIABLE_ASSIGNMENT|[5]|account|${JSON.stringify({ Id: "001000000000001AAA", Name: pipeHeavyName })}|0x1`,
      "12:00:00.003 (4)|EXECUTION_FINISHED",
    ].join("\n");
    const parsed = await parseLog(text);
    const report = buildInsightsReport({
      filePath: "variables.log",
      fileBytes: Buffer.byteLength(text),
      generatedAt: "2026-08-17T00:00:00.000Z",
      parseTimeMs: parsed.parseTimeMs,
      parserResult: parsed.parserResult,
    }) as {
      recordGraph: Array<{
        records: Array<{
          fields: Array<{ field: string; value: unknown }>;
          provenance: { variableName: string; lineNumber: number | null };
        }>;
      }>;
    };

    expect(report.recordGraph[0]?.records[0]?.fields).toContainEqual({
      field: "Name",
      value: pipeHeavyName,
    });
    expect(report.recordGraph[0]?.records[0]?.provenance).toMatchObject({
      variableName: "account",
      lineNumber: 3,
    });
  });

  it("reports asynchronous correlation clues without claiming the child log is present", async () => {
    const text = [
      "12:00:00.000 (1)|EXECUTION_STARTED",
      "12:00:00.001 (2)|QUEUEABLE_BEGIN|[4]|MyQueueable|707000000000001AAA",
      "12:00:00.002 (3)|QUEUEABLE_END|[4]",
      "12:00:00.003 (4)|EXECUTION_FINISHED",
    ].join("\n");
    const parsed = await parseLog(text);
    const report = buildInsightsReport({
      filePath: "async.log",
      fileBytes: text.length,
      generatedAt: "2026-08-01T00:00:00.000Z",
      parseTimeMs: parsed.parseTimeMs,
      parserResult: parsed.parserResult,
    }) as { asynchronousContinuations: Array<Record<string, unknown>> };
    expect(report.asynchronousContinuations[0]).toMatchObject({
      kind: "QUEUEABLE_BEGIN",
      jobIds: ["707000000000001AAA"],
      relationship: "related",
    });
    expect(report.asynchronousContinuations[0]?.guidance).toMatch(
      /separate debug log/,
    );
  });

  it("retains level-specific user debug records and includes them in reports", async () => {
    const levels = [
      "FINER",
      "FINEST",
      "FINE",
      "DEBUG",
      "INFO",
      "WARN",
      "ERROR",
    ];
    const text = [
      "12:00:00.000 (1)|EXECUTION_STARTED",
      ...levels.map(
        (level, index) =>
          `12:00:00.00${index + 1} (${index + 2})|USER_DEBUG_${level}|[${index + 10}]|message-${level}`,
      ),
      "wrapped warning detail",
      "12:00:00.009 (10)|EXECUTION_FINISHED",
    ].join("\n");
    const parsed = await parseLog(text);
    const typedDebugEvents = parsed.normalizedTimeline.filter((event) =>
      event.type.startsWith("USER_DEBUG_"),
    );

    expect(typedDebugEvents).toHaveLength(levels.length);
    expect(
      typedDebugEvents.every((event) => event.classification === "supported"),
    ).toBe(true);
    expect(typedDebugEvents.at(-1)?.text).toBe(
      "message-ERROR\nwrapped warning detail",
    );
    expect(parsed.parserDiagnostics).toEqual([]);

    const report = buildInsightsReport({
      filePath: "debug-levels.log",
      fileBytes: text.length,
      generatedAt: "2026-08-17T00:00:00.000Z",
      parseTimeMs: parsed.parseTimeMs,
      parserResult: parsed.parserResult,
    }) as {
      trace: {
        debugEvents: Array<{
          eventType: string;
          level: string | null;
          message: string;
        }>;
      };
    };
    expect(report.trace.debugEvents).toHaveLength(levels.length);
    expect(report.trace.debugEvents.map((event) => event.level)).toEqual(
      levels,
    );
    expect(report.trace.debugEvents.at(-1)).toMatchObject({
      eventType: "USER_DEBUG_ERROR",
      message: "message-ERROR\nwrapped warning detail",
    });
  });

  it("retains bracketed and unbracketed DataWeave debug output", async () => {
    const text = [
      "12:00:00.000 (1)|EXECUTION_STARTED",
      "12:00:00.001 (2)|DATAWEAVE_USER_DEBUG|[18]|transform result|A|B",
      "wrapped transform detail",
      "12:00:00.002 (3)|DATAWEAVE_USER_DEBUG|standalone result|C|D",
      "12:00:00.003 (4)|EXECUTION_FINISHED",
    ].join("\n");
    const parsed = await parseLog(text);
    const events = parsed.normalizedTimeline.filter(
      (event) => event.type === "DATAWEAVE_USER_DEBUG",
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      lineNumber: 18,
      text: "transform result | A | B\nwrapped transform detail",
      classification: "supported",
    });
    expect(events[1]).toMatchObject({
      lineNumber: null,
      text: "standalone result | C | D",
      classification: "supported",
    });
    expect(parsed.parserDiagnostics).toEqual([]);

    const report = buildInsightsReport({
      filePath: "dataweave-debug.log",
      fileBytes: text.length,
      generatedAt: "2026-08-17T00:00:00.000Z",
      parseTimeMs: parsed.parseTimeMs,
      parserResult: parsed.parserResult,
    }) as {
      trace: {
        debugEvents: Array<{
          eventType: string;
          level: string | null;
          message: string;
        }>;
      };
    };
    expect(report.trace.debugEvents).toHaveLength(2);
    expect(report.trace.debugEvents[0]).toMatchObject({
      eventType: "DATAWEAVE_USER_DEBUG",
      level: null,
      message: "transform result | A | B\nwrapped transform detail",
    });
  });

  it("continues after a malformed recognized event and preserves its raw evidence", async () => {
    const result = await parseLog(
      [
        "12:00:00.000 (1)|EXECUTION_STARTED",
        "12:00:00.001 (2)|STATEMENT_EXECUTE|not-a-line-number",
        "12:00:00.002 (3)|USER_DEBUG|[9]|DEBUG|continued",
        "12:00:00.003 (4)|EXECUTION_FINISHED",
      ].join("\n"),
      { includeRawLines: true },
    );
    expect(
      result.normalizedTimeline.some(
        (event) => event.type === "STATEMENT_EXECUTE",
      ),
    ).toBe(true);
    expect(
      result.normalizedTimeline.some((event) => event.type === "USER_DEBUG"),
    ).toBe(true);
    expect(
      result.normalizedTimeline.find(
        (event) => event.type === "STATEMENT_EXECUTE",
      ),
    ).toMatchObject({ timestampNs: 2, timestampIsInferred: false });
    expect(
      (result.parserResult as { parsingErrors: string[] }).parsingErrors[0],
    ).toMatch(/Malformed STATEMENT_EXECUTE/);
    expect(result.parserDiagnostics).toEqual([
      expect.objectContaining({
        type: "MALFORMED_EVENT",
        count: 1,
        firstLine: 2,
        lastLine: 2,
        samples: ["12:00:00.001 (2)|STATEMENT_EXECUTE|not-a-line-number"],
      }),
    ]);
  });

  it("keeps SOQL aggregation evidence exact-or-unknown without losing the query", async () => {
    const cases = [
      ["Aggregations:0|", 0],
      ["Aggregations:2|", 2],
      ["", null],
      ["Aggregations:|", null],
      ["Aggregations:not-a-number|", null],
      ["Aggregations:9007199254740992|", null],
    ] as const;

    for (const [prefix, expectedAggregations] of cases) {
      const result = await parseLog(
        [
          "12:00:00.000 (1)|EXECUTION_STARTED",
          `12:00:00.001 (2)|SOQL_EXECUTE_BEGIN|[8]|${prefix}SELECT Id FROM Account`,
          "12:00:00.002 (3)|SOQL_EXECUTE_END|[8]|Rows:1",
          "12:00:00.003 (4)|EXECUTION_FINISHED",
        ].join("\n"),
      );
      const report = buildInsightsReport({
        filePath: "aggregation-evidence.log",
        fileBytes: 0,
        generatedAt: "2026-08-17T00:00:00.000Z",
        parseTimeMs: result.parseTimeMs,
        parserResult: result.parserResult,
      }) as {
        database: {
          soql: Array<{ query: string; aggregations: number | null }>;
        };
      };
      const query = report.database.soql[0];

      expect(query).toMatchObject({
        query: "SELECT Id FROM Account",
        aggregations: expectedAggregations,
      });
    }
  });

  it("does not turn malformed database row fields into observed zeroes", async () => {
    const text = [
      "12:00:00.000 (1)|EXECUTION_STARTED",
      "12:00:00.001 (2)|SOQL_EXECUTE_BEGIN|[8]|Aggregations:0|SELECT Id FROM Account",
      "12:00:00.002 (3)|SOQL_EXECUTE_END|[8]|Rows:not-a-number",
      "12:00:00.003 (4)|SOSL_EXECUTE_BEGIN|[9]|FIND {Acme} RETURNING Account(Id)",
      "12:00:00.004 (5)|SOSL_EXECUTE_END|[9]|Rows:9007199254740992",
      "12:00:00.005 (6)|DML_BEGIN|[10]|Op:Insert|Type:Account|Rows:not-a-number",
      "12:00:00.006 (7)|DML_END|[10]",
      "12:00:00.007 (8)|EXECUTION_FINISHED",
    ].join("\n");
    const parsed = await parseLog(text);
    const report = buildInsightsReport({
      filePath: "malformed-rows.log",
      fileBytes: utf8ByteLength(text),
      generatedAt: "2026-08-17T00:00:00.000Z",
      parseTimeMs: parsed.parseTimeMs,
      parserResult: parsed.parserResult,
    }) as {
      database: {
        soql: Array<{ rows: number | null }>;
        sosl: Array<{ rows: number | null }>;
        dml: Array<{ rows: number | null }>;
      };
      errors: { items: Array<{ type: string }> };
    };

    expect(report.database.soql[0]?.rows).toBeNull();
    expect(report.database.sosl[0]?.rows).toBeNull();
    expect(report.database.dml[0]?.rows).toBeNull();
    expect(report.errors.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "EMPTY_QUERY_WARNING" }),
        expect.objectContaining({ type: "NO_OP_DML_WARNING" }),
      ]),
    );
  });

  it("isolates malformed timestamps without aborting later log records", async () => {
    const result = await parseLog(
      [
        "12:00:00.000 (1)|EXECUTION_STARTED",
        "12:00:00.001 (bad)|METHOD_ENTRY|[1]|01p000000000001AAA|Example.run()",
        "12:00:00.002 (also-bad)|FUTURE_PLATFORM_EVENT|payload|retained",
        "12:00:00.003 (4)|USER_DEBUG|[9]|DEBUG|continued",
        "12:00:00.004 (5)|EXECUTION_FINISHED",
      ].join("\n"),
      { includeRawLines: true },
    );

    const malformedKnown = result.normalizedTimeline.find(
      (event) => event.type === "METHOD_ENTRY",
    );
    const malformedUnknown = result.normalizedTimeline.find(
      (event) => event.type === "FUTURE_PLATFORM_EVENT",
    );
    const laterEvent = result.normalizedTimeline.find(
      (event) => event.type === "USER_DEBUG",
    );

    expect(malformedKnown).toMatchObject({
      timestampNs: 1,
      timestampIsInferred: true,
      classification: "unsupported",
      evidence: expect.objectContaining({ startLine: 2, endLine: 2 }),
    });
    expect(malformedUnknown).toMatchObject({
      timestampNs: 1,
      timestampIsInferred: true,
      text: "payload|retained",
      classification: "unsupported",
      evidence: expect.objectContaining({ startLine: 3, endLine: 3 }),
    });
    expect(laterEvent).toMatchObject({
      timestampNs: 4,
      timestampIsInferred: false,
      text: "DEBUG | continued",
      evidence: expect.objectContaining({ startLine: 4, endLine: 4 }),
    });
    expect(result.parserDiagnostics).toEqual([
      expect.objectContaining({
        type: "MALFORMED_EVENT",
        count: 2,
        firstLine: 2,
        lastLine: 3,
        samples: [
          "12:00:00.001 (bad)|METHOD_ENTRY|[1]|01p000000000001AAA|Example.run()",
          "12:00:00.002 (also-bad)|FUTURE_PLATFORM_EVENT|payload|retained",
        ],
      }),
    ]);

    const report = buildOfflineReport({
      source: { fileName: "malformed-timestamp.log", bytes: 0 },
      parseResult: result,
    }) as any;
    expect(
      report.timeline.find(
        (event: { type: string }) => event.type === "METHOD_ENTRY",
      ),
    ).toMatchObject({ timestampNs: 1, timestampIsInferred: true });
  });

  it("enforces the multiline event text cap and reports truncation", async () => {
    const oversizedContinuation = "x".repeat(110_000);
    const result = await parseLog(
      [
        "12:00:00.000 (1)|EXECUTION_STARTED",
        "12:00:00.001 (2)|USER_DEBUG|[9]|DEBUG|start",
        oversizedContinuation,
        "12:00:00.002 (3)|EXECUTION_FINISHED",
      ].join("\n"),
    );
    const userDebug = result.normalizedTimeline.find(
      (event) => event.type === "USER_DEBUG",
    );
    expect(userDebug?.text).toHaveLength(100_000);
    expect(
      result.issues.find((issue) => issue.summary === "Text-Truncation")
        ?.description,
    ).toContain("log line 2");
  });
});
