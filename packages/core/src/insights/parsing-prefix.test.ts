import { describe, expect, it } from "vitest";

import {
  buildDynamicPrefixMap,
  inferSObjectFromVarName,
  resolveSObjectType,
} from "./parsing-prefix.js";
import type { DatabaseSoqlEntry, ParsedVariableAssignment } from "./types.js";

function query(
  id: string,
  queryText: string,
  targetObject: string,
): DatabaseSoqlEntry {
  return {
    id,
    query: queryText,
    targetObject,
    aggregations: 0,
    rows: null,
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
      timestampNs: 1,
      raw: null,
    },
  };
}

function assignment(
  variableName: string,
  id: string,
): ParsedVariableAssignment {
  return {
    variableName,
    rawValue: "",
    parsedValue: { Id: id },
    isEmptyCollection: false,
  };
}

describe("inferSObjectFromVarName", () => {
  it("recognizes tokenized Apex naming conventions", () => {
    expect(inferSObjectFromVarName("OLIById")).toBe("OpportunityLineItem");
    expect(inferSObjectFromVarName("oppLineItems")).toBe("OpportunityLineItem");
    expect(inferSObjectFromVarName("accountsById")).toBe("Account");
    expect(inferSObjectFromVarName("quoteLines")).toBe("SBQQ__QuoteLine__c");
  });

  it("does not infer types from incidental substrings", () => {
    for (const name of ["policy", "shoppingCart", "showcase", "abuser"]) {
      expect(inferSObjectFromVarName(name)).toBeNull();
    }
  });
});

describe("buildDynamicPrefixMap", () => {
  it("gives an exact Id predicate priority over a variable-name guess", () => {
    const customId = "aAA000000000001";
    const prefixes = buildDynamicPrefixMap(
      [
        query(
          "query",
          `SELECT Id FROM Custom__c WHERE Id = '${customId}'`,
          "Custom__c",
        ),
      ],
      [assignment("accountRecord", customId)],
    );

    expect(prefixes.get("aAA")).toBe("Custom__c");
  });

  it("leaves conflicting explicit or heuristic evidence unresolved", () => {
    const customId = "aAB000000000001";
    const queryConflict = buildDynamicPrefixMap(
      [
        query(
          "one",
          `SELECT Id FROM One__c WHERE Id = '${customId}'`,
          "One__c",
        ),
        query(
          "two",
          `SELECT Id FROM Two__c WHERE Id = '${customId}'`,
          "Two__c",
        ),
      ],
      [assignment("accountRecord", customId)],
    );
    const variableConflict = buildDynamicPrefixMap(
      [],
      [
        assignment("accountRecord", customId),
        assignment("contactRecord", customId),
      ],
    );

    expect(queryConflict.has("aAB")).toBe(false);
    expect(variableConflict.has("aAB")).toBe(false);
  });

  it("learns only IDs belonging to literal outer Id predicates", () => {
    const outerId = "aAC000000000001";
    const secondOuterId = "aAC000000000002";
    const ownerId = "bBD000000000001";
    const nestedId = "cCE000000000001";
    const commentId = "dDF000000000001";
    const prefixes = buildDynamicPrefixMap(
      [
        query(
          "query",
          [
            `SELECT Id, (SELECT Id FROM Contacts WHERE Id = '${nestedId}')`,
            `FROM Custom__c WHERE Id IN ('${outerId}', '${secondOuterId}')`,
            `AND OwnerId = '${ownerId}' /* Id = '${commentId}' */`,
          ].join(" "),
          "Custom__c",
        ),
      ],
      [],
    );

    expect(prefixes.get("aAC")).toBe("Custom__c");
    expect(prefixes.has("bBD")).toBe(false);
    expect(prefixes.has("cCE")).toBe(false);
    expect(prefixes.has("dDF")).toBe(false);
  });

  it("never overrides canonical standard prefixes", () => {
    const prefixes = buildDynamicPrefixMap(
      [
        query(
          "query",
          "SELECT Id FROM Wrong__c WHERE Id = '001000000000001AAA'",
          "Wrong__c",
        ),
      ],
      [],
    );

    expect(resolveSObjectType("001000000000001AAA", prefixes)).toBe("Account");
    expect(resolveSObjectType("short", prefixes)).toBeNull();
  });

  it("handles a large literal Id list in one query", () => {
    const ids = Array.from(
      { length: 10_000 },
      (_, index) => `aAZ${String(index).padStart(12, "0")}`,
    );
    const prefixes = buildDynamicPrefixMap(
      [
        query(
          "large",
          `SELECT Id FROM Scale__c WHERE Id IN (${ids.map((id) => `'${id}'`).join(",")})`,
          "Scale__c",
        ),
      ],
      [],
    );

    expect(prefixes.get("aAZ")).toBe("Scale__c");
  });
});
