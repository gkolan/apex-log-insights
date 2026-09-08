/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

import type { ApexLogParser, DebugLevel } from "./ApexLogParser.js";
import type {
  CPUType,
  DebugCategory,
  GovernorLimits,
  Limits,
  LineNumber,
  LogCategory,
  LogEventType,
  LogIssue,
  ParsingDiagnostic,
  SelfTotal,
} from "./types.js";
import { DEBUG_CATEGORY, LOG_CATEGORY } from "./types.js";
import { parseSafeIntegerToken } from "../logFields.js";

/**
 * All log lines extend this base class.
 */
export abstract class LogEvent {
  logParser: ApexLogParser;

  parent: LogEvent | null = null;

  /**
   * All child nodes of the current node
   */
  children: LogEvent[] = [];

  /**
   * The type of this log line from the log file e.g METHOD_ENTRY
   */
  type: LogEventType | null = null;

  /**
   * The full raw text of this log line
   */
  logLine = ""; // the raw text of this log line

  /**
   * A parsed version of the log line text useful for display in UIs
   */
  text = "";

  /**
   * Should this log entry pull in following text lines (as the log entry can contain newlines)?
   */
  acceptsText = false;

  /**
   * Is a method exit line?
   */
  isExit = false;

  /**
   * Indicates whether the current log event could have children.
   * It is possible this is true but there are no defined exit events or children.
   */
  isParent = false;

  /**
   * Whether the log event was truncated when the log ended, e.g. no matching end event
   */
  isTruncated = false;

  /** Whether a paired begin/end operation was observed or ended abnormally. */
  pairingStatus:
    | "not_applicable"
    | "complete"
    | "missing_end"
    | "orphan_end"
    | "closed_by_exception"
    | "closed_at_truncation"
    | "depth_limit" = "not_applicable";

  /** True when duration ends at inferred or incomplete evidence. */
  durationIsPartial = false;

  /** Forward-compatible classification for events without known semantics. */
  classification: "supported" | "unsupported" = "supported";

  /** True when this typed record continues the preceding operation. */
  isContinuation = false;

  /**
   * Should the exitstamp be the timestamp of the next line?
   * These kind of lines can not be used as exit lines for anything othe than other pseudo exits.
   */
  nextLineIsExit = false;

  /**
   * The line number within the containing class
   */
  lineNumber: LineNumber = null;

  /** 1-based physical line number in the Salesforce debug-log file. */
  rawLineNumber: number | null = null;

  /** Physical log line containing this event's matched exit record. */
  exitRawLineNumber: number | null = null;

  /** Original text of this event's matched exit record. */
  exitLogLine: string | null = null;

  /**
   * The package namespace associated with this log line
   * @default default
   */
  namespace: string | "default" = "";

  /**
   * Could match to a corresponding symbol in a file in the workspace?
   */
  hasValidSymbols = false;

  /**
   * Extra description context
   */
  suffix: string | null = null;

  /**
   * Does this line cause a discontinuity in the call stack? e.g an exception causing stack unwinding
   */
  discontinuity = false;

  /**
   * The timestamp of this log line, in nanoseconds
   */
  timestamp = 0;

  /** Whether timestamp was substituted to retain a malformed record. */
  timestampIsInferred = false;

  /**
   * The timestamp when the node finished, in nanoseconds
   */
  exitStamp: number | null = null;

  /**
   * The timeline display category this event belongs to.
   */
  category: LogCategory = "";

  /**
   * The original Salesforce debug log category.
   */
  debugCategory: DebugCategory = "";

  /**
   * The CPU type, e.g loading, method, custom
   */
  cpuType: CPUType = ""; // the category key to collect our cpu usage

  /**
   * The time spent.
   */
  duration: SelfTotal = {
    /**
     * The net (wall) time spent in the node (when not inside children)
     */
    self: 0,
    /**
     * The total (wall) time spent in the node
     */
    total: 0,
  };

  /**
   * Total + self row counts for DML
   */
  dmlRowCount: SelfTotal = {
    /**
     * The net number of DML rows for this node, excluding child nodes
     */
    self: 0,
    /**
     * The total number of DML rows for this node and child nodes
     */
    total: 0,
  };

  /**
   * Total + self row counts for SOQL
   */
  soqlRowCount: SelfTotal = {
    /**
     * The net number of SOQL rows for this node, excluding child nodes
     */
    self: 0,
    /**
     * The total number of SOQL rows for this node and child nodes
     */
    total: 0,
  };

  /**
   * Total + self row counts for SOSL
   */
  soslRowCount: SelfTotal = {
    /**
     * The net number of SOSL rows for this node, excluding child nodes
     */
    self: 0,
    /**
     * The total number of SOSL rows for this node and child nodes
     */
    total: 0,
  };

  /** Whether this database event's own row count was parsed from valid evidence. */
  rowCountIsKnown = true;

  dmlCount: SelfTotal = {
    /**
     * The net number of DML operations (DML_BEGIN) in this node.
     */
    self: 0,
    /**
     * The total number of DML operations (DML_BEGIN) in this node and child nodes
     */
    total: 0,
  };

  soqlCount: SelfTotal = {
    /**
     * The net number of SOQL operations (SOQL_EXECUTE_BEGIN) in this node.
     */
    self: 0,
    /**
     * The total number of SOQL operations (SOQL_EXECUTE_BEGIN) in this node and child nodes
     */
    total: 0,
  };

  soslCount: SelfTotal = {
    /**
     * The net number of SOSL operations (SOSL_EXECUTE_BEGIN) in this node.
     */
    self: 0,
    /**
     * The total number of SOSL operations (SOSL_EXECUTE_BEGIN) in this node and child nodes
     */
    total: 0,
  };

  /**
   * The total number of exceptions thrown (EXCEPTION_THROWN) in this node and child nodes
   */
  totalThrownCount = 0;

  /**
   * The line types which would legitimately end this method
   */
  exitTypes: LogEventType[] = [];

  constructor(parser: ApexLogParser, parts: string[]) {
    this.logParser = parser;
    // Now set actual values from parts
    const [timeData, type] = parts;
    if (type) {
      this.text = this.type = type as LogEventType;
    }
    if (timeData) {
      this.timestamp = this.parseTimestamp(timeData);
    }
  }

  /** Called if a corresponding end event is found during tree parsing*/
  onEnd?(end: LogEvent, stack: LogEvent[]): void;

  /** Called when the Log event after this one is created in the line parser*/
  onAfter?(parser: ApexLogParser, next?: LogEvent): void;

  public recalculateDurations() {
    if (this.exitStamp != null) {
      if (this.exitStamp < this.timestamp) {
        this.duration.total = this.duration.self = 0;
        this.durationIsPartial = true;
        return;
      }
      this.duration.total = this.duration.self =
        this.exitStamp - this.timestamp;
    }
  }

  private parseTimestamp(text: string): number {
    const match = String(text || "").match(/\((\d+)\)$/);
    if (match) {
      const value = Number(match[1]);
      if (Number.isSafeInteger(value) && value >= 0) return value;
    }
    throw new Error(`Unable to parse timestamp: '${text}'`);
  }

  protected parseLineNumber(text: string | null | undefined): LineNumber {
    if (text === "[EXTERNAL]") return "EXTERNAL";
    if (text && /^\[[A-Z_]+\]$/.test(text)) return null;
    if (!text) return 0;
    const match = text.match(/^\[(\d+)\]$/);
    if (match) {
      const value = Number(match[1]);
      if (Number.isSafeInteger(value) && value >= 0) return value;
    }
    throw new Error(`Unable to parse line number: '${text}'`);
  }
}

export class DurationLogEvent extends LogEvent {
  isParent = true;
  constructor(
    parser: ApexLogParser,
    parts: string[],
    exitTypes: LogEventType[],
    category: LogCategory,
    cpuType: CPUType,
    debugCategory: DebugCategory = "",
  ) {
    super(parser, parts);
    this.exitTypes = exitTypes;
    this.category = category;
    this.cpuType = cpuType;
    this.debugCategory = debugCategory;
  }
}

export class BasicLogLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join("|").trim();
  }
}

/**
 * Forward-compatible representation of an event Salesforce introduced before
 * the parser learned its field semantics. The event remains in the timeline so
 * users can inspect its raw evidence instead of losing it during parsing.
 */
