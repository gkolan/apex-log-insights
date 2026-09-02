import {
  parseLog,
  buildInsightsReport,
  utf8ByteLength,
} from "@apex-log-insights/core";
import { resolveLogInput } from "./resolveLogInput.js";
import { redactReport } from "../redact.js";
import { stringifyJson } from "../jsonStringify.js";

export const summarizeTool = {
  name: "summarize_log",
  description:
    "Generate a quick one-line summary of an Apex debug log. " +
    "Returns execution context, total events, parse time, and key metrics.",
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

export async function handleSummarize(
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

  const context = report.context as Record<string, unknown> | undefined;
  const summary = {
    fileName: input.sourceName,
    parseTimeMs: parsed.parseTimeMs,
    totalEvents: parsed.normalizedTimeline.length,
    issues: parsed.issues.length,
    executionContext: context?.executionContext,
    schema: report.schema,
    source: report.source,
  };

  return {
    content: [{ type: "text" as const, text: stringifyJson(summary) }],
  };
}
