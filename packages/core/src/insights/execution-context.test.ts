import { describe, expect, it } from "vitest";

import {
  buildContextOverride,
  detectExecutionContext,
  VALID_CONTEXT_VALUES,
} from "./execution-context.js";
import type { FlatEvent } from "./types.js";

function event(type: string, text = ""): FlatEvent {
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

describe("detectExecutionContext", () => {
  it("prefers canonical batch evidence over scheduled-name heuristics", () => {
    const result = detectExecutionContext(
      "NightlySchedulable.execute",
      [event("BATCH_APEX_EXECUTE_BEGIN", "NightlySchedulable.execute")],
      [],
    );

    expect(result).toMatchObject({
      type: "batch_execute",
      confidence: "direct",
      phaseModel: "batch",
    });
  });

  it("prefers platform-event evidence over its trigger text", () => {
    const result = detectExecutionContext(
      "Order_Event__e trigger event AfterInsert",
      [event("CODE_UNIT_STARTED", "Order_Event__e trigger event AfterInsert")],
      [],
    );

    expect(result.type).toBe("platform_event");
  });

  it("does not infer contexts from incidental class-name substrings", () => {
    expect(detectExecutionContext("TriggerHandler.run", [], []).type).toBe(
      "apex_class",
    );
    expect(detectExecutionContext("BatchUtilities.run", [], []).type).toBe(
      "apex_class",
    );
    expect(
      detectExecutionContext("ScheduledApexUtilities.run", [], []).type,
    ).toBe("apex_class");
  });

  it("retains precise legacy class-name fallbacks", () => {
    expect(detectExecutionContext("NightlyBatch.execute", [], []).type).toBe(
      "batch_execute",
    );
    expect(
      detectExecutionContext("NightlySchedulable.execute", [], []).type,
    ).toBe("scheduled");
  });

  it("scans a large event collection without changing direct precedence", () => {
    const events = Array.from({ length: 100_000 }, (_, index) =>
      event("USER_DEBUG", `entry-${index}`),
    );
    events.push(event("FUTURE_METHOD_BEGIN", "Worker.run"));
    events.push(event("BATCH_APEX_EXECUTE_BEGIN", "Batch.execute"));

    expect(detectExecutionContext(null, events, []).type).toBe("future_method");
  });
});

describe("buildContextOverride", () => {
  it("accepts every declared context value", () => {
    for (const contextValue of VALID_CONTEXT_VALUES) {
      expect(buildContextOverride(contextValue)).toMatchObject({
        type: contextValue,
        confidence: "override",
        contextSource: "override",
      });
    }
  });

  it.each(["__proto__", "constructor", "toString", "valueOf", "unknown"])(
    "rejects the inherited or unknown key %s",
    (contextValue) => {
      expect(buildContextOverride(contextValue)).toBeNull();
    },
  );
});
