import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import { handleAnalyzeGovernorLimits } from "../src/tools/analyzeGovernorLimits.js";
import { handleAnalyzePerformance } from "../src/tools/analyzePerformance.js";
import { handleAnalyzeSoql } from "../src/tools/analyzeSoql.js";
import { handleParseLog } from "../src/tools/parseLog.js";
import { handleSummarize } from "../src/tools/summarize.js";

let logText: string;

beforeAll(async () => {
  logText = await readFile(
    new URL("../../../fixtures/simple.log", import.meta.url),
    "utf8",
  );
});

async function resultJson(
  handler: (
    args: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>,
): Promise<Record<string, unknown>> {
  const result = await handler({ logText });
  expect(result.content).toHaveLength(1);
  expect(result.content[0]?.type).toBe("text");
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe("MCP tool report contracts", () => {
  it("returns the complete insights report", async () => {
    const report = await resultJson(handleParseLog);

    expect(report).toHaveProperty("context.executionContext");
    expect(report).toHaveProperty("database.soqlPatterns");
    expect(report).toHaveProperty("limits.cumulative");
  });

  it("reports inline Unicode log size in UTF-8 bytes", async () => {
    const unicodeLog = [
      "12:00:00.000 (0)|EXECUTION_STARTED",
      "12:00:00.001 (1)|USER_DEBUG|[1]|DEBUG|café 😀",
      "12:00:00.002 (2)|EXECUTION_FINISHED",
    ].join("\n");
    const result = await handleParseLog({ logText: unicodeLog });
    const report = JSON.parse(result.content[0]!.text) as {
      rawLog: { bytes: number };
    };

    expect(report.rawLog.bytes).toBe(
      new TextEncoder().encode(unicodeLog).byteLength,
    );
  });

  it("projects canonical performance fields", async () => {
    const report = await resultJson(handleAnalyzePerformance);

    expect(report).toHaveProperty("cpuAttribution");
    expect(report).toHaveProperty("executionPhases");
    expect(report).toHaveProperty("hotspots");
    expect(report).not.toHaveProperty("spanHotspots");
  });

  it("projects canonical SOQL fields", async () => {
    const report = await resultJson(handleAnalyzeSoql);

    expect(report).toHaveProperty("database.soqlPatterns");
    expect(report).toHaveProperty("soqlPatterns");
    expect(report).not.toHaveProperty("soqlPatternAnalysis");
  });

  it("projects canonical governor-limit fields", async () => {
    const report = await resultJson(handleAnalyzeGovernorLimits);

    expect(report).toHaveProperty("limits.cumulative");
    expect(report).toHaveProperty("governorBurnRate");
    expect(report).not.toHaveProperty("governorLimits");
  });

  it("projects the canonical execution context in summaries", async () => {
    const report = await resultJson(handleSummarize);

    expect(report).toHaveProperty("executionContext.type");
    expect(report).toHaveProperty("totalEvents");
    expect(report).toHaveProperty("schema.version");
    expect(report).toHaveProperty("source.input.fileName", "inline.log");
    expect(report).not.toHaveProperty("meta");
  });
});
