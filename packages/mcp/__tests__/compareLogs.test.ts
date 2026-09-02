import { describe, expect, it } from "vitest";

import { handleCompareLogs } from "../src/tools/compareLogs.js";

describe("compare_logs", () => {
  it("returns candidate-minus-baseline metric deltas", async () => {
    const baseline = [
      "12:00:00.000 (0)|EXECUTION_STARTED",
      "12:00:00.005 (5)|SOQL_EXECUTE_BEGIN|[1]|SELECT Id FROM Account",
      "12:00:00.006 (6)|SOQL_EXECUTE_END|[1]|Rows:1",
      "12:00:00.010 (10)|EXECUTION_FINISHED",
    ].join("\n");
    const candidate = [
      "12:00:00.000 (0)|EXECUTION_STARTED",
      "12:00:00.005 (5)|SOQL_EXECUTE_BEGIN|[1]|SELECT Id FROM Account",
      "12:00:00.006 (6)|SOQL_EXECUTE_END|[1]|Rows:1",
      "12:00:00.015 (15)|SOQL_EXECUTE_BEGIN|[2]|SELECT Id FROM Contact",
      "12:00:00.016 (16)|SOQL_EXECUTE_END|[2]|Rows:1",
      "12:00:00.025 (25)|SOQL_EXECUTE_BEGIN|[3]|SELECT Id FROM Opportunity",
      "12:00:00.026 (26)|SOQL_EXECUTE_END|[3]|Rows:1",
      "12:00:00.030 (30)|EXECUTION_FINISHED",
    ].join("\n");

    const result = await handleCompareLogs({
      baseline: { logText: baseline },
      candidate: { logText: candidate },
    });
    const comparison = JSON.parse(result.content[0].text);

    expect(comparison.deltaDefinition).toBe("candidate minus baseline");
    expect(comparison.baseline.soqlCount).toBe(1);
    expect(comparison.candidate.soqlCount).toBe(3);
    expect(comparison.delta.soqlCount).toBe(2);
  });

  it("requires both inputs and preserves the one-source rule", async () => {
    await expect(
      handleCompareLogs({ baseline: { logText: "log" } }),
    ).rejects.toThrow("both baseline and candidate");
    await expect(
      handleCompareLogs({
        baseline: { logText: "log", filePath: "other.log" },
        candidate: { logText: "log" },
      }),
    ).rejects.toThrow("exactly one");
  });
});
