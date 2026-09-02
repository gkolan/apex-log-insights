import { performance } from "node:perf_hooks";

import { ApexLogParser } from "./certinia/index.js";
import { parseSafeIntegerToken } from "./logFields.js";
import type { EvidenceConfidence } from "./phases.js";

type UnknownRecord = Record<string, unknown>;

/**
 * Identifies how the log text was obtained. Used to tailor parsing
 * heuristics for each ingestion path.
 *
 * - `'file'` — read from a `.log` file on disk (default).
 * - `'salesforce-page'` — pasted or scraped from a Salesforce Setup page.
 * - `'clipboard'` — pasted directly from the clipboard.
 */
export type ParseSourceType = "file" | "salesforce-page" | "clipboard";

/**
 * Options accepted by {@link parseLog}.
 */
export interface ParseLogOptions {
  /**
   * Human-readable name shown in reports to identify this log.
   * @default 'inline.log'
   */
  sourceName?: string;

  /**
   * How the log text was obtained.
   * @default 'file'
   */
  sourceType?: ParseSourceType;

  /**
   * When `true`, the raw log lines are included in the result under
   * {@link NormalizedParseResult.rawLines}. Useful for evidence linking
   * and offline reports, but increases memory usage.
   * @default false
   */
  includeRawLines?: boolean;

  /**
   * When `true`, the parser infers Salesforce execution phases
   * (before triggers, validation rules, after-save flows, etc.) from
   * the event stream. Disable if you only need the flat timeline.
   * @default true
   */
  enablePhaseInference?: boolean;
}

/**
 * A single line from the original debug log file, identified by its
 * 1-based line number. Used for evidence linking in offline reports.
 */
export interface RawLogLine {
  /** Sequential identifier (1-based, same as {@link lineNumber}). */
  id: number;

  /** 1-based line number within the log file. */
  lineNumber: number;

  /** Full text content of the log line. */
  text: string;
}

/**
 * A single event from the normalized timeline produced by the parser.
 * Events are sorted chronologically and carry evidence metadata that
 * links them back to the raw log lines they were extracted from.
 */
export interface NormalizedTimelineEvent {
  /** Unique identifier within this parse result (e.g. `'event-42'`). */
  id: string;

  /** Salesforce log event type (e.g. `'CODE_UNIT_STARTED'`, `'SOQL_EXECUTE_BEGIN'`). */
  type: string;

  /** Event start timestamp in nanoseconds, or `null` if unavailable. */
  timestampNs: number | null;

  /** True when malformed source timing was replaced only to preserve ordering. */
  timestampIsInferred: boolean;

  /** Event end timestamp in nanoseconds, or `null` for instant events. */
  endNs: number | null;

  /** Duration in nanoseconds (`endNs - timestampNs`), or `null` if either bound is missing. */
  durationNs: number | null;

  /** Line number within the Apex source class, or `null` if not applicable. */
  lineNumber: number | null;

  /** Parsed display text for this event, or `null`. */
  text: string | null;

  /** Package namespace that emitted this event (e.g. `'default'`, `'cerFFA'`), or `null`. */
  namespace: string | null;

  /** ID of the parent event in the call tree, or `null` for root-level events. */
  parentId: string | null;

  /** Whether a paired begin/end operation was complete or ended abnormally. */
  pairingStatus:
    | "not_applicable"
    | "complete"
    | "missing_end"
    | "orphan_end"
    | "closed_by_exception"
    | "closed_at_truncation"
    | "depth_limit";

  durationIsPartial: boolean;
  classification: "supported" | "unsupported";

  /** Evidence linking this event back to the raw debug log. */
  evidence: {
    /** First raw log line number that supports this event. */
    startLine: number | null;
    /** Last raw log line number that supports this event. */
    endLine: number | null;
    /** Specific line numbers referenced, when available. */
    lineIds?: number[];
    /** How confidently this event maps to the raw log. */
    confidence: EvidenceConfidence;
  };
}

/** Aggregated parser evidence for input that could not be interpreted fully. */
export interface NormalizedParsingDiagnostic {
  type: "INVALID_LOG_LINE" | "UNSUPPORTED_EVENT" | "MALFORMED_EVENT";
  count: number;
  firstLine: number | null;
  lastLine: number | null;
  /** At most three parser-bounded raw examples. */
  samples: string[];
}

/**
 * The fully normalized output of {@link parseLog}. Contains the
 * chronological timeline, parser issues, and metadata about what
 * capabilities were enabled during parsing.
 */
export interface NormalizedParseResult {
  /** Human-readable source identifier. */
  sourceName: string;

  /** How the log was obtained. */
  sourceType: ParseSourceType;

  /**
   * The raw parser result object from the Certinia vendor parser.
   * Typed as `unknown` because downstream code should use the
   * normalized fields instead of reaching into vendor internals.
   */
  parserResult: unknown;

  /** Wall-clock time spent parsing, in milliseconds. */
  parseTimeMs: number;

  /** Raw log lines, present only when `includeRawLines` was `true`. */
  rawLines?: RawLogLine[];

