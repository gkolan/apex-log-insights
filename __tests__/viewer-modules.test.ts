import { describe, it, expect } from "vitest";

import { normalizeReport } from "../viewer/modules/normalize-report.js";
import {
  addRawLogLineNumber,
  buildRawLineMap,
} from "../viewer/modules/normalize-evidence-mapping.js";
import { evidenceButton } from "../viewer/modules/shared-evidence.js";
import { renderData } from "../viewer/modules/render-data.js";
import { renderExecution } from "../viewer/modules/render-execution.js";
import { renderDiagnostics } from "../viewer/modules/render-diagnostics.js";
import { renderEvidence } from "../viewer/modules/render-evidence.js";
import {
  maskName,
  redactLine,
  redactLines,
  DEFAULT_REDACTION_SETTINGS,
} from "../viewer/modules/redact-pii.js";
import {
  compareReports,
  summarizeReportForComparison,
} from "../viewer/modules/compare-reports.js";

it("compares candidate metrics against a baseline without subjective scoring", () => {
  const baseline = {
    context: { transaction: { durationMs: 100, cpuTimeMs: 40 } },
    database: { soql: [{ rows: 2 }], dml: [{ rows: 1 }], callouts: [] },
    metadata: { logCompleteness: { status: "complete", reasons: [] } },
    issues: [{ severity: "warning" }],
  };
  const candidate = {
    context: { transaction: { durationMs: 75, cpuTimeMs: 50 } },
    database: {
      soql: [{ rows: 2 }, { rows: 4 }],
      dml: [],
      callouts: [{ id: "callout-1" }],
    },
    metadata: {
      logCompleteness: {
        status: "incomplete",
        reasons: ["EXECUTION_FINISHED was not observed."],
      },
    },
    issues: [{ severity: "error" }],
  };

  const comparison = compareReports(baseline, candidate, {
    baseline: "before.log",
    candidate: "after.log",
  });

  expect(comparison.baseline.fileName).toBe("before.log");
  expect(comparison.candidate.fileName).toBe("after.log");
  expect(
    comparison.metrics.find((metric) => metric.key === "durationMs")?.delta,
  ).toBe(-25);
  expect(
    comparison.metrics.find((metric) => metric.key === "cpuTimeMs")?.delta,
  ).toBe(10);
  expect(
    comparison.metrics.find((metric) => metric.key === "soqlRows")?.delta,
  ).toBe(4);
  expect(
    comparison.metrics.find((metric) => metric.key === "errors")?.delta,
  ).toBe(1);
  expect(
    comparison.metrics.find((metric) => metric.key === "callouts")?.delta,
  ).toBe(1);
  expect(comparison.candidate.evidence.status).toBe("incomplete");
  expect(comparison).not.toHaveProperty("winner");
});

it("preserves unavailable comparison metrics instead of treating them as zero", () => {
  const summary = summarizeReportForComparison({
    context: { transaction: {} },
  });
  expect(summary.metrics.durationMs).toBeNull();
  expect(summary.metrics.cpuTimeMs).toBeNull();
  expect(summary.metrics.heapBytes).toBeNull();
});

it("keeps log-line navigation separate from Apex source-line context", () => {
  const repeated =
    "12:00:00.001 (2)|SOQL_EXECUTE_BEGIN|[87]|SELECT Id FROM Account";
  const rawLineMap = buildRawLineMap([
    { number: 1, text: repeated },
    { number: 2, text: "different" },
    { number: 3, text: repeated },
  ]);
  const evidence = addRawLogLineNumber(
    { lineNumber: 3, sourceLineNumber: 87, raw: repeated },
    rawLineMap,
  );
  const markup = evidenceButton({ evidence });

  expect(evidence.rawLogLineNumber).toBe(3);
  expect(markup).toContain("Log line 3");
  expect(markup).toContain("Apex source line 87");
  expect(markup).toContain("log%3A3");
  expect(markup).not.toContain("log%3A87");
});

it("does not create a log jump from an unverified source line", () => {
  const markup = evidenceButton({
    evidence: { sourceLineNumber: 87 },
  });
  expect(markup).toContain("Apex source line 87");
  expect(markup).not.toContain("href=");
});

function countRenderedLines(html: string): number {
  return (html.match(/class="rawLine(?:\s|")/g) || []).length;
}

