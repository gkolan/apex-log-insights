import {
  buildInsightsReport,
  parseLog,
  utf8ByteLength,
} from "@apex-log-insights/core";

import { redactReport } from "../redact.js";
import { stringifyJson } from "../jsonStringify.js";
import { resolveLogInput } from "./resolveLogInput.js";

type UnknownRecord = Record<string, unknown>;

const logSourceSchema = {
  type: "object" as const,
  properties: {
    logText: { type: "string", description: "Raw Apex debug log text." },
    filePath: {
      type: "string",
      description: "Relative path to an Apex debug log.",
    },
  },
  oneOf: [{ required: ["logText"] }, { required: ["filePath"] }],
};

export const compareLogsTool = {
  name: "compare_logs",
  description:
    "Compare two Apex debug logs and return explicit deltas for duration, CPU, heap, SOQL, DML, callouts, and reported errors.",
  inputSchema: {
    type: "object" as const,
    properties: {
      baseline: {
        ...logSourceSchema,
        description: "The log used as the baseline.",
      },
      candidate: {
        ...logSourceSchema,
        description: "The log compared with the baseline.",
      },
      redact: {
        type: "boolean",
        description:
          "Redact recognized sensitive values before deriving the comparison.",
      },
    },
    required: ["baseline", "candidate"],
  },
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function numberAt(value: unknown, ...path: string[]): number | null {
  let current = value;
  for (const key of path) current = record(current)[key];
  return typeof current === "number" && Number.isFinite(current)
    ? current
    : null;
}

function textAt(value: unknown, ...path: string[]): string | null {
  let current = value;
  for (const key of path) current = record(current)[key];
  return typeof current === "string" && current.trim() ? current : null;
}

async function buildReport(args: UnknownRecord, redact: boolean) {
  const input = await resolveLogInput(args);
  const parsed = await parseLog(input.text, {
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    enablePhaseInference: true,
  });
  const report = buildInsightsReport({
    filePath: input.sourceName,
    fileBytes: utf8ByteLength(input.text),
    generatedAt: new Date().toISOString(),
    parseTimeMs: parsed.parseTimeMs,
    parserResult: parsed.parserResult,
  });
  return redact ? redactReport(report) : report;
}

function snapshot(report: unknown) {
  return {
    executionContext:
      textAt(report, "context", "executionContext", "label") ??
      textAt(report, "context", "executionContext", "type"),
    totalDurationMs: numberAt(
      report,
      "overview",
      "topMetrics",
      "totalDurationMs",
    ),
    cpuTimeMs: numberAt(report, "overview", "topMetrics", "cpuTimeMs"),
    heapBytesMax: numberAt(report, "overview", "topMetrics", "heapBytesMax"),
    soqlCount: numberAt(report, "overview", "topMetrics", "soql", "count"),
    soqlRows: numberAt(report, "overview", "topMetrics", "soql", "rows"),
    dmlStatements: numberAt(
      report,
      "overview",
      "topMetrics",
      "dml",
      "statements",
    ),
    dmlRows: numberAt(report, "overview", "topMetrics", "dml", "rows"),
    callouts: numberAt(report, "overview", "topMetrics", "callouts", "count"),
    errorCount: numberAt(report, "errors", "count"),
  };
}

function numericDeltas(
  baseline: ReturnType<typeof snapshot>,
  candidate: ReturnType<typeof snapshot>,
) {
  return Object.fromEntries(
    Object.keys(baseline)
      .filter((key) => key !== "executionContext")
      .map((key) => {
        const baselineValue = baseline[key as keyof typeof baseline];
        const candidateValue = candidate[key as keyof typeof candidate];
        const delta =
          typeof baselineValue === "number" &&
          typeof candidateValue === "number"
            ? candidateValue - baselineValue
            : null;
        return [key, delta];
      }),
  );
}

export async function handleCompareLogs(args: UnknownRecord | undefined) {
  const baselineArgs = record(args?.baseline);
  const candidateArgs = record(args?.candidate);
  if (!args?.baseline || !args?.candidate) {
    throw new Error("Provide both baseline and candidate log sources.");
  }
  const redact = args?.redact === true;
  const [baselineReport, candidateReport] = await Promise.all([
    buildReport(baselineArgs, redact),
    buildReport(candidateArgs, redact),
  ]);
  const baseline = snapshot(baselineReport);
  const candidate = snapshot(candidateReport);
  const comparison = {
    baseline,
    candidate,
    delta: numericDeltas(baseline, candidate),
    deltaDefinition: "candidate minus baseline",
  };
  return {
    content: [{ type: "text" as const, text: stringifyJson(comparison) }],
  };
}