export class UnknownLogLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.classification = "unsupported";
    this.text = parts.slice(2).join("|").trim();
  }
}
export class BasicExitLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join("|").trim();
  }
}

/**
 * This export class represents the single root node for the node tree.
 * It is a "pseudo" node and not present in the log.
 * Since it has children it extends "Method".
 */
export class ApexLog extends LogEvent {
  type = null;
  text = "LOG_ROOT";
  timestamp = 0;
  exitStamp = 0;
  exitTypes = [];
  override category: LogCategory = "";
  cpuType: CPUType = "";

  /**
   * The size of the log, in bytes
   */
  public size = 0;

  /**
   * The Apex Debug Logging Levels for the current log
   */
  public debugLevels: DebugLevel[] = [];

  /**
   * All the namespaces that appear in this log.
   */
  public namespaces: string[] = [];

  /**
   * Any issues within the log, such as cpu time exceeded or max log size reached.
   */
  public logIssues: LogIssue[] = [];

  /**
   * Any issues that occurred during the parsing of the log, such as an unrecognized log event type.
   */
  public parsingErrors: string[] = [];

  /** Grouped malformed-input diagnostics with bounded representative samples. */
  public parsingDiagnostics: ParsingDiagnostic[] = [];

  /** Number of additional parser diagnostics omitted after the safety cap. */
  public parsingErrorOverflowCount = 0;

  /** Issue occurrences represented only by the bounded overflow aggregate. */
  public logIssueOverflowCount = 0;

  public governorLimits: GovernorLimits = {
    soqlQueries: { used: 0, limit: 0 },
    soslQueries: { used: 0, limit: 0 },
    queryRows: { used: 0, limit: 0 },
    dmlStatements: { used: 0, limit: 0 },
    publishImmediateDml: { used: 0, limit: 0 },
    dmlRows: { used: 0, limit: 0 },
    cpuTime: { used: 0, limit: 0 },
    heapSize: { used: 0, limit: 0 },
    callouts: { used: 0, limit: 0 },
    emailInvocations: { used: 0, limit: 0 },
    futureCalls: { used: 0, limit: 0 },
    queueableJobsAddedToQueue: { used: 0, limit: 0 },
    mobileApexPushCalls: { used: 0, limit: 0 },
    byNamespace: new Map<string, Limits>(),
    snapshots: [],
  };

  /**
   * The wall-clock time of the first event, in milliseconds since midnight.
   * Parsed from the `HH:MM:SS.f` portion of the first log line.
   * Null if no wall-clock time could be parsed.
   */
  startTime: number | null = null;

  /**
   * The endtime with nodes of 0 duration excluded
   */
  executionEndTime = 0;

  constructor(parser: ApexLogParser) {
    super(parser, []);
  }

  setTimes() {
    const firstChild = this.children[0];
    this.timestamp = firstChild?.timestamp ?? 0;

    // Parse wall-clock time from the first child's log line (HH:MM:SS.f before the '(')
    if (firstChild?.logLine) {
      this.startTime = parseWallClockTime(firstChild.logLine);
    }

    // We do not just want to use the very last exitStamp because it could be CUMULATIVE_USAGE which is not really part of the code execution time but does have a later time.
    let endTime;
    const reverseLen = this.children.length - 1;
    for (let i = reverseLen; i >= 0; i--) {
      const child = this.children[i];
      // If there is no duration on a node then it is not going to be shown on the timeline anyway
      if (child?.exitStamp != null) {
        endTime ??= child.exitStamp;
        if (child.duration.total > 0) {
          this.executionEndTime = child.exitStamp;
          break;
        }
      }
      endTime ??= child?.timestamp;
    }
    this.exitStamp = endTime ?? 0;
    this.recalculateDurations();
  }
}

/**
 * Extracts the package namespace from a Salesforce SObject or field name.
 *
 * Uses the managed-name convention `namespace__Name__suffix`. An unmanaged
 * custom API name such as `Order_Event__e` has only one double-underscore
 * boundary and therefore belongs to the default namespace.
 *
 * @param text - The SObject or field API name (e.g. `'cerFFA__BillingDocument__c'`).
 * @returns The extracted namespace, `'default'` if unmanaged, or `''` if input is empty.
 */
export function parseObjectNamespace(text: string | null | undefined): string {
  if (!text) {
    return "";
  }

  const sep = text.indexOf("__");
  if (sep <= 0 || text.indexOf("__", sep + 2) === -1) {
    return "default";
  }
  return text.slice(0, sep);
}

/**
 * Extracts the package namespace from a Visualforce page or component path.
 *
 * Looks for the `namespace__` prefix before the first `/` separator.
 * Returns `'default'` when no managed namespace is detected.
 *
 * @param text - The Visualforce component path (e.g. `'cerFFA__/apex/InvoicePage'`).
 * @returns The extracted namespace or `'default'`.
 */
export function parseVfNamespace(text: string): string {
  const sep = text.indexOf("__");
  if (sep <= 0) {
    return "default";
  }
  const namespace = text.substring(0, sep);
  // Sanity-check: namespace should not contain slashes (those belong to the path after `__`)
  if (namespace.includes("/")) {
    return "default";
  }
  return namespace;
}

/**
 * Parses the wall-clock time from a log line's timestamp portion.
 * Log lines start with `HH:MM:SS.f (nanoseconds)|...`
 * Returns milliseconds since midnight, or null if parsing fails.
 */
function parseWallClockTime(logLine: string): number | null {
  const match =
    /^((?:[01]\d|2[0-3])):([0-5]\d):([0-5]\d)\.(\d{1,9})(?=\s+\()/.exec(
      logLine,
    );
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const raw = match[4]!;
  // Normalize fractional seconds to 3-digit milliseconds for the return value.
  // Salesforce logs may emit varying precision (e.g., .123, .1234, .123456789).
  // We take only the first 3 digits (millisecond precision) since this value is
  // documented as "milliseconds since midnight" and used for ordering/comparison.
  const fraction = Number(raw.slice(0, 3).padEnd(3, "0"));

  return (hours * 3600 + minutes * 60 + seconds) * 1000 + fraction;
}

/**
 * Parses the row count from a DML or SOQL log event's text.
 *
 * Looks for the `Rows:N` pattern in the text. Falls back to parsing a
 * bare trailing integer if no `Rows:` prefix is found.
 *
 * @param text - The event text containing a row count (e.g. `'Op:Insert|Type:Account|Rows:5'`).
 * @returns The parsed row count, or `null` if the input is empty or unparseable.
 */
export function parseRows(text: string | null | undefined): number | null {
  if (!text) {
    return null;
  }

  const rowMatch = text.match(
    /(?:\bRows|Number of rows processed)\s*:\s*([^\s|]+)/i,
  );
  // Fall back to a bare token when no Rows: label is present.
  const token = rowMatch?.[1] ?? text.trim();
  return parseSafeIntegerToken(token);
}

/* Log line entry Parsers */

export class BulkHeapAllocateLine extends LogEvent {
  logCategory = "Apex Code";
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || "";
  }
}

export class CalloutRequestLine extends DurationLogEvent {
  responseText: string | null = null;
  responseLineNumber: number | null = null;
  responseTimestamp: number | null = null;
  responseLogLine: string | null = null;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["CALLOUT_RESPONSE"],
      LOG_CATEGORY.Callout,
      "free",
      DEBUG_CATEGORY.Callout,
    );
    const linePart = parts[2] || "";
    const hasSourceLine = /^\[[^\]]+\]$/.test(linePart);
    this.isContinuation =
      !hasSourceLine && /^(?:Method|Headers|Body)\s*:/i.test(linePart);
    if (this.isContinuation) {
      this.isParent = false;
      this.exitTypes = [];
    }
    this.text = parts.slice(hasSourceLine ? 3 : 2).join("|");
    if (hasSourceLine) this.lineNumber = this.parseLineNumber(linePart);
  }

  onEnd(end: CalloutResponseLine, _stack: LogEvent[]): void {
    this.responseText = end.text;
    this.responseLineNumber = end.rawLineNumber;
    this.responseTimestamp = end.timestamp;
    this.responseLogLine = end.logLine;
  }
}