it("normalizeReport derives summary status from issues without overview", () => {
  const viewModel = normalizeReport({
    report: {
      context: {
        transaction: {
          rootCodeUnit: "QueueableJob.execute",
        },
      },
      errors: {
        count: 2,
        items: [
          {
            message: "Parser failed to decode event frame",
            severity: "error",
            evidence: { lineNumber: 12 },
          },
          {
            message: "Explicit warning",
            severity: "warning",
            evidence: { lineNumber: 34 },
          },
        ],
      },
    },
    rawLines: [],
  });

  expect(viewModel.summary.status.outcome).toBe("error");
  expect(viewModel.summary.status.errorCount).toBe(1);
  expect(viewModel.summary.status.warningCount).toBe(1);
  expect(viewModel.diagnostics.issues[0]?.severity).toBe("error");
  expect(viewModel.diagnostics.issues[1]?.severity).toBe("warn");
});

it("normalizeReport tolerates issue entries with null descriptions", () => {
  const viewModel = normalizeReport({
    report: {
      errors: {
        count: 1,
        items: [
          {
            type: "NO_OP_DML_WARNING",
            summary: "List<Opportunity>: wrote 0 rows",
            description: null,
            severity: "warn",
            evidence: { lineNumber: 79 },
          },
        ],
      },
    },
    rawLines: [],
  });

  expect(viewModel.diagnostics.issues.length).toBe(1);
  expect(viewModel.diagnostics.issues[0]?.summary).toBe(
    "List<Opportunity>: wrote 0 rows",
  );
  expect(viewModel.diagnostics.issues[0]?.detail).toBe(null);
  expect(viewModel.diagnostics.issues[0]?.severity).toBe("warn");
});

it("normalizeReport uses execution.blocks and phases from current schema", () => {
  const viewModel = normalizeReport({
    report: {
      execution: {
        blocks: [
          {
            id: "block-1",
            name: "Queueable Root",
            type: "queueable",
            timing: { durationMs: 123 },
            evidence: { raw: "METHOD_ENTRY|Queueable Root" },
          },
          {
            id: "block-2",
            name: "Child Unit",
            parentId: "block-1",
            timing: { durationMs: 12 },
          },
        ],
      },
      phases: [
        {
          id: "phase-1",
          label: "Post Commit",
          warnings: ["Phase was inferred from available evidence"],
        },
      ],
    },
    rawLines: [{ number: 1, text: "METHOD_ENTRY|Queueable Root" }],
  });

  expect(viewModel.execution.chain.length).toBe(1);
  expect(viewModel.execution.chain[0]?.id).toBe("block-1");
  expect(viewModel.execution.chain[0]?.label).toBe("Queueable Root");
  expect(viewModel.execution.chain[0]?.durationMs).toBe(123);
  expect(viewModel.execution.chain[0]?.evidence.raw).toBe(
    "METHOD_ENTRY|Queueable Root",
  );
  expect(viewModel.execution.chain[0]?.evidence.lineNumber).toBeUndefined();
  expect(viewModel.execution.tree.map((item) => item.depth)).toEqual([0, 1]);
  expect(renderExecution(viewModel)).toMatch(/Code-Unit Waterfall/);
  expect(renderExecution(viewModel)).toMatch(/Child Unit/);
  expect(viewModel.execution.phases.length).toBe(1);
  expect(viewModel.execution.phases[0]?.name).toBe("Post Commit");
  expect(viewModel.diagnostics.parserWarnings).toEqual([
    {
      phase: "phase-1",
      text: "Phase was inferred from available evidence",
    },
  ]);
});

it("renderEvidence pages large logs without losing traversal or lines:all", () => {
  const rawLines = Array.from({ length: 805 }, (_, index) => ({
    number: index + 1,
    text: `Needle ${index + 1}`,
  }));
  const report = {
    evidence: {
      rawLines,
      lookup: [],
    },
  };

  const defaultHtml = renderEvidence(report, { query: "" });
  const explicitAllHtml = renderEvidence(report, { query: "lines:all" });
  const searchHtml = renderEvidence(report, { query: "needle" });
  const secondPageHtml = renderEvidence(report, {
    query: "lines:all",
    offset: 500,
  });

  expect(countRenderedLines(defaultHtml)).toBe(500);
  expect(countRenderedLines(explicitAllHtml)).toBe(500);
  expect(countRenderedLines(searchHtml)).toBe(500);
  expect(countRenderedLines(secondPageHtml)).toBe(305);

  expect(explicitAllHtml).toMatch(/1-500 of 805 matching line\(s\)/);
  expect(explicitAllHtml).toMatch(/Next 500/);
  expect(secondPageHtml).toMatch(/501-805 of 805 matching line\(s\)/);
  expect(secondPageHtml).toMatch(/Previous 500/);
});

