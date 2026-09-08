import { describe, expect, it } from "vitest";

import {
  collectCumulativeProfilingSections,
  extractTargetObject,
  parseExplainPlan,
  parseVariableAssignment,
  parseVariableScope,
} from "./parsing-variables.js";
import type { FlatEvent } from "./types.js";

function event(type: string, text = "", logLine = ""): FlatEvent {
  return {
    idx: 0,
    parentIdx: null,
    type,
    timestampNs: 1,
    timestampIsInferred: false,
    endTimestampNs: null,
    durationSelfNs: null,
    durationTotalNs: null,
    namespace: "default",
    category: "",
    debugCategory: "",
    cpuType: "",
    lineNumber: 1,
    sourceLineNumber: null,
    text,
    logLine,
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

describe("extractTargetObject", () => {
  it("returns the outer object when a relationship subquery has an earlier FROM", () => {
    expect(
      extractTargetObject(
        "SELECT Id, (SELECT Id FROM Contacts WHERE LastName = 'FROM Lead') FROM Account WHERE Name = 'FROM Contact'",
      ),
    ).toBe("Account");
  });

  it("ignores FROM tokens in quoted values and comments", () => {
    expect(
      extractTargetObject(
        [
          "SELECT Id, 'FROM Lead', Name /* FROM Opportunity */",
          "// FROM Contact",
          "FROM ns__Invoice__c WHERE Name = 'O\\'Brien FROM Account'",
        ].join("\n"),
      ),
    ).toBe("ns__Invoice__c");
  });

  it("returns null when no outer FROM clause has a valid object", () => {
    expect(extractTargetObject(null)).toBeNull();
    expect(
      extractTargetObject("SELECT Id FROM (SELECT Id FROM Contact)"),
    ).toBeNull();
  });
});

describe("parseExplainPlan", () => {
  it("parses complete grouped and decimal metrics", () => {
    expect(
      parseExplainPlan(
        "Index on Account : [Name, OwnerId], cardinality: 1,234,sobjectCardinality: 9,876, relativeCost 1.25e-3",
      ),
    ).toMatchObject({
      available: true,
      indexed: true,
      indexFields: ["Name", "OwnerId"],
      cardinality: 1_234,
      sobjectCardinality: 9_876,
      relativeCost: 0.00125,
    });
  });

  it("does not accept numeric prefixes from malformed metrics", () => {
    const plan = parseExplainPlan(
      "cardinality: 12.5, sobjectCardinality: 1,00, relativeCost 1e",
    );

    expect(plan).not.toHaveProperty("cardinality");
    expect(plan).not.toHaveProperty("sobjectCardinality");
    expect(plan).not.toHaveProperty("relativeCost");
  });

  it("does not confuse sObject cardinality with query cardinality", () => {
    const plan = parseExplainPlan("sobjectCardinality: 42");

    expect(plan.sobjectCardinality).toBe(42);
    expect(plan).not.toHaveProperty("cardinality");
  });

  it("represents an unavailable plan explicitly", () => {
    expect(parseExplainPlan("No explain plan is available")).toEqual({
      available: false,
      indexed: false,
      raw: "No explain plan is available",
    });
  });
});

describe("parseVariableAssignment", () => {
  it("preserves pipes inside a raw JSON value and removes only the heap token", () => {
    const assignment = parseVariableAssignment(
      event(
        "VARIABLE_ASSIGNMENT",
        "ignored",
        '12:00:00.000 (1)|VARIABLE_ASSIGNMENT|[7]|record|{"Name":"A|B"}|0xABC',
      ),
    );

    expect(assignment).toEqual({
      variableName: "record",
      rawValue: '{"Name":"A|B"}',
      parsedValue: { Name: "A|B" },
      isEmptyCollection: false,
    });
  });

  it("handles fallback, null, empty, malformed, and unrelated events", () => {
    expect(
      parseVariableAssignment(event("VARIABLE_ASSIGNMENT", "items|[]")),
    ).toMatchObject({ parsedValue: [], isEmptyCollection: true });
    expect(
      parseVariableAssignment(event("VARIABLE_ASSIGNMENT", "value|null")),
    ).toMatchObject({ parsedValue: null, isEmptyCollection: false });
    expect(
      parseVariableAssignment(event("VARIABLE_ASSIGNMENT", "value|{bad")),
    ).toMatchObject({ parsedValue: "{bad", isEmptyCollection: false });
    expect(
      parseVariableAssignment(event("VARIABLE_ASSIGNMENT", "|value")),
    ).toBeNull();
    expect(parseVariableAssignment(event("USER_DEBUG"))).toBeNull();
  });
});

describe("parseVariableScope", () => {
  it("parses raw and display representations", () => {
    expect(
      parseVariableScope(
        event(
          "VARIABLE_SCOPE_BEGIN",
          "ignored",
          "12:00:00.000 (1)|VARIABLE_SCOPE_BEGIN|[7]|records|List<Account>|true|false",
        ),
      ),
    ).toEqual({ variableName: "records", typeName: "List<Account>" });
    expect(
      parseVariableScope(
        event("VARIABLE_SCOPE_BEGIN", "account|Account|false"),
      ),
    ).toEqual({ variableName: "account", typeName: "Account" });
    expect(
      parseVariableScope(event("VARIABLE_SCOPE_BEGIN", "account|")),
    ).toBeNull();
    expect(parseVariableScope(event("USER_DEBUG"))).toBeNull();
  });
});

describe("collectCumulativeProfilingSections", () => {
  it("parses valid sections and rejects unsafe numeric evidence", () => {
    const result = collectCumulativeProfilingSections([
      event("USER_DEBUG", "ignored"),
      event(
        "CUMULATIVE_PROFILING",
        [
          "DML operations",
          "Class.Worker: line 12, column 1: Update: Account: executed 2 times in 3 ms",
        ].join("\n"),
      ),
      event(
        "CUMULATIVE_PROFILING",
        [
          "Method invocations",
          "Class.Worker: line 9, column 1: executed 1,004 times in 2,005 ms",
          "Class.Bad: line 1, column 1: executed 9007199254740992 times in 1 ms",
          "Class.Bad: line 1.5, column 1: executed 1 times in 1 ms",
        ].join("\n"),
      ),
      event(
        "CUMULATIVE_PROFILING",
        "SOQL operations\nClass.Worker: line 15, column 1: executed 6 times in 7 ms",
      ),
    ]);

    expect(result.dmlOperations).toEqual([
      expect.objectContaining({
        className: "Worker",
        lineNumber: 12,
        executionCount: 2,
        timeMs: 3,
        operation: "Update",
        sObject: "Account",
      }),
    ]);
    expect(result.methodInvocations).toEqual([
      expect.objectContaining({ executionCount: 1_004, timeMs: 2_005 }),
    ]);
    expect(result.soqlOperations).toEqual([
      expect.objectContaining({ executionCount: 6, timeMs: 7 }),
    ]);
  });
});
