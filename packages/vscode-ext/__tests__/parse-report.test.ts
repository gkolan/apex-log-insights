import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseOfflineReport } from "../src/parse-report.js";

describe("VS Code report worker pipeline", () => {
  it("builds the canonical offline report from a synthetic log", async () => {
    const fixture = resolve(process.cwd(), "fixtures/simple.log");
    const logText = await readFile(fixture, "utf8");
    const report = await parseOfflineReport(logText, "simple.log");

    expect(report.reportVersion).toBe("3.0.0");
    expect(report.source.fileName).toBe("simple.log");
    expect(report.metadata.rawLineCount).toBeGreaterThan(0);
    expect(report.uiHints.offline).toEqual({
      localOnly: true,
      networkRequired: false,
    });
  });

  it("derives report size from the actual UTF-8 text", async () => {
    const logText = [
      "😀",
      "12:00:00.000 (1)|EXECUTION_STARTED",
      "12:00:00.001 (2)|EXECUTION_FINISHED",
    ].join("\n");
    const report = await parseOfflineReport(logText, "unicode.log");

    expect(report.source).toMatchObject({
      fileName: "unicode.log",
      bytes: Buffer.byteLength(logText),
    });
  });

  it("rejects empty and oversized text before parsing", async () => {
    await expect(parseOfflineReport("", "empty.log")).rejects.toThrow(
      "The selected log is empty.",
    );
    await expect(
      parseOfflineReport("x".repeat(25 * 1024 * 1024 + 1), "oversized.log"),
    ).rejects.toThrow("the limit is 25.0 MiB");
  });
});
