import { describe, expect, it } from "vitest";

import {
  buildExecutionPhases,
  collectSalesforceIds,
} from "./execution-phases.js";
import type {
  DatabaseDmlEntry,
  DatabaseSoqlEntry,
  FlatEvent,
} from "./types.js";

function span(
  id: string,
  parentId: string | null,
  eventType: string,
  startNs: number,
) {
  return {
    id,
    parentId,
    eventType,
    label: id,
    namespace: "default",
    startNs,
    endNs: startNs + 9,
    durationNs: 9,
    durationMs: 0.000009,
    selfDurationNs: 9,
    selfDurationMs: 0.000009,
    evidence: { lineNumber: startNs, raw: null },
    category: null,
    debugCategory: null,
    cpuType: null,
  };
}

function query(
  timestampNs: number,
  rows: number | null,
  id = "query",
): DatabaseSoqlEntry {
  return {
    id,
    query: "SELECT Id FROM Account",
    targetObject: "Account",
    aggregations: 0,
    rows,
    count: 1,
    durationNs: null,
    durationMs: null,
    explain: null,
    namespace: "default",
    category: null,
    debugCategory: null,
    evidence: {
      lineNumber: 1,
      sourceLineNumber: null,
      timestampNs,
      raw: null,
    },
  };
}

function dml(
  timestampNs: number,
  rows: number | null,
  durationMs: number | null = 0,
): DatabaseDmlEntry {
  return {
    id: "dml",
    operation: "Update",
    sObject: "Account",
    rows,
    count: 1,
    durationNs: null,
    durationMs,
    namespace: "default",
    category: null,
    debugCategory: null,
    text: null,
    source: "event",
    evidence: {
      lineNumber: 2,
      sourceLineNumber: null,
      timestampNs,
      raw: null,
    },
  };
}

