import { describe, expect, it } from "vitest";

import { buildTriggerCascade } from "./execution-cascade.js";
import type { DatabaseDmlEntry, FlatEvent } from "./types.js";

function event(
  idx: number,
  parentIdx: number | null,
  type: string,
  timestampNs: number,
  text: string,
): FlatEvent {
  return {
    idx,
    parentIdx,
    type,
    timestampNs,
    timestampIsInferred: false,
    endTimestampNs: timestampNs + 1_000,
    durationSelfNs: null,
    durationTotalNs: 1_000,
    namespace: "default",
    category: "",
    debugCategory: "",
    cpuType: "",
    lineNumber: idx + 1,
    sourceLineNumber: null,
    text,
    logLine: `${timestampNs}|${type}|${text}`,
    exitLineNumber: idx + 2,
    exitLogLine: `${timestampNs + 1_000}|END`,
    isParent: type === "CODE_UNIT_STARTED",
    aggregations: null,
    soqlCountTotal: null,
    soqlRowCountTotal: null,
    soslCountTotal: null,
    soslRowCountTotal: null,
    dmlCountTotal: null,
    dmlRowCountTotal: null,
  };
}

function dml(
  id: string,
  timestampNs: number,
  sObject: string,
): DatabaseDmlEntry {
  return {
    id,
    operation: "Insert",
    sObject,
    rows: 1,
    count: 1,
    durationNs: 1,
    durationMs: 0.001,
    namespace: "default",
    category: null,
    debugCategory: null,
    text: `Op:Insert|Type:${sObject}|Rows:1`,
    source: "event",
    evidence: {
      lineNumber: null,
      sourceLineNumber: null,
      timestampNs,
      raw: null,
    },
  };
}

describe("buildTriggerCascade", () => {
  it("assigns nested DML and triggers only to their nearest trigger owner", () => {
    const events = [
      event(0, null, "CODE_UNIT_STARTED", 1, "Root trigger event"),
      event(1, 0, "DML_BEGIN", 10, "Op:Insert|Type:Account|Rows:1"),
      event(2, 1, "CODE_UNIT_STARTED", 20, "Child trigger event"),
      event(3, 2, "DML_BEGIN", 30, "Op:Insert|Type:Contact|Rows:1"),
      event(4, 3, "CODE_UNIT_STARTED", 40, "Grandchild trigger event"),
    ];

    const result = buildTriggerCascade(events, [
      dml("dml-1", 10, "Account"),
      dml("dml-2", 30, "Contact"),
    ]);

    expect(result.meta).toMatchObject({ totalRootTriggers: 1, maxDepth: 4 });
    expect(result.cascades).toHaveLength(1);
    expect(result.cascades[0]?.children).toHaveLength(1);
    expect(result.cascades[0]?.children[0]).toMatchObject({ id: "dml-1" });
    expect(result.cascades[0]?.children[0]?.children[0]).toMatchObject({
      id: "trigger-3",
    });
    expect(
      result.cascades[0]?.children[0]?.children[0]?.children[0],
    ).toMatchObject({ id: "dml-2" });
    expect(
      result.cascades[0]?.children[0]?.children[0]?.children[0]?.children[0],
    ).toMatchObject({ id: "trigger-5" });
  });

  it("reports child truncation without discarding the total", () => {
    const events = [
      event(0, null, "CODE_UNIT_STARTED", 1, "Root trigger event"),
      event(1, 0, "DML_BEGIN", 10, "Op:Insert|Type:Account|Rows:1"),
      event(2, 1, "CODE_UNIT_STARTED", 20, "First trigger event"),
      event(3, 1, "CODE_UNIT_STARTED", 21, "Second trigger event"),
    ];
    const result = buildTriggerCascade(
      events,
      [dml("dml-1", 10, "Account")],
      1,
    );

    expect(result.cascades[0]?.children[0]?.children).toHaveLength(1);
    expect(result.meta.truncatedNodes).toEqual([
      { parentId: "dml-1", totalChildren: 2, shown: 1 },
    ]);
  });
});
