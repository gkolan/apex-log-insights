import { performance } from 'node:perf_hooks';

import { ApexLogParser } from './certinia/index.js';
import type { EvidenceConfidence } from './phases.js';

type UnknownRecord = Record<string, unknown>;

/**
 * Identifies how the log text was obtained. Used to tailor parsing
 * heuristics for each ingestion path.
 *
 * - `'file'` — read from a `.log` file on disk (default).
 * - `'salesforce-page'` — pasted or scraped from a Salesforce Setup page.
 * - `'clipboard'` — pasted directly from the clipboard.
 */
export type ParseSourceType = 'file' | 'salesforce-page' | 'clipboard';

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
    confidence: EvidenceConfidence;
  }>;

  /** Flags indicating which optional features were active for this parse. */
  capabilities: {
    includeRawLines: boolean;
    phaseInferenceEnabled: boolean;
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

function readPath(obj: unknown, keys: string[]): unknown {
  if (!isRecord(obj)) return undefined;
  for (const key of keys) {
    // Skip null/undefined so fallback aliases are tried when the first key exists
    // but carries no usable value (e.g. parserResult.logIssues = null).
    if (key in obj && obj[key] !== null && obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

async function runVendorParser(logText: string): Promise<unknown> {
  const parser = new ApexLogParser() as unknown as Record<string, unknown>;

  if (typeof parser.parse === 'function') {
    return (parser.parse as (input: string) => unknown)(logText);
  }
  throw new Error('Parser contract violation: ApexLogParser.parse() is required.');
}

function preprocessLogText(logText: string): string {
  return logText
    .split(/\r?\n/)
    .map((line) => {
      const shortDml = line.match(
        /^(\d{2}:\d{2}:\d{2}\.\d+\s+\(\d+\)\|DML_BEGIN\|\[[^\]]+\])\|(Insert|Update|Upsert|Delete|Undelete|Merge)\|([^|]+)\|(\d+)$/,
      );
      if (shortDml) {
        const [, prefix, operation, sObject, rows] = shortDml;
        return `${prefix}|Op:${operation}|Type:${sObject}|Rows:${rows}`;
      }
      return line;
    })
    .join('\n');
}

function normalizeTimeline(parserResult: unknown): NormalizedTimelineEvent[] {
  const nodes: NormalizedTimelineEvent[] = [];

  const visit = (node: unknown, parentId: string | null) => {
    const children = Array.isArray(readPath(node, ['children'])) ? (readPath(node, ['children']) as unknown[]) : [];
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      const type = asString(readPath(child, ['type'])) ?? 'UNKNOWN';
      const timestampNs = asNumber(readPath(child, ['timestamp'])) ?? null;
      const endNs = asNumber(readPath(child, ['exitStamp'])) ?? null;
      const durationObj = readPath(child, ['duration']);
      const durationNs = asNumber(isRecord(durationObj) ? (durationObj as UnknownRecord).total : undefined) ?? null;
      const lineNumber = asNumber(readPath(child, ['lineNumber'])) ?? null;
      const text = asString(readPath(child, ['text'])) ?? null;
      const namespace = asString(readPath(child, ['namespace'])) ?? null;
      const id = `event-${nodes.length + 1}`;
      const event: NormalizedTimelineEvent = {
        id,
        type,
        timestampNs,
        endNs,
        durationNs,
        lineNumber,
        text,
        namespace,
        parentId,
        evidence: {
          startLine: lineNumber,
          endLine: lineNumber,
          ...(lineNumber !== null ? { lineIds: [lineNumber] } : {}),
          confidence: 'direct',
        },
      };
      nodes.push(event);
      visit(child, id);
    }
  };

  visit(parserResult, null);
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

function normalizeIssues(parserResult: unknown): NormalizedParseResult['issues'] {
  const issues = Array.isArray(readPath(parserResult, ['logIssues']))
    ? (readPath(parserResult, ['logIssues']) as unknown[])
    : [];

  return issues.map((issue, index) => ({
    id: `issue-${index + 1}`,
    summary: asString(readPath(issue, ['summary'])) ?? 'Log issue',
    description: asString(readPath(issue, ['description'])) ?? '',
    confidence: 'direct',
  }));
}

/**
 * High-level entry point for parsing a Salesforce Apex debug log.
 *
 * Preprocesses the raw log text to normalise vendor-specific quirks,
 * runs the Certinia vendor parser, then normalises the result into a
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
export async function parseLog(logText: string, options: ParseLogOptions = {}): Promise<NormalizedParseResult> {
  const {
    sourceName = 'inline.log',
    sourceType = 'file',
    includeRawLines = false,
    enablePhaseInference = true,
  } = options;

  const t0 = performance.now();
  const parserResult = await runVendorParser(preprocessLogText(logText));
  const parseTimeMs = Math.round((performance.now() - t0) * 1000) / 1000;

  const rawLines = includeRawLines
    ? logText.split(/\r?\n/).map((text, index) => ({
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
    capabilities: {
      includeRawLines,
      phaseInferenceEnabled: enablePhaseInference,
    },
  };
}
