import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildOfflineReport } from "../src/offlineReport.js";
import { parseLog } from "../src/parserCore.js";
import { EXECUTION_PHASE_DEFINITIONS } from "../src/phases.js";

it("parseLog handles empty input without crashing", async () => {
  const result = await parseLog("", { includeRawLines: true });
  expect(result.sourceType).toBe("file");
  expect(result.normalizedTimeline.length).toBe(0);
  expect(result.rawLines?.length).toBe(1);
});

it("marks structurally complete logs uncertain when parser diagnostics remain", async () => {
  const rawLogText = [
    "12:00:00.000 (1)|EXECUTION_STARTED",
    "unrecognized transport residue",
    "12:00:00.001 (2)|EXECUTION_FINISHED",
  ].join("\n");
  const parseResult = await parseLog(rawLogText, { includeRawLines: true });
  const report = buildOfflineReport({
    source: {
      fileName: "diagnostic.log",
      bytes: Buffer.byteLength(rawLogText),
    },
    parseResult,
    rawLogText,
  }) as any;

  expect(report.metadata.logCompleteness).toMatchObject({
    status: "uncertain",
    hasExecutionStart: true,
    hasExecutionFinish: true,
  });
  expect(report.metadata.logCompleteness.reasons.join(" ")).toMatch(
    /could not fully interpret 1 log record/i,
  );
});

it("buildOfflineReport emits canonical v3 sections and 20 synthetic phases", async () => {
  const filePath = resolve(
    __dirname,
    "../../../fixtures/apex-07Lbc00000Ihnw6EAB.log",
  );
  const rawLogText = await readFile(filePath, "utf8");
  const parseResult = await parseLog(rawLogText, {
    sourceName: filePath,
    sourceType: "file",
    includeRawLines: true,
    enablePhaseInference: true,
  });

  const report = buildOfflineReport({
    source: {
      fileName: filePath,
      bytes: Buffer.byteLength(rawLogText),
    },
    parseResult,
    rawLogText,
  });

  expect(report.reportVersion).toBe("3.0.0");
  expect(report.source).toBeTruthy();
  expect(report.metadata).toBeTruthy();
  expect((report.metadata as any).logCompleteness.status).toBe("complete");
  expect(report.entryPoint).toBeTruthy();
  expect(Array.isArray(report.timeline)).toBeTruthy();
  expect(report.execution).toBeTruthy();
  expect(Array.isArray(report.phases)).toBeTruthy();
  expect(report.database).toBeTruthy();
  expect(report.governorLimits).toBeTruthy();
  expect(Array.isArray(report.issues)).toBeTruthy();
  expect(report.evidenceIndex).toBeTruthy();
  expect(report.uiHints).toBeTruthy();

  const timeline = report.timeline as Array<{
    lineNumber: number | null;
    evidence: { startLine: number | null };
  }>;
  expect(
    timeline.every(
      (event) =>
        event.evidence.startLine === null || event.evidence.startLine > 0,
    ),
  ).toBe(true);

  const phases = report.phases as Array<{ id: string; syntheticDoc: string }>;
  expect(phases.length).toBe(EXECUTION_PHASE_DEFINITIONS.length);
  expect(phases[0]?.id).toBe("phase-01-load-original-record");
  expect(phases.at(-1)?.id).toBe("phase-20-post-commit-logic");
  expect(
    phases.every(
      (phase) =>
        typeof phase.syntheticDoc === "string" &&
        phase.syntheticDoc.includes("docs/synthetic_logs/"),
    ),
  ).toBeTruthy();

  const uiHints = report.uiHints as { brand?: Record<string, unknown> };
  expect(uiHints.brand?.productName).toBe("Apex Log Insights");
  expect(!Object.hasOwn(uiHints.brand ?? {}, "logoAsset")).toBeTruthy();
  expect(JSON.stringify(report)).not.toMatch(
    /docs\/loglens-icons\/svgs\/active\.svg/,
  );
});