export class CalloutResponseLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    const linePart = parts[2] || "";
    const hasSourceLine = /^\[[^\]]+\]$/.test(linePart);
    this.isContinuation = !hasSourceLine && /^Body\s*:/i.test(linePart);
    if (this.isContinuation) this.isExit = false;
    this.text = parts.slice(hasSourceLine ? 3 : 2).join("|");
    if (hasSourceLine) this.lineNumber = this.parseLineNumber(linePart);
  }
}
const NAMED_CREDENTIAL_FIELD_LABELS = [
  "Named Credential Id",
  "Named Credential Name",
  "Endpoint",
  "Method",
  "External Credential Type",
  "Http Header Authorization",
  "Request Size bytes",
  "Retry on 401",
  "Status Code",
  "Response Size bytes",
  "Overall Callout Time ms",
  "Connect Time ms",
] as const;

function parseNamedCredentialFields(payload: string[]): Map<string, string> {
  const text = payload.join("|");
  const labels = NAMED_CREDENTIAL_FIELD_LABELS.map((label) =>
    label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|");
  const pattern = new RegExp(`(?:^|[\\[|,]\\s*)(${labels})\\s*[:=]\\s*`, "gi");
  const matches = Array.from(text.matchAll(pattern));
  const fields = new Map<string, string>();
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const next = matches[index + 1];
    const valueStart = (match.index ?? 0) + match[0].length;
    const valueEnd = next?.index ?? text.length;
    const value = text
      .slice(valueStart, valueEnd)
      .replace(/[|\]\s]+$/g, "")
      .trim();
    fields.set(match[1]!.toLowerCase(), value);
  }
  return fields;
}

function namedCredentialNumber(
  fields: Map<string, string>,
  key: string,
): number | null {
  const raw = fields.get(key.toLowerCase());
  return parseSafeIntegerToken(raw);
}

export class NamedCredentialRequestLine extends LogEvent {
  credentialId: string | null = null;
  credentialName: string | null = null;
  endpoint: string | null = null;
  method: string | null = null;
  externalCredentialType: string | null = null;
  requestSizeBytes: number | null = null;
  retryOn401: boolean | null = null;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Callout;
    const hasSourceLine = /^\[[^\]]+\]$/.test(parts[2] || "");
    if (hasSourceLine) this.lineNumber = this.parseLineNumber(parts[2]);
    const payload = parts.slice(hasSourceLine ? 3 : 2);
    this.isContinuation = /^(?:Headers|Body)\s*:/i.test(payload[0] || "");
    const fields = parseNamedCredentialFields(payload);
    this.credentialId = fields.get("named credential id") || null;
    this.credentialName = fields.get("named credential name") || null;
    this.endpoint = fields.get("endpoint") || null;
    this.method = fields.get("method")?.toUpperCase() || null;
    this.externalCredentialType =
      fields.get("external credential type") || null;
    this.requestSizeBytes = namedCredentialNumber(fields, "request size bytes");
    const retry = fields.get("retry on 401")?.toLowerCase();
    this.retryOn401 =
      retry === "true" ? true : retry === "false" ? false : null;

    if (this.credentialName || this.endpoint || this.method) {
      this.text = payload.join("|");
    } else if ((payload[1] || "").toLowerCase() === "namedcredential") {
      this.method = payload[0]?.toUpperCase() || null;
      this.credentialName = payload[2] || null;
      this.endpoint = payload[3] || null;
      this.text = `${payload[2] ?? ""} : ${payload[3] ?? ""} : ${payload[0] ?? ""} : ${payload.slice(4).join("|")}`;
    } else if ((payload[0] || "").toLowerCase() === "managed") {
      this.credentialName = payload[1] || null;
      this.endpoint = payload[2] || null;
      this.method = payload[3]?.toUpperCase() || null;
      this.text = `${payload[1] ?? ""} : ${payload[2] ?? ""} : ${payload[3] ?? ""} : ${payload.slice(4).join("|")}`;
    } else {
      this.text = payload.join("|");
    }
  }
}

export class NamedCredentialResponseLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Callout;
    const hasSourceLine = /^\[[^\]]+\]$/.test(parts[2] || "");
    if (hasSourceLine) this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts.slice(hasSourceLine ? 3 : 2).join("|");
    this.isContinuation = /^Body\s*:/i.test(this.text);
  }
}

export class NamedCredentialResponseDetailLine extends LogEvent {
  credentialId: string | null = null;
  credentialName: string | null = null;
  statusCode: number | null = null;
  responseSizeBytes: number | null = null;
  overallCalloutTimeMs: number | null = null;
  connectTimeMs: number | null = null;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Callout;
    const hasSourceLine = /^\[[^\]]+\]$/.test(parts[2] || "");
    if (hasSourceLine) this.lineNumber = this.parseLineNumber(parts[2]);
    const payload = parts.slice(hasSourceLine ? 3 : 2);
    const fields = parseNamedCredentialFields(payload);
    this.credentialId = fields.get("named credential id") || null;
    this.credentialName = fields.get("named credential name") || null;
    this.statusCode = namedCredentialNumber(fields, "status code");
    this.responseSizeBytes = namedCredentialNumber(
      fields,
      "response size bytes",
    );
    this.overallCalloutTimeMs = namedCredentialNumber(
      fields,
      "overall callout time ms",
    );
    this.connectTimeMs = namedCredentialNumber(fields, "connect time ms");
    this.text = payload.join("|");
  }
}

export class ConstructorEntryLine extends DurationLogEvent {
  hasValidSymbols = true;
  suffix = " (constructor)";

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["CONSTRUCTOR_EXIT"],
      LOG_CATEGORY.Apex,
      "method",
      DEBUG_CATEGORY.ApexCode,
    );
    this.lineNumber = this.parseLineNumber(parts[2]);
    const [, , , , args, className] = parts;

    this.text = className + (args ? args.substring(args.lastIndexOf("(")) : "");
    const possibleNS = this._parseConstructorNamespace(className || "");
    if (possibleNS) {
      this.namespace = possibleNS;
    }
  }

  _parseConstructorNamespace(className: string): string {
    const dotIndex = className.indexOf(".");
    let possibleNs = dotIndex === -1 ? "" : className.slice(0, dotIndex);
    if (possibleNs && this.logParser.namespaces.has(possibleNs)) {
      return possibleNs;
    }

    const constructorParts = (className ?? "").split(".");
    possibleNs = constructorParts[0] || "";
    // A dotted constructor can also be an unmanaged inner class. Only promote
    // a prefix that another event has already established as a namespace.
    return this.logParser.namespaces.has(possibleNs) ? possibleNs : "";
  }
}

export class ConstructorExitLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

export class EmailQueueLine extends LogEvent {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

export class MethodEntryLine extends DurationLogEvent {
  hasValidSymbols = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["METHOD_EXIT"],
      LOG_CATEGORY.Apex,
      "method",
      DEBUG_CATEGORY.ApexCode,
    );
    const [, , lineNumber, , methodName] = parts;
    this.lineNumber = this.parseLineNumber(lineNumber);
    this.text = methodName ?? this.type ?? this.text;
    if (this.text?.startsWith("System.Type.forName(")) {
      // assume we are not charged for export class loading (or at least not lengthy remote-loading / compiling)
      this.cpuType = "loading";
    } else {
      const possibleNs = this._parseMethodNamespace(methodName);
      if (possibleNs) {
        this.namespace = possibleNs;
      }
    }
  }

  onEnd(end: MethodExitLine, _stack: LogEvent[]): void {
    if (end.namespace && !end.text.endsWith(")")) {
      this.namespace = end.namespace;
    }
  }

  _parseMethodNamespace(methodName: string | undefined): string {
    if (!methodName) {
      return "";
    }

    const methodBracketIndex = methodName.indexOf("(");
    if (methodBracketIndex === -1) {
      return "";
    }

    const nsSeparator = methodName.indexOf(".");
    if (nsSeparator === -1) {
      return "";
    }

    const possibleNs = methodName.slice(0, nsSeparator);
    if (this.logParser.namespaces.has(possibleNs)) {
      return possibleNs;
    }

    const methodNameParts = methodName.slice(0, methodBracketIndex)?.split(".");
    if (methodNameParts.length === 2) {
      return "default";
    }

    return "";
  }
}
export class MethodExitLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[4] ?? parts[3] ?? this.text;

    /*A method will end with ')'. Without that this it represents the first reference to a class, outer or inner. One of the few reliable ways to determine valid namespaces. The first reference to a class (outer or inner) will always have an METHOD_EXIT containing the Outer class name with namespace if present. Other events will follow, CONSTRUCTOR_ENTRY etc. But this case will only ever have 2 parts ns.Outer even if the first reference was actually an inner class e.g new ns.Outer.Inner();*/
    // If does not end in ) then we have a reference to the class, either via outer or inner.
    if (!this.text.endsWith(")")) {
      // if there is a . the we have a namespace e.g ns.Outer
      const index = this.text.indexOf(".");
      if (index !== -1) {
        const possibleNamespace = this.text.slice(0, index);
        this.namespace = this.logParser.namespaces.has(possibleNamespace)
          ? possibleNamespace
          : "default";
      }
    }
  }
}