  /** Chronologically sorted, deduplicated event timeline. */
  normalizedTimeline: NormalizedTimelineEvent[];

  /** Issues detected during parsing (warnings, errors, unexpected patterns). */
  issues: Array<{
    id: string;
    summary: string;
    description: string;
    occurrences: number;
    firstTimestampNs: number | null;
    lastTimestampNs: number | null;
    confidence: EvidenceConfidence;
  }>;

  /** Structured, aggregated diagnostics copied from the parser boundary. */
  parserDiagnostics: NormalizedParsingDiagnostic[];

  /** Number of distinct legacy warning strings omitted after the safety cap. */
  parsingErrorOverflowCount: number;

  /** Issue occurrences represented only by the parser's overflow aggregate. */
  logIssueOverflowCount: number;

  /** Flags indicating which optional features were active for this parse. */
  capabilities: {
    includeRawLines: boolean;
    phaseInferenceEnabled: boolean;
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return value;
  if (typeof value === "string")
    return parseSafeIntegerToken(value) ?? undefined;
  return undefined;
}

function readPath(obj: unknown, keys: string[]): unknown {
  if (!isRecord(obj)) return undefined;
  for (const key of keys) {
    // Skip null/undefined so fallback aliases are tried when the first key exists
    // but carries no usable value (e.g. parserResult.logIssues = null).
    if (
      Object.prototype.hasOwnProperty.call(obj, key) &&
      obj[key] !== null &&
      obj[key] !== undefined
    )
      return obj[key];
  }
  return undefined;
}

async function runVendorParser(logText: string): Promise<unknown> {
  const parser = new ApexLogParser() as unknown as Record<string, unknown>;

  if (typeof parser.parse === "function") {
    return (parser.parse as (input: string) => unknown)(logText);
  }
  throw new Error(
    "Parser contract violation: ApexLogParser.parse() is required.",
  );
}

function normalizeTimeline(parserResult: unknown): NormalizedTimelineEvent[] {
  const nodes: NormalizedTimelineEvent[] = [];
  const rootChildren = readPath(parserResult, ["children"]);
  const stack: Array<{ node: unknown; parentId: string | null }> =
    Array.isArray(rootChildren)
      ? rootChildren.map((node) => ({ node, parentId: null })).reverse()
      : [];

  while (stack.length > 0) {
    const frame = stack.pop()!;
    const child = frame.node;
    const type = asString(readPath(child, ["type"])) ?? "UNKNOWN";
    const timestampNs = asNumber(readPath(child, ["timestamp"])) ?? null;
    const endNs = asNumber(readPath(child, ["exitStamp"])) ?? null;
    const lineNumber = asNumber(readPath(child, ["lineNumber"])) ?? null;
    const rawLineNumber = asNumber(readPath(child, ["rawLineNumber"])) ?? null;
    const exitRawLineNumber =
      asNumber(readPath(child, ["exitRawLineNumber"])) ?? null;
    const text = asString(readPath(child, ["text"])) ?? null;
    const namespace = asString(readPath(child, ["namespace"])) ?? null;
    const pairingStatus =
      (asString(readPath(child, ["pairingStatus"])) as
        NormalizedTimelineEvent["pairingStatus"] | undefined) ??
      "not_applicable";
    const durationIsPartial =
      readPath(child, ["durationIsPartial"]) === true ||
      (timestampNs !== null && endNs !== null && endNs < timestampNs) ||
      !["not_applicable", "complete"].includes(pairingStatus);
    const durationNs =
      !durationIsPartial &&
      timestampNs !== null &&
      endNs !== null &&
      endNs >= timestampNs
        ? endNs - timestampNs
        : null;
    const id = `event-${nodes.length + 1}`;
    const event: NormalizedTimelineEvent = {
      id,
      type,
      timestampNs,
      timestampIsInferred: readPath(child, ["timestampIsInferred"]) === true,
      endNs,
      durationNs,
      lineNumber,
      text,
      namespace,
      parentId: frame.parentId,
      pairingStatus,
      durationIsPartial,
      classification:
        readPath(child, ["classification"]) === "unsupported"
          ? "unsupported"
          : "supported",
      evidence: {
        startLine: rawLineNumber,
        endLine: exitRawLineNumber ?? rawLineNumber,
        ...(rawLineNumber !== null
          ? {
              lineIds:
                exitRawLineNumber !== null &&
                exitRawLineNumber !== rawLineNumber
                  ? [rawLineNumber, exitRawLineNumber]
                  : [rawLineNumber],
            }
          : {}),
        confidence: "direct",
      },
    };
    nodes.push(event);

    const children = readPath(child, ["children"]);
    if (Array.isArray(children)) {
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({ node: children[index], parentId: id });
      }
    }
  }
  // Extract the trailing integer from IDs like "event-10" for numeric tie-breaking,
  // so "event-10" correctly sorts after "event-2" instead of before it.
  const idSortKey = (id: string): number => {
    const m = id.match(/(\d+)$/);
    return m ? Number(m[1]) : 0;
  };
  nodes.sort((a, b) => {
    const aTs = a.timestampNs ?? Number.MAX_SAFE_INTEGER;
    const bTs = b.timestampNs ?? Number.MAX_SAFE_INTEGER;
    if (aTs !== bTs) return aTs - bTs;
    return idSortKey(a.id) - idSortKey(b.id);
  });
  return nodes;
}