it("renderEvidence supports regex and case-sensitive search modes", () => {
  const report = {
    evidence: {
      rawLines: [
        { number: 1, text: "AccountTrigger fired" },
        { number: 2, text: "account trigger skipped" },
        { number: 3, text: "ContactTrigger fired" },
      ],
      lookup: [],
      index: [],
    },
  };

  const regexHtml = renderEvidence(report, {
    query: "Account.*fired",
    regex: true,
    caseSensitive: true,
  });
  const caseHtml = renderEvidence(report, {
    query: "AccountTrigger",
    regex: false,
    caseSensitive: true,
  });
  const insensitiveHtml = renderEvidence(report, {
    query: "account",
    regex: false,
    caseSensitive: false,
  });

  expect(regexHtml).toMatch(/1-1 of 1 matching line\(s\)/);
  expect(caseHtml).toMatch(/1-1 of 1 matching line\(s\)/);
  expect(insensitiveHtml).toMatch(/1-2 of 2 matching line\(s\)/);
  expect(regexHtml).toMatch(/Regex/);
  expect(regexHtml).toMatch(/Case-sensitive/);
});

it("renderEvidence surfaces structured evidence-index pointers", () => {
  const viewModel = normalizeReport({
    report: {
      evidenceIndex: {
        phases: [
          {
            id: "phase-1",
            startLine: 42,
            endLine: 47,
            confidence: "direct",
          },
        ],
      },
    },
    rawLines: [
      { number: 29, text: "METHOD_ENTRY|Root.execute()" },
      { number: 42, text: "VALIDATION_RULE|Rule" },
    ],
  });

  const html = renderEvidence(viewModel, { query: "" });

  expect(html).toMatch(/Structured Index/);
  expect(html).toMatch(/Phase/);
});

