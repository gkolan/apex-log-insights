import { describe, expect, it } from "vitest";

import { isHostMessage, toZeroBasedLine } from "../src/webview-protocol.js";

describe("VS Code webview host messages", () => {
  it.each(["READY", "REFRESH"])("accepts %s", (type) => {
    expect(isHostMessage({ type })).toBe(true);
  });

  it("accepts only positive integer log lines", () => {
    expect(isHostMessage({ type: "OPEN_LOG_LINE", lineNumber: 7 })).toBe(true);
    for (const lineNumber of [0, -1, 1.5, NaN, Infinity, "7", null]) {
      expect(isHostMessage({ type: "OPEN_LOG_LINE", lineNumber })).toBe(false);
    }
  });

  it("allows only the packaged support destination", () => {
    expect(
      isHostMessage({
        type: "OPEN_EXTERNAL",
        href: "https://github.com/gkolan/apex-log-insights/issues",
      }),
    ).toBe(true);
    for (const href of [
      "http://github.com/gkolan/apex-log-insights/issues",
      "https://example.com/",
      "https://github.com/other/repository/issues",
      "https://attacker@github.com/gkolan/apex-log-insights/issues",
      "javascript:alert(1)",
    ]) {
      expect(isHostMessage({ type: "OPEN_EXTERNAL", href })).toBe(false);
    }
  });

  it.each([null, [], "READY", {}, { type: "UNKNOWN" }])(
    "rejects hostile shape %#",
    (message) => expect(isHostMessage(message)).toBe(false),
  );

  it("converts exact 1-based evidence and rejects stale coordinates", () => {
    expect(toZeroBasedLine(1, 20)).toBe(0);
    expect(toZeroBasedLine(7, 20)).toBe(6);
    expect(toZeroBasedLine(21, 20)).toBeUndefined();
    expect(toZeroBasedLine(1, 0)).toBeUndefined();
  });
});
