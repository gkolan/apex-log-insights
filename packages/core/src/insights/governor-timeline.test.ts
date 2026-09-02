import { describe, expect, it } from "vitest";

import {
  computeGovernorDelta,
  type LimitTimelineEntry,
} from "./governor-timeline.js";

function snapshot(timestampNs: number, used: number): LimitTimelineEntry {
  return {
    timestampNs,
    soql: used,
    soqlRows: used * 10,
    dml: used * 2,
  };
}

describe("computeGovernorDelta", () => {
  it("uses the last boundary snapshot when timestamps are duplicated", () => {
    const timeline = [
      snapshot(10, 1),
      snapshot(20, 2),
      snapshot(20, 3),
      snapshot(30, 4),
      snapshot(30, 5),
    ];

    expect(computeGovernorDelta(timeline, 20, 30)).toEqual({
      soqlBefore: 3,
      soqlAfter: 5,
      soqlRowsBefore: 30,
      soqlRowsAfter: 50,
      dmlBefore: 6,
      dmlAfter: 10,
    });
  });

  it("uses the first later snapshot when a phase contains none", () => {
    const timeline = [snapshot(10, 1), snapshot(20, 2), snapshot(30, 3)];

    expect(computeGovernorDelta(timeline, 21, 29)).toMatchObject({
      soqlBefore: 2,
      soqlAfter: 3,
    });
    expect(computeGovernorDelta(timeline, 31, 40)).toMatchObject({
      soqlBefore: 3,
      soqlAfter: null,
    });
  });

  it("looks up phase boundaries in a large sorted timeline", () => {
    const timeline = Array.from({ length: 100_000 }, (_, index) =>
      snapshot(index * 10, index),
    );

    expect(computeGovernorDelta(timeline, 543_215, 765_435)).toMatchObject({
      soqlBefore: 54_321,
      soqlAfter: 76_543,
      soqlRowsBefore: 543_210,
      soqlRowsAfter: 765_430,
    });
  });

  it("returns unknown evidence for an inverted phase window", () => {
    expect(computeGovernorDelta([snapshot(10, 1)], 20, 10)).toEqual({
      soqlBefore: null,
      soqlAfter: null,
      soqlRowsBefore: null,
      soqlRowsAfter: null,
      dmlBefore: null,
      dmlAfter: null,
    });
  });
});