it("normalizeReport surfaces richer parser-backed diagnostics and execution details", () => {
  const viewModel = normalizeReport({
    report: {
      phases: [
        {
          id: "phase-1",
          name: "Validation Rules",
          status: "observed",
          inputs: {
            executionType: "ApexTrigger",
            rootCodeUnit:
              "AccountTrigger on Account trigger event BeforeUpdate",
          },
          outputs: {
            observedEventCount: 3,
            soqlCount: 1,
            dmlCount: 0,
          },
          warnings: ["Observed from direct events"],
          evidence: {
            startLine: 42,
            endLine: 47,
          },
          events: [{ id: "evt-1" }],
        },
      ],
      governorBurnRate: {
        trajectory: [
          { timestampNs: 1, namespace: "default", cpuUsed: 100 },
          { timestampNs: 2, namespace: "default", cpuUsed: 400 },
        ],
        burnRates: [
          {
            limitName: "cpuTime",
            used: 8900,
            max: 10000,
            pctUsed: 89,
            status: "critical",
            burnRatePerSec: 1200,
          },
        ],
        phaseHeadroom: [
          {
            phaseId: "phase-1",
            phaseLabel: "Validation Rules",
            cpuPctAfter: 89,
            soqlPctAfter: 12,
            dmlPctAfter: 0,
            phasesRemaining: 4,
          },
        ],
      },
      database: {
        soql: [
          {
            id: "soql-1",
            query: "SELECT Id FROM Account",
            rows: 2,
            durationMs: 12.5,
            explain: {
              leadingOperationType: "Index",
              cardinality: 2,
            },
            evidence: { lineNumber: 41 },
          },
        ],
        callouts: [
          {
            id: "callout-1",
            endpoint: "https://api.slack.com/v1/messages",
            host: "api.slack.com",
            method: "POST",
            durationMs: 88.4,
            evidence: { lineNumber: 77 },
          },
        ],
      },
      trace: {
        flowBlocks: [
          {
            eventId: "flow-1",
            label: "Flow: Account_After_Save",
            startNs: 1,
            endNs: 2_000_001,
            totals: { eventCount: 2, errorCount: 0 },
            steps: [{ type: "FLOW_START_INTERVIEW_BEGIN", lineNumber: 44 }],
          },
        ],
        validationBlocks: [
          {
            eventId: "phase-1",
            label: "Validation Rules",
            rules: [
              { ruleName: "Check_CompanyId_Value", outcome: "FAIL" },
              { ruleName: "OtherRule", outcome: "PASS" },
            ],
          },
        ],
        debugEvents: [
          {
            id: "debug-1",
            namespace: "default",
            message: "First debug message",
            lineNumber: 150,
            evidence: "USER_DEBUG|First debug message",
          },
        ],
      },
      debugLevelQuality: {
        overallQuality: "low",
        warnings: [
          {
            category: "APEX_PROFILING",
            currentLevel: "NONE",
            recommendation: "FINE",
            impact: "Profiling hotspots may be incomplete.",
          },
        ],
      },
      heapAnalysis: {
        peakCumulativeBytes: 2048,
        allocationCount: 7,
        deallocationCount: 2,
        netAllocatedBytes: 1024,
        watermarkSamples: [
          { timestampNs: 1, cumulativeBytes: 256 },
          { timestampNs: 2, cumulativeBytes: 2048 },
        ],
        hotspotsByLine: [
          { lineNumber: 9, count: 2, totalBytes: 512, namespace: "default" },
        ],
      },
      recordGraph: [
        {
          sObjectType: "Account",
          keyPrefix: "001",
          recordCount: 1,
          records: [
            {
              id: "001000000000001AAA",
              fields: [{ name: "Name" }],
              relationships: [],
            },
          ],
        },
      ],
      cpuAttribution: {
        byType: {
          method: { durationMs: 42.5, count: 3 },
          custom: { durationMs: 12.25, count: 1 },
        },
        byNamespace: {
          default: {
            selfDurationMs: 18.5,
            totalDurationMs: 50.75,
            spanCount: 4,
          },
          slackv2: { selfDurationMs: 3.5, totalDurationMs: 9.25, spanCount: 1 },
        },
      },
      systemModeTransitions: [
        { lineNumber: 99, entering: true, isSystemMode: true },
      ],
      triggerCascade: [
        {
          id: "trig-1",
          label: "AccountTrigger",
          depth: 0,
          durationMs: 12,
          children: [{ id: "trig-2" }],
        },
      ],
      managedPackageImpact: [
        {
          namespace: "slackv2",
          totalDurationMs: 144,
          soqlCount: 3,
          dmlCount: 1,
          pctOfTotalDuration: 22,
        },
      ],
      mixedDmlAnalysis: {
        detected: true,
        setupObjects: ["User"],
        nonSetupObjects: ["Account"],
        evidence: [{ lineNumber: 120, timestampNs: 1 }],
      },
      recursiveTriggerAnalysis: {
        detected: true,
        recursiveTriggers: [
          {
            triggerName: "AccountTrigger",
            count: 3,
            rawLogLineTexts: ["METHOD_ENTRY|AccountTrigger"],
          },
        ],
      },
    },
    rawLines: [
      { number: 1, text: "METHOD_ENTRY|AccountTrigger" },
      { number: 2, text: "USER_DEBUG|First debug message" },
    ],
  });

  expect(viewModel.data.limitHealth[0]?.limitKey).toBe("cpuTimeMs");
  expect(viewModel.data.limitHealth[0]?.status).toBe("critical");
  expect(viewModel.data.soql[0]?.explain?.leadingOperationType).toBe("Index");
  expect(viewModel.data.callouts[0]?.method).toBe("POST");
  expect(viewModel.data.callouts[0]?.host).toBe("api.slack.com");
  expect(viewModel.data.phaseHeadroom[0]?.label).toBe("Validation Rules");
  expect(viewModel.data.validationBlocks[0]?.failedRules[0]?.name).toBe(
    "Check_CompanyId_Value",
  );
  expect(viewModel.data.calloutTotalCount).toBe(1);
  expect(viewModel.data.namedCredentialTotalCount).toBe(0);
  expect(viewModel.data.validationBlockTotalCount).toBe(1);
  expect(viewModel.data.phaseHeadroomTotalCount).toBe(1);
  expect(viewModel.data.limitTrajectory).toHaveLength(2);
  expect(viewModel.data.recordTotalCount).toBe(1);
  expect(viewModel.data.automation[0]?.kind).toBe("flow");
  expect(viewModel.execution.phaseDetails[0]?.startLine).toBe(42);
  expect(viewModel.execution.phaseDetails[0]?.executionType).toBe(
    "ApexTrigger",
  );
  expect(viewModel.execution.phaseDetails[0]?.rootCodeUnit).toBe(
    "AccountTrigger on Account trigger event BeforeUpdate",
  );
  expect(viewModel.execution.triggerCascade[0]?.childCount).toBe(1);
  expect(viewModel.execution.managedImpact[0]?.namespace).toBe("slackv2");
  expect(viewModel.execution.timelineSummary.totalEvents).toBe(0);
  expect(viewModel.data.soqlPatterns.length).toBe(0);
  expect(viewModel.data.soqlTotalCount).toBe(1);
  expect(viewModel.data.dmlTotalCount).toBe(0);
  expect(viewModel.diagnostics.debugWarnings[0]?.category).toBe(
    "APEX_PROFILING",
  );
  expect(viewModel.diagnostics.debugWarningCountTotal).toBe(1);
  expect(viewModel.diagnostics.debugEvents.length).toBe(1);
  expect(viewModel.diagnostics.debugEventCountTotal).toBe(1);
  expect(viewModel.diagnostics.cpuBreakdown.byType[0]?.label).toBe("method");
  expect(viewModel.diagnostics.cpuBreakdown.byNamespace[0]?.namespace).toBe(
    "default",
  );
  expect(viewModel.diagnostics.heapSummary?.peakCumulativeBytes).toBe(2048);
  expect(viewModel.diagnostics.heapSummary?.watermarkSamples).toHaveLength(2);
  expect(viewModel.diagnostics.systemModeTimeline[0]?.state).toBe("system");
  expect(viewModel.diagnostics.issueCountTotal).toBe(0);
  expect(viewModel.diagnostics.structuralWarnings.length).toBe(2);
  expect(viewModel.diagnostics.parserWarningCountTotal).toBe(1);

  expect(renderData(viewModel)).toMatch(/Validation and Phase Headroom/);
  expect(renderData(viewModel)).toMatch(/External Calls/);
  expect(renderData(viewModel)).toMatch(/Explain: Index &middot; 2 rows/);
  expect(renderData(viewModel)).toMatch(/api\.slack\.com/);
  expect(renderData(viewModel)).toMatch(/Check_CompanyId_Value/);
  expect(renderData(viewModel)).toMatch(/Resource Trajectory/);
  expect(renderData(viewModel)).toMatch(/Account_After_Save/);
  expect(renderData(viewModel)).toMatch(/001000000000001AAA/);
  expect(renderExecution(viewModel)).toMatch(/Trigger Cascade/);
  expect(renderExecution(viewModel)).toMatch(/Request ApexTrigger/);
  expect(renderExecution(viewModel)).toMatch(
    /Root AccountTrigger on Account trigger event BeforeUpdate/,
  );
  expect(renderExecution(viewModel)).toMatch(/Managed Impact/);
  expect(renderDiagnostics(viewModel)).toMatch(/APEX_PROFILING/);
  expect(renderDiagnostics(viewModel)).toMatch(/Structural Warnings/);
  expect(renderDiagnostics(viewModel)).toMatch(/Mixed DML/);
  expect(renderDiagnostics(viewModel)).toMatch(/Recursive Trigger/);
  expect(renderDiagnostics(viewModel)).toMatch(/CPU Attribution/);
  expect(renderDiagnostics(viewModel)).toMatch(/Debug Output/);
  expect(renderDiagnostics(viewModel)).toMatch(/First debug message/);
  expect(renderDiagnostics(viewModel)).toMatch(/By Type/);
  expect(renderDiagnostics(viewModel)).toMatch(/slackv2/);
  expect(renderDiagnostics(viewModel)).toMatch(/Peak 2\.0 KB/);
  expect(renderDiagnostics(viewModel)).toMatch(
    /Heap watermark over the transaction/,
  );
});

