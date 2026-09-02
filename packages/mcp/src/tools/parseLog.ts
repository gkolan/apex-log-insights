import {
  parseLog,
  buildInsightsReport,
  utf8ByteLength,
} from "@apex-log-insights/core";
import { resolveLogInput } from "./resolveLogInput.js";
import { redactReport } from "../redact.js";
import { stringifyJson } from "../jsonStringify.js";

export const parseLogTool = {
  name: "parse_apex_log",
  description:
    "Parse a Salesforce Apex debug log into a structured analysis. " +
    "Accepts either raw log text or a file path. Returns execution timeline, " +
    "governor limit usage, SOQL/DML breakdown, and diagnostics.",
  inputSchema: {
    type: "object" as const,
    properties: {
      logText: {
        type: "string",
        description: "Raw Apex debug log text to parse.",
      },
      filePath: {
        type: "string",
        description: "Path to an Apex debug log file on disk.",
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

export async function handleParseLog(
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
  });

  if (redact) {
    report = redactReport(report) as typeof report;
  }

  return {
    content: [{ type: "text" as const, text: stringifyJson(report) }],
  };
}
