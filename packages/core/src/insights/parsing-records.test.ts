import { describe, expect, it } from "vitest";

import { buildDynamicPrefixMap } from "./parsing-prefix.js";
import { extractRecordGraph } from "./parsing-records.js";
import { isSalesforceId } from "./types.js";
import type { DatabaseSoqlEntry, ParsedVariableAssignment } from "./types.js";

describe("Salesforce record discovery", () => {
  it("requires complete ID tokens in record fields and recovers valid map keys", () => {
    const accountId = "001000000000001AAA";
    const contaminatedId = "001000000000002AAA trailing";
    const contactId = "003000000000003AAA";
    const opportunityId = "006000000000004AAA";
    const relatedAccountId = "001000000000005AAA";
    const assignments: ParsedVariableAssignment[] = [
      {
        variableName: "accountIds",
        rawValue: "",
        parsedValue: [accountId, contaminatedId],
        isEmptyCollection: false,
      },
      {
        variableName: "contactsById",
        rawValue: "",
        parsedValue: {
          [contactId]: { Id: "invalid", Name: "Ada" },
        },
        isEmptyCollection: false,
      },
      {
        variableName: "opportunity",
        rawValue: "",
        parsedValue: {
          Id: opportunityId,
          AccountId: relatedAccountId,
          Notes: `${relatedAccountId} trailing`,
        },
        isEmptyCollection: false,
      },
      {
        variableName: "invalidRecord",
        rawValue: "",
        parsedValue: { Id: contaminatedId, Name: "Not a record" },
        isEmptyCollection: false,
      },
    ];

    const graph = extractRecordGraph([], assignments, new Map(), 100);
    const records = graph.entries.flatMap((entry) => entry.records);

    expect(graph.meta.totalRecords).toBe(3);
    expect(records.map((record) => record.id).sort()).toEqual(
      [accountId, contactId, opportunityId].sort(),
    );
    expect(records.find((record) => record.id === contactId)?.fields).toEqual([
      { field: "Name", value: "Ada" },
    ]);
    expect(
      records.find((record) => record.id === opportunityId)?.relationships,
    ).toEqual([
      {
        field: "AccountId",
        relatedId: relatedAccountId,
        relatedSObject: null,
      },
    ]);
    expect(isSalesforceId(contaminatedId)).toBe(false);
  });

  it("learns every exact ID prefix in an Id-filter query", () => {
    const firstId = "aAA000000000001";
    const secondId = "bBB000000000002";
    const query: DatabaseSoqlEntry = {
      id: "query-1",
      query: `SELECT Id FROM Custom__c WHERE Id IN ('${firstId}', '${secondId}')`,
      targetObject: "Custom__c",
      aggregations: 0,
      rows: 2,
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

    const prefixes = buildDynamicPrefixMap([query], []);

    expect(prefixes.get("aAA")).toBe("Custom__c");
    expect(prefixes.get("bBB")).toBe("Custom__c");
  });

  it("extracts deep cyclic relationship chains without recursive stack growth", () => {
    const depth = 12_000;
    const idFor = (index: number) => `a00${String(index).padStart(12, "0")}AAA`;
    const root: Record<string, unknown> = { Id: idFor(0) };
    let cursor = root;
    for (let index = 1; index < depth; index += 1) {
      const child: Record<string, unknown> = { Id: idFor(index) };
      cursor.Child__r = child;
      cursor = child;
    }
    cursor.Root__r = root;

    const graph = extractRecordGraph(
      [],
      [
        {
          variableName: "deepRecord",
          rawValue: "",
          parsedValue: root,
          isEmptyCollection: false,
        },
      ],
      new Map(),
      5,
    );

    expect(graph.meta.totalRecords).toBe(depth);
    expect(graph.entries).toEqual([
      expect.objectContaining({
        keyPrefix: "a00",
        recordCount: depth,
        truncated: true,
        records: expect.arrayContaining([
          expect.objectContaining({ id: idFor(0) }),
        ]),
      }),
    ]);
  });
});