it("honors every public collection limit without changing aggregate counts", async () => {
  const rawLogText = [
    "10:00:00.000 (1)|EXECUTION_STARTED",
    "10:00:00.001 (2)|CODE_UNIT_STARTED|[EXTERNAL]|01q000000000001|AccountTrigger on Account trigger event BeforeInsert",
    "10:00:00.002 (3)|SOQL_EXECUTE_BEGIN|[7]|Aggregations:0|SELECT Id FROM Account WHERE Name = 'A'",
    "10:00:00.003 (4)|SOQL_EXECUTE_END|[7]|Rows:1",
    '10:00:00.004 (5)|VARIABLE_ASSIGNMENT|[8]|account|{"Id":"001000000000001AAA","Name":"A"}|0x1',
    "10:00:00.005 (6)|CODE_UNIT_FINISHED|AccountTrigger on Account trigger event BeforeInsert",
    "10:00:00.006 (7)|CURSOR_CREATE_BEGIN|[9]|SELECT Id FROM Contact",
    "10:00:00.007 (8)|CURSOR_CREATE_END|[9]|QueryId:01g000000000001AAA|Rows:1",
    "10:00:00.008 (9)|CURSOR_FETCH|[10]|QueryId:01g000000000001AAA|Offset:0|Rows:1",
    "10:00:00.009 (10)|EXECUTION_FINISHED",
  ].join("\n");
  const parseResult = await parseLog(rawLogText, { includeRawLines: true });
  const report = buildOfflineReport({
    source: { fileName: "limited.log", bytes: Buffer.byteLength(rawLogText) },
    parseResult,
    rawLogText,
    limits: {
      eventsPerType: 0,
      triggerNames: 0,
      soqlPatterns: 0,
      triggerCascadeChildren: 0,
      spanHotspots: 0,
      recordsPerSObject: 0,
      cursorOperations: 0,
      errorItems: 0,
      recursiveTriggers: 0,
    },
  }) as any;

  expect(report.overview.whatRan.triggerNames).toEqual([]);
  expect(report.overview.whatRan.triggerNamesMeta.totalCount).toBe(1);
  expect(report.database.soqlPatterns).toEqual([]);
  expect(report.database.soqlPatternsMeta.limit).toBe(0);
  expect(report.database.cursors).toEqual([]);
  expect(report.database.cursorsMeta).toEqual({
    totalCount: 2,
    truncated: true,
    limit: 0,
  });
  expect(report.performance.hotspots).toEqual([]);
  expect(report.performance.hotspotsMeta.limit).toBe(0);
  expect(report.recordGraph[0].recordCount).toBe(1);
  expect(report.recordGraph[0].records).toEqual([]);
  expect(report.recordGraph[0].recordsTruncated).toBe(true);
  expect(report.metadata.limits).toMatchObject({
    triggerNames: 0,
    soqlPatterns: 0,
    triggerCascadeChildren: 0,
    spanHotspots: 0,
    recordsPerSObject: 0,
    cursorOperations: 0,
    errorItems: 0,
    recursiveTriggers: 0,
  });
  expect(report.issues).toEqual([]);
  expect(report.errors).toMatchObject({ truncated: false, limit: 0 });
});