function normalizeIssues(
  parserResult: unknown,
): NormalizedParseResult["issues"] {
  const issues = Array.isArray(readPath(parserResult, ["logIssues"]))
    ? (readPath(parserResult, ["logIssues"]) as unknown[])
    : [];

  return issues.map((issue, index) => {
    const firstTimestampNs = asNumber(readPath(issue, ["startTime"])) ?? null;
    return {
      id: `issue-${index + 1}`,
      summary: asString(readPath(issue, ["summary"])) ?? "Log issue",
      description: asString(readPath(issue, ["description"])) ?? "",
      occurrences: asNumber(readPath(issue, ["occurrences"])) ?? 1,
      firstTimestampNs,
      lastTimestampNs:
        asNumber(readPath(issue, ["lastTime"])) ?? firstTimestampNs,
      confidence: "direct",
    };
  });
}

function normalizeParsingDiagnostics(
  parserResult: unknown,
): NormalizedParsingDiagnostic[] {
  const allowedTypes = new Set<NormalizedParsingDiagnostic["type"]>([
    "INVALID_LOG_LINE",
    "UNSUPPORTED_EVENT",
    "MALFORMED_EVENT",
  ]);
  const diagnostics = readPath(parserResult, ["parsingDiagnostics"]);
  if (!Array.isArray(diagnostics)) return [];
  const lineNumber = (value: unknown): number | null => {
    const parsed = asNumber(value);
    return parsed !== undefined && parsed >= 1 ? Math.floor(parsed) : null;
  };

  return diagnostics.flatMap((entry) => {
    const type = asString(readPath(entry, ["type"]));
    if (
      !type ||
      !allowedTypes.has(type as NormalizedParsingDiagnostic["type"])
    ) {
      return [];
    }
    const samples = readPath(entry, ["samples"]);
    return [
      {
        type: type as NormalizedParsingDiagnostic["type"],
        count: Math.max(
          0,
          Math.floor(asNumber(readPath(entry, ["count"])) ?? 0),
        ),
        firstLine: lineNumber(readPath(entry, ["firstLine"])),
        lastLine: lineNumber(readPath(entry, ["lastLine"])),
        samples: Array.isArray(samples)
          ? samples
              .filter((sample): sample is string => typeof sample === "string")
              .map((sample) => sample.slice(0, 500))
              .slice(0, 3)
          : [],
      },
    ];
  });
}

/**
 * High-level entry point for parsing a Salesforce Apex debug log.
 *
 * Runs the Certinia parser, then normalises the result into a
 * flat, chronological timeline with evidence metadata.
 *
 * @param logText - The full text content of the Apex debug log.
 * @param options - Optional configuration (source name, source type,
 *   whether to include raw lines, whether to enable phase inference).
 * @returns A promise that resolves to a {@link NormalizedParseResult}
 *   containing the timeline, issues, and parse metadata.
 *
 * @example
 * ```ts
 * import { parseLog } from '@apex-log-insights/core';
 *
 * const result = await parseLog(logText, {
 *   sourceName: 'MyTrigger.log',
 *   includeRawLines: true,
 * });
 * console.log(result.normalizedTimeline.length, 'events');
 * ```
 */
export async function parseLog(
  logText: string,
  options: ParseLogOptions = {},
): Promise<NormalizedParseResult> {
  const {
    sourceName = "inline.log",
    sourceType = "file",
    includeRawLines = false,
    enablePhaseInference = true,
  } = options;

  const t0 = performance.now();
  const parserResult = await runVendorParser(logText);
  const parseTimeMs = Math.round((performance.now() - t0) * 1000) / 1000;

  const rawLines = includeRawLines
    ? logText.split(/\r\n|\r|\n/).map((text, index) => ({
        id: index + 1,
        lineNumber: index + 1,
        text,
      }))
    : undefined;

  return {
    sourceName,
    sourceType,
    parserResult,
    parseTimeMs,
    ...(rawLines ? { rawLines } : {}),
    normalizedTimeline: normalizeTimeline(parserResult),
    issues: normalizeIssues(parserResult),
    parserDiagnostics: normalizeParsingDiagnostics(parserResult),
    parsingErrorOverflowCount: Math.max(
      0,
      Math.floor(
        asNumber(readPath(parserResult, ["parsingErrorOverflowCount"])) ?? 0,
      ),
    ),
    logIssueOverflowCount: Math.max(
      0,
      Math.floor(
        asNumber(readPath(parserResult, ["logIssueOverflowCount"])) ?? 0,
      ),
    ),
    capabilities: {
      includeRawLines,
      phaseInferenceEnabled: enablePhaseInference,
    },
  };
}