export class SystemConstructorEntryLine extends DurationLogEvent {
  suffix = "(system constructor)";

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["SYSTEM_CONSTRUCTOR_EXIT"],
      LOG_CATEGORY.System,
      "method",
      DEBUG_CATEGORY.System,
    );
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[3] || "";
  }
}

export class SystemConstructorExitLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}
export class SystemMethodEntryLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["SYSTEM_METHOD_EXIT"],
      LOG_CATEGORY.System,
      "method",
      DEBUG_CATEGORY.System,
    );
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[3] || "";
  }
}

export class SystemMethodExitLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

export class CodeUnitStartedLine extends DurationLogEvent {
  suffix = " (entrypoint)";
  codeUnitType = "";

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["CODE_UNIT_FINISHED"],
      LOG_CATEGORY.CodeUnit,
      "custom",
      DEBUG_CATEGORY.ApexCode,
    );

    const typeString = parts[5] || parts[4] || parts[3] || "";
    let sepIndex = typeString.indexOf(":");
    if (sepIndex === -1) {
      sepIndex = typeString.indexOf("/");
    }
    this.codeUnitType = sepIndex !== -1 ? typeString.slice(0, sepIndex) : "";

    const name = parts[4] || parts[3] || this.codeUnitType || "";
    switch (this.codeUnitType) {
      case "EventService":
        this.cpuType = "method";
        this.namespace = parseObjectNamespace(typeString.slice(sepIndex + 1));
        this.text = name;
        break;
      case "Validation":
        this.cpuType = "custom";
        this.text = name;
        break;
      case "Workflow":
        this.cpuType = "custom";
        this.text = name;
        break;
      case "Flow":
        this.cpuType = "custom";
        this.text = name;
        break;
      case "VF":
        this.cpuType = "method";
        this.namespace = parseVfNamespace(name);
        this.text = name;
        break;
      case "apex": {
        this.cpuType = "method";
        const namespaceIndex = name.indexOf(".");
        this.namespace =
          namespaceIndex !== -1
            ? name.slice(name.indexOf("apex://") + 7, namespaceIndex)
            : "default";
        this.text = name;
        break;
      }
      case "__sfdc_trigger": {
        this.cpuType = "method";
        this.text = typeString;
        const triggerParts = typeString.split("/");
        const objectName =
          triggerParts.length === 3 ? triggerParts[1] || "" : "";
        const triggerName =
          triggerParts.length === 3 ? triggerParts[2] || "" : "";
        const objectNamespace = parseObjectNamespace(objectName);
        const triggerNamespace = triggerName.split("__")[0] || "";
        this.namespace =
          objectNamespace && objectNamespace !== "default"
            ? objectNamespace
            : this.logParser.namespaces.has(triggerNamespace)
              ? triggerNamespace
              : "default";
        break;
      }
      default: {
        this.cpuType = "method";
        this.text = name;
        const openBracket = name.lastIndexOf("(");
        const methodName =
          openBracket !== -1
            ? name.slice(0, openBracket + 1).split(".")
            : name.split(".");
        if (
          methodName.length === 3 ||
          (methodName.length === 2 && !methodName[1]?.endsWith("("))
        ) {
          const possibleNamespace = methodName[0] || "";
          if (this.logParser.namespaces.has(possibleNamespace)) {
            this.namespace = possibleNamespace;
          }
        }
        break;
      }
    }

    this.namespace ||= "default";
  }
}
export class CodeUnitFinishedLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || "";
  }
}

export class VFApexCallStartLine extends DurationLogEvent {
  hasValidSymbols = true;
  suffix = " (VF APEX)";
  invalidClasses = [
    "pagemessagescomponentcontroller",
    "pagemessagecomponentcontroller",
    "severitymessages",
  ];

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["VF_APEX_CALL_END"],
      LOG_CATEGORY.Apex,
      "method",
      DEBUG_CATEGORY.ApexCode,
    );
    this.lineNumber = this.parseLineNumber(parts[2]);

    const classText = parts[5] || parts[3] || "";
    let methodtext = parts[4] || "";
    if (
      !methodtext &&
      (!classText.includes(" ") ||
        this.invalidClasses.some((invalidCls: string) =>
          classText.toLowerCase().includes(invalidCls),
        ))
    ) {
      // we have a system entry and they do not have exits
      // e.g |VF_APEX_CALL_START|[EXTERNAL]|/apexpage/pagemessagescomponentcontroller.apex <init>
      // and they really mess with the logs so skip handling them.
      this.exitTypes = [];
      this.hasValidSymbols = false;
    } else if (methodtext) {
      // method call
      const methodIndex = methodtext.indexOf("(");
      const constructorIndex = methodtext.indexOf("<init>");
      if (methodIndex > -1) {
        // Method
        methodtext =
          "." + methodtext.substring(methodIndex).slice(1, -1) + "()";
      } else if (constructorIndex > -1) {
        // Constructor
        methodtext = methodtext.substring(constructorIndex + 6) + "()";
      } else {
        // Property
        methodtext = "." + methodtext;
      }
    }
    this.text = classText + methodtext;
  }
}

export class VFApexCallEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || "";
  }
}

export class VFDeserializeViewstateBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["VF_DESERIALIZE_VIEWSTATE_END"],
      LOG_CATEGORY.System,
      "method",
      DEBUG_CATEGORY.Visualforce,
    );
  }
}

export class VFFormulaStartLine extends DurationLogEvent {
  suffix = " (VF FORMULA)";

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["VF_EVALUATE_FORMULA_END"],
      LOG_CATEGORY.System,
      "custom",
      DEBUG_CATEGORY.Visualforce,
    );
    this.text = parts[3] || "";
  }
}

export class VFFormulaEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Visualforce;
    this.text = parts[2] || "";
  }
}

export class VFSeralizeViewStateStartLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["VF_SERIALIZE_VIEWSTATE_END"],
      LOG_CATEGORY.System,
      "method",
      DEBUG_CATEGORY.Visualforce,
    );
  }
}

export class VFPageMessageLine extends LogEvent {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.ApexCode;
    this.text = parts[2] || "";
  }
}

export class DMLBeginLine extends DurationLogEvent {
  dmlCount = {
    self: 1,
    total: 1,
  };
  namespace = "default";

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["DML_END"],
      LOG_CATEGORY.DML,
      "free",
      DEBUG_CATEGORY.Database,
    );
    this.lineNumber = this.parseLineNumber(parts[2]);
    const payloadParts = parts.slice(3);
    const payload = payloadParts.join("|");
    const compactOperation = payloadParts[0]?.match(
      /^(Insert|Update|Upsert|Delete|Undelete|Merge)$/i,
    )?.[1];
    const compactObject = payloadParts[1]?.trim();
    const compactRows = payloadParts[2]?.trim();

    if (
      compactOperation &&
      compactObject &&
      compactRows &&
      /^\d[\d,]*$/.test(compactRows)
    ) {
      this.text = `DML Op:${compactOperation} Type:${compactObject} Rows:${compactRows}`;
    } else {
      this.text = `DML ${payloadParts.join(" ")}`;
    }
    const rows = parseRows(payload);
    this.rowCountIsKnown = rows !== null;
    if (rows !== null) this.dmlRowCount.total = this.dmlRowCount.self = rows;
  }
}

export class DMLEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

export class DMLErrorLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Database;
    this.text = String(parts.slice(3).join("|") || "").trim();
  }
}

