import { describe, expect, it } from "vitest";

import {
  buildSoqlPatternAnalysis,
  extractCursorOperations,
  extractNamedCredentials,
} from "./database.js";
import type { DatabaseSoqlEntry, FlatEvent } from "./types.js";

function event(type: string, timestampNs: number, text: string): FlatEvent {
  return {
    idx: timestampNs,
    parentIdx: null,
    type,
    timestampNs,
    timestampIsInferred: false,
    endTimestampNs: null,
    durationSelfNs: null,
    durationTotalNs: null,
    lineNumber: timestampNs,
    sourceLineNumber: null,
    namespace: "default",
    category: "",
    debugCategory: "",
    cpuType: "",
    text,
    logLine: `${timestampNs}|${type}|${text}`,
    exitLineNumber: null,
    exitLogLine: null,
    isParent: false,
    soqlRowCountTotal: null,
    soqlCountTotal: null,
    soslRowCountTotal: null,
    soslCountTotal: null,
    dmlRowCountTotal: null,
    dmlCountTotal: null,
    aggregations: null,
  };
}

function query(
  id: string,
  soql: string,
  timestampNs: number,
): DatabaseSoqlEntry {
  return {
    id,
    query: soql,
    targetObject: "Account",
    aggregations: 0,
    rows: 1,
    count: 1,
    durationNs: 1,
    durationMs: 0.000001,
    explain: null,
    namespace: "default",
    category: null,
    debugCategory: null,
    evidence: {
      lineNumber: null,
      sourceLineNumber: null,
      timestampNs,
      raw: null,
    },
  };
}

describe("extractNamedCredentials", () => {
  it("pairs each response once within its request window", () => {
    const entries = extractNamedCredentials([
      event("NAMED_CREDENTIAL_RESPONSE", 5, "HTTP/1.1 418 Too Early"),
      event(
        "NAMED_CREDENTIAL_REQUEST",
        10,
        "First : https://one.example : get : body",
      ),
      event("NAMED_CREDENTIAL_RESPONSE", 11, "HTTP/1.1 201 Created"),
      event("NAMED_CREDENTIAL_RESPONSE", 12, "HTTP/1.1 202 Extra"),
      event(
        "NAMED_CREDENTIAL_REQUEST",
        20,
        "Second : https://two.example : post : body",
      ),
      event("NAMED_CREDENTIAL_RESPONSE", 20, "HTTP/1.1 204 No Content"),
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      credentialName: "First",
      method: "GET",
      statusCode: 201,
    });
    expect(entries[1]).toMatchObject({
      credentialName: "Second",
      method: "POST",
      statusCode: 204,
    });
  });

  it("handles large ordered event streams without repeated response scans", () => {
    const events: FlatEvent[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      const timestamp = i * 2;
      events.push(
        event(
          "NAMED_CREDENTIAL_REQUEST",
          timestamp,
          `Credential${i} : https://example.test/${i} : get : body`,
        ),
        event("NAMED_CREDENTIAL_RESPONSE", timestamp + 1, "HTTP/1.1 200 OK"),
      );
    }

    const entries = extractNamedCredentials(events);
    expect(entries).toHaveLength(10_000);
    expect(entries[0]?.statusCode).toBe(200);
    expect(entries.at(-1)?.credentialName).toBe("Credential9999");
  });
});

describe("extractCursorOperations", () => {
  it("requires complete safe integer row and offset tokens", () => {
    const malformed = event(
      "CURSOR_FETCH",
      1,
      "QueryId:01g000000000001AAA|Offset:1.5|Rows:12oops",
    );
    const formatted = event(
      "CURSOR_FETCH_PAGE",
      2,
      "QueryId:01g000000000001AAA|Cursor Offset Position:1,000|Number of rows:2,500",
    );

    expect(extractCursorOperations([malformed, formatted])).toEqual([
      expect.objectContaining({ offset: null, rows: null }),
      expect.objectContaining({ offset: 1_000, rows: 2_500 }),
    ]);
  });
});

describe("buildSoqlPatternAnalysis", () => {
  it("groups string literals containing escaped quotes and dotted binds", () => {
    const result = buildSoqlPatternAnalysis([
      query(
        "q1",
        "SELECT Id FROM Account WHERE Name = 'O\\'Brien' AND OwnerId = :context.owner.Id",
        1,
      ),
      query(
        "q2",
        "SELECT Id FROM Account WHERE Name = 'D\\'Angelo' AND OwnerId = :other.owner.Id",
        2,
      ),
      query(
        "q3",
        "SELECT Id FROM Account WHERE Name = 'Acme' AND OwnerId = :ownerId",
        3,
      ),
    ]);

    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0]).toMatchObject({
      executionCount: 3,
      pattern: "SELECT Id FROM Account WHERE Name = '?' AND OwnerId = :?",
      isLoopSuspect: true,
    });
  });

  it("analyzes a large repeated-query stream without rescanning every query per group", () => {
    const queries = Array.from({ length: 10_000 }, (_, index) =>
      query(
        `q${index}`,
        `SELECT Id FROM Account WHERE ExternalId__c = '${index}'`,
        index,
      ),
    );

    const result = buildSoqlPatternAnalysis(queries);
    expect(result.patterns[0]).toMatchObject({
      executionCount: 10_000,
      totalRows: 10_000,
      isLoopSuspect: true,
    });
  });

  it("does not present an incomplete grouped row total as an exact zero", () => {
    const complete = query("q1", "SELECT Id FROM Account", 1);
    const incomplete = query("q2", "SELECT Id FROM Account", 2);
    incomplete.rows = null;

    const result = buildSoqlPatternAnalysis([complete, incomplete]);

    expect(result.patterns[0]).toMatchObject({
      executionCount: 2,
      totalRows: null,
    });
  });

  it("keeps repeated-query duration totals unknown when any duration is invalid or unmeasured", () => {
    const measured = query("q1", "SELECT Id FROM Account", 1);
    measured.durationMs = 2.5;
    const unmeasured = query("q2", "SELECT Id FROM Account", 2);
    unmeasured.durationMs = null;

    expect(
      buildSoqlPatternAnalysis([measured, unmeasured]).patterns[0],
    ).toMatchObject({
      executionCount: 2,
      totalDurationMs: null,
      avgDurationMs: null,
    });

    const negative = query("q3", "SELECT Id FROM Contact", 3);
    negative.durationMs = -1;
    const nonFinite = query("q4", "SELECT Id FROM Contact", 4);
    nonFinite.durationMs = Number.POSITIVE_INFINITY;

    expect(
      buildSoqlPatternAnalysis([negative, nonFinite]).patterns[0],
    ).toMatchObject({ totalDurationMs: null, avgDurationMs: null });
  });
});