it("normalizeReport summarizes the canonical timeline for execution view", () => {
  const viewModel = normalizeReport({
    report: {
      timeline: [
        { type: "EXECUTION_STARTED", namespace: "default", lineNumber: 3 },
        { type: "METHOD_ENTRY", namespace: "default", lineNumber: 29 },
        { type: "METHOD_ENTRY", namespace: "pkg1", lineNumber: 35 },
        { type: "METHOD_EXIT", namespace: "pkg1", lineNumber: 40 },
      ],
    },
    rawLines: [],
  });

  expect(viewModel.execution.timelineSummary.totalEvents).toBe(4);
  expect(viewModel.execution.timelineSummary.namespaceCount).toBe(2);
  expect(viewModel.execution.timelineSummary.firstEvent?.type).toBe(
    "EXECUTION_STARTED",
  );
  expect(viewModel.execution.timelineSummary.lastEvent?.type).toBe(
    "METHOD_EXIT",
  );
  expect(viewModel.execution.timelineSummary.topTypes[0]?.type).toBe(
    "METHOD_ENTRY",
  );

  const html = renderExecution(viewModel);
  expect(html).toMatch(/Timeline Snapshot/);
  expect(html).toMatch(/4 event\(s\) across 2 namespace\(s\)/);
  expect(html).toMatch(/METHOD_ENTRY/);
});