export class IdeasQueryExecuteLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

/** Database cursor creation, introduced with Apex cursor APIs. */
export class CursorCreateBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["CURSOR_CREATE_END"],
      LOG_CATEGORY.SOQL,
      "free",
      DEBUG_CATEGORY.Database,
    );
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts.slice(3).join("|").trim();
  }
}

export class CursorCreateEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts.slice(3).join("|").trim();
  }
}

/** Cursor fetch records are point events rather than paired spans. */
export class CursorFetchLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.category = LOG_CATEGORY.SOQL;
    this.cpuType = "free";
    this.debugCategory = DEBUG_CATEGORY.Database;
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts.slice(3).join("|").trim();
  }
}

export class CursorFetchPageLine extends CursorFetchLine {}

export class SOQLExecuteBeginLine extends DurationLogEvent {
  aggregations: number | null = null;
  children: SOQLExecuteExplainLine[] = [];
  soqlCount = {
    self: 1,
    total: 1,
  };
  rowCountIsKnown = false;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["SOQL_EXECUTE_END"],
      LOG_CATEGORY.SOQL,
      "free",
      DEBUG_CATEGORY.Database,
    );
    this.lineNumber = this.parseLineNumber(parts[2]);

    const payload = parts.slice(3);
    const aggregationText = payload[0] || "";
    if (/^Aggregations:/i.test(aggregationText)) {
      const rawAggregations = aggregationText.slice(13).trim();
      const parsedAggregations = /^\d+$/.test(rawAggregations)
        ? Number(rawAggregations)
        : NaN;
      this.aggregations =
        Number.isSafeInteger(parsedAggregations) && parsedAggregations >= 0
          ? parsedAggregations
          : null;
      this.text = payload.slice(1).join("|");
    } else {
      this.text = payload.join("|");
    }
  }

  onEnd(end: SOQLExecuteEndLine, _stack: LogEvent[]): void {
    this.rowCountIsKnown = end.rowCountIsKnown;
    this.soqlRowCount.total = this.soqlRowCount.self = end.soqlRowCount.total;
  }
}

export class SOQLExecuteEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    const rows = parseRows(parts[3] || "");
    this.rowCountIsKnown = rows !== null;
    if (rows !== null) this.soqlRowCount.total = this.soqlRowCount.self = rows;
  }
}

/** Safely parse a numeric field from explain plan text, returning null on missing/invalid values. */
function parseNumericField(
  text: string | undefined,
  prefix: string,
  integer: boolean = true,
): number | null {
  if (!text) return null;
  const idx = text.indexOf(prefix);
  if (idx === -1) return null;
  const rawText = text.slice(idx + prefix.length).trim();
  if (rawText === "") return null;
  const raw = Number(rawText);
  if (!Number.isFinite(raw) || raw < 0) return null;
  return !integer || Number.isSafeInteger(raw) ? raw : null;
}

export class SOQLExecuteExplainLine extends LogEvent {
  cardinality: number | null = null; // The estimated number of records that the leading operation type would return
  fields: string[] | null = null; //The indexed field(s) used by the Query Optimizer. If the leading operation type is Index, the fields value is Index. Otherwise, the fields value is null.
  leadingOperationType: string | null = null; // The primary operation type that Salesforce will use to optimize the query.
  relativeCost: number | null = null; // The cost of the query compared to the Force.com Query Optimizer’s selectivity threshold. Values above 1 mean that the query won’t be selective.
  sObjectCardinality: number | null = null; // The approximate record count for the queried object.
  sObjectType: string | null = null; //T he name of the queried SObject

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);

    const queryPlanDetails = parts[3] || "";
    this.text = queryPlanDetails;

    const queryplanParts = queryPlanDetails.split("],");
    if (queryplanParts.length > 1) {
      const planExplain = queryplanParts[0] || "";
      const [cardinalityText, sobjCardinalityText, costText] = (
        queryplanParts[1] || ""
      ).split(",");

      const onIndex = planExplain.indexOf(" on");
      const colonIndex = planExplain.indexOf(" :");
      const bracketIndex = planExplain.indexOf("[");

      if (onIndex === -1 || colonIndex === -1 || bracketIndex === -1) {
        this.leadingOperationType = planExplain;
        this.sObjectType = "";
        this.fields = [];
      } else {
        this.leadingOperationType = planExplain.slice(0, onIndex);
        this.sObjectType = planExplain.slice(onIndex + 4, colonIndex);

        // remove whitespace if there is any. we could have [ field1__c, field2__c ]
        // I am not 100% sure of format when we have multiple fields so this is safer
        const fieldsAsString = planExplain
          .slice(bracketIndex + 1)
          .replace(/\s+/g, "");
        this.fields = fieldsAsString === "" ? [] : fieldsAsString.split(",");

        this.cardinality = parseNumericField(cardinalityText, "cardinality: ");
        this.sObjectCardinality = parseNumericField(
          sobjCardinalityText,
          "sobjectCardinality: ",
        );
        this.relativeCost = parseNumericField(costText, "relativeCost ", false);
      }
    }
  }
}

export class SOSLExecuteBeginLine extends DurationLogEvent {
  soslCount = {
    self: 1,
    total: 1,
  };
  rowCountIsKnown = false;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["SOSL_EXECUTE_END"],
      LOG_CATEGORY.SOQL,
      "free",
      DEBUG_CATEGORY.Database,
    );
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `SOSL: ${parts.slice(3).join("|")}`;
  }

  onEnd(end: SOSLExecuteEndLine, _stack: LogEvent[]): void {
    this.rowCountIsKnown = end.rowCountIsKnown;
    this.soslRowCount.total = this.soslRowCount.self = end.soslRowCount.total;
  }
}

export class SOSLExecuteEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    const rows = parseRows(parts[3] || "");
    this.rowCountIsKnown = rows !== null;
    if (rows !== null) this.soslRowCount.total = this.soslRowCount.self = rows;
  }
}

export class QueueableBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["QUEUEABLE_END"],
      LOG_CATEGORY.CodeUnit,
      "custom",
      DEBUG_CATEGORY.ApexCode,
    );
    const linePart = String(parts[2] || "");
    if (/^\[[^\]]+\]$/.test(linePart))
      this.lineNumber = this.parseLineNumber(linePart);
    this.text = String(parts.slice(3).join("|") || "").trim();
  }
}

export class QueueableEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    const linePart = String(parts[2] || "");
    if (/^\[[^\]]+\]$/.test(linePart))
      this.lineNumber = this.parseLineNumber(linePart);
    this.text = String(parts.slice(3).join("|") || "").trim();
  }
}

abstract class AsyncApexBeginLine extends DurationLogEvent {
  constructor(
    parser: ApexLogParser,
    parts: string[],
    exitType: "FUTURE_METHOD_END" | "BATCH_APEX_EXECUTE_END",
  ) {
    super(
      parser,
      parts,
      [exitType],
      LOG_CATEGORY.CodeUnit,
      "custom",
      DEBUG_CATEGORY.ApexCode,
    );
    const linePart = String(parts[2] || "");
    const hasSourceLine = /^\[[^\]]+\]$/.test(linePart);
    if (hasSourceLine) this.lineNumber = this.parseLineNumber(linePart);
    this.text = parts
      .slice(hasSourceLine ? 3 : 2)
      .join("|")
      .trim();
  }
}

export class FutureMethodBeginLine extends AsyncApexBeginLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, "FUTURE_METHOD_END");
  }
}

export class BatchApexExecuteBeginLine extends AsyncApexBeginLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, "BATCH_APEX_EXECUTE_END");
  }
}

export class AsyncApexEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    const linePart = String(parts[2] || "");
    const hasSourceLine = /^\[[^\]]+\]$/.test(linePart);
    if (hasSourceLine) this.lineNumber = this.parseLineNumber(linePart);
    this.text = parts
      .slice(hasSourceLine ? 3 : 2)
      .join("|")
      .trim();
  }
}

export class HeapAllocateLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[3] || "";
  }
}

export class HeapDeallocateLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

export class StatementExecuteLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

export class VariableScopeBeginLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts.slice(3).join(" | ");
  }
}

