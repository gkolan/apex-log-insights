import { describe, expect, it } from "vitest";

import {
  MAX_DETECTION_BYTES,
  MAX_DETECTION_LINES,
  detectApexLogPrefix,
  hasLogSuffix,
} from "../src/log-detection.js";

describe("bounded Apex debug-log detection", () => {
  it.each([
    ["59.0 APEX_CODE,FINE;DB,FINEST", "debug-level-header"],
    ["12:00:00.0 (1)|EXECUTION_STARTED", "execution-started"],
    ["12:00:00.0 (1)|USER_INFO|[EXTERNAL]|005000000000000", "user-info"],
  ])("detects %s", (line, marker) => {
    expect(detectApexLogPrefix(line)).toMatchObject({
      isApexLog: true,
      marker,
    });
  });

  it("rejects an unrelated log", () => {
    expect(detectApexLogPrefix("INFO application started").isApexLog).toBe(
      false,
    );
  });

  it("detects markers after CR-only line endings", () => {
    expect(
      detectApexLogPrefix(
        "ordinary preamble\r12:00:00.0 (1)|EXECUTION_STARTED",
      ),
    ).toMatchObject({
      isApexLog: true,
      inspectedLines: 2,
      marker: "execution-started",
    });
  });

  it("stops at the line bound", () => {
    const text = [
      ...Array.from({ length: MAX_DETECTION_LINES }, () => "ordinary line"),
      "12:00:00.0 (1)|EXECUTION_STARTED",
    ].join("\n");
    const result = detectApexLogPrefix(text);
    expect(result.isApexLog).toBe(false);
    expect(result.inspectedLines).toBe(MAX_DETECTION_LINES);
  });

  it("stops at the byte bound", () => {
    const text = `${"x".repeat(MAX_DETECTION_BYTES)}\n12:00:00.0 (1)|EXECUTION_STARTED`;
    const result = detectApexLogPrefix(text);
    expect(result.isApexLog).toBe(false);
    expect(result.inspectedBytes).toBeLessThanOrEqual(MAX_DETECTION_BYTES);
  });

  it("counts only separators that exist and preserves exact CRLF bytes", () => {
    expect(detectApexLogPrefix("ordinary line").inspectedBytes).toBe(13);
    expect(detectApexLogPrefix("one\ntwo").inspectedBytes).toBe(7);
    expect(detectApexLogPrefix("one\r\ntwo").inspectedBytes).toBe(8);
    expect(detectApexLogPrefix("one\rtwo").inspectedBytes).toBe(7);
  });

  it("counts Unicode prefix content as UTF-8 without crossing the byte cap", () => {
    const line = "😀".repeat(MAX_DETECTION_BYTES / 4);
    const exact = detectApexLogPrefix(line);
    const over = detectApexLogPrefix(`${line}x`);

    expect(exact).toMatchObject({
      isApexLog: false,
      inspectedLines: 1,
      inspectedBytes: MAX_DETECTION_BYTES,
    });
    expect(over).toMatchObject({
      isApexLog: false,
      inspectedLines: 0,
      inspectedBytes: 0,
    });
  });

  it("matches the .log suffix case-insensitively", () => {
    expect(hasLogSuffix("debug.log")).toBe(true);
    expect(hasLogSuffix("DEBUG.LOG")).toBe(true);
    expect(hasLogSuffix("debug.log.txt")).toBe(false);
  });
});