it("normalizes malformed report limits before they can bypass collection caps", async () => {
  const workflowEvents = Array.from(
    { length: 25 },
    (_, index) =>
      `10:00:00.${String(index + 1).padStart(3, "0")} (${index + 2})|WF_RULE_EVAL|[${index + 1}]|Rule Name: Rule ${index + 1}|Result: Evaluation succeeds`,
  );
  const rawLogText = [
    "10:00:00.000 (1)|EXECUTION_STARTED",
    ...workflowEvents,
    "10:00:00.999 (100)|EXECUTION_FINISHED",
  ].join("\n");
  const parseResult = await parseLog(rawLogText, { includeRawLines: true });

  const infinite = buildOfflineReport({
    source: { fileName: "invalid-limits.log", bytes: rawLogText.length },
    parseResult,
    rawLogText,
    limits: {
      eventsPerType: Number.POSITIVE_INFINITY,
      triggerNames: Number.NaN,
    },
  }) as any;
  const workflowPhase = infinite.phases.find(
    (phase: { id: string }) => phase.id === "phase-11-workflow-rules",
  );

  expect(workflowPhase.events).toHaveLength(20);
  expect(infinite.metadata.truncationWarnings).toContain(
    "Workflow events truncated: showing 20 of 25",
  );
  expect(infinite.metadata.limits).toMatchObject({
    eventsPerType: 20,
    triggerNames: 50,
  });

  const negative = buildOfflineReport({
    source: { fileName: "invalid-limits.log", bytes: rawLogText.length },
    parseResult,
    rawLogText,
    limits: { eventsPerType: -4, soqlPatterns: 2.9 },
  }) as any;
  const emptyWorkflowPhase = negative.phases.find(
    (phase: { id: string }) => phase.id === "phase-11-workflow-rules",
  );

  expect(emptyWorkflowPhase.events).toEqual([]);
  expect(negative.metadata.limits).toMatchObject({
    eventsPerType: 0,
    soqlPatterns: 2,
  });
});

it("correlates ordered Named Credential requests with each callout once", async () => {
  const filePath = resolve(__dirname, "../../../fixtures/malformed.log");
  const rawLogText = await readFile(filePath, "utf8");
  const parseResult = await parseLog(rawLogText, { includeRawLines: true });
  const report = buildOfflineReport({
    source: { fileName: filePath, bytes: Buffer.byteLength(rawLogText) },
    parseResult,
    rawLogText,
  }) as any;

  expect(report.database.integrationOperations).toHaveLength(2);
  expect(report.database.callouts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ statusCode: 200, responseLineNumber: 49 }),
      expect.objectContaining({ statusCode: 200, responseLineNumber: 100 }),
    ]),
  );
  expect(report.database.integrationOperations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        credentialName: "ERP_NC",
        calloutId: "callout-1",
        namedCredentialId: "named-credential-1",
      }),
      expect.objectContaining({
        credentialName: "ERP_NC",
        calloutId: "callout-2",
        namedCredentialId: "named-credential-2",
      }),
    ]),
  );
});

