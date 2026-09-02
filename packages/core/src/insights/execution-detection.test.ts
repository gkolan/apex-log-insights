import { describe, expect, it } from "vitest";

import { detectRecursiveTriggers } from "./execution-detection.js";

describe("detectRecursiveTriggers", () => {
  it("handles large nested groups linearly and bounds retained evidence", () => {
    const deepGroup = Array.from({ length: 10_000 }, (_, index) => ({
      id: `deep-${index}`,
      parentId: index === 0 ? null : `deep-${index - 1}`,
      eventType: "CODE_UNIT_STARTED",
      label: "__sfdc_trigger/Account/AccountTrigger",
      evidence: {
        lineNumber: index + 1,
        raw: index === 0 ? "x".repeat(2_500) : `raw-${index}`,
      },
    }));
    const otherGroups = Array.from({ length: 100 }, (_, index) => [
      {
        id: `root-${index}`,
        parentId: null,
        eventType: "CODE_UNIT_STARTED",
        label: `__sfdc_trigger/Account/Trigger${index}`,
        evidence: { lineNumber: 1, raw: `root-${index}` },
      },
      {
        id: `child-${index}`,
        parentId: `root-${index}`,
        eventType: "CODE_UNIT_STARTED",
        label: `__sfdc_trigger/Account/Trigger${index}`,
        evidence: { lineNumber: 2, raw: `child-${index}` },
      },
    ]).flat();

    const result = detectRecursiveTriggers(
      [...deepGroup, ...otherGroups],
      3,
      5,
    );

    expect(result.detected).toBe(true);
    expect(result.meta).toEqual({
      totalCount: 101,
      truncated: true,
      limit: 3,
      evidenceLimit: 5,
    });
    expect(result.recursiveTriggers).toHaveLength(3);
    expect(result.recursiveTriggers[0]).toMatchObject({
      triggerName: "AccountTrigger",
      count: 10_000,
      lineNumbers: [1, 2, 3, 4, 5],
      evidenceMeta: {
        lineNumberCount: 10_000,
        rawLogLineTextCount: 10_000,
        lineNumbersTruncated: true,
        rawLogLineTextsTruncated: true,
      },
    });
    expect(result.recursiveTriggers[0]?.rawLogLineTexts).toHaveLength(5);
    expect(
      result.recursiveTriggers[0]?.rawLogLineTexts.every(
        (line) => line.length <= 2_000,
      ),
    ).toBe(true);
  });

  it("terminates malformed cyclic parent chains", () => {
    const result = detectRecursiveTriggers(
      [
        {
          id: "a",
          parentId: "b",
          eventType: "CODE_UNIT_STARTED",
          label: "CycleTrigger on Account trigger event BeforeUpdate",
          evidence: { lineNumber: 7, raw: "same evidence" },
        },
        {
          id: "b",
          parentId: "a",
          eventType: "CODE_UNIT_STARTED",
          label: "CycleTrigger on Account trigger event AfterUpdate",
          evidence: { lineNumber: 7, raw: "same evidence" },
        },
      ],
      50,
      1,
    );

    expect(result.detected).toBe(true);
    expect(result.recursiveTriggers[0]?.count).toBe(2);
    expect(result.recursiveTriggers[0]?.evidenceMeta).toEqual({
      lineNumberCount: 2,
      rawLogLineTextCount: 2,
      lineNumbersTruncated: false,
      rawLogLineTextsTruncated: false,
    });
  });
});