function variableEvent(
  timestampNs: number,
  variableName = "records",
): FlatEvent {
  return {
    idx: 0,
    parentIdx: null,
    type: "VARIABLE_ASSIGNMENT",
    timestampNs,
    timestampIsInferred: false,
    endTimestampNs: null,
    durationSelfNs: null,
    durationTotalNs: null,
    namespace: "default",
    category: "",
    debugCategory: "",
    cpuType: "",
    lineNumber: 3,
    sourceLineNumber: 7,
    text: `${variableName}|{"001000000000001AAA":{"Name":"Acme"}}`,
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

describe("buildExecutionPhases", () => {
  it("uses half-open phase windows and preserves unknown row aggregates", () => {
    const phases = buildExecutionPhases(
      [
        span("root", null, "CODE_UNIT_STARTED", 0),
        span("execute", "root", "METHOD_ENTRY", 1),
        span("phase-1", "execute", "METHOD_ENTRY", 10),
        span("phase-2", "execute", "METHOD_ENTRY", 20),
      ],
      [query(20, null)],
      [dml(20, 0, null)],
      [],
      [],
      [],
      1,
      new Map(),
    );

    expect(phases[0]?.database).toMatchObject({
      soqlInPhase: [],
      dmlInPhase: [],
      totalSoqlRows: 0,
      totalDmlRows: 0,
    });
    expect(phases[1]?.database).toMatchObject({
      soqlInPhase: [expect.objectContaining({ rows: null })],
      dmlInPhase: [expect.objectContaining({ rows: 0, durationMs: null })],
      totalSoqlRows: null,
      totalDmlRows: 0,
    });
    expect(phases[1]?.warnings).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("returned 0 rows"),
        expect.stringContaining("no-op"),
      ]),
    );
  });

  it("attributes a boundary variable assignment only to the next phase", () => {
    const recordId = "001000000000001AAA";
    const phases = buildExecutionPhases(
      [
        span("root", null, "CODE_UNIT_STARTED", 0),
        span("execute", "root", "METHOD_ENTRY", 1),
        span("phase-1", "execute", "METHOD_ENTRY", 10),
        span("phase-2", "execute", "METHOD_ENTRY", 20),
      ],
      [],
      [],
      [
        {
          variableName: "records",
          rawValue: `{\"${recordId}\":{\"Name\":\"Acme\"}}`,
          parsedValue: { [recordId]: { Name: "Acme" } },
          isEmptyCollection: false,
        },
      ],
      [variableEvent(20)],
      [],
      1,
      new Map(),
    );

    expect(phases[0]?.dataFlow).toMatchObject({
      inputIds: [],
      outputIds: [],
      recordsProcessed: 0,
      significantAssignments: [],
    });
    expect(phases[1]?.dataFlow).toMatchObject({
      inputIds: [],
      outputIds: [recordId],
      recordsProcessed: 1,
      significantAssignments: [
        expect.objectContaining({
          variableName: "records",
          recordCount: 1,
          timestampNs: 20,
        }),
      ],
    });
  });

  it("attributes large event collections across all phases in shared passes", () => {
    const phaseCount = 20;
    const eventsPerPhase = 250;
    const phaseSpans = Array.from({ length: phaseCount }, (_, index) =>
      span(`phase-${index}`, "execute", "METHOD_ENTRY", 10 + index * 10),
    );
    const soql: DatabaseSoqlEntry[] = [];
    const dmlOperations: DatabaseDmlEntry[] = [];
    const assignments = [];
    const assignmentEvents: FlatEvent[] = [];

    for (let index = 0; index < phaseCount * eventsPerPhase; index += 1) {
      const phaseIndex = index % phaseCount;
      const timestampNs = 10 + phaseIndex * 10;
      // Reverse IDs relative to timestamps to prove source ordering survives
      // attribution instead of being replaced by timestamp sorting.
      soql.push(query(timestampNs, 1, `query-${index}`));
      dmlOperations.push({ ...dml(timestampNs, 1), id: `dml-${index}` });

      if (index < 2_000) {
        const variableName = `records${index}`;
        assignments.push({
          variableName,
          rawValue: '{"001000000000001AAA":{"Name":"Acme"}}',
          parsedValue: { "001000000000001AAA": { Name: "Acme" } },
          isEmptyCollection: false,
        });
        assignmentEvents.push(variableEvent(timestampNs, variableName));
      }
    }

    soql.unshift(query(9, 1, "before-first"));
    soql.push(query(210, 1, "after-final"));
    dmlOperations.unshift({ ...dml(9, 1), id: "before-first" });
    dmlOperations.push({ ...dml(210, 1), id: "after-final" });

    const phases = buildExecutionPhases(
      [
        span("root", null, "CODE_UNIT_STARTED", 0),
        span("execute", "root", "METHOD_ENTRY", 1),
        ...phaseSpans,
      ],
      soql,
      dmlOperations,
      assignments,
      assignmentEvents,
      [],
      1,
      new Map(),
    );

    expect(phases).toHaveLength(phaseCount);
    for (const [phaseIndex, phase] of phases.entries()) {
      expect(phase.database.soqlInPhase).toHaveLength(eventsPerPhase);
      expect(phase.database.dmlInPhase).toHaveLength(eventsPerPhase);
      expect(phase.database.totalSoqlRows).toBe(eventsPerPhase);
      expect(phase.database.totalDmlRows).toBe(eventsPerPhase);
      expect(phase.dataFlow.significantAssignments).toHaveLength(100);
      expect(phase.database.soqlInPhase[0]?.id).toBe(`query-${phaseIndex}`);
    }
  });

  it("collects every Salesforce ID from strings and record-map keys", () => {
    const ids = new Set<string>();
    collectSalesforceIds(
      {
        "001000000000001AAA": {
          related: "003000000000002AAA and 006000000000003AAA",
        },
      },
      ids,
    );

    expect([...ids]).toEqual([
      "001000000000001AAA",
      "003000000000002AAA",
      "006000000000003AAA",
    ]);
  });

  it("does not classify 15-character field API names as scope IDs", () => {
    const ids = new Set<string>();
    collectSalesforceIds(
      {
        CurrencyIsoCode: "CurrencyIsoCode",
        ExpectedRevenue: "ExpectedRevenue",
        HasOpenActivity: "HasOpenActivity",
        Id: "006000000000003AAA",
      },
      ids,
    );

    expect([...ids]).toEqual(["006000000000003AAA"]);
  });

  it("collects IDs from deep cyclic values without recursive stack growth", () => {
    const recordId = "001000000000001AAA";
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let index = 0; index < 20_000; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    cursor.recordId = recordId;
    root.self = root;

    const ids = new Set<string>();
    collectSalesforceIds(root, ids);

    expect([...ids]).toEqual([recordId]);
  });
});