export class VariableAssignmentLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts.slice(3).join(" | ");
  }
}
export class UserInfoLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = (parts[3] ?? "") + " " + (parts[4] ?? "");
  }
}

export class UserDebugLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts.slice(3).join(" | ");
  }
}

export class DataWeaveUserDebugLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.ApexCode;
    const sourceMarker = parts[2];
    const hasSourceMarker = Boolean(
      sourceMarker?.match(/^\[(?:\d+|[A-Z_]+)\]$/),
    );
    if (hasSourceMarker) this.lineNumber = this.parseLineNumber(sourceMarker);
    this.text = parts.slice(hasSourceMarker ? 3 : 2).join(" | ");
  }
}

export class FormulaEvaluateBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["FORMULA_EVALUATE_END"],
      LOG_CATEGORY.Apex,
      "method",
      DEBUG_CATEGORY.ApexCode,
    );
    this.text = parts.slice(2).join(" | ");
  }
}

export class RlmConfiguratorBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["RLM_CONFIGURATOR_END"],
      LOG_CATEGORY.System,
      "method",
      DEBUG_CATEGORY.System,
    );
    this.text = parts.slice(2).join(" | ");
  }
}

export class RlmPricingBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["RLM_PRICING_END"],
      LOG_CATEGORY.System,
      "method",
      DEBUG_CATEGORY.System,
    );
    this.text = parts.slice(2).join(" | ");
  }
}

export class CumulativeLimitUsageLine extends DurationLogEvent {
  namespace = "default";
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["CUMULATIVE_LIMIT_USAGE_END"],
      LOG_CATEGORY.System,
      "system",
      DEBUG_CATEGORY.ApexProfiling,
    );
  }
}

export class CumulativeProfilingLine extends LogEvent {
  acceptsText = true;
  namespace = "default";
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = (parts[2] ?? "") + " " + (parts[3] ?? "");
  }
}

export class CumulativeProfilingBeginLine extends DurationLogEvent {
  namespace = "default";
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["CUMULATIVE_PROFILING_END"],
      LOG_CATEGORY.System,
      "custom",
      DEBUG_CATEGORY.ApexProfiling,
    );
  }
}

export class LimitUsageLine extends LogEvent {
  namespace = "default";
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.ApexProfiling;
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text =
      (parts[3] ?? "") + " " + (parts[4] ?? "") + " out of " + (parts[5] ?? "");
  }
}

export class LimitUsageForNSLine extends LogEvent {
  static limitsKeys = new Map<string, string>([
    ["Number of SOQL queries", "soqlQueries"],
    ["Number of query rows", "queryRows"],
    ["Number of SOSL queries", "soslQueries"],
    ["Number of DML statements", "dmlStatements"],
    ["Number of Publish Immediate DML", "publishImmediateDml"],
    ["Number of DML rows", "dmlRows"],
    ["Maximum CPU time", "cpuTime"],
    ["Maximum CPU time on the Salesforce servers", "cpuTime"],
    ["Maximum heap size", "heapSize"],
    ["Number of callouts", "callouts"],
    ["Number of Email Invocations", "emailInvocations"],
    ["Number of future calls", "futureCalls"],
    [
      "Number of queueable jobs added to the queue",
      "queueableJobsAddedToQueue",
    ],
    ["Number of Mobile Apex push calls", "mobileApexPushCalls"],
    ["Number of Publish Immediate list size", "publishImmediateDml"],
  ]);

  namespace = "default";

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.ApexProfiling;
    this.acceptsText = true;
    const namespace = parts[2]?.trim() || "(default)";
    const inlineLimit = parts.slice(3).join("|").trim();
    this.text = `${namespace}|${inlineLimit ? `\n${inlineLimit}` : ""}`;
  }

  onAfter(parser: ApexLogParser, _next?: LogEvent): void {
    // Parse the namespace from the first line (before any newline)
    const rawNs = this.text.split(/\r?\n/)[0]?.replace(/\|$/, "").trim() ?? "";
    this.namespace = rawNs.replace(/^\((.+)\)$/, "$1") || "default";

    // Clean up the text for easier parsing
    const cleanedText = this.text
      .replace(/^\s+/gm, "")
      .replaceAll("******* CLOSE TO LIMIT", "")
      .replaceAll(" out of ", "/");
    this.text = cleanedText;

    // Split into lines and parse each line for limits
    const lines = cleanedText.split(/\r?\n/);
    const limits: Limits = {
      soqlQueries: { used: 0, limit: 0 },
      soslQueries: { used: 0, limit: 0 },
      queryRows: { used: 0, limit: 0 },
      dmlStatements: { used: 0, limit: 0 },
      publishImmediateDml: { used: 0, limit: 0 },
      dmlRows: { used: 0, limit: 0 },
      cpuTime: { used: 0, limit: 0 },
      heapSize: { used: 0, limit: 0 },
      callouts: { used: 0, limit: 0 },
      emailInvocations: { used: 0, limit: 0 },
      futureCalls: { used: 0, limit: 0 },
      queueableJobsAddedToQueue: { used: 0, limit: 0 },
      mobileApexPushCalls: { used: 0, limit: 0 },
    };

    for (const line of lines) {
      // Match lines like: "Maximum CPU time: 15008/10000"
      const match = line.match(/^(.+?):\s*([\d,]+)\/([\d,]+)/);
      if (match) {
        const key: keyof Limits = LimitUsageForNSLine.limitsKeys.get(
          match[1]!.trim(),
        ) as keyof Limits;
        if (key) {
          const used = parseSafeIntegerToken(match[2]);
          const limit = parseSafeIntegerToken(match[3]);
          if (key && used !== null && limit !== null) {
            limits[key] = { used, limit };
          }
        }
      }
    }

    const prior = parser.governorLimits.byNamespace.get(this.namespace);
    if (prior) {
      for (const key of LimitUsageForNSLine.limitsKeys.values() as Iterable<
        keyof Limits
      >) {
        if (limits[key].limit === 0 && limits[key].used === 0) {
          limits[key] = { ...prior[key] };
        }
      }
    }
    parser.governorLimits.byNamespace.set(this.namespace, limits);

    // Track snapshots for governor limit visualization
    parser.governorLimits.snapshots.push({
      timestamp: this.timestamp,
      namespace: this.namespace,
      limits: Object.fromEntries(
        Object.entries(limits).map(([key, value]) => [key, { ...value }]),
      ) as unknown as Limits,
    });
  }
}

export class NBANodeBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["NBA_NODE_END"],
      LOG_CATEGORY.Automation,
      "method",
      DEBUG_CATEGORY.NBA,
    );
    this.text = parts.slice(2).join(" | ");
  }
}

export class NBANodeDetail extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(" | ");
  }
}
export class NBANodeEnd extends LogEvent {
  isExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(" | ");
  }
}
export class NBANodeError extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(" | ");
  }
}
export class NBAOfferInvalid extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(" | ");
  }
}
export class NBAStrategyBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["NBA_STRATEGY_END"],
      LOG_CATEGORY.Automation,
      "method",
      DEBUG_CATEGORY.NBA,
    );
    this.text = parts.slice(2).join(" | ");
  }
}
export class NBAStrategyEnd extends LogEvent {
  isExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(" | ");
  }
}
export class NBAStrategyError extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(" | ");
  }
}

export class PushTraceFlagsLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text =
      (parts[4] ?? "") + ", line:" + this.lineNumber + " - " + (parts[5] ?? "");
  }
}

export class PopTraceFlagsLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text =
      (parts[4] ?? "") + ", line:" + this.lineNumber + " - " + (parts[5] ?? "");
  }
}