it("merges inline namespace limit records into canonical governor totals", async () => {
  const filePath = resolve(__dirname, "../../../fixtures/governor-limits.log");
  const rawLogText = await readFile(filePath, "utf8");
  const parseResult = await parseLog(rawLogText, { includeRawLines: true });
  const report = buildOfflineReport({
    source: { fileName: filePath, bytes: Buffer.byteLength(rawLogText) },
    parseResult,
    rawLogText,
  }) as any;
  const limits = report.governorLimits.current.defaultNamespace;

  expect((parseResult.parserResult as any).parsingErrors).toEqual([]);
  expect(
    parseResult.normalizedTimeline.find(
      (event) =>
        event.type === "FLOW_START_INTERVIEWS" &&
        event.text === "Account Sync Flow",
    ),
  ).toMatchObject({
    classification: "supported",
    lineNumber: null,
    evidence: { startLine: 111 },
  });
  expect(
    parseResult.normalizedTimeline.find(
      (event) =>
        event.type === "WF_RULE_EVAL" &&
        event.text?.includes("Notify Account Owner"),
    ),
  ).toMatchObject({
    classification: "supported",
    lineNumber: 122,
  });
  expect(
    parseResult.normalizedTimeline.find(
      (event) => event.type === "EXITING_MANAGED_PKG",
    ),
  ).toMatchObject({
    classification: "supported",
    namespace: "npe01",
    lineNumber: 193,
  });

  expect(limits).toMatchObject({
    soqlQueries: { used: 52, max: 100, pct: 52 },
    soqlRows: { used: 1468, max: 50000 },
    dmlStatements: { used: 22, max: 150 },
    dmlRows: { used: 1218, max: 10000 },
    cpuTimeMs: { used: 5678, max: 10000 },
    heapBytes: { used: 120576, max: 6000000 },
    callouts: { used: 8, max: 100 },
  });
  expect(report.governorLimits.snapshots.at(-1)).toMatchObject({
    namespace: "default",
    limits: {
      soqlQueries: { used: 52, limit: 100 },
      cpuTime: { used: 5678, limit: 10000 },
      callouts: { used: 8, limit: 100 },
    },
  });
  expect(report.metadata.namespaces).toContain("npe01");
  expect(report.metadata.namespaces).not.toContain("ContactHelper");
  expect(report.metadata.namespaces).not.toContain("[185]");

  expect(report.database.callouts).toHaveLength(6);
  expect(report.database.callouts[0]).toMatchObject({
    endpoint: "https://api.company.com/v1/accounts/sync",
    method: "POST",
    statusCode: 200,
    responseLineNumber: 77,
  });
  expect(report.database.namedCredentials).toMatchObject([
    {
      credentialName: "AccountSyncCredential",
      endpoint: "https://secure-api.example.com/accounts",
      method: "POST",
      statusCode: 201,
    },
    {
      credentialName: "PartnerIntegrationCredential",
      endpoint: "https://partner-api.example.com/v2/accounts/bulk",
      method: "POST",
      statusCode: 202,
    },
  ]);
  expect(report.database.integrationOperations).toHaveLength(8);
  expect(
    report.database.integrationOperations.filter(
      (operation: any) => operation.namedCredentialId,
    ),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        credentialName: "AccountSyncCredential",
        calloutId: null,
      }),
      expect.objectContaining({
        credentialName: "PartnerIntegrationCredential",
        calloutId: null,
      }),
    ]),
  );

  expect(report.database.soql).toHaveLength(35);
  expect(
    report.database.soql.every((query: any) =>
      query.query?.startsWith("SELECT"),
    ),
  ).toBe(true);
  expect(report.database.soql[0]).toMatchObject({
    targetObject: "Account",
    rows: 3,
    explain: { available: true, cardinality: 3 },
  });
  expect(
    report.database.soql.find((query: any) =>
      query.query.includes("NextReviewDate__c"),
    ),
  ).toMatchObject({
    rows: 5,
    evidence: { sourceLineNumber: null },
    explain: { available: true, cardinality: 5 },
  });
  expect(
    report.database.dml.find(
      (entry: any) => entry.operation === "update" && entry.rows === 5,
    ),
  ).toMatchObject({ sObject: "Account", rows: 5 });
});