it("normalizeReport surfaces loop-suspect SOQL patterns in the data view", () => {
  const viewModel = normalizeReport({
    report: {
      database: {
        soqlPatterns: [
          {
            pattern: "select id from account where id = '?'",
            targetObject: "Account",
            executionCount: 14,
            totalRows: 14,
            avgDurationMs: 9,
            isLoopSuspect: true,
            loopEvidence: "Pattern executed 14 times across different spans",
          },
          {
            pattern: "select id from contact where id = '?'",
            targetObject: "Contact",
            executionCount: 2,
            totalRows: 2,
            avgDurationMs: 1,
            isLoopSuspect: false,
          },
        ],
      },
    },
    rawLines: [],
  });

  expect(viewModel.data.soqlPatterns.length).toBe(2);
  expect(viewModel.data.soqlPatterns[0]?.targetObject).toBe("Account");
  expect(viewModel.data.soqlPatterns[0]?.executionCount).toBe(14);
  expect(viewModel.data.soqlPatterns[0]?.isLoopSuspect).toBe(true);
  expect(viewModel.data.soqlPatterns[1]?.targetObject).toBe("Contact");
  expect(viewModel.data.soqlPatterns[1]?.isLoopSuspect).toBe(false);

  const html = renderData(viewModel);
  expect(html).toMatch(/SOQL Pattern Warnings/);
  expect(html).toMatch(/SOQL Patterns/);
  expect(html).toMatch(/N\+1 Candidate/);
  expect(html).toMatch(/Account/);
  expect(html).toMatch(/Contact/);
  expect(html).toMatch(/Pattern executed 14 times across different spans/);
});

it("renderData and renderDiagnostics expose expand controls for truncated modular lists", () => {
  const manySoql = Array.from({ length: 12 }, (_, index) => ({
    id: `soql-${index + 1}`,
    query: `SELECT Id FROM Account WHERE Name = 'A${index}'`,
    rows: index + 1,
    durationMs: 20 + index,
    evidence: {
      raw: `SOQL_EXECUTE_BEGIN|SELECT Id FROM Account WHERE Name = 'A${index}'`,
    },
  }));
  const manyIssues = Array.from({ length: 14 }, (_, index) => ({
    id: `issue-${index + 1}`,
    summary: `Issue ${index + 1}`,
    severity: "warn",
    evidence: { raw: `EXCEPTION_THROWN|Issue ${index + 1}` },
  }));

  const viewModel = normalizeReport({
    report: {
      database: { soql: manySoql },
      errors: { count: manyIssues.length, items: manyIssues },
    },
    rawLines: [
      ...manySoql.map((entry, index) => ({
        number: index + 1,
        text: String(entry.evidence?.raw || ""),
      })),
      ...manyIssues.map((entry, index) => ({
        number: manySoql.length + index + 1,
        text: String(entry.evidence?.raw || ""),
      })),
    ],
  });

  const collapsedData = renderData(viewModel, { expanded: [] });
  const expandedData = renderData(viewModel, { expanded: ["data-soql"] });
  const collapsedDiagnostics = renderDiagnostics(viewModel, { expanded: [] });
  const expandedDiagnostics = renderDiagnostics(viewModel, {
    expanded: ["diag-issues"],
  });

  expect(collapsedData).toMatch(/Show all \(12\)/);
  expect(collapsedData).toMatch(/Showing 10 of 12 SOQL item\(s\)/);
  expect(expandedData).toMatch(/Show fewer/);
  expect(expandedData).toMatch(/Showing 12 of 12 SOQL item\(s\)/);
  expect(collapsedDiagnostics).toMatch(/Show all \(14\)/);
  expect(collapsedDiagnostics).toMatch(/Showing 12 of 14 issue\(s\)/);
  expect(expandedDiagnostics).toMatch(/Show fewer/);
  expect(expandedDiagnostics).toMatch(/Showing 14 of 14 issue\(s\)/);
});

