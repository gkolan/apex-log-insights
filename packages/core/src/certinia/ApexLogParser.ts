/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

import { ApexLog, UnknownLogLine, type LogEvent } from "./LogEvents.js";
import { getLogEventClass } from "./LogLineMapping.js";
import { splitLogFields } from "../logFields.js";
import { MAX_LOG_BYTES, utf8ByteLength } from "../utf8.js";
import type {
  GovernorLimits,
  IssueType,
  Limits,
  LogEventType,
  LogIssue,
  ParsingDiagnostic,
} from "./types.js";

const typePattern = /^[A-Z_]*$/,
  settingsPattern = /^\d+\.\d+\sAPEX_CODE,\w+;APEX_PROFILING,.+$/m;

const LINE_SENSITIVE_ENTRY_TYPES = new Set<LogEventType>([
  "METHOD_ENTRY",
  "CONSTRUCTOR_ENTRY",
  "SYSTEM_METHOD_ENTRY",
  "SYSTEM_CONSTRUCTOR_ENTRY",
]);

function createGovernorLimits(): GovernorLimits {
  return {
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
}

/**
 * Takes string input of a log and returns the ApexLog class, which represents a log tree
 * @param {string} logData
 * @returns {ApexLog}
 */
export function parse(logData: string): ApexLog {
  return new ApexLogParser().parse(logData);
}

/**
 * An Apex Log file can be parsed by passing the text.
 * You can either import the ApexLogParser class or import the parse method e.g.
 *
 * import ApexLogParser, { parse } from ./ApexLogParser.js
 * const apexLog = new ApexLogParser().parse(logText);
 * const apexLog = parse(logText);
 */
export class ApexLogParser {
  private static readonly MAX_PARSING_ERRORS = 200;
  private static readonly MAX_LOG_ISSUES = 200;
  private static readonly MAX_ISSUE_SUMMARY_CHARS = 500;
  private static readonly MAX_ISSUE_DESCRIPTION_CHARS = 2_000;
  private static readonly ISSUE_OVERFLOW_SUMMARY =
    "Additional log issues omitted";
  logIssues: LogIssue[] = [];
  private logIssuesBySummary = new Map<string, LogIssue>();
  logIssueOverflowCount = 0;
  parsingErrors: string[] = [];
  parsingDiagnostics: ParsingDiagnostic[] = [];
  private parsingDiagnosticsByType = new Map<string, ParsingDiagnostic>();
  parsingErrorOverflowCount = 0;
  maxSizeTimestamp: number | null = null;
  reasons: Set<string> = new Set<string>();
  lastTimestamp = 0;

  /** Timestamp of the preceding physical event, used only for ordering diagnostics. */
  lastObservedTimestamp: number | null = null;
  discontinuity = false;
  namespaces = new Set<string>();
  governorLimits: GovernorLimits = createGovernorLimits();

  /**
   * Takes string input of a log and returns the ApexLog class, which represents a log tree
   * @param {string} debugLog
   * @returns {ApexLog}
   */
  parse(debugLog: string): ApexLog {
    this.resetState();
    if (typeof debugLog !== "string") {
      throw new TypeError("Apex log input must be a string.");
    }
    const inputBytes = utf8ByteLength(debugLog);
    if (inputBytes > MAX_LOG_BYTES) {
      throw new RangeError("Log exceeds the 25 MiB parser input limit.");
    }
    const lineGenerator = this.generateLogLines(debugLog);
    const apexLog = this.toLogTree(lineGenerator);
    this.logIssues.sort(
      (left, right) => (left.startTime ?? 0) - (right.startTime ?? 0),
    );
    apexLog.size = inputBytes;
    apexLog.debugLevels = this.getDebugLevels(debugLog);
    apexLog.logIssues = this.logIssues;
    apexLog.logIssueOverflowCount = this.logIssueOverflowCount;
    apexLog.parsingErrors = this.parsingErrors;
    apexLog.parsingDiagnostics = this.parsingDiagnostics;
    apexLog.parsingErrorOverflowCount = this.parsingErrorOverflowCount;
    apexLog.namespaces = Array.from(this.namespaces);
    apexLog.governorLimits = this.governorLimits;

    this.addGovernorLimits(apexLog);

    return apexLog;
  }

  private resetState(): void {
    this.logIssues = [];
    this.logIssuesBySummary = new Map<string, LogIssue>();
    this.logIssueOverflowCount = 0;
    this.parsingErrors = [];
    this.parsingDiagnostics = [];
    this.parsingDiagnosticsByType = new Map<string, ParsingDiagnostic>();
    this.parsingErrorOverflowCount = 0;
    this.maxSizeTimestamp = null;
    this.reasons = new Set<string>();
    this.lastTimestamp = 0;
    this.lastObservedTimestamp = null;
    this.discontinuity = false;
    this.namespaces = new Set<string>();
    this.governorLimits = createGovernorLimits();
  }

  private addGovernorLimits(apexLog: ApexLog) {
    const totalLimits = apexLog.governorLimits;
    if (totalLimits) {
      for (const limitsForNs of apexLog.governorLimits.byNamespace.values()) {
        for (const [key, value] of Object.entries(limitsForNs) as Array<
          [keyof Limits, Limits[keyof Limits]]
        >) {
          if (!value) {
            continue;
          }

          const currentLimit = totalLimits[key];
          currentLimit.limit = value.limit;
          currentLimit.used += value.used;
        }
      }
    }
  }

  private parseLine(
    line: string,
    lastEntry: LogEvent | null,
    rawLineNumber: number,
  ): LogEvent | null {
    const parts = splitLogFields(line);
    const type = parts[1] ?? "";

    const metaCtor = getLogEventClass(type as LogEventType);
    if (metaCtor) {
      try {
        const entry = new metaCtor(this, parts);
        entry.logLine = line;
        lastEntry?.onAfter?.(this, entry);
        if (entry.namespace) {
          this.namespaces.add(entry.namespace);
        }
        return entry;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.addParsingError(
          `Malformed ${type} event: ${detail}. Raw line: ${line.slice(0, 300)}`,
          "MALFORMED_EVENT",
          rawLineNumber,
          line,
        );
        return this.createMalformedFallback(parts, line, lastEntry);
      }
    }

    const hasType = !!(type && typePattern.test(type));
    if (!hasType && lastEntry?.acceptsText) {
      // Wrapped text from the previous entry. Enforce the cap while appending;
      // checking only the previous length allowed one large continuation line
      // to overshoot the limit without ever reporting truncation.
      const continuation = `\n${line}`;
      const remaining = Math.max(0, 100_000 - lastEntry.text.length);
      if (remaining > 0) {
        lastEntry.text += continuation.slice(0, remaining);
      }
      if (continuation.length > remaining) {
        this.addLogIssue(
          lastEntry.timestamp,
          "Text-Truncation",
          `Text for the event beginning at log line ${lastEntry.rawLineNumber ?? "unknown"} exceeded 100 KB and was truncated to protect parser memory.`,
          "skip",
        );
      }
    } else if (hasType) {
      try {
        const entry = new UnknownLogLine(this, parts);
        entry.logLine = line;
        this.addParsingError(
          `Unsupported log event name: ${type}`,
          "UNSUPPORTED_EVENT",
          rawLineNumber,
          line,
        );
        return entry;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.addParsingError(
          `Malformed ${type} event: ${detail}. Raw line: ${line.slice(0, 300)}`,
          "MALFORMED_EVENT",
          rawLineNumber,
          line,
        );
        return this.createMalformedFallback(parts, line, lastEntry);
      }
    } else if (lastEntry && line.startsWith("*** Skipped")) {
      this.addLogIssue(
        lastEntry.timestamp,
        "Skipped-Lines",
        `${line}. A section of the log has been skipped and the log has been truncated. Full details of this section of log can not be provided.`,
        "skip",
      );
    } else if (
      lastEntry &&
      line.indexOf("MAXIMUM DEBUG LOG SIZE REACHED") !== -1
    ) {
      this.addLogIssue(
        lastEntry.timestamp,
        "Max-Size-reached",
        "The maximum log size has been reached. Part of the log has been truncated.",
        "skip",
      );
      this.maxSizeTimestamp = lastEntry.timestamp;
    } else if (!hasType && settingsPattern.test(line)) {
      // skip an unexpected settings line
    } else {
      this.addParsingError(
        `Invalid log line: ${line.slice(0, 500)}`,
        "INVALID_LOG_LINE",
        rawLineNumber,
        line,
      );
    }

    return null;
  }

  /**
   * Retain a malformed record without allowing its invalid timestamp to throw
   * again from UnknownLogLine. The original line remains the evidence source;
   * only the constructor input receives the last safe monotonic timestamp.
   */
  private createMalformedFallback(
    parts: string[],
    line: string,
    lastEntry: LogEvent | null,
  ): UnknownLogLine {
    const timestampMatch = String(parts[0] || "").match(/\((\d+)\)$/);
    const parsedTimestamp = timestampMatch ? Number(timestampMatch[1]) : NaN;
    const timestampIsValid =
      Number.isSafeInteger(parsedTimestamp) && parsedTimestamp >= 0;
    const safeParts = timestampIsValid ? parts : [...parts];
    if (!timestampIsValid) {
      const safeTimestamp = lastEntry?.timestamp ?? this.lastTimestamp ?? 0;
      safeParts[0] = `(${safeTimestamp})`;
    }
    const fallback = new UnknownLogLine(this, safeParts);
    fallback.logLine = line;
    fallback.timestampIsInferred = !timestampIsValid;
    return fallback;
  }

  private *generateLogLines(log: string): Generator<LogEvent> {
    // USER_INFO normally precedes EXECUTION_STARTED. Start at whichever of
    // those records appears first so report metadata is not silently lost,
    // while still skipping the debug-level header and other non-event preamble.
    const firstTransactionRecord = log.match(
      /(^|[\r\n])((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{1,9} \(\d+\)\|(?:USER_INFO|EXECUTION_STARTED))(?=\||\r\n|\r|\n|$)/,
    );
    let startIndex = firstTransactionRecord
      ? (firstTransactionRecord.index ?? 0) + firstTransactionRecord[1]!.length
      : 0;

    let rawLineNumber = 1;
    for (let index = 0; index < startIndex; index += 1) {
      const code = log.charCodeAt(index);
      if (code === 13) {
        rawLineNumber += 1;
        if (log.charCodeAt(index + 1) === 10) index += 1;
      } else if (code === 10) {
        rawLineNumber += 1;
      }
    }

    let lastEntry: LogEvent | null = null;
    while (startIndex < log.length) {
      const crIndex = log.indexOf("\r", startIndex);
      const lfIndex = log.indexOf("\n", startIndex);
      const eolIndex =
        crIndex === -1
          ? lfIndex
          : lfIndex === -1
            ? crIndex
            : Math.min(crIndex, lfIndex);
      const lineEnd = eolIndex === -1 ? log.length : eolIndex;
      const line = log.slice(startIndex, lineEnd);
      if (line) {
        // ignore blank lines
        const entry = this.parseLine(line, lastEntry, rawLineNumber);
        if (entry) {
          entry.rawLineNumber = rawLineNumber;
          if (
            this.lastObservedTimestamp !== null &&
            entry.timestamp < this.lastObservedTimestamp
          ) {
            this.addLogIssue(
              entry.timestamp,
              "Timestamp-Violation",
              `Log line ${rawLineNumber} has timestamp ${entry.timestamp}, earlier than the preceding event timestamp ${this.lastObservedTimestamp}. The log may be corrupted or truncated, so affected durations are not reliable.`,
              "unexpected",
            );
          }
          this.lastObservedTimestamp = entry.timestamp;
          lastEntry = entry;
          yield entry;
        }
      }
      if (eolIndex === -1) {
        lastEntry?.onAfter?.(this);
        break;
      }
      rawLineNumber += 1;
      startIndex =
        log.charCodeAt(eolIndex) === 13 && log.charCodeAt(eolIndex + 1) === 10
          ? eolIndex + 2
          : eolIndex + 1;
    }
  }

  private toLogTree(lineGenerator: Generator<LogEvent>) {
    const rootMethod = new ApexLog(this),
      stack: LogEvent[] = [];
    let line: LogEvent | null;

    const lineIter = new LineIterator(lineGenerator);

    while ((line = lineIter.fetch())) {
      if (line.isParent) {
        this.parseTree(line, lineIter, stack, 0);
      } else if (line.isExit) {
        line.pairingStatus = "orphan_end";
        line.durationIsPartial = true;
        this.addLogIssue(
          line.timestamp,
          "Unexpected-Exit",
          "An exit event was found without a corresponding entry event.",
          "unexpected",
        );
      }
      line.parent = rootMethod;
      rootMethod.children.push(line);
    }

    rootMethod.setTimes();
    this.mergeManagedPackageEvents(rootMethod);
    this.aggregateTotals([rootMethod]);
    return rootMethod;
  }

  private parseTree(
    currentLine: LogEvent,
    lineIter: LineIterator,
    stack: LogEvent[],
    depth: number = 0,
  ) {
    const MAX_DEPTH = 500;
    if (depth >= MAX_DEPTH) {
      this.addLogIssue(
        currentLine.timestamp,
        "Maximum-Nesting-Depth",
        `Execution nesting exceeded the parser safety limit of ${MAX_DEPTH} levels. The affected subtree is incomplete.`,
        "unexpected",
      );
      currentLine.isTruncated = true;
      currentLine.pairingStatus = "depth_limit";
      currentLine.durationIsPartial = true;
      this.consumeDepthLimitedSubtree(currentLine, lineIter, stack);
      return;
    }
    this.lastTimestamp = currentLine.timestamp;
    currentLine.namespace ||= "default";

    const isEntry = currentLine.exitTypes.length;
    if (isEntry) {
      const exitOnNextLine = currentLine.nextLineIsExit;
      let nextLine;

      stack.push(currentLine);

      try {
        while ((nextLine = lineIter.peek())) {
          // discontinuities are stack unwinding (caused by Exceptions)
          this.discontinuity ||= nextLine.discontinuity; // start unwinding stack

          // Exit Line has been found no more work needed
          if (
            !exitOnNextLine &&
            !nextLine.nextLineIsExit &&
            nextLine.isExit &&
            !nextLine.exitTypes.length &&
            this.endMethod(currentLine, nextLine, lineIter, stack)
          ) {
            // Typed end hooks must only receive their declared exit. A true
            // result can also mean "unwind to an ancestor that owns this exit".
            if (this.isMatchingEnd(currentLine, nextLine)) {
              currentLine.onEnd?.(nextLine, stack);
            }
            break;
          } else if (
            exitOnNextLine &&
            (nextLine.nextLineIsExit ||
              nextLine.isExit ||
              nextLine.exitTypes.length > 0)
          ) {
            currentLine.exitStamp = nextLine.timestamp;
            currentLine.exitRawLineNumber = nextLine.rawLineNumber;
            currentLine.exitLogLine = nextLine.logLine;
            currentLine.pairingStatus = "complete";
            currentLine.onEnd?.(nextLine, stack);
            break;
          } else if (
            this.discontinuity &&
            this.maxSizeTimestamp !== null &&
            nextLine.timestamp > this.maxSizeTimestamp
          ) {
            // The current line was truncated (we did not find the exit line before the end of log) and there was a discontinuity
            currentLine.isTruncated = true;
            currentLine.pairingStatus = "closed_at_truncation";
            currentLine.durationIsPartial = true;
            break;
          }

          lineIter.fetch(); // it's a child - consume the line
          this.lastTimestamp = nextLine.timestamp;
          nextLine.namespace ||= currentLine.namespace || "default";
          nextLine.parent = currentLine;
          currentLine.children.push(nextLine);

          if (nextLine.isParent) {
            this.parseTree(nextLine, lineIter, stack, depth + 1);
          }
        }

        // End of line error handling. We have finished processing this log line and either got to the end
        // of the log without finding an exit line or the current line was truncated)
        if (!nextLine || currentLine.isTruncated) {
          const endedAtTruncation = currentLine.isTruncated;
          // truncated method - terminate at the end of the log
          currentLine.exitStamp = this.lastTimestamp ?? currentLine.timestamp;

          // we found an entry event on its own e.g a `METHOD_ENTRY` without a `METHOD_EXIT` and got to the end of the log
          this.addLogIssue(
            currentLine.exitStamp,
            "Unexpected-End",
            "An entry event was found without a corresponding exit event e.g a `METHOD_ENTRY` event without a `METHOD_EXIT`",
            "unexpected",
          );

          if (currentLine.isTruncated) {
            this.updateLogIssue(
              currentLine.exitStamp,
              "Max-Size-reached",
              "The maximum log size has been reached. Part of the log has been truncated.",
              "skip",
            );
            this.maxSizeTimestamp = currentLine.exitStamp;
          }
          currentLine.isTruncated = true;
          if (currentLine.pairingStatus === "not_applicable") {
            currentLine.pairingStatus = endedAtTruncation
              ? "closed_at_truncation"
              : "missing_end";
            currentLine.durationIsPartial = true;
          }
        }
      } finally {
        stack.pop();
        currentLine.recalculateDurations();
      }
    }
  }

  private isMatchingEnd(startMethod: LogEvent, endLine: LogEvent) {
    if (!endLine.type || !startMethod.exitTypes?.includes(endLine.type)) {
      return false;
    }
    if (
      !startMethod.type ||
      !LINE_SENSITIVE_ENTRY_TYPES.has(startMethod.type)
    ) {
      return true;
    }
    return (
      endLine.lineNumber === startMethod.lineNumber ||
      !endLine.lineNumber ||
      !startMethod.lineNumber
    );
  }

  private endMethod(
    startMethod: LogEvent,
    endLine: LogEvent,
    lineIter: LineIterator,
    stack: LogEvent[],
  ) {
    startMethod.exitStamp = endLine.timestamp;

    // is this a 'good' end line?
    if (this.isMatchingEnd(startMethod, endLine)) {
      startMethod.pairingStatus = "complete";
      startMethod.exitRawLineNumber = endLine.rawLineNumber;
      startMethod.exitLogLine = endLine.logLine;
      this.discontinuity = false; // end stack unwinding
      lineIter.fetch(); // consume the line
      return true; // success
    } else if (this.discontinuity) {
      startMethod.pairingStatus = "closed_by_exception";
      startMethod.durationIsPartial = true;
      return true; // exception - unwind
    } else {
      if (stack.some((m) => this.isMatchingEnd(m, endLine))) {
        startMethod.pairingStatus = "missing_end";
        startMethod.durationIsPartial = true;
        this.addLogIssue(
          endLine.timestamp,
          "Unexpected-End",
          `A ${startMethod.type} event was closed by the ${endLine.type} exit of an ancestor because its own exit event was missing.`,
          "unexpected",
        );
        return true; // we match a method further down the stack - unwind
      }
      // we found an exit event on its own e.g a `METHOD_EXIT` without a `METHOD_ENTRY`
      this.addLogIssue(
        endLine.timestamp,
        "Unexpected-Exit",
        "An exit event was found without a corresponding entry event e.g a `METHOD_EXIT` event without a `METHOD_ENTRY`",
        "unexpected",
      );
      endLine.pairingStatus = "orphan_end";
      endLine.durationIsPartial = true;
      return false; // we have no matching method - ignore
    }
  }

  /** Preserve an over-depth subtree without further recursive calls. */
  private consumeDepthLimitedSubtree(
    root: LogEvent,
    lineIter: LineIterator,
    ancestorStack: LogEvent[],
  ): void {
    const frames: LogEvent[] = [root];
    const closeMissingFrames = (
      lowestFrameToKeep: number,
      boundaryTimestamp: number,
    ): void => {
      while (frames.length - 1 > lowestFrameToKeep) {
        const incomplete = frames.pop()!;
        incomplete.exitStamp = boundaryTimestamp;
        if (incomplete === root) incomplete.isTruncated = true;
        incomplete.pairingStatus =
          incomplete === root ? "depth_limit" : "missing_end";
        incomplete.durationIsPartial = true;
        incomplete.recalculateDurations();
        this.addLogIssue(
          boundaryTimestamp,
          "Unexpected-End",
          `A ${incomplete.type} event was closed by an ancestor exit because its own exit event was missing.`,
          "unexpected",
        );
      }
    };

    while (frames.length) {
      const next = lineIter.peek();
      if (!next) break;
      const frame = frames[frames.length - 1]!;
      if (next.isExit) {
        let matchingFrame = -1;
        for (let index = frames.length - 1; index >= 0; index -= 1) {
          if (this.isMatchingEnd(frames[index]!, next)) {
            matchingFrame = index;
            break;
          }
        }

        if (matchingFrame >= 0) {
          closeMissingFrames(matchingFrame, next.timestamp);
          const matched = frames[frames.length - 1]!;
          lineIter.fetch();
          matched.exitStamp = next.timestamp;
          matched.exitRawLineNumber = next.rawLineNumber;
          matched.exitLogLine = next.logLine;
          if (matched !== root) matched.pairingStatus = "complete";
          matched.onEnd?.(next, [...ancestorStack, ...frames]);
          matched.recalculateDurations();
          frames.pop();
          continue;
        }

        if (
          ancestorStack.some((ancestor) => this.isMatchingEnd(ancestor, next))
        ) {
          // Do not consume an exit owned by the recursive parser above this
          // fallback. It will use the same record to unwind and close the
          // appropriate ancestor after these incomplete frames are removed.
          closeMissingFrames(-1, next.timestamp);
          break;
        }
      }
      lineIter.fetch();
      next.parent = frame;
      next.namespace ||= frame.namespace || "default";
      frame.children.push(next);
      this.lastTimestamp = next.timestamp;
      if (next.isParent && next.exitTypes.length) frames.push(next);
      else if (next.isExit) {
        next.pairingStatus = "orphan_end";
        next.durationIsPartial = true;
      }
    }

    // Any frames left open at EOF have only a synthetic recovery boundary.
    // Mark every one as partial so downstream reports never present its
    // inferred end timestamp as an exact measurement.
    for (const frame of frames) {
      frame.exitStamp ??= this.lastTimestamp;
      frame.isTruncated = true;
      frame.pairingStatus = "depth_limit";
      frame.durationIsPartial = true;
      frame.recalculateDurations();
    }
  }

  private flattenByDepth(nodes: LogEvent[]) {
    const result = new Map<number, LogEvent[]>();

    let currentDepth = 0;
    let currentNodes = nodes.filter((n) => n.children.length);
    let len = currentNodes.length;
    while (len) {
      result.set(currentDepth++, currentNodes);

      const children: LogEvent[] = [];
      while (len--) {
        const node = currentNodes[len];
        if (!node?.children) {
          continue;
        }

        let i = node.children.length;
        while (i--) {
          const c = node.children[i];
          if (c?.children.length) {
            children.push(c);
          }
        }
      }

      currentNodes = children;
      len = currentNodes.length;
    }

    return result;
  }

  private aggregateTotals(nodes: LogEvent[]) {
    const len = nodes.length;
    if (!len) {
      return;
    }

    // This method purposely processes the children at the lowest depth first in bulk to avoid as much recursion as possible. This increases performance to be just over ~3 times faster or ~70% faster.

    // collect all children for the supplied nodes by depth.
    const nodesByDepth = this.flattenByDepth(nodes);
    let depth = nodesByDepth.size;
    while (depth--) {
      const nds = nodesByDepth.get(depth);
      if (!nds) {
        continue;
      }
      let i = nds.length;
      while (i--) {
        const parent = nds[i];
        if (!parent?.children) {
          continue;
        }

        let j = parent.children.length;
        while (j--) {
          const child = parent.children[j];
          if (!child) {
            continue;
          }
          parent.dmlCount.total += child.dmlCount.total;
          parent.soqlCount.total += child.soqlCount.total;
          parent.soslCount.total += child.soslCount.total;
          parent.dmlRowCount.total += child.dmlRowCount.total;
          parent.soqlRowCount.total += child.soqlRowCount.total;
          parent.soslRowCount.total += child.soslRowCount.total;
          if (!isNaN(child.duration.total)) {
            parent.duration.self -= child.duration.total;
          }
          parent.totalThrownCount += child.totalThrownCount;
        }
      }
    }
    nodesByDepth.clear();
  }

  private mergeManagedPackageEvents(root: LogEvent) {
    const stack: LogEvent[] = [root];

    while (stack.length) {
      const node = stack.pop()!;
      const children = node.children;
      const len = children.length;
      let write = 0;
      let lastPkg: LogEvent | null = null;

      for (let i = 0; i < len; i++) {
        const child = children[i];
        if (!child) {
          continue;
        }

        const isPkg = child.type === "ENTERING_MANAGED_PKG";
        if (lastPkg && child.isParent) {
          // merge consecutive pkg events (same namespace)
          if (isPkg && child.namespace === lastPkg.namespace) {
            lastPkg.exitStamp = child.exitStamp ?? child.timestamp;

            // Currently pkg events can not have children (no exit event) but if they ever do we need to move the children to the lastPkg event. The commented code below does that.

            // // Move children from the discarded package to the kept package
            // for (const childOfDiscarded of child.children) {
            //   childOfDiscarded.parent = lastPkg;
            //   lastPkg.children.push(childOfDiscarded);

            //   // If the moved child is also a parent, we need to process it recursively
            //   if (childOfDiscarded.isParent) {
            //     stack.push(childOfDiscarded);
            //   }
            // }

            continue; // skip writing this child
          } else if (!isPkg && child.exitStamp != null) {
            // pkg merge sequence ends
            lastPkg.recalculateDurations();
            lastPkg = null;
          }
        }

        // First timing we see a pkg event or found a pkg event with a different namespace
        if (isPkg) {
          // done merging to the last pkg event, make sure the durations are correct
          lastPkg?.recalculateDurations();
          lastPkg = child;
        }

        if (child.isParent) {
          stack.push(child);
        }

        // keep this child by rewriting in place
        children[write++] = child;
      }

      // truncate array to new length
      if (write < children.length) {
        children.length = write;
        lastPkg?.recalculateDurations();
      }
    }
  }

  public addLogIssue(
    startTime: number,
    summary: string,
    description: string,
    type: IssueType,
  ) {
    const boundedSummary = this.boundIssueText(
      summary,
      ApexLogParser.MAX_ISSUE_SUMMARY_CHARS,
    );
    const existing = this.logIssuesBySummary.get(boundedSummary);
    if (existing) {
      existing.occurrences = (existing.occurrences ?? 1) + 1;
      existing.lastTime = startTime;
      return;
    }

    if (this.logIssues.length >= ApexLogParser.MAX_LOG_ISSUES) {
      this.addOverflowIssue(startTime);
      return;
    }

    const issue: LogIssue = {
      startTime,
      lastTime: startTime,
      occurrences: 1,
      summary: boundedSummary,
      description: this.boundIssueText(
        description,
        ApexLogParser.MAX_ISSUE_DESCRIPTION_CHARS,
      ),
      type,
    };
    this.reasons.add(boundedSummary);
    this.logIssues.push(issue);
    this.logIssuesBySummary.set(boundedSummary, issue);
  }

  private addOverflowIssue(startTime: number): void {
    let overflow = this.logIssuesBySummary.get(
      ApexLogParser.ISSUE_OVERFLOW_SUMMARY,
    );
    if (!overflow) {
      const evicted = this.logIssues.pop()!;
      this.logIssuesBySummary.delete(evicted.summary);
      this.reasons.delete(evicted.summary);
      const evictedOccurrences = evicted.occurrences ?? 1;
      overflow = {
        startTime: evicted.startTime ?? startTime,
        lastTime: startTime,
        occurrences: evictedOccurrences,
        summary: ApexLogParser.ISSUE_OVERFLOW_SUMMARY,
        description:
          "Additional issue occurrences exceeded the parser safety cap; aggregate occurrence and timing evidence is retained here.",
        type: "unexpected",
      };
      this.logIssues.push(overflow);
      this.logIssuesBySummary.set(overflow.summary, overflow);
      this.reasons.add(overflow.summary);
      this.logIssueOverflowCount = evictedOccurrences;
    }
    overflow.occurrences = (overflow.occurrences ?? 0) + 1;
    overflow.lastTime = startTime;
    this.logIssueOverflowCount += 1;
  }

  private boundIssueText(value: string, maxChars: number): string {
    return value.length <= maxChars
      ? value
      : `${value.slice(0, maxChars - 1)}…`;
  }

  private addParsingError(
    message: string,
    type: ParsingDiagnostic["type"],
    rawLineNumber: number | null,
    sample: string,
  ): void {
    let diagnostic = this.parsingDiagnosticsByType.get(type);
    if (!diagnostic) {
      diagnostic = {
        type,
        count: 0,
        firstLine: rawLineNumber,
        lastLine: rawLineNumber,
        samples: [],
      };
      this.parsingDiagnosticsByType.set(type, diagnostic);
      this.parsingDiagnostics.push(diagnostic);
    }
    diagnostic.count += 1;
    diagnostic.lastLine = rawLineNumber;
    const boundedSample = sample.slice(0, 500);
    if (
      diagnostic.samples.length < 3 &&
      !diagnostic.samples.includes(boundedSample)
    ) {
      diagnostic.samples.push(boundedSample);
    }
    if (
      !this.parsingErrors.includes(message) &&
      this.parsingErrors.length < ApexLogParser.MAX_PARSING_ERRORS
    ) {
      this.parsingErrors.push(message);
      return;
    }
    if (this.parsingErrors.includes(message)) return;
    this.parsingErrorOverflowCount += 1;
  }

  private updateLogIssue(
    startTime: number,
    summary: string,
    description: string,
    type: IssueType,
  ) {
    const boundedSummary = this.boundIssueText(
      summary,
      ApexLogParser.MAX_ISSUE_SUMMARY_CHARS,
    );
    const existing = this.logIssuesBySummary.get(boundedSummary);
    if (existing) {
      const elem = this.logIssues.indexOf(existing);
      if (elem > -1) this.logIssues.splice(elem, 1);
      this.logIssuesBySummary.delete(boundedSummary);
    }
    this.reasons.delete(boundedSummary);

    this.addLogIssue(startTime, summary, description, type);
  }

  private getDebugLevels(log: string): DebugLevel[] {
    const match = log.match(settingsPattern);
    if (!match) {
      return [];
    }

    const settings = match[0],
      settingList = settings.substring(settings.indexOf(" ") + 1).split(";");

    return settingList.map((entry) => {
      const parts = entry.split(",");
      return new DebugLevel(parts[0] || "", parts[1] || "");
    });
  }
}

export class DebugLevel {
  logCategory: string;
  logLevel: string;

  constructor(category: string, level: string) {
    this.logCategory = category;
    this.logLevel = level;
  }
}

export class LineIterator {
  next: LogEvent | null;
  lineGenerator: Generator<LogEvent>;

  constructor(lineGenerator: Generator<LogEvent>) {
    this.lineGenerator = lineGenerator;
    this.next = this.lineGenerator.next().value;
  }

  peek(): LogEvent | null {
    return this.next;
  }

  fetch(): LogEvent | null {
    const result = this.next;
    this.next = this.lineGenerator.next().value;
    return result;
  }
}
