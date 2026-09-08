import {
  parseLog,
  buildInsightsReport,
  utf8ByteLength,
} from "@apex-log-insights/core";
import { resolveLogInput } from "./resolveLogInput.js";
import { redactReport } from "../redact.js";
import { stringifyJson } from "../jsonStringify.js";

export const analyzeSoqlTool = {
  name: "analyze_soql",
  description:
    "Analyze SOQL queries in an Apex debug log. " +
    "Detects duplicate queries, expensive patterns, and provides row counts.",
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

export async function handleAnalyzeSoql(
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

  const database = report.database as Record<string, unknown> | undefined;
  const soql = {
    database,
    soqlPatterns: database?.soqlPatterns,
  };

  return {
    content: [{ type: "text" as const, text: stringifyJson(soql) }],
  };
}