it("normalizeReport preserves canonical execution, evidence, totals, and unknown values", () => {
  const viewModel = normalizeReport({
    report: {
      overview: {
        topMetrics: { queueablesEnqueued: { count: 4 } },
      },
      execution: { blocks: [], tree: [] },
      executionPhases: [
        {
          id: "unit-1",
          label: "AccountService.run",
          phaseIndex: 2,
          timing: { durationMs: 12.5 },
        },
      ],
      performance: {
        hotspots: [{ id: "hot-1", label: "AccountService.run" }],
        hotspotsMeta: { totalCount: 9, truncated: true, limit: 1 },
      },
      database: {
        soql: [{ id: "soql-1", query: "SELECT Id FROM Account" }],
        dml: [{ id: "dml-1", operation: "Update", sObject: "Account" }],
        soqlPatterns: [{ id: "pattern-1", pattern: "select id from account" }],
        soqlPatternsMeta: { totalCount: 6, truncated: true, limit: 1 },
      },
      triggerCascade: [{ id: "trigger-1", label: "AccountTrigger" }],
      triggerCascadeMeta: { totalCount: 7, truncated: true, limit: 1 },
      errors: {
        count: 12,
        truncated: true,
        limit: 1,
        items: [{ summary: "One retained issue", severity: "warn" }],
      },
      evidenceIndex: {
        phases: [
          { id: "phase-1", startLine: 10, endLine: 20, confidence: "direct" },
        ],
      },
    },
    rawLines: [],
  });

  expect(viewModel.execution.chain[0]?.label).toBe("AccountService.run");
  expect(viewModel.execution.hotspotTotalCount).toBe(9);
  expect(viewModel.execution.hotspotsTruncated).toBe(true);
  expect(viewModel.execution.triggerCascadeTotalCount).toBe(7);
  expect(viewModel.data.soql[0]?.rows).toBeNull();
  expect(viewModel.data.soql[0]?.durationMs).toBeNull();
  expect(viewModel.data.dml[0]?.rows).toBeNull();
  expect(viewModel.data.soqlPatternTotalCount).toBe(6);
  expect(viewModel.data.soqlPatternsTruncated).toBe(true);
  expect(viewModel.summary.topMetrics.queueables).toBe(4);
  expect(viewModel.diagnostics.issueCountTotal).toBe(12);
  expect(viewModel.diagnostics.issuesTruncated).toBe(true);
  expect(viewModel.evidence.index[0]).toMatchObject({
    line: 10,
    startLine: 10,
    endLine: 20,
  });
});

it("normalizeReport summary.topMetrics.lines is null when rawLines is empty, not rawLog.bytes", () => {
  const viewModel = normalizeReport({
    report: { rawLog: { bytes: 1234 } },
    rawLines: [],
  });
  expect(viewModel.summary.topMetrics.lines).toBe(null);
});

it("normalizeReport summary.topMetrics.lines reflects actual line count when rawLines present", () => {
  const viewModel = normalizeReport({
    report: { rawLog: { bytes: 99999 } },
    rawLines: [
      { number: 1, text: "line one" },
      { number: 2, text: "line two" },
      { number: 3, text: "line three" },
    ],
  });
  expect(viewModel.summary.topMetrics.lines).toBe(3);
});

// ─── redact-pii.js tests ──────────────────────────────────────────────────────