export class QueryMoreBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["QUERY_MORE_END"],
      LOG_CATEGORY.SOQL,
      "custom",
      DEBUG_CATEGORY.Database,
    );
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}`;
  }
}

export class QueryMoreEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}`;
  }
}
export class QueryMoreIterationsLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}, iterations:${parts[3]}`;
  }
}

export class SavepointRollbackLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `${parts[3]}, line: ${this.lineNumber}`;
  }
}

export class SavePointSetLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `${parts[3]}, line: ${this.lineNumber}`;
  }
}

export class TotalEmailRecipientsQueuedLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || "";
  }
}

export class StackFrameVariableListLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
  }
}

export class StaticVariableListLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
  }
}

// This looks like a method, but the exit line is often missing...
export class SystemModeEnterLine extends LogEvent {
  // namespace = "system";

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || "";
  }
}

export class SystemModeExitLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || "";
  }
}

export class ExecutionStartedLine extends DurationLogEvent {
  namespace = "default";
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["EXECUTION_FINISHED"],
      LOG_CATEGORY.Apex,
      "method",
      DEBUG_CATEGORY.ApexCode,
    );
  }
}

export class EnteringManagedPackageLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, [], LOG_CATEGORY.Apex, "pkg", DEBUG_CATEGORY.ApexCode);
    const linePart = parts[2] || "";
    if (/^\[[^\]]+\]$/.test(linePart)) {
      this.lineNumber = this.parseLineNumber(linePart);
    }
    const rawNs = (/^\[[^\]]+\]$/.test(linePart) ? parts[3] : linePart) || "";
    this.text = this.namespace = rawNs.split(".")[0] || "default";
  }

  onAfter(parser: ApexLogParser, end?: LogEvent): void {
    if (end) {
      this.exitStamp = end.timestamp;
      this.recalculateDurations();
    }
  }
}

export class ExitingManagedPackageLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.category = LOG_CATEGORY.Apex;
    this.cpuType = "pkg";
    this.debugCategory = DEBUG_CATEGORY.ApexCode;
    const linePart = parts[2] || "";
    if (/^\[[^\]]+\]$/.test(linePart)) {
      this.lineNumber = this.parseLineNumber(linePart);
    }
    const rawNs = (/^\[[^\]]+\]$/.test(linePart) ? parts[3] : linePart) || "";
    this.text = this.namespace = rawNs.split(".")[0] || "default";
  }
}

export class EventServicePubBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["EVENT_SERVICE_PUB_END"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text = parts[2] || "";
  }
}

export class EventServicePubEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || "";
  }
}

export class EventServicePubDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] + " " + parts[3] + " " + parts[4];
  }
}

export class EventServiceSubBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["EVENT_SERVICE_SUB_END"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]} ${parts[3]}`;
  }
}

export class EventServiceSubEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} ${parts[3]}`;
  }
}

export class EventServiceSubDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} ${parts[3]} ${parts[4]} ${parts[5]} ${parts[6]}`;
  }
}

export class FlowStartInterviewsBeginLine extends DurationLogEvent {
  text = "FLOW_START_INTERVIEWS : ";
  namespace = "default";

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["FLOW_START_INTERVIEWS_END"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
  }

  onEnd(end: LogEvent, stack: LogEvent[]) {
    const flowType = this.getFlowType(stack);
    this.suffix = ` (${flowType})`;
    this.text += this.getFlowName();
  }

  getFlowType(stack: LogEvent[]) {
    let flowType;
    // ignore the last one on stack is it will be this FlowStartInterviewsBeginLine
    const len = stack.length - 2;
    for (let i = len; i >= 0; i--) {
      const elem = stack[i];
      // type = "CODE_UNIT_STARTED" a flow or Processbuilder was started directly
      // type = "FLOW_START_INTERVIEWS_BEGIN" a flow was started from a process builder
      if (elem instanceof CodeUnitStartedLine) {
        flowType = elem.codeUnitType === "Flow" ? "Flow" : "Process Builder";
        break;
      } else if (elem && elem.type === "FLOW_START_INTERVIEWS_BEGIN") {
        flowType = "Flow";
        break;
      }
    }
    return flowType || "";
  }

  getFlowName() {
    if (this.children.length) {
      return this.children[0]?.text || "";
    }
    return "";
  }
}

export class FlowStartInterviewsErrorLine extends LogEvent {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} - ${parts[4]}`;
  }
}

/** Older Flow logs emit this detail form without BEGIN/END pairing. */
export class FlowStartInterviewsLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.category = LOG_CATEGORY.Automation;
    this.cpuType = "custom";
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    const linePart = parts[2] || "";
    const hasLineMarker = /^\[[^\]]+\]$/.test(linePart);
    if (hasLineMarker) {
      this.lineNumber = this.parseLineNumber(linePart);
    }
    this.text = parts
      .slice(hasLineMarker ? 3 : 2)
      .join("|")
      .trim();
  }
}

export class FlowStartInterviewBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["FLOW_START_INTERVIEW_END"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text = parts[3] || "";
  }
}

export class FlowStartInterviewLimitUsageLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || "";
  }
}

export class FlowStartScheduledRecordsLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

export class FlowCreateInterviewErrorLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

export class AutomationSpanBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    const beginType = String(parts[1] || "");
    const exitType = beginType.replace(/_BEGIN$/, "_END") as LogEventType;
    super(
      parser,
      parts,
      [exitType],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    const linePart = String(parts[2] || "");
    const hasSourceLine = /^\[[^\]]+\]$/.test(linePart);
    if (hasSourceLine) this.lineNumber = this.parseLineNumber(linePart);
    this.text = parts
      .slice(hasSourceLine ? 3 : 2)
      .join("|")
      .trim();
  }
}

export class AutomationSpanEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    const linePart = String(parts[2] || "");
    const hasSourceLine = /^\[[^\]]+\]$/.test(linePart);
    if (hasSourceLine) this.lineNumber = this.parseLineNumber(linePart);
    this.text = parts
      .slice(hasSourceLine ? 3 : 2)
      .join("|")
      .trim();
  }
}

export class FlowElementBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["FLOW_ELEMENT_END"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text = parts[3] + " " + parts[4];
  }
}

export class FlowElementDeferredLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] + " " + parts[3];
  }
}

export class FlowElementAssignmentLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[3] + " " + parts[4];
  }
}

export class FlowWaitEventResumingDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

export class FlowWaitEventWaitingDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}

export class FlowWaitResumingDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class FlowWaitWaitingDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

export class FlowInterviewFinishedLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[3] || "";
  }
}

export class FlowInterviewResumedLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

export class FlowInterviewPausedLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class FlowElementErrorLine extends LogEvent {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = (parts[1] || "") + parts[2] + " " + parts[3] + " " + parts[4];
  }
}

export class FlowElementFaultLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class FlowElementLimitUsageLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]}`;
  }
}

export class FlowInterviewFinishedLimitUsageLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]}`;
  }
}

export class FlowSubflowDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

export class FlowActionCallDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text =
      parts[3] + " : " + parts[4] + " : " + parts[5] + " : " + parts[6];
  }
}

export class FlowAssignmentDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[3] + " : " + parts[4] + " : " + parts[5];
  }
}

export class FlowLoopDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[3] + " : " + parts[4];
  }
}

export class FlowRuleDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[3] + " : " + parts[4];
  }
}

export class FlowBulkElementBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["FLOW_BULK_ELEMENT_END"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]} - ${parts[3]}`;
  }
}

export class FlowBulkElementDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] + " : " + parts[3] + " : " + parts[4];
  }
}

export class FlowBulkElementNotSupportedLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class FlowBulkElementLimitUsageLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || "";
  }
}

export class PNInvalidAppLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}.${parts[3]}`;
  }
}

export class PNInvalidCertificateLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}.${parts[3]}`;
  }
}
export class PNInvalidNotificationLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}.${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]} : ${parts[8]}`;
  }
}
export class PNNoDevicesLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}.${parts[3]}`;
  }
}

export class PNSentLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}.${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]}`;
  }
}

export class SLAEndLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}

export class SLAEvalMilestoneLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}`;
  }
}