it("offline report keeps flow event stream parity between parser timeline and trace events", async () => {
  const rawLogText = [
    "10:00:00.000 (1)|FLOW_CREATE_INTERVIEW_BEGIN|org|def|ver",
    "10:00:00.001 (2)|FLOW_CREATE_INTERVIEW_END|i-1|MyFlow",
    "10:00:00.002 (3)|FLOW_START_INTERVIEW_BEGIN|i-1|MyFlow",
    "10:00:00.003 (4)|FLOW_ELEMENT_BEGIN|i-1|Assignment|SetX",
    "10:00:00.004 (5)|FLOW_VALUE_ASSIGNMENT|i-1|x|5",
    "10:00:00.005 (6)|FLOW_RULE_DETAIL|i-1|RuleA|true",
    "10:00:00.006 (7)|FLOW_ACTIONCALL_DETAIL|i-1|Act|Apex|Id|true|",
    "10:00:00.007 (8)|FLOW_WAIT_WAITING_DETAIL|i-1|Wait1|1|p-1",
  ].join("\n");

  const parseResult = await parseLog(rawLogText, {
    sourceName: "synthetic-flow.log",
    sourceType: "file",
    includeRawLines: true,
    enablePhaseInference: true,
  });

  const report = buildOfflineReport({
    source: {
      fileName: "synthetic-flow.log",
      bytes: Buffer.byteLength(rawLogText),
    },
    parseResult,
    rawLogText,
  }) as any;

  const parserFlowTypes = new Set(
    parseResult.normalizedTimeline
      .map((event) => String(event?.type || "").trim())
      .filter((type) => type.startsWith("FLOW_")),
  );
  const traceFlowTypes = new Set(
    (Array.isArray(report?.trace?.events) ? report.trace.events : [])
      .map((event: any) => String(event?.type || "").trim())
      .filter((type: string) => type.startsWith("FLOW_")),
  );

  expect(
    parserFlowTypes.size > 0,
    "expected flow events in parser timeline",
  ).toBeTruthy();
  for (const type of parserFlowTypes) {
    expect(
      traceFlowTypes.has(type),
      `trace.events missing parser flow type ${type}`,
    ).toBeTruthy();
  }
});

it("classifies Flow phases from raw evidence lines rather than Apex source lines", async () => {
  const rawLogText = [
    "10:00:00.000 (1)|EXECUTION_STARTED",
    "10:00:00.001 (2)|FLOW_START_INTERVIEWS|[99]|Before Save Account Flow",
    "10:00:00.002 (3)|EXECUTION_FINISHED",
  ].join("\n");
  const parseResult = await parseLog(rawLogText, { includeRawLines: true });
  const report = buildOfflineReport({
    source: {
      fileName: "flow-evidence-lines.log",
      bytes: Buffer.byteLength(rawLogText),
    },
    parseResult,
    rawLogText,
  }) as any;

  const beforeSave = report.phases.find(
    (phase: any) => phase.id === "phase-04-before-save-flows",
  );
  expect(beforeSave).toMatchObject({
    status: "observed",
    evidence: { startLine: 2, endLine: 2 },
  });
});

it("reports incomplete logs and preserves the events immediately before a failure", async () => {
  const rawLogText = [
    "12:00:00.000 (1)|EXECUTION_STARTED",
    "malformed transport residue",
    "12:00:00.001 (2)|CODE_UNIT_STARTED|[EXTERNAL]|Example.run()",
    "12:00:00.002 (3)|SOQL_EXECUTE_BEGIN|[7]|Aggregations:0|SELECT Id FROM Account",
    "12:00:00.003 (4)|SOQL_EXECUTE_END|[7]|Rows:1",
    "12:00:00.004 (5)|EXCEPTION_THROWN|[8]|System.QueryException: failure",
    "12:00:00.005 (6)|FATAL_ERROR|System.QueryException: failure",
    "*** Skipped 200000 Bytes of detailed log",
  ].join("\n");
  const parseResult = await parseLog(rawLogText, { includeRawLines: true });
  const report = buildOfflineReport({
    source: { fileName: "truncated.log", bytes: Buffer.byteLength(rawLogText) },
    parseResult,
    rawLogText,
  }) as any;

  expect(report.metadata.logCompleteness.status).toBe("incomplete");
  expect(report.metadata.logCompleteness.hasExecutionFinish).toBe(false);
  expect(report.metadata.logCompleteness.reasons.join(" ")).toMatch(/skipped/i);
  expect(report.parserDiagnostics).toEqual(parseResult.parserDiagnostics);
  expect(report.parserDiagnostics[0]).toMatchObject({
    type: "INVALID_LOG_LINE",
    count: 1,
    firstLine: 2,
    lastLine: 2,
  });
  expect(report.failureContexts.length).toBeGreaterThan(0);
  expect(
    report.failureContexts[0].precedingEvents.map((event: any) => event.type),
  ).toContain("SOQL_EXECUTE_BEGIN");
});