it("maskName masks each word after the first character", () => {
  expect(maskName("John Smith")).toBe("J*** S****");
  expect(maskName("A")).toBe("A");
  expect(maskName("Jo")).toBe("J*");
  expect(maskName("Mary Jane Watson")).toBe("M*** J*** W*****");
});

it("redactLine replaces email addresses with [EMAIL]", () => {
  const settings = { ...DEFAULT_REDACTION_SETTINGS, enabled: true };
  const line =
    "12:00.0 (1)|USER_INFO|[EXTERNAL]|005xx|kchin@example.com|(GMT-05:00)";
  const result = redactLine(line, settings);
  expect(result).toContain("[EMAIL]");
  expect(result).not.toContain("kchin@example.com");
});

it("redactLine replaces 15-char Salesforce IDs with [SF-ID]", () => {
  const settings = { ...DEFAULT_REDACTION_SETTINGS, enabled: true };
  const line = "12:00.0 (1)|USER_INFO|[EXTERNAL]|001f000000jUQe7|some text";
  const result = redactLine(line, settings);
  expect(result).toContain("[SF-ID]");
  expect(result).not.toContain("001f000000jUQe7");
});

it("redactLine replaces 18-char Salesforce IDs with [SF-ID]", () => {
  const settings = { ...DEFAULT_REDACTION_SETTINGS, enabled: true };
  const line = "trigger on Account (001f000000jUQe7AAE before insert)";
  const result = redactLine(line, settings);
  expect(result).toContain("[SF-ID]");
  expect(result).not.toContain("001f000000jUQe7AAE");
});

it("redactLine does not match a 16-char alphanumeric string as an SF ID", () => {
  const settings = { ...DEFAULT_REDACTION_SETTINGS, enabled: true };
  const line = "value=001f000000jUQe7X and more";
  const result = redactLine(line, settings);
  expect(result).not.toContain("[SF-ID]");
});

it("redactLine replaces US phone numbers with [PHONE]", () => {
  const settings = { ...DEFAULT_REDACTION_SETTINGS, enabled: true };
  const line = "Phone: (555) 123-4567 is in the debug output";
  const result = redactLine(line, settings);
  expect(result).toContain("[PHONE]");
  expect(result).not.toContain("(555) 123-4567");
});

it("redactLine masks user-supplied names with first-char pattern", () => {
  const settings = {
    ...DEFAULT_REDACTION_SETTINGS,
    enabled: true,
    nameList: ["John Smith"],
  };
  const line = "Contact: John Smith was updated";
  const result = redactLine(line, settings);
  expect(result).not.toContain("John Smith");
  expect(result).toContain("J*** S****");
});

it("redactLine name matching is case-insensitive", () => {
  const settings = {
    ...DEFAULT_REDACTION_SETTINGS,
    enabled: true,
    nameList: ["John Smith"],
  };
  const result = redactLine("JOHN SMITH logged in", settings);
  expect(result).not.toContain("JOHN SMITH");
});

it("redactLine skips disabled category (email off)", () => {
  const settings = {
    ...DEFAULT_REDACTION_SETTINGS,
    enabled: true,
    email: false,
  };
  const line = "user@example.com did something";
  const result = redactLine(line, settings);
  expect(result).toContain("user@example.com");
});

it("redactLine returns line unchanged when enabled=false", () => {
  const settings = { ...DEFAULT_REDACTION_SETTINGS, enabled: false };
  const line = "user@example.com|001f000000jUQe7|(555) 123-4567";
  expect(redactLine(line, settings)).toBe(line);
});

it("redactLines applies redaction to every line in the array", () => {
  const settings = { ...DEFAULT_REDACTION_SETTINGS, enabled: true };
  const lines = [
    "a@b.com logged in",
    "no pii here",
    "contact@org.example updated",
  ];
  const result = redactLines(lines, settings);
  expect(result.length).toBe(3);
  expect(result[0]).toContain("[EMAIL]");
  expect(result[1]).toBe("no pii here");
  expect(result[2]).toContain("[EMAIL]");
});

it("redactLines returns original array reference when enabled=false", () => {
  const settings = { ...DEFAULT_REDACTION_SETTINGS, enabled: false };
  const lines = ["a@b.com", "c@d.com"];
  const result = redactLines(lines, settings);
  expect(result).toBe(lines);
});