export class SLAProcessCaseLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}`;
  }
}

export class TestingLimitsLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.ApexProfiling;
  }
}

export class ValidationRuleLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Validation;
    this.text = parts[3] || "";
  }
}

export class ValidationErrorLine extends LogEvent {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Validation;
    this.text = parts[2] || "";
  }
}

export class ValidationFormulaLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Validation;
    const extra = parts.length > 3 ? " " + parts[3] : "";

    this.text = parts[2] + extra;
  }
}

export class ValidationPassLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Validation;
    this.text = parts[3] || "";
  }
}

export class WFFlowActionErrorLine extends LogEvent {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[1] + " " + parts[4];
  }
}

export class WFFlowActionErrorDetailLine extends LogEvent {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[1] + " " + parts[2];
  }
}

export class WFFieldUpdateLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["WF_FIELD_UPDATE"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text =
      " " +
      parts[2] +
      " " +
      parts[3] +
      " " +
      parts[4] +
      " " +
      parts[5] +
      " " +
      parts[6];
  }
}

export class WFRuleEvalBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["WF_RULE_EVAL_END"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text = parts[2] || "";
  }
}

export class WFRuleEvalValueLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || "";
  }
}

/** Compact workflow-rule evaluation record used by some log formats. */
export class WFRuleEvalLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.category = LOG_CATEGORY.Automation;
    this.cpuType = "custom";
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    const linePart = parts[2] || "";
    const hasLineMarker = /^\[[^\]]+\]$/.test(linePart);
    if (hasLineMarker) {
      this.lineNumber = this.parseLineNumber(linePart);
    }
    this.text = parts
      .slice(hasLineMarker ? 3 : 2)
      .join("|")
      .trim();
  }
}

export class WFRuleFilterLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || "";
  }
}

export class WFCriteriaBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["WF_CRITERIA_END", "WF_RULE_NOT_EVALUATED"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text = "WF_CRITERIA : " + parts[5] + " : " + parts[3];
  }
}

export class WFFormulaLine extends DurationLogEvent {
  acceptsText = true;
  isExit = true;
  nextLineIsExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["WF_FORMULA"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text = parts[2] + " : " + parts[3];
  }
}

export class WFActionLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || "";
  }
}

export class WFActionsEndLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || "";
  }
}

export class WFActionTaskLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]}`;
  }
}

export class WFApprovalLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["WF_APPROVAL"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class WFApprovalRemoveLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]}`;
  }
}

export class WFApprovalSubmitLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["WF_APPROVAL_SUBMIT"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]}`;
  }
}

export class WFApprovalSubmitterLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class WFAssignLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

export class WFEmailAlertLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["WF_EMAIL_ALERT"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class WFEmailSentLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["WF_EMAIL_SENT"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class WFEnqueueActionsLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || "";
  }
}

export class WFEscalationActionLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

export class WFEvalEntryCriteriaLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["WF_EVAL_ENTRY_CRITERIA"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class WFFlowActionDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    const optional = parts[4] ? ` : ${parts[4]} :${parts[5]}` : "";
    this.text = `${parts[2]} : ${parts[3]}` + optional;
  }
}

export class WFNextApproverLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["WF_NEXT_APPROVER"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class WFOutboundMsgLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

export class WFProcessFoundLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["WF_PROCESS_FOUND"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

export class WFProcessNode extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["WF_PROCESS_NODE"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text = parts[2] || "";
  }
}

export class WFReassignRecordLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

export class WFResponseNotifyLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

export class WFRuleEntryOrderLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || "";
  }
}

export class WFRuleInvocationLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["WF_RULE_INVOCATION"],
      LOG_CATEGORY.Automation,
      "custom",
      DEBUG_CATEGORY.Workflow,
    );
    this.text = parts[2] || "";
  }
}

export class WFSoftRejectLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || "";
  }
}

export class WFTimeTriggerLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

export class WFSpoolActionBeginLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || "";
  }
}

export class ExceptionThrownLine extends LogEvent {
  discontinuity = true;
  acceptsText = true;
  totalThrownCount = 1;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts.slice(3).join("|");
  }

  onAfter(parser: ApexLogParser, _next?: LogEvent): void {
    if (this.text.indexOf("System.LimitException") >= 0) {
      const isMultiLine = this.text.indexOf("\n");
      const len = isMultiLine < 0 ? 99 : isMultiLine;
      const truncateText = this.text.length > len;
      const summary = this.text.slice(0, len + 1) + (truncateText ? "…" : "");
      const message = truncateText ? this.text : "";
      parser.addLogIssue(this.timestamp, summary, message, "error");
    }
  }
}

export class FatalErrorLine extends LogEvent {
  acceptsText = true;
  discontinuity = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join("|");
  }

  onAfter(parser: ApexLogParser, _next?: LogEvent): void {
    const newLineIndex = this.text.indexOf("\n");
    const summary =
      newLineIndex > -1 ? this.text.slice(0, newLineIndex + 1) : this.text;
    const detailText = summary.length !== this.text.length ? this.text : "";
    parser.addLogIssue(
      this.timestamp,
      "FATAL ERROR! cause=" + summary,
      detailText,
      "error",
    );
  }
}

export class XDSDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || "";
  }
}

export class XDSResponseLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2] ?? ""} : ${parts[3] ?? ""} : ${parts[4] ?? ""} : ${parts[5] ?? ""} : ${parts[6] ?? ""}`;
  }
}
export class XDSResponseDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || "";
  }
}

export class XDSResponseErrorLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || "";
  }
}

export class OLSViolationLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.System;
    this.text = String(parts.slice(3).join("|") || "").trim();
  }
}

export class FLSViolationLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.System;
    this.text = String(parts.slice(3).join("|") || "").trim();
  }
}

// e.g. "09:45:31.888 (38889007737)|DUPLICATE_DETECTION_BEGIN"
export class DuplicateDetectionBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["DUPLICATE_DETECTION_END"],
      LOG_CATEGORY.System,
      "custom",
      DEBUG_CATEGORY.System,
    );
  }
}

// e.g. "09:45:31.888 (38889067408)|DUPLICATE_DETECTION_RULE_INVOCATION|DuplicateRuleId:0Bm20000000CaSP|DuplicateRuleName:Duplicate Account|DmlType:UPDATE"
export class DuplicateDetectionRule extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[3]} - ${parts[4]}`;
  }
}

/**
 * NOTE: These can be found in the org on the create new debug level page but are not found in the docs here
 * https://help.salesforce.com/s/articleView?id=sf.code_setting_debug_log_levels.htm
 */
export class BulkDMLEntry extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || "";
  }
}

/**
 * DUPLICATE_DETECTION_MATCH_INVOCATION_DETAILS|EntityType:Account|ActionTaken:Allow_[Alert,Report]|DuplicateRecordIds:
 */
export class DuplicateDetectionDetails extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(" | ");
  }
}

/**
 * DUPLICATE_DETECTION_MATCH_INVOCATION_SUMMARY|EntityType:Account|NumRecordsToBeSaved:200|NumRecordsToBeSavedWithDuplicates:0|NumDuplicateRecordsFound:0
 */
export class DuplicateDetectionSummary extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(" | ");
  }
}

export class SessionCachePutBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["SESSION_CACHE_PUT_END"],
      LOG_CATEGORY.Apex,
      "method",
      DEBUG_CATEGORY.ApexCode,
    );
  }
}
export class SessionCacheGetBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["SESSION_CACHE_GET_END"],
      LOG_CATEGORY.Apex,
      "method",
      DEBUG_CATEGORY.ApexCode,
    );
  }
}

export class SessionCacheRemoveBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["SESSION_CACHE_REMOVE_END"],
      LOG_CATEGORY.Apex,
      "method",
      DEBUG_CATEGORY.ApexCode,
    );
  }
}

export class OrgCachePutBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["ORG_CACHE_PUT_END"],
      LOG_CATEGORY.Apex,
      "method",
      DEBUG_CATEGORY.ApexCode,
    );
  }
}

export class OrgCacheGetBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["ORG_CACHE_GET_END"],
      LOG_CATEGORY.Apex,
      "method",
      DEBUG_CATEGORY.ApexCode,
    );
  }
}

export class OrgCacheRemoveBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["ORG_CACHE_REMOVE_END"],
      LOG_CATEGORY.Apex,
      "method",
      DEBUG_CATEGORY.ApexCode,
    );
  }
}

export class VFSerializeContinuationStateBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["VF_SERIALIZE_CONTINUATION_STATE_END"],
      LOG_CATEGORY.Apex,
      "method",
      DEBUG_CATEGORY.ApexCode,
    );
  }
}

export class VFDeserializeContinuationStateBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["VF_SERIALIZE_CONTINUATION_STATE_END"],
      LOG_CATEGORY.Apex,
      "method",
      DEBUG_CATEGORY.ApexCode,
    );
  }
}

export class MatchEngineBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ["MATCH_ENGINE_END"],
      LOG_CATEGORY.System,
      "method",
      DEBUG_CATEGORY.System,
    );
  }
}
