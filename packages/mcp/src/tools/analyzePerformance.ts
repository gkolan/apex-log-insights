import {
  parseLog,
  buildInsightsReport,
  utf8ByteLength,
} from "@apex-log-insights/core";
import { resolveLogInput } from "./resolveLogInput.js";
import { redactReport } from "../redact.js";
import { stringifyJson } from "../jsonStringify.js";

export const analyzePerformanceTool = {
  name: "analyze_performance",
  description:
    "Analyze performance hotspots in an Apex debug log. " +
    "Returns CPU attribution, execution phases, and timing breakdowns.",
  inputSchema: {
    type: "object" as const,
    properties: {
      logText: { type: "string", description: "Raw Apex debug log text." },
      filePath: {
        type: "string",
        description: "Path to an Apex debug log file.",
      },
      redact: {
        type: "boolean",
        description:
          "Redact PII (Salesforce IDs, emails, phones, debug values) from the response. " +
          "Recommended when using cloud-based AI services.",
      },
    },
    oneOf: [{ required: ["logText"] }, { required: ["filePath"] }],
  },
};

export async function handleAnalyzePerformance(
  args: Record<string, unknown> | undefined,
) {
  const redact = typeof args?.redact === "boolean" ? args.redact : false;
  const input = await resolveLogInput(args);
  const { text } = input;

  const parsed = await parseLog(text, {
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    enablePhaseInference: true,
  });

  let report = buildInsightsReport({
    filePath: input.sourceName,
    fileBytes: utf8ByteLength(text),
    generatedAt: new Date().toISOString(),
    parseTimeMs: parsed.parseTimeMs,
    parserResult: parsed.parserResult,
  }) as Record<string, unknown>;

  if (redact) {
    report = redactReport(report) as typeof report;
  }

  const performanceReport = report.performance as
    Record<string, unknown> | undefined;

  // Extract performance-specific sections
  const performance = {
    cpuAttribution: report.cpuAttribution,
    executionPhases: report.executionPhases,
    hotspots: performanceReport?.hotspots,
    parseTimeMs: parsed.parseTimeMs,
  };

  return {
    content: [{ type: "text" as const, text: stringifyJson(performance) }],
  };
}
