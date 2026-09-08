"use strict";
(() => {
  // src/perf-shim.ts
  var performance = globalThis.performance ?? { now: () => Date.now() };

  // ../core/dist/index.js
  var DEBUG_CATEGORY = {
    Database: "Database",
    Workflow: "Workflow",
    NBA: "NBA",
    Validation: "Validation",
    Callout: "Callout",
    ApexCode: "Apex Code",
    ApexProfiling: "Apex Profiling",
    Visualforce: "Visualforce",
    System: "System"
  };
  var LOG_CATEGORY = {
    Apex: "Apex",
    System: "System",
    CodeUnit: "Code Unit",
    Automation: "Automation",
    DML: "DML",
    SOQL: "SOQL",
    Callout: "Callout"
  };
  function splitLogFields(value, maxFields = 64) {
    const limit = Math.max(1, Math.floor(maxFields));
    const fields = [];
    let start = 0;
    while (fields.length < limit - 1) {
      const separator = value.indexOf("|", start);
      if (separator === -1) break;
      fields.push(value.slice(start, separator));
      start = separator + 1;
    }
    fields.push(value.slice(start));
    return fields;
  }
  function parseSafeIntegerToken(value) {
    const token = value?.trim() ?? "";
    if (!/^\d+$/.test(token) && !/^\d{1,3}(?:,\d{3})+$/.test(token)) {
      return null;
    }
    const parsed = Number(token.replaceAll(",", ""));
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  var LogEvent = class {
    logParser;
    parent = null;
    /**
     * All child nodes of the current node
     */
    children = [];
    /**
     * The type of this log line from the log file e.g METHOD_ENTRY
     */
    type = null;
    /**
     * The full raw text of this log line
     */
    logLine = "";
    // the raw text of this log line
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
    pairingStatus = "not_applicable";
    /** True when duration ends at inferred or incomplete evidence. */
    durationIsPartial = false;
    /** Forward-compatible classification for events without known semantics. */
    classification = "supported";
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
    lineNumber = null;
    /** 1-based physical line number in the Salesforce debug-log file. */
    rawLineNumber = null;
    /** Physical log line containing this event's matched exit record. */
    exitRawLineNumber = null;
    /** Original text of this event's matched exit record. */
    exitLogLine = null;
    /**
     * The package namespace associated with this log line
     * @default default
     */
    namespace = "";
    /**
     * Could match to a corresponding symbol in a file in the workspace?
     */
    hasValidSymbols = false;
    /**
     * Extra description context
     */
    suffix = null;
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
    exitStamp = null;
    /**
     * The timeline display category this event belongs to.
     */
    category = "";
    /**
     * The original Salesforce debug log category.
     */
    debugCategory = "";
    /**
     * The CPU type, e.g loading, method, custom
     */
    cpuType = "";
    // the category key to collect our cpu usage
    /**
     * The time spent.
     */
    duration = {
      /**
       * The net (wall) time spent in the node (when not inside children)
       */
      self: 0,
      /**
       * The total (wall) time spent in the node
       */
      total: 0
    };
    /**
     * Total + self row counts for DML
     */
    dmlRowCount = {
      /**
       * The net number of DML rows for this node, excluding child nodes
       */
      self: 0,
      /**
       * The total number of DML rows for this node and child nodes
       */
      total: 0
    };
    /**
     * Total + self row counts for SOQL
     */
    soqlRowCount = {
      /**
       * The net number of SOQL rows for this node, excluding child nodes
       */
      self: 0,
      /**
       * The total number of SOQL rows for this node and child nodes
       */
      total: 0
    };
    /**
     * Total + self row counts for SOSL
     */
    soslRowCount = {
      /**
       * The net number of SOSL rows for this node, excluding child nodes
       */
      self: 0,
      /**
       * The total number of SOSL rows for this node and child nodes
       */
      total: 0
    };
    /** Whether this database event's own row count was parsed from valid evidence. */
    rowCountIsKnown = true;
    dmlCount = {
      /**
       * The net number of DML operations (DML_BEGIN) in this node.
       */
      self: 0,
      /**
       * The total number of DML operations (DML_BEGIN) in this node and child nodes
       */
      total: 0
    };
    soqlCount = {
      /**
       * The net number of SOQL operations (SOQL_EXECUTE_BEGIN) in this node.
       */
      self: 0,
      /**
       * The total number of SOQL operations (SOQL_EXECUTE_BEGIN) in this node and child nodes
       */
      total: 0
    };
    soslCount = {
      /**
       * The net number of SOSL operations (SOSL_EXECUTE_BEGIN) in this node.
       */
      self: 0,
      /**
       * The total number of SOSL operations (SOSL_EXECUTE_BEGIN) in this node and child nodes
       */
      total: 0
    };
    /**
     * The total number of exceptions thrown (EXCEPTION_THROWN) in this node and child nodes
     */
    totalThrownCount = 0;
    /**
     * The line types which would legitimately end this method
     */
    exitTypes = [];
    constructor(parser, parts) {
      this.logParser = parser;
      const [timeData, type] = parts;
      if (type) {
        this.text = this.type = type;
      }
      if (timeData) {
        this.timestamp = this.parseTimestamp(timeData);
      }
    }
    recalculateDurations() {
      if (this.exitStamp != null) {
        if (this.exitStamp < this.timestamp) {
          this.duration.total = this.duration.self = 0;
          this.durationIsPartial = true;
          return;
        }
        this.duration.total = this.duration.self = this.exitStamp - this.timestamp;
      }
    }
    parseTimestamp(text) {
      const match = String(text || "").match(/\((\d+)\)$/);
      if (match) {
        const value = Number(match[1]);
        if (Number.isSafeInteger(value) && value >= 0) return value;
      }
      throw new Error(`Unable to parse timestamp: '${text}'`);
    }
    parseLineNumber(text) {
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
  };
  var DurationLogEvent = class extends LogEvent {
    isParent = true;
    constructor(parser, parts, exitTypes, category, cpuType, debugCategory = "") {
      super(parser, parts);
      this.exitTypes = exitTypes;
      this.category = category;
      this.cpuType = cpuType;
      this.debugCategory = debugCategory;
    }
  };
  var BasicLogLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts.slice(2).join("|").trim();
    }
  };
  var UnknownLogLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.classification = "unsupported";
      this.text = parts.slice(2).join("|").trim();
    }
  };
  var BasicExitLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts.slice(2).join("|").trim();
    }
  };
  var ApexLog = class extends LogEvent {
    type = null;
    text = "LOG_ROOT";
    timestamp = 0;
    exitStamp = 0;
    exitTypes = [];
    category = "";
    cpuType = "";
    /**
     * The size of the log, in bytes
     */
    size = 0;
    /**
     * The Apex Debug Logging Levels for the current log
     */
    debugLevels = [];
    /**
     * All the namespaces that appear in this log.
     */
    namespaces = [];
    /**
     * Any issues within the log, such as cpu time exceeded or max log size reached.
     */
    logIssues = [];
    /**
     * Any issues that occurred during the parsing of the log, such as an unrecognized log event type.
     */
    parsingErrors = [];
    /** Grouped malformed-input diagnostics with bounded representative samples. */
    parsingDiagnostics = [];
    /** Number of additional parser diagnostics omitted after the safety cap. */
    parsingErrorOverflowCount = 0;
    /** Issue occurrences represented only by the bounded overflow aggregate. */
    logIssueOverflowCount = 0;
    governorLimits = {
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
      byNamespace: /* @__PURE__ */ new Map(),
      snapshots: []
    };
    /**
     * The wall-clock time of the first event, in milliseconds since midnight.
     * Parsed from the `HH:MM:SS.f` portion of the first log line.
     * Null if no wall-clock time could be parsed.
     */
    startTime = null;
    /**
     * The endtime with nodes of 0 duration excluded
     */
    executionEndTime = 0;
    constructor(parser) {
      super(parser, []);
    }
    setTimes() {
      const firstChild = this.children[0];
      this.timestamp = firstChild?.timestamp ?? 0;
      if (firstChild?.logLine) {
        this.startTime = parseWallClockTime(firstChild.logLine);
      }
      let endTime;
      const reverseLen = this.children.length - 1;
      for (let i = reverseLen; i >= 0; i--) {
        const child = this.children[i];
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
  };
  function parseObjectNamespace(text) {
    if (!text) {
      return "";
    }
    const sep = text.indexOf("__");
    if (sep <= 0 || text.indexOf("__", sep + 2) === -1) {
      return "default";
    }
    return text.slice(0, sep);
  }
  function parseVfNamespace(text) {
    const sep = text.indexOf("__");
    if (sep <= 0) {
      return "default";
    }
    const namespace = text.substring(0, sep);
    if (namespace.includes("/")) {
      return "default";
    }
    return namespace;
  }
  function parseWallClockTime(logLine) {
    const match = /^((?:[01]\d|2[0-3])):([0-5]\d):([0-5]\d)\.(\d{1,9})(?=\s+\()/.exec(
      logLine
    );
    if (!match) {
      return null;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const raw = match[4];
    const fraction = Number(raw.slice(0, 3).padEnd(3, "0"));
    return (hours * 3600 + minutes * 60 + seconds) * 1e3 + fraction;
  }
  function parseRows(text) {
    if (!text) {
      return null;
    }
    const rowMatch = text.match(
      /(?:\bRows|Number of rows processed)\s*:\s*([^\s|]+)/i
    );
    const token = rowMatch?.[1] ?? text.trim();
    return parseSafeIntegerToken(token);
  }
  var BulkHeapAllocateLine = class extends LogEvent {
    logCategory = "Apex Code";
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts[2] || "";
    }
  };
  var CalloutRequestLine = class extends DurationLogEvent {
    responseText = null;
    responseLineNumber = null;
    responseTimestamp = null;
    responseLogLine = null;
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["CALLOUT_RESPONSE"],
        LOG_CATEGORY.Callout,
        "free",
        DEBUG_CATEGORY.Callout
      );
      const linePart = parts[2] || "";
      const hasSourceLine = /^\[[^\]]+\]$/.test(linePart);
      this.isContinuation = !hasSourceLine && /^(?:Method|Headers|Body)\s*:/i.test(linePart);
      if (this.isContinuation) {
        this.isParent = false;
        this.exitTypes = [];
      }
      this.text = parts.slice(hasSourceLine ? 3 : 2).join("|");
      if (hasSourceLine) this.lineNumber = this.parseLineNumber(linePart);
    }
    onEnd(end, _stack) {
      this.responseText = end.text;
      this.responseLineNumber = end.rawLineNumber;
      this.responseTimestamp = end.timestamp;
      this.responseLogLine = end.logLine;
    }
  };
  var CalloutResponseLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      const linePart = parts[2] || "";
      const hasSourceLine = /^\[[^\]]+\]$/.test(linePart);
      this.isContinuation = !hasSourceLine && /^Body\s*:/i.test(linePart);
      if (this.isContinuation) this.isExit = false;
      this.text = parts.slice(hasSourceLine ? 3 : 2).join("|");
      if (hasSourceLine) this.lineNumber = this.parseLineNumber(linePart);
    }
  };
  var NAMED_CREDENTIAL_FIELD_LABELS = [
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
    "Connect Time ms"
  ];
  function parseNamedCredentialFields(payload) {
    const text = payload.join("|");
    const labels = NAMED_CREDENTIAL_FIELD_LABELS.map(
      (label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    ).join("|");
    const pattern = new RegExp(`(?:^|[\\[|,]\\s*)(${labels})\\s*[:=]\\s*`, "gi");
    const matches = Array.from(text.matchAll(pattern));
    const fields = /* @__PURE__ */ new Map();
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const next = matches[index + 1];
      const valueStart = (match.index ?? 0) + match[0].length;
      const valueEnd = next?.index ?? text.length;
      const value = text.slice(valueStart, valueEnd).replace(/[|\]\s]+$/g, "").trim();
      fields.set(match[1].toLowerCase(), value);
    }
    return fields;
  }
  function namedCredentialNumber(fields, key) {
    const raw = fields.get(key.toLowerCase());
    return parseSafeIntegerToken(raw);
  }
  var NamedCredentialRequestLine = class extends LogEvent {
    credentialId = null;
    credentialName = null;
    endpoint = null;
    method = null;
    externalCredentialType = null;
    requestSizeBytes = null;
    retryOn401 = null;
    constructor(parser, parts) {
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
      this.externalCredentialType = fields.get("external credential type") || null;
      this.requestSizeBytes = namedCredentialNumber(fields, "request size bytes");
      const retry = fields.get("retry on 401")?.toLowerCase();
      this.retryOn401 = retry === "true" ? true : retry === "false" ? false : null;
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
  };
  var NamedCredentialResponseLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Callout;
      const hasSourceLine = /^\[[^\]]+\]$/.test(parts[2] || "");
      if (hasSourceLine) this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = parts.slice(hasSourceLine ? 3 : 2).join("|");
      this.isContinuation = /^Body\s*:/i.test(this.text);
    }
  };
  var NamedCredentialResponseDetailLine = class extends LogEvent {
    credentialId = null;
    credentialName = null;
    statusCode = null;
    responseSizeBytes = null;
    overallCalloutTimeMs = null;
    connectTimeMs = null;
    constructor(parser, parts) {
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
        "response size bytes"
      );
      this.overallCalloutTimeMs = namedCredentialNumber(
        fields,
        "overall callout time ms"
      );
      this.connectTimeMs = namedCredentialNumber(fields, "connect time ms");
      this.text = payload.join("|");
    }
  };
  var ConstructorEntryLine = class extends DurationLogEvent {
    hasValidSymbols = true;
    suffix = " (constructor)";
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["CONSTRUCTOR_EXIT"],
        LOG_CATEGORY.Apex,
        "method",
        DEBUG_CATEGORY.ApexCode
      );
      this.lineNumber = this.parseLineNumber(parts[2]);
      const [, , , , args, className] = parts;
      this.text = className + (args ? args.substring(args.lastIndexOf("(")) : "");
      const possibleNS = this._parseConstructorNamespace(className || "");
      if (possibleNS) {
        this.namespace = possibleNS;
      }
    }
    _parseConstructorNamespace(className) {
      const dotIndex = className.indexOf(".");
      let possibleNs = dotIndex === -1 ? "" : className.slice(0, dotIndex);
      if (possibleNs && this.logParser.namespaces.has(possibleNs)) {
        return possibleNs;
      }
      const constructorParts = (className ?? "").split(".");
      possibleNs = constructorParts[0] || "";
      return this.logParser.namespaces.has(possibleNs) ? possibleNs : "";
    }
  };
  var ConstructorExitLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
    }
  };
  var EmailQueueLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
    }
  };
  var MethodEntryLine = class extends DurationLogEvent {
    hasValidSymbols = true;
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["METHOD_EXIT"],
        LOG_CATEGORY.Apex,
        "method",
        DEBUG_CATEGORY.ApexCode
      );
      const [, , lineNumber, , methodName] = parts;
      this.lineNumber = this.parseLineNumber(lineNumber);
      this.text = methodName ?? this.type ?? this.text;
      if (this.text?.startsWith("System.Type.forName(")) {
        this.cpuType = "loading";
      } else {
        const possibleNs = this._parseMethodNamespace(methodName);
        if (possibleNs) {
          this.namespace = possibleNs;
        }
      }
    }
    onEnd(end, _stack) {
      if (end.namespace && !end.text.endsWith(")")) {
        this.namespace = end.namespace;
      }
    }
    _parseMethodNamespace(methodName) {
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
  };
  var MethodExitLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = parts[4] ?? parts[3] ?? this.text;
      if (!this.text.endsWith(")")) {
        const index = this.text.indexOf(".");
        if (index !== -1) {
          const possibleNamespace = this.text.slice(0, index);
          this.namespace = this.logParser.namespaces.has(possibleNamespace) ? possibleNamespace : "default";
        }
      }
    }
  };
  var SystemConstructorEntryLine = class extends DurationLogEvent {
    suffix = "(system constructor)";
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["SYSTEM_CONSTRUCTOR_EXIT"],
        LOG_CATEGORY.System,
        "method",
        DEBUG_CATEGORY.System
      );
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = parts[3] || "";
    }
  };
  var SystemConstructorExitLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
    }
  };
  var SystemMethodEntryLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["SYSTEM_METHOD_EXIT"],
        LOG_CATEGORY.System,
        "method",
        DEBUG_CATEGORY.System
      );
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = parts[3] || "";
    }
  };
  var SystemMethodExitLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
    }
  };
  var CodeUnitStartedLine = class extends DurationLogEvent {
    suffix = " (entrypoint)";
    codeUnitType = "";
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["CODE_UNIT_FINISHED"],
        LOG_CATEGORY.CodeUnit,
        "custom",
        DEBUG_CATEGORY.ApexCode
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
          this.namespace = namespaceIndex !== -1 ? name.slice(name.indexOf("apex://") + 7, namespaceIndex) : "default";
          this.text = name;
          break;
        }
        case "__sfdc_trigger": {
          this.cpuType = "method";
          this.text = typeString;
          const triggerParts = typeString.split("/");
          const objectName = triggerParts.length === 3 ? triggerParts[1] || "" : "";
          const triggerName = triggerParts.length === 3 ? triggerParts[2] || "" : "";
          const objectNamespace = parseObjectNamespace(objectName);
          const triggerNamespace = triggerName.split("__")[0] || "";
          this.namespace = objectNamespace && objectNamespace !== "default" ? objectNamespace : this.logParser.namespaces.has(triggerNamespace) ? triggerNamespace : "default";
          break;
        }
        default: {
          this.cpuType = "method";
          this.text = name;
          const openBracket = name.lastIndexOf("(");
          const methodName = openBracket !== -1 ? name.slice(0, openBracket + 1).split(".") : name.split(".");
          if (methodName.length === 3 || methodName.length === 2 && !methodName[1]?.endsWith("(")) {
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
  };
  var CodeUnitFinishedLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts[2] || "";
    }
  };
  var VFApexCallStartLine = class extends DurationLogEvent {
    hasValidSymbols = true;
    suffix = " (VF APEX)";
    invalidClasses = [
      "pagemessagescomponentcontroller",
      "pagemessagecomponentcontroller",
      "severitymessages"
    ];
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["VF_APEX_CALL_END"],
        LOG_CATEGORY.Apex,
        "method",
        DEBUG_CATEGORY.ApexCode
      );
      this.lineNumber = this.parseLineNumber(parts[2]);
      const classText = parts[5] || parts[3] || "";
      let methodtext = parts[4] || "";
      if (!methodtext && (!classText.includes(" ") || this.invalidClasses.some(
        (invalidCls) => classText.toLowerCase().includes(invalidCls)
      ))) {
        this.exitTypes = [];
        this.hasValidSymbols = false;
      } else if (methodtext) {
        const methodIndex = methodtext.indexOf("(");
        const constructorIndex = methodtext.indexOf("<init>");
        if (methodIndex > -1) {
          methodtext = "." + methodtext.substring(methodIndex).slice(1, -1) + "()";
        } else if (constructorIndex > -1) {
          methodtext = methodtext.substring(constructorIndex + 6) + "()";
        } else {
          methodtext = "." + methodtext;
        }
      }
      this.text = classText + methodtext;
    }
  };
  var VFApexCallEndLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts[2] || "";
    }
  };
  var VFDeserializeViewstateBeginLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["VF_DESERIALIZE_VIEWSTATE_END"],
        LOG_CATEGORY.System,
        "method",
        DEBUG_CATEGORY.Visualforce
      );
    }
  };
  var VFFormulaStartLine = class extends DurationLogEvent {
    suffix = " (VF FORMULA)";
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["VF_EVALUATE_FORMULA_END"],
        LOG_CATEGORY.System,
        "custom",
        DEBUG_CATEGORY.Visualforce
      );
      this.text = parts[3] || "";
    }
  };
  var VFFormulaEndLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Visualforce;
      this.text = parts[2] || "";
    }
  };
  var VFSeralizeViewStateStartLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["VF_SERIALIZE_VIEWSTATE_END"],
        LOG_CATEGORY.System,
        "method",
        DEBUG_CATEGORY.Visualforce
      );
    }
  };
  var VFPageMessageLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.ApexCode;
      this.text = parts[2] || "";
    }
  };
  var DMLBeginLine = class extends DurationLogEvent {
    dmlCount = {
      self: 1,
      total: 1
    };
    namespace = "default";
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["DML_END"],
        LOG_CATEGORY.DML,
        "free",
        DEBUG_CATEGORY.Database
      );
      this.lineNumber = this.parseLineNumber(parts[2]);
      const payloadParts = parts.slice(3);
      const payload = payloadParts.join("|");
      const compactOperation = payloadParts[0]?.match(
        /^(Insert|Update|Upsert|Delete|Undelete|Merge)$/i
      )?.[1];
      const compactObject = payloadParts[1]?.trim();
      const compactRows = payloadParts[2]?.trim();
      if (compactOperation && compactObject && compactRows && /^\d[\d,]*$/.test(compactRows)) {
        this.text = `DML Op:${compactOperation} Type:${compactObject} Rows:${compactRows}`;
      } else {
        this.text = `DML ${payloadParts.join(" ")}`;
      }
      const rows = parseRows(payload);
      this.rowCountIsKnown = rows !== null;
      if (rows !== null) this.dmlRowCount.total = this.dmlRowCount.self = rows;
    }
  };
  var DMLEndLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
    }
  };
  var DMLErrorLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Database;
      this.text = String(parts.slice(3).join("|") || "").trim();
    }
  };
  var IdeasQueryExecuteLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
    }
  };
  var CursorCreateBeginLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["CURSOR_CREATE_END"],
        LOG_CATEGORY.SOQL,
        "free",
        DEBUG_CATEGORY.Database
      );
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = parts.slice(3).join("|").trim();
    }
  };
  var CursorCreateEndLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = parts.slice(3).join("|").trim();
    }
  };
  var CursorFetchLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.category = LOG_CATEGORY.SOQL;
      this.cpuType = "free";
      this.debugCategory = DEBUG_CATEGORY.Database;
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = parts.slice(3).join("|").trim();
    }
  };
  var CursorFetchPageLine = class extends CursorFetchLine {
  };
  var SOQLExecuteBeginLine = class extends DurationLogEvent {
    aggregations = null;
    children = [];
    soqlCount = {
      self: 1,
      total: 1
    };
    rowCountIsKnown = false;
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["SOQL_EXECUTE_END"],
        LOG_CATEGORY.SOQL,
        "free",
        DEBUG_CATEGORY.Database
      );
      this.lineNumber = this.parseLineNumber(parts[2]);
      const payload = parts.slice(3);
      const aggregationText = payload[0] || "";
      if (/^Aggregations:/i.test(aggregationText)) {
        const rawAggregations = aggregationText.slice(13).trim();
        const parsedAggregations = /^\d+$/.test(rawAggregations) ? Number(rawAggregations) : NaN;
        this.aggregations = Number.isSafeInteger(parsedAggregations) && parsedAggregations >= 0 ? parsedAggregations : null;
        this.text = payload.slice(1).join("|");
      } else {
        this.text = payload.join("|");
      }
    }
    onEnd(end, _stack) {
      this.rowCountIsKnown = end.rowCountIsKnown;
      this.soqlRowCount.total = this.soqlRowCount.self = end.soqlRowCount.total;
    }
  };
  var SOQLExecuteEndLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
      const rows = parseRows(parts[3] || "");
      this.rowCountIsKnown = rows !== null;
      if (rows !== null) this.soqlRowCount.total = this.soqlRowCount.self = rows;
    }
  };
  function parseNumericField(text, prefix, integer = true) {
    if (!text) return null;
    const idx = text.indexOf(prefix);
    if (idx === -1) return null;
    const rawText = text.slice(idx + prefix.length).trim();
    if (rawText === "") return null;
    const raw = Number(rawText);
    if (!Number.isFinite(raw) || raw < 0) return null;
    return !integer || Number.isSafeInteger(raw) ? raw : null;
  }
  var SOQLExecuteExplainLine = class extends LogEvent {
    cardinality = null;
    // The estimated number of records that the leading operation type would return
    fields = null;
    //The indexed field(s) used by the Query Optimizer. If the leading operation type is Index, the fields value is Index. Otherwise, the fields value is null.
    leadingOperationType = null;
    // The primary operation type that Salesforce will use to optimize the query.
    relativeCost = null;
    // The cost of the query compared to the Force.com Query Optimizer’s selectivity threshold. Values above 1 mean that the query won’t be selective.
    sObjectCardinality = null;
    // The approximate record count for the queried object.
    sObjectType = null;
    //T he name of the queried SObject
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
      const queryPlanDetails = parts[3] || "";
      this.text = queryPlanDetails;
      const queryplanParts = queryPlanDetails.split("],");
      if (queryplanParts.length > 1) {
        const planExplain = queryplanParts[0] || "";
        const [cardinalityText, sobjCardinalityText, costText] = (queryplanParts[1] || "").split(",");
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
          const fieldsAsString = planExplain.slice(bracketIndex + 1).replace(/\s+/g, "");
          this.fields = fieldsAsString === "" ? [] : fieldsAsString.split(",");
          this.cardinality = parseNumericField(cardinalityText, "cardinality: ");
          this.sObjectCardinality = parseNumericField(
            sobjCardinalityText,
            "sobjectCardinality: "
          );
          this.relativeCost = parseNumericField(costText, "relativeCost ", false);
        }
      }
    }
  };
  var SOSLExecuteBeginLine = class extends DurationLogEvent {
    soslCount = {
      self: 1,
      total: 1
    };
    rowCountIsKnown = false;
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["SOSL_EXECUTE_END"],
        LOG_CATEGORY.SOQL,
        "free",
        DEBUG_CATEGORY.Database
      );
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = `SOSL: ${parts.slice(3).join("|")}`;
    }
    onEnd(end, _stack) {
      this.rowCountIsKnown = end.rowCountIsKnown;
      this.soslRowCount.total = this.soslRowCount.self = end.soslRowCount.total;
    }
  };
  var SOSLExecuteEndLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
      const rows = parseRows(parts[3] || "");
      this.rowCountIsKnown = rows !== null;
      if (rows !== null) this.soslRowCount.total = this.soslRowCount.self = rows;
    }
  };
  var QueueableBeginLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["QUEUEABLE_END"],
        LOG_CATEGORY.CodeUnit,
        "custom",
        DEBUG_CATEGORY.ApexCode
      );
      const linePart = String(parts[2] || "");
      if (/^\[[^\]]+\]$/.test(linePart))
        this.lineNumber = this.parseLineNumber(linePart);
      this.text = String(parts.slice(3).join("|") || "").trim();
    }
  };
  var QueueableEndLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      const linePart = String(parts[2] || "");
      if (/^\[[^\]]+\]$/.test(linePart))
        this.lineNumber = this.parseLineNumber(linePart);
      this.text = String(parts.slice(3).join("|") || "").trim();
    }
  };
  var AsyncApexBeginLine = class extends DurationLogEvent {
    constructor(parser, parts, exitType) {
      super(
        parser,
        parts,
        [exitType],
        LOG_CATEGORY.CodeUnit,
        "custom",
        DEBUG_CATEGORY.ApexCode
      );
      const linePart = String(parts[2] || "");
      const hasSourceLine = /^\[[^\]]+\]$/.test(linePart);
      if (hasSourceLine) this.lineNumber = this.parseLineNumber(linePart);
      this.text = parts.slice(hasSourceLine ? 3 : 2).join("|").trim();
    }
  };
  var FutureMethodBeginLine = class extends AsyncApexBeginLine {
    constructor(parser, parts) {
      super(parser, parts, "FUTURE_METHOD_END");
    }
  };
  var BatchApexExecuteBeginLine = class extends AsyncApexBeginLine {
    constructor(parser, parts) {
      super(parser, parts, "BATCH_APEX_EXECUTE_END");
    }
  };
  var AsyncApexEndLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      const linePart = String(parts[2] || "");
      const hasSourceLine = /^\[[^\]]+\]$/.test(linePart);
      if (hasSourceLine) this.lineNumber = this.parseLineNumber(linePart);
      this.text = parts.slice(hasSourceLine ? 3 : 2).join("|").trim();
    }
  };
  var HeapAllocateLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = parts[3] || "";
    }
  };
  var HeapDeallocateLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
    }
  };
  var StatementExecuteLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
    }
  };
  var VariableScopeBeginLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = parts.slice(3).join(" | ");
    }
  };
  var VariableAssignmentLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = parts.slice(3).join(" | ");
    }
  };
  var UserInfoLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = (parts[3] ?? "") + " " + (parts[4] ?? "");
    }
  };
  var UserDebugLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = parts.slice(3).join(" | ");
    }
  };
  var DataWeaveUserDebugLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.ApexCode;
      const sourceMarker = parts[2];
      const hasSourceMarker = Boolean(
        sourceMarker?.match(/^\[(?:\d+|[A-Z_]+)\]$/)
      );
      if (hasSourceMarker) this.lineNumber = this.parseLineNumber(sourceMarker);
      this.text = parts.slice(hasSourceMarker ? 3 : 2).join(" | ");
    }
  };
  var FormulaEvaluateBeginLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["FORMULA_EVALUATE_END"],
        LOG_CATEGORY.Apex,
        "method",
        DEBUG_CATEGORY.ApexCode
      );
      this.text = parts.slice(2).join(" | ");
    }
  };
  var RlmConfiguratorBeginLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["RLM_CONFIGURATOR_END"],
        LOG_CATEGORY.System,
        "method",
        DEBUG_CATEGORY.System
      );
      this.text = parts.slice(2).join(" | ");
    }
  };
  var RlmPricingBeginLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["RLM_PRICING_END"],
        LOG_CATEGORY.System,
        "method",
        DEBUG_CATEGORY.System
      );
      this.text = parts.slice(2).join(" | ");
    }
  };
  var CumulativeLimitUsageLine = class extends DurationLogEvent {
    namespace = "default";
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["CUMULATIVE_LIMIT_USAGE_END"],
        LOG_CATEGORY.System,
        "system",
        DEBUG_CATEGORY.ApexProfiling
      );
    }
  };
  var CumulativeProfilingLine = class extends LogEvent {
    acceptsText = true;
    namespace = "default";
    constructor(parser, parts) {
      super(parser, parts);
      this.text = (parts[2] ?? "") + " " + (parts[3] ?? "");
    }
  };
  var CumulativeProfilingBeginLine = class extends DurationLogEvent {
    namespace = "default";
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["CUMULATIVE_PROFILING_END"],
        LOG_CATEGORY.System,
        "custom",
        DEBUG_CATEGORY.ApexProfiling
      );
    }
  };
  var LimitUsageLine = class extends LogEvent {
    namespace = "default";
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.ApexProfiling;
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = (parts[3] ?? "") + " " + (parts[4] ?? "") + " out of " + (parts[5] ?? "");
    }
  };
  var LimitUsageForNSLine = class _LimitUsageForNSLine extends LogEvent {
    static limitsKeys = /* @__PURE__ */ new Map([
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
        "queueableJobsAddedToQueue"
      ],
      ["Number of Mobile Apex push calls", "mobileApexPushCalls"],
      ["Number of Publish Immediate list size", "publishImmediateDml"]
    ]);
    namespace = "default";
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.ApexProfiling;
      this.acceptsText = true;
      const namespace = parts[2]?.trim() || "(default)";
      const inlineLimit = parts.slice(3).join("|").trim();
      this.text = `${namespace}|${inlineLimit ? `
${inlineLimit}` : ""}`;
    }
    onAfter(parser, _next) {
      const rawNs = this.text.split(/\r?\n/)[0]?.replace(/\|$/, "").trim() ?? "";
      this.namespace = rawNs.replace(/^\((.+)\)$/, "$1") || "default";
      const cleanedText = this.text.replace(/^\s+/gm, "").replaceAll("******* CLOSE TO LIMIT", "").replaceAll(" out of ", "/");
      this.text = cleanedText;
      const lines = cleanedText.split(/\r?\n/);
      const limits = {
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
        mobileApexPushCalls: { used: 0, limit: 0 }
      };
      for (const line of lines) {
        const match = line.match(/^(.+?):\s*([\d,]+)\/([\d,]+)/);
        if (match) {
          const key = _LimitUsageForNSLine.limitsKeys.get(
            match[1].trim()
          );
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
        for (const key of _LimitUsageForNSLine.limitsKeys.values()) {
          if (limits[key].limit === 0 && limits[key].used === 0) {
            limits[key] = { ...prior[key] };
          }
        }
      }
      parser.governorLimits.byNamespace.set(this.namespace, limits);
      parser.governorLimits.snapshots.push({
        timestamp: this.timestamp,
        namespace: this.namespace,
        limits: Object.fromEntries(
          Object.entries(limits).map(([key, value]) => [key, { ...value }])
        )
      });
    }
  };
  var NBANodeBegin = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["NBA_NODE_END"],
        LOG_CATEGORY.Automation,
        "method",
        DEBUG_CATEGORY.NBA
      );
      this.text = parts.slice(2).join(" | ");
    }
  };
  var NBANodeDetail = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts.slice(2).join(" | ");
    }
  };
  var NBANodeEnd = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts.slice(2).join(" | ");
    }
  };
  var NBANodeError = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts.slice(2).join(" | ");
    }
  };
  var NBAOfferInvalid = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts.slice(2).join(" | ");
    }
  };
  var NBAStrategyBegin = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["NBA_STRATEGY_END"],
        LOG_CATEGORY.Automation,
        "method",
        DEBUG_CATEGORY.NBA
      );
      this.text = parts.slice(2).join(" | ");
    }
  };
  var NBAStrategyEnd = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts.slice(2).join(" | ");
    }
  };
  var NBAStrategyError = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts.slice(2).join(" | ");
    }
  };
  var PushTraceFlagsLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = (parts[4] ?? "") + ", line:" + this.lineNumber + " - " + (parts[5] ?? "");
    }
  };
  var PopTraceFlagsLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = (parts[4] ?? "") + ", line:" + this.lineNumber + " - " + (parts[5] ?? "");
    }
  };
  var QueryMoreBeginLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["QUERY_MORE_END"],
        LOG_CATEGORY.SOQL,
        "custom",
        DEBUG_CATEGORY.Database
      );
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = `line: ${this.lineNumber}`;
    }
  };
  var QueryMoreEndLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = `line: ${this.lineNumber}`;
    }
  };
  var QueryMoreIterationsLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = `line: ${this.lineNumber}, iterations:${parts[3]}`;
    }
  };
  var SavepointRollbackLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = `${parts[3]}, line: ${this.lineNumber}`;
    }
  };
  var SavePointSetLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = `${parts[3]}, line: ${this.lineNumber}`;
    }
  };
  var TotalEmailRecipientsQueuedLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts[2] || "";
    }
  };
  var StackFrameVariableListLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
    }
  };
  var StaticVariableListLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
    }
  };
  var SystemModeEnterLine = class extends LogEvent {
    // namespace = "system";
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts[2] || "";
    }
  };
  var SystemModeExitLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts[2] || "";
    }
  };
  var ExecutionStartedLine = class extends DurationLogEvent {
    namespace = "default";
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["EXECUTION_FINISHED"],
        LOG_CATEGORY.Apex,
        "method",
        DEBUG_CATEGORY.ApexCode
      );
    }
  };
  var EnteringManagedPackageLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(parser, parts, [], LOG_CATEGORY.Apex, "pkg", DEBUG_CATEGORY.ApexCode);
      const linePart = parts[2] || "";
      if (/^\[[^\]]+\]$/.test(linePart)) {
        this.lineNumber = this.parseLineNumber(linePart);
      }
      const rawNs = (/^\[[^\]]+\]$/.test(linePart) ? parts[3] : linePart) || "";
      this.text = this.namespace = rawNs.split(".")[0] || "default";
    }
    onAfter(parser, end) {
      if (end) {
        this.exitStamp = end.timestamp;
        this.recalculateDurations();
      }
    }
  };
  var ExitingManagedPackageLine = class extends LogEvent {
    constructor(parser, parts) {
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
  };
  var EventServicePubBeginLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["EVENT_SERVICE_PUB_END"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = parts[2] || "";
    }
  };
  var EventServicePubEndLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts[2] || "";
    }
  };
  var EventServicePubDetailLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts[2] + " " + parts[3] + " " + parts[4];
    }
  };
  var EventServiceSubBeginLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["EVENT_SERVICE_SUB_END"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = `${parts[2]} ${parts[3]}`;
    }
  };
  var EventServiceSubEndLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.text = `${parts[2]} ${parts[3]}`;
    }
  };
  var EventServiceSubDetailLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = `${parts[2]} ${parts[3]} ${parts[4]} ${parts[5]} ${parts[6]}`;
    }
  };
  var FlowStartInterviewsBeginLine = class extends DurationLogEvent {
    text = "FLOW_START_INTERVIEWS : ";
    namespace = "default";
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["FLOW_START_INTERVIEWS_END"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
    }
    onEnd(end, stack) {
      const flowType = this.getFlowType(stack);
      this.suffix = ` (${flowType})`;
      this.text += this.getFlowName();
    }
    getFlowType(stack) {
      let flowType;
      const len = stack.length - 2;
      for (let i = len; i >= 0; i--) {
        const elem = stack[i];
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
  };
  var FlowStartInterviewsErrorLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} - ${parts[4]}`;
    }
  };
  var FlowStartInterviewsLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.category = LOG_CATEGORY.Automation;
      this.cpuType = "custom";
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      const linePart = parts[2] || "";
      const hasLineMarker = /^\[[^\]]+\]$/.test(linePart);
      if (hasLineMarker) {
        this.lineNumber = this.parseLineNumber(linePart);
      }
      this.text = parts.slice(hasLineMarker ? 3 : 2).join("|").trim();
    }
  };
  var FlowStartInterviewBeginLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["FLOW_START_INTERVIEW_END"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = parts[3] || "";
    }
  };
  var FlowStartInterviewLimitUsageLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[2] || "";
    }
  };
  var FlowStartScheduledRecordsLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]}`;
    }
  };
  var FlowCreateInterviewErrorLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
    }
  };
  var AutomationSpanBeginLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      const beginType = String(parts[1] || "");
      const exitType = beginType.replace(/_BEGIN$/, "_END");
      super(
        parser,
        parts,
        [exitType],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      const linePart = String(parts[2] || "");
      const hasSourceLine = /^\[[^\]]+\]$/.test(linePart);
      if (hasSourceLine) this.lineNumber = this.parseLineNumber(linePart);
      this.text = parts.slice(hasSourceLine ? 3 : 2).join("|").trim();
    }
  };
  var AutomationSpanEndLine = class extends LogEvent {
    isExit = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      const linePart = String(parts[2] || "");
      const hasSourceLine = /^\[[^\]]+\]$/.test(linePart);
      if (hasSourceLine) this.lineNumber = this.parseLineNumber(linePart);
      this.text = parts.slice(hasSourceLine ? 3 : 2).join("|").trim();
    }
  };
  var FlowElementBeginLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["FLOW_ELEMENT_END"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = parts[3] + " " + parts[4];
    }
  };
  var FlowElementDeferredLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[2] + " " + parts[3];
    }
  };
  var FlowElementAssignmentLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[3] + " " + parts[4];
    }
  };
  var FlowWaitEventResumingDetailLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
    }
  };
  var FlowWaitEventWaitingDetailLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
    }
  };
  var FlowWaitResumingDetailLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
  };
  var FlowWaitWaitingDetailLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
    }
  };
  var FlowInterviewFinishedLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[3] || "";
    }
  };
  var FlowInterviewResumedLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]}`;
    }
  };
  var FlowInterviewPausedLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
  };
  var FlowElementErrorLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = (parts[1] || "") + parts[2] + " " + parts[3] + " " + parts[4];
    }
  };
  var FlowElementFaultLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
  };
  var FlowElementLimitUsageLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]}`;
    }
  };
  var FlowInterviewFinishedLimitUsageLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]}`;
    }
  };
  var FlowSubflowDetailLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
    }
  };
  var FlowActionCallDetailLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[3] + " : " + parts[4] + " : " + parts[5] + " : " + parts[6];
    }
  };
  var FlowAssignmentDetailLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[3] + " : " + parts[4] + " : " + parts[5];
    }
  };
  var FlowLoopDetailLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[3] + " : " + parts[4];
    }
  };
  var FlowRuleDetailLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[3] + " : " + parts[4];
    }
  };
  var FlowBulkElementBeginLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["FLOW_BULK_ELEMENT_END"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = `${parts[2]} - ${parts[3]}`;
    }
  };
  var FlowBulkElementDetailLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[2] + " : " + parts[3] + " : " + parts[4];
    }
  };
  var FlowBulkElementNotSupportedLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
  };
  var FlowBulkElementLimitUsageLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[2] || "";
    }
  };
  var PNInvalidAppLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = `${parts[2]}.${parts[3]}`;
    }
  };
  var PNInvalidCertificateLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = `${parts[2]}.${parts[3]}`;
    }
  };
  var PNInvalidNotificationLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = `${parts[2]}.${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]} : ${parts[8]}`;
    }
  };
  var PNNoDevicesLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = `${parts[2]}.${parts[3]}`;
    }
  };
  var PNSentLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = `${parts[2]}.${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]}`;
    }
  };
  var SLAEndLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
    }
  };
  var SLAEvalMilestoneLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = `${parts[2]}`;
    }
  };
  var SLAProcessCaseLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = `${parts[2]}`;
    }
  };
  var TestingLimitsLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.ApexProfiling;
    }
  };
  var ValidationRuleLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Validation;
      this.text = parts[3] || "";
    }
  };
  var ValidationErrorLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Validation;
      this.text = parts[2] || "";
    }
  };
  var ValidationFormulaLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Validation;
      const extra = parts.length > 3 ? " " + parts[3] : "";
      this.text = parts[2] + extra;
    }
  };
  var ValidationPassLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Validation;
      this.text = parts[3] || "";
    }
  };
  var WFFlowActionErrorLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[1] + " " + parts[4];
    }
  };
  var WFFlowActionErrorDetailLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[1] + " " + parts[2];
    }
  };
  var WFFieldUpdateLine = class extends DurationLogEvent {
    isExit = true;
    nextLineIsExit = true;
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["WF_FIELD_UPDATE"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = " " + parts[2] + " " + parts[3] + " " + parts[4] + " " + parts[5] + " " + parts[6];
    }
  };
  var WFRuleEvalBeginLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["WF_RULE_EVAL_END"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = parts[2] || "";
    }
  };
  var WFRuleEvalValueLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[2] || "";
    }
  };
  var WFRuleEvalLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.category = LOG_CATEGORY.Automation;
      this.cpuType = "custom";
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      const linePart = parts[2] || "";
      const hasLineMarker = /^\[[^\]]+\]$/.test(linePart);
      if (hasLineMarker) {
        this.lineNumber = this.parseLineNumber(linePart);
      }
      this.text = parts.slice(hasLineMarker ? 3 : 2).join("|").trim();
    }
  };
  var WFRuleFilterLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[2] || "";
    }
  };
  var WFCriteriaBeginLine = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["WF_CRITERIA_END", "WF_RULE_NOT_EVALUATED"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = "WF_CRITERIA : " + parts[5] + " : " + parts[3];
    }
  };
  var WFFormulaLine = class extends DurationLogEvent {
    acceptsText = true;
    isExit = true;
    nextLineIsExit = true;
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["WF_FORMULA"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = parts[2] + " : " + parts[3];
    }
  };
  var WFActionLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[2] || "";
    }
  };
  var WFActionsEndLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[2] || "";
    }
  };
  var WFActionTaskLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]}`;
    }
  };
  var WFApprovalLine = class extends DurationLogEvent {
    isExit = true;
    nextLineIsExit = true;
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["WF_APPROVAL"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
  };
  var WFApprovalRemoveLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]}`;
    }
  };
  var WFApprovalSubmitLine = class extends DurationLogEvent {
    isExit = true;
    nextLineIsExit = true;
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["WF_APPROVAL_SUBMIT"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = `${parts[2]}`;
    }
  };
  var WFApprovalSubmitterLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
  };
  var WFAssignLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]}`;
    }
  };
  var WFEmailAlertLine = class extends DurationLogEvent {
    isExit = true;
    nextLineIsExit = true;
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["WF_EMAIL_ALERT"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
  };
  var WFEmailSentLine = class extends DurationLogEvent {
    isExit = true;
    nextLineIsExit = true;
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["WF_EMAIL_SENT"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
  };
  var WFEnqueueActionsLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[2] || "";
    }
  };
  var WFEscalationActionLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]}`;
    }
  };
  var WFEvalEntryCriteriaLine = class extends DurationLogEvent {
    isExit = true;
    nextLineIsExit = true;
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["WF_EVAL_ENTRY_CRITERIA"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
  };
  var WFFlowActionDetailLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      const optional = parts[4] ? ` : ${parts[4]} :${parts[5]}` : "";
      this.text = `${parts[2]} : ${parts[3]}` + optional;
    }
  };
  var WFNextApproverLine = class extends DurationLogEvent {
    isExit = true;
    nextLineIsExit = true;
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["WF_NEXT_APPROVER"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
    }
  };
  var WFOutboundMsgLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
    }
  };
  var WFProcessFoundLine = class extends DurationLogEvent {
    isExit = true;
    nextLineIsExit = true;
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["WF_PROCESS_FOUND"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = `${parts[2]} : ${parts[3]}`;
    }
  };
  var WFProcessNode = class extends DurationLogEvent {
    isExit = true;
    nextLineIsExit = true;
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["WF_PROCESS_NODE"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = parts[2] || "";
    }
  };
  var WFReassignRecordLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]}`;
    }
  };
  var WFResponseNotifyLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
    }
  };
  var WFRuleEntryOrderLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[2] || "";
    }
  };
  var WFRuleInvocationLine = class extends DurationLogEvent {
    isExit = true;
    nextLineIsExit = true;
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["WF_RULE_INVOCATION"],
        LOG_CATEGORY.Automation,
        "custom",
        DEBUG_CATEGORY.Workflow
      );
      this.text = parts[2] || "";
    }
  };
  var WFSoftRejectLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[2] || "";
    }
  };
  var WFTimeTriggerLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
    }
  };
  var WFSpoolActionBeginLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.Workflow;
      this.text = parts[2] || "";
    }
  };
  var ExceptionThrownLine = class extends LogEvent {
    discontinuity = true;
    acceptsText = true;
    totalThrownCount = 1;
    constructor(parser, parts) {
      super(parser, parts);
      this.lineNumber = this.parseLineNumber(parts[2]);
      this.text = parts.slice(3).join("|");
    }
    onAfter(parser, _next) {
      if (this.text.indexOf("System.LimitException") >= 0) {
        const isMultiLine = this.text.indexOf("\n");
        const len = isMultiLine < 0 ? 99 : isMultiLine;
        const truncateText = this.text.length > len;
        const summary = this.text.slice(0, len + 1) + (truncateText ? "\u2026" : "");
        const message = truncateText ? this.text : "";
        parser.addLogIssue(this.timestamp, summary, message, "error");
      }
    }
  };
  var FatalErrorLine = class extends LogEvent {
    acceptsText = true;
    discontinuity = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts.slice(2).join("|");
    }
    onAfter(parser, _next) {
      const newLineIndex = this.text.indexOf("\n");
      const summary = newLineIndex > -1 ? this.text.slice(0, newLineIndex + 1) : this.text;
      const detailText = summary.length !== this.text.length ? this.text : "";
      parser.addLogIssue(
        this.timestamp,
        "FATAL ERROR! cause=" + summary,
        detailText,
        "error"
      );
    }
  };
  var XDSDetailLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts[2] || "";
    }
  };
  var XDSResponseLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = `${parts[2] ?? ""} : ${parts[3] ?? ""} : ${parts[4] ?? ""} : ${parts[5] ?? ""} : ${parts[6] ?? ""}`;
    }
  };
  var XDSResponseDetailLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts[2] || "";
    }
  };
  var XDSResponseErrorLine = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts[2] || "";
    }
  };
  var OLSViolationLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.System;
      this.text = String(parts.slice(3).join("|") || "").trim();
    }
  };
  var FLSViolationLine = class extends LogEvent {
    acceptsText = true;
    constructor(parser, parts) {
      super(parser, parts);
      this.debugCategory = DEBUG_CATEGORY.System;
      this.text = String(parts.slice(3).join("|") || "").trim();
    }
  };
  var DuplicateDetectionBegin = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["DUPLICATE_DETECTION_END"],
        LOG_CATEGORY.System,
        "custom",
        DEBUG_CATEGORY.System
      );
    }
  };
  var DuplicateDetectionRule = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = `${parts[3]} - ${parts[4]}`;
    }
  };
  var BulkDMLEntry = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts[2] || "";
    }
  };
  var DuplicateDetectionDetails = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts.slice(2).join(" | ");
    }
  };
  var DuplicateDetectionSummary = class extends LogEvent {
    constructor(parser, parts) {
      super(parser, parts);
      this.text = parts.slice(2).join(" | ");
    }
  };
  var SessionCachePutBegin = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["SESSION_CACHE_PUT_END"],
        LOG_CATEGORY.Apex,
        "method",
        DEBUG_CATEGORY.ApexCode
      );
    }
  };
  var SessionCacheGetBegin = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["SESSION_CACHE_GET_END"],
        LOG_CATEGORY.Apex,
        "method",
        DEBUG_CATEGORY.ApexCode
      );
    }
  };
  var SessionCacheRemoveBegin = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["SESSION_CACHE_REMOVE_END"],
        LOG_CATEGORY.Apex,
        "method",
        DEBUG_CATEGORY.ApexCode
      );
    }
  };
  var OrgCachePutBegin = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["ORG_CACHE_PUT_END"],
        LOG_CATEGORY.Apex,
        "method",
        DEBUG_CATEGORY.ApexCode
      );
    }
  };
  var OrgCacheGetBegin = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["ORG_CACHE_GET_END"],
        LOG_CATEGORY.Apex,
        "method",
        DEBUG_CATEGORY.ApexCode
      );
    }
  };
  var OrgCacheRemoveBegin = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["ORG_CACHE_REMOVE_END"],
        LOG_CATEGORY.Apex,
        "method",
        DEBUG_CATEGORY.ApexCode
      );
    }
  };
  var VFSerializeContinuationStateBegin = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["VF_SERIALIZE_CONTINUATION_STATE_END"],
        LOG_CATEGORY.Apex,
        "method",
        DEBUG_CATEGORY.ApexCode
      );
    }
  };
  var VFDeserializeContinuationStateBegin = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["VF_SERIALIZE_CONTINUATION_STATE_END"],
        LOG_CATEGORY.Apex,
        "method",
        DEBUG_CATEGORY.ApexCode
      );
    }
  };
  var MatchEngineBegin = class extends DurationLogEvent {
    constructor(parser, parts) {
      super(
        parser,
        parts,
        ["MATCH_ENGINE_END"],
        LOG_CATEGORY.System,
        "method",
        DEBUG_CATEGORY.System
      );
    }
  };
  function getLogEventClass(eventName) {
    if (!eventName) {
      return null;
    }
    switch (eventName) {
      case "METHOD_ENTRY":
        return MethodEntryLine;
      case "METHOD_EXIT":
        return MethodExitLine;
      case "CONSTRUCTOR_ENTRY":
        return ConstructorEntryLine;
      case "CONSTRUCTOR_EXIT":
        return ConstructorExitLine;
    }
    const logType = lineTypeMap.get(eventName);
    if (logType) {
      return logType;
    } else if (basicLogEvents.has(eventName)) {
      return BasicLogLine;
    } else if (basicExitLogEvents.has(eventName)) {
      return BasicExitLine;
    }
    return null;
  }
  var lineTypeMap = /* @__PURE__ */ new Map([
    ["BULK_DML_RETRY", BulkDMLEntry],
    ["BULK_HEAP_ALLOCATE", BulkHeapAllocateLine],
    ["CALLOUT_REQUEST", CalloutRequestLine],
    ["CALLOUT_RESPONSE", CalloutResponseLine],
    ["NAMED_CREDENTIAL_REQUEST", NamedCredentialRequestLine],
    ["NAMED_CREDENTIAL_RESPONSE", NamedCredentialResponseLine],
    ["NAMED_CREDENTIAL_RESPONSE_DETAIL", NamedCredentialResponseDetailLine],
    ["CONSTRUCTOR_ENTRY", ConstructorEntryLine],
    ["CONSTRUCTOR_EXIT", ConstructorExitLine],
    ["EMAIL_QUEUE", EmailQueueLine],
    ["METHOD_ENTRY", MethodEntryLine],
    ["METHOD_EXIT", MethodExitLine],
    ["SYSTEM_CONSTRUCTOR_ENTRY", SystemConstructorEntryLine],
    ["SYSTEM_CONSTRUCTOR_EXIT", SystemConstructorExitLine],
    ["SYSTEM_METHOD_ENTRY", SystemMethodEntryLine],
    ["SYSTEM_METHOD_EXIT", SystemMethodExitLine],
    ["CODE_UNIT_STARTED", CodeUnitStartedLine],
    ["CODE_UNIT_FINISHED", CodeUnitFinishedLine],
    ["VF_APEX_CALL_START", VFApexCallStartLine],
    ["VF_APEX_CALL_END", VFApexCallEndLine],
    ["VF_DESERIALIZE_VIEWSTATE_BEGIN", VFDeserializeViewstateBeginLine],
    ["VF_EVALUATE_FORMULA_BEGIN", VFFormulaStartLine],
    ["VF_EVALUATE_FORMULA_END", VFFormulaEndLine],
    ["VF_SERIALIZE_CONTINUATION_STATE_BEGIN", VFSerializeContinuationStateBegin],
    [
      "VF_DESERIALIZE_CONTINUATION_STATE_BEGIN",
      VFDeserializeContinuationStateBegin
    ],
    ["VF_SERIALIZE_VIEWSTATE_BEGIN", VFSeralizeViewStateStartLine],
    ["VF_PAGE_MESSAGE", VFPageMessageLine],
    ["DML_BEGIN", DMLBeginLine],
    ["DML_END", DMLEndLine],
    ["DML_ERROR", DMLErrorLine],
    ["IDEAS_QUERY_EXECUTE", IdeasQueryExecuteLine],
    ["CURSOR_CREATE_BEGIN", CursorCreateBeginLine],
    ["CURSOR_CREATE_END", CursorCreateEndLine],
    ["CURSOR_FETCH", CursorFetchLine],
    ["CURSOR_FETCH_PAGE", CursorFetchPageLine],
    ["SOQL_EXECUTE_BEGIN", SOQLExecuteBeginLine],
    ["SOQL_EXECUTE_END", SOQLExecuteEndLine],
    ["SOQL_EXECUTE_EXPLAIN", SOQLExecuteExplainLine],
    ["SOSL_EXECUTE_BEGIN", SOSLExecuteBeginLine],
    ["SOSL_EXECUTE_END", SOSLExecuteEndLine],
    ["QUEUEABLE_BEGIN", QueueableBeginLine],
    ["QUEUEABLE_END", QueueableEndLine],
    ["FUTURE_METHOD_BEGIN", FutureMethodBeginLine],
    ["FUTURE_METHOD_END", AsyncApexEndLine],
    ["BATCH_APEX_EXECUTE_BEGIN", BatchApexExecuteBeginLine],
    ["BATCH_APEX_EXECUTE_END", AsyncApexEndLine],
    ["HEAP_ALLOCATE", HeapAllocateLine],
    ["HEAP_DEALLOCATE", HeapDeallocateLine],
    ["STATEMENT_EXECUTE", StatementExecuteLine],
    ["VARIABLE_SCOPE_BEGIN", VariableScopeBeginLine],
    ["VARIABLE_ASSIGNMENT", VariableAssignmentLine],
    ["USER_INFO", UserInfoLine],
    ["USER_DEBUG", UserDebugLine],
    ["USER_DEBUG_FINER", UserDebugLine],
    ["USER_DEBUG_FINEST", UserDebugLine],
    ["USER_DEBUG_FINE", UserDebugLine],
    ["USER_DEBUG_DEBUG", UserDebugLine],
    ["USER_DEBUG_INFO", UserDebugLine],
    ["USER_DEBUG_WARN", UserDebugLine],
    ["USER_DEBUG_ERROR", UserDebugLine],
    ["DATAWEAVE_USER_DEBUG", DataWeaveUserDebugLine],
    ["FORMULA_EVALUATE_BEGIN", FormulaEvaluateBeginLine],
    ["RLM_CONFIGURATOR_BEGIN", RlmConfiguratorBeginLine],
    ["RLM_PRICING_BEGIN", RlmPricingBeginLine],
    ["CUMULATIVE_LIMIT_USAGE", CumulativeLimitUsageLine],
    ["CUMULATIVE_PROFILING", CumulativeProfilingLine],
    ["CUMULATIVE_PROFILING_BEGIN", CumulativeProfilingBeginLine],
    ["LIMIT_USAGE", LimitUsageLine],
    ["LIMIT_USAGE_FOR_NS", LimitUsageForNSLine],
    ["NBA_NODE_BEGIN", NBANodeBegin],
    ["NBA_NODE_DETAIL", NBANodeDetail],
    ["NBA_NODE_END", NBANodeEnd],
    ["NBA_NODE_ERROR", NBANodeError],
    ["NBA_OFFER_INVALID", NBAOfferInvalid],
    ["NBA_STRATEGY_BEGIN", NBAStrategyBegin],
    ["NBA_STRATEGY_END", NBAStrategyEnd],
    ["NBA_STRATEGY_ERROR", NBAStrategyError],
    ["POP_TRACE_FLAGS", PopTraceFlagsLine],
    ["PUSH_TRACE_FLAGS", PushTraceFlagsLine],
    ["QUERY_MORE_BEGIN", QueryMoreBeginLine],
    ["QUERY_MORE_END", QueryMoreEndLine],
    ["QUERY_MORE_ITERATIONS", QueryMoreIterationsLine],
    ["TOTAL_EMAIL_RECIPIENTS_QUEUED", TotalEmailRecipientsQueuedLine],
    ["SAVEPOINT_ROLLBACK", SavepointRollbackLine],
    ["SAVEPOINT_SET", SavePointSetLine],
    ["STACK_FRAME_VARIABLE_LIST", StackFrameVariableListLine],
    ["STATIC_VARIABLE_LIST", StaticVariableListLine],
    ["SYSTEM_MODE_ENTER", SystemModeEnterLine],
    ["SYSTEM_MODE_EXIT", SystemModeExitLine],
    ["EXECUTION_STARTED", ExecutionStartedLine],
    ["ENTERING_MANAGED_PKG", EnteringManagedPackageLine],
    ["EXITING_MANAGED_PKG", ExitingManagedPackageLine],
    ["EVENT_SERVICE_PUB_BEGIN", EventServicePubBeginLine],
    ["EVENT_SERVICE_PUB_END", EventServicePubEndLine],
    ["EVENT_SERVICE_PUB_DETAIL", EventServicePubDetailLine],
    ["EVENT_SERVICE_SUB_BEGIN", EventServiceSubBeginLine],
    ["EVENT_SERVICE_SUB_DETAIL", EventServiceSubDetailLine],
    ["EVENT_SERVICE_SUB_END", EventServiceSubEndLine],
    ["FLOW_START_INTERVIEWS_BEGIN", FlowStartInterviewsBeginLine],
    ["FLOW_START_INTERVIEWS_ERROR", FlowStartInterviewsErrorLine],
    ["FLOW_START_INTERVIEWS", FlowStartInterviewsLine],
    ["FLOW_START_INTERVIEW_BEGIN", FlowStartInterviewBeginLine],
    ["FLOW_START_INTERVIEW_LIMIT_USAGE", FlowStartInterviewLimitUsageLine],
    ["FLOW_START_SCHEDULED_RECORDS", FlowStartScheduledRecordsLine],
    ["FLOW_CREATE_INTERVIEW_ERROR", FlowCreateInterviewErrorLine],
    ["FLOW_CREATE_INTERVIEW_BEGIN", AutomationSpanBeginLine],
    ["FLOW_CREATE_INTERVIEW_END", AutomationSpanEndLine],
    ["FLOW_ELEMENT_BEGIN", FlowElementBeginLine],
    ["FLOW_ELEMENT_DEFERRED", FlowElementDeferredLine],
    ["FLOW_ELEMENT_ERROR", FlowElementErrorLine],
    ["FLOW_ELEMENT_FAULT", FlowElementFaultLine],
    ["FLOW_ELEMENT_LIMIT_USAGE", FlowElementLimitUsageLine],
    ["FLOW_INTERVIEW_FINISHED_LIMIT_USAGE", FlowInterviewFinishedLimitUsageLine],
    ["FLOW_SUBFLOW_DETAIL", FlowSubflowDetailLine],
    ["FLOW_VALUE_ASSIGNMENT", FlowElementAssignmentLine],
    ["FLOW_WAIT_EVENT_RESUMING_DETAIL", FlowWaitEventResumingDetailLine],
    ["FLOW_WAIT_EVENT_WAITING_DETAIL", FlowWaitEventWaitingDetailLine],
    ["FLOW_WAIT_RESUMING_DETAIL", FlowWaitResumingDetailLine],
    ["FLOW_WAIT_WAITING_DETAIL", FlowWaitWaitingDetailLine],
    ["FLOW_INTERVIEW_FINISHED", FlowInterviewFinishedLine],
    ["FLOW_INTERVIEW_PAUSED", FlowInterviewPausedLine],
    ["FLOW_INTERVIEW_RESUMED", FlowInterviewResumedLine],
    ["FLOW_ACTIONCALL_DETAIL", FlowActionCallDetailLine],
    ["FLOW_ASSIGNMENT_DETAIL", FlowAssignmentDetailLine],
    ["FLOW_LOOP_DETAIL", FlowLoopDetailLine],
    ["FLOW_RULE_DETAIL", FlowRuleDetailLine],
    ["FLOW_BULK_ELEMENT_BEGIN", FlowBulkElementBeginLine],
    ["FLOW_BULK_ELEMENT_DETAIL", FlowBulkElementDetailLine],
    ["FLOW_BULK_ELEMENT_LIMIT_USAGE", FlowBulkElementLimitUsageLine],
    ["FLOW_BULK_ELEMENT_NOT_SUPPORTED", FlowBulkElementNotSupportedLine],
    ["MATCH_ENGINE_BEGIN", MatchEngineBegin],
    ["ORG_CACHE_PUT_BEGIN", OrgCachePutBegin],
    ["ORG_CACHE_GET_BEGIN", OrgCacheGetBegin],
    ["ORG_CACHE_REMOVE_BEGIN", OrgCacheRemoveBegin],
    ["PUSH_NOTIFICATION_INVALID_APP", PNInvalidAppLine],
    ["PUSH_NOTIFICATION_INVALID_CERTIFICATE", PNInvalidCertificateLine],
    ["PUSH_NOTIFICATION_INVALID_NOTIFICATION", PNInvalidNotificationLine],
    ["PUSH_NOTIFICATION_NO_DEVICES", PNNoDevicesLine],
    ["PUSH_NOTIFICATION_SENT", PNSentLine],
    ["SESSION_CACHE_PUT_BEGIN", SessionCachePutBegin],
    ["SESSION_CACHE_GET_BEGIN", SessionCacheGetBegin],
    ["SESSION_CACHE_REMOVE_BEGIN", SessionCacheRemoveBegin],
    ["SLA_END", SLAEndLine],
    ["SLA_EVAL_MILESTONE", SLAEvalMilestoneLine],
    ["SLA_PROCESS_CASE", SLAProcessCaseLine],
    ["TESTING_LIMITS", TestingLimitsLine],
    ["VALIDATION_ERROR", ValidationErrorLine],
    ["VALIDATION_FORMULA", ValidationFormulaLine],
    ["VALIDATION_PASS", ValidationPassLine],
    ["VALIDATION_RULE", ValidationRuleLine],
    ["WF_FLOW_ACTION_ERROR", WFFlowActionErrorLine],
    ["WF_FLOW_ACTION_ERROR_DETAIL", WFFlowActionErrorDetailLine],
    ["WF_FLOW_ACTION_BEGIN", AutomationSpanBeginLine],
    ["WF_FLOW_ACTION_END", AutomationSpanEndLine],
    ["WF_FIELD_UPDATE", WFFieldUpdateLine],
    ["WF_RULE_EVAL_BEGIN", WFRuleEvalBeginLine],
    ["WF_RULE_EVAL", WFRuleEvalLine],
    ["WF_RULE_EVAL_VALUE", WFRuleEvalValueLine],
    ["WF_RULE_FILTER", WFRuleFilterLine],
    ["WF_CRITERIA_BEGIN", WFCriteriaBeginLine],
    ["WF_FORMULA", WFFormulaLine],
    ["WF_ACTION", WFActionLine],
    ["WF_ACTIONS_END", WFActionsEndLine],
    ["WF_ACTION_TASK", WFActionTaskLine],
    ["WF_APPROVAL", WFApprovalLine],
    ["WF_APPROVAL_REMOVE", WFApprovalRemoveLine],
    ["WF_APPROVAL_SUBMIT", WFApprovalSubmitLine],
    ["WF_APPROVAL_SUBMITTER", WFApprovalSubmitterLine],
    ["WF_ASSIGN", WFAssignLine],
    ["WF_EMAIL_ALERT", WFEmailAlertLine],
    ["WF_EMAIL_SENT", WFEmailSentLine],
    ["WF_ENQUEUE_ACTIONS", WFEnqueueActionsLine],
    ["WF_ESCALATION_ACTION", WFEscalationActionLine],
    ["WF_EVAL_ENTRY_CRITERIA", WFEvalEntryCriteriaLine],
    ["WF_FLOW_ACTION_DETAIL", WFFlowActionDetailLine],
    ["WF_NEXT_APPROVER", WFNextApproverLine],
    ["WF_OUTBOUND_MSG", WFOutboundMsgLine],
    ["WF_PROCESS_FOUND", WFProcessFoundLine],
    ["WF_PROCESS_NODE", WFProcessNode],
    ["WF_REASSIGN_RECORD", WFReassignRecordLine],
    ["WF_RESPONSE_NOTIFY", WFResponseNotifyLine],
    ["WF_RULE_ENTRY_ORDER", WFRuleEntryOrderLine],
    ["WF_RULE_INVOCATION", WFRuleInvocationLine],
    ["WF_SOFT_REJECT", WFSoftRejectLine],
    ["WF_SPOOL_ACTION_BEGIN", WFSpoolActionBeginLine],
    ["WF_TIME_TRIGGER", WFTimeTriggerLine],
    ["EXCEPTION_THROWN", ExceptionThrownLine],
    ["FATAL_ERROR", FatalErrorLine],
    ["XDS_DETAIL", XDSDetailLine],
    ["XDS_RESPONSE", XDSResponseLine],
    ["XDS_RESPONSE_DETAIL", XDSResponseDetailLine],
    ["XDS_RESPONSE_ERROR", XDSResponseErrorLine],
    ["OLS_VIOLATION", OLSViolationLine],
    ["FLS_VIOLATION", FLSViolationLine],
    ["DUPLICATE_DETECTION_BEGIN", DuplicateDetectionBegin],
    ["DUPLICATE_DETECTION_RULE_INVOCATION", DuplicateDetectionRule],
    ["DUPLICATE_DETECTION_MATCH_INVOCATION_DETAILS", DuplicateDetectionDetails],
    ["DUPLICATE_DETECTION_MATCH_INVOCATION_SUMMARY", DuplicateDetectionSummary]
  ]);
  var basicLogEvents = /* @__PURE__ */ new Set([
    "APP_ANALYTICS_ERROR",
    "APP_ANALYTICS_FINE",
    "APP_ANALYTICS_WARN",
    "BATCH_APEX_START_BEGIN",
    "BULK_COUNTABLE_STATEMENT_EXECUTE",
    "TEMPLATE_PROCESSING_ERROR",
    "EXTERNAL_SERVICE_REQUEST",
    "VARIABLE_SCOPE_END",
    "PUSH_NOTIFICATION_NOT_ENABLED",
    "SLA_NULL_START_DATE",
    "VALIDATION_FAIL",
    "WF_ESCALATION_RULE",
    "WF_HARD_REJECT",
    "WF_NO_PROCESS_FOUND",
    "WF_TIME_TRIGGERS_BEGIN",
    "WF_KNOWLEDGE_ACTION",
    "WF_SEND_ACTION",
    "WAVE_APP_LIFECYCLE",
    "WF_QUICK_CREATE",
    "WF_APEX_ACTION",
    "INVOCABLE_ACTION_DETAIL",
    "INVOCABLE_ACTION_ERROR",
    "FLOW_COLLECTION_PROCESSOR_DETAIL",
    "FLOW_SCHEDULED_PATH_QUEUED",
    "ROUTE_WORK_ACTION",
    "ADD_SKILL_REQUIREMENT_ACTION",
    "ADD_SCREEN_POP_ACTION",
    "CALLOUT_REQUEST_PREPARE",
    "CALLOUT_REQUEST_FINALIZE",
    "FUNCTION_INVOCATION_REQUEST",
    "APP_CONTAINER_INITIATED",
    "FUNCTION_INVOCATION_RESPONSE",
    "XDS_REQUEST_DETAIL",
    "EXTERNAL_SERVICE_RESPONSE",
    "DATA_ACCESS_EVALUATION",
    "DUPLICATE_RULE_FILTER_INVOCATION",
    "END_CALL",
    "EXTERNAL_SERVICE_CALLBACK",
    "FLOW_SCREEN_DETAIL",
    "FORMULA_BUILD",
    "FOR_UPDATE_LOCKS_RELEASE",
    "ORG_CACHE_CONTAINS",
    "ORG_CACHE_GET",
    "ORG_CACHE_GET_CAPACITY",
    "ORG_CACHE_GET_PARTITION",
    "ORG_CACHE_PUT",
    "ORG_CACHE_REMOVE",
    "PLAY_PROMPT",
    "POLICY_RULE_DEFINITION_CONDITION_EVALUATION_RESPONSE",
    "POLICY_RULE_EVALUATION_REQUEST",
    "POLICY_RULE_EVALUATION_RESPONSE",
    "POLICY_RULE_EVALUATION_SKIPPED",
    "POLICY_RULE_EVALUATION_START",
    "PUSH_NOTIFICATION_INVALID_CONFIGURATION",
    "PUSH_NOTIFICATION_INVALID_PAYLOAD",
    "QUERY_SQL_LOG",
    "RLM_CONFIGURATOR_DEPLOY",
    "RLM_CONFIGURATOR_STATS",
    "SAVEPOINT_RELEASE",
    "SAVEPOINT_RESET",
    "SCHEDULED_FLOW_DETAIL",
    "SESSION_CACHE_CONTAINS",
    "SESSION_CACHE_GET",
    "SESSION_CACHE_GET_CAPACITY",
    "SESSION_CACHE_GET_PARTITION",
    "SESSION_CACHE_PUT",
    "SESSION_CACHE_REMOVE",
    "SLA_CASE_MILESTONE",
    "USER_MODE_PERMSET_APPLIED",
    "WF_CHATTER_POST",
    "VF_APEX_CALL",
    "HEAP_DUMP",
    "SCRIPT_EXECUTION",
    "SESSION_CACHE_MEMORY_USAGE",
    "ORG_CACHE_MEMORY_USAGE",
    "AE_PERSIST_VALIDATION",
    "REFERENCED_OBJECT_LIST",
    "DUPLICATE_RULE_FILTER",
    "DUPLICATE_RULE_FILTER_RESULT",
    "DUPLICATE_RULE_FILTER_VALUE",
    "TEMPLATED_ASSET",
    "TRANSFORMATION_SUMMARY",
    "RULES_EXECUTION_SUMMARY",
    "ASSET_DIFF_SUMMARY",
    "ASSET_DIFF_DETAIL",
    "RULES_EXECUTION_DETAIL",
    "JSON_DIFF_SUMMARY",
    "JSON_DIFF_DETAIL",
    "MATCH_ENGINE_INVOCATION"
  ]);
  var basicExitLogEvents = /* @__PURE__ */ new Set([
    "FORMULA_EVALUATE_END",
    "FLOW_START_INTERVIEW_END",
    "VF_DESERIALIZE_VIEWSTATE_END",
    "VF_SERIALIZE_VIEWSTATE_END",
    "CUMULATIVE_LIMIT_USAGE_END",
    "CUMULATIVE_PROFILING_END",
    "EXECUTION_FINISHED",
    "FLOW_START_INTERVIEWS_END",
    "FLOW_ELEMENT_END",
    "FLOW_BULK_ELEMENT_END",
    "WF_RULE_EVAL_END",
    "WF_RULE_NOT_EVALUATED",
    "WF_CRITERIA_END",
    "DUPLICATE_DETECTION_END",
    "VF_SERIALIZE_CONTINUATION_STATE_END",
    "VF_DESERIALIZE_CONTINUATION_STATE_END",
    "MATCH_ENGINE_END",
    "RLM_CONFIGURATOR_END",
    "RLM_PRICING_END",
    "ORG_CACHE_PUT_END",
    "ORG_CACHE_GET_END",
    "ORG_CACHE_REMOVE_END",
    "SESSION_CACHE_PUT_END",
    "SESSION_CACHE_GET_END",
    "SESSION_CACHE_REMOVE_END"
  ]);
  var MAX_LOG_BYTES = 25 * 1024 * 1024;
  function utf8ByteLength(value) {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit <= 127) {
        bytes += 1;
      } else if (codeUnit <= 2047) {
        bytes += 2;
      } else if (codeUnit >= 55296 && codeUnit <= 56319) {
        const next = value.charCodeAt(index + 1);
        if (next >= 56320 && next <= 57343) {
          bytes += 4;
          index += 1;
        } else {
          bytes += 3;
        }
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }
  var typePattern = /^[A-Z_]*$/;
  var settingsPattern = /^\d+\.\d+\sAPEX_CODE,\w+;APEX_PROFILING,.+$/m;
  var LINE_SENSITIVE_ENTRY_TYPES = /* @__PURE__ */ new Set([
    "METHOD_ENTRY",
    "CONSTRUCTOR_ENTRY",
    "SYSTEM_METHOD_ENTRY",
    "SYSTEM_CONSTRUCTOR_ENTRY"
  ]);
  function createGovernorLimits() {
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
      byNamespace: /* @__PURE__ */ new Map(),
      snapshots: []
    };
  }
  var ApexLogParser = class _ApexLogParser {
    static MAX_PARSING_ERRORS = 200;
    static MAX_LOG_ISSUES = 200;
    static MAX_ISSUE_SUMMARY_CHARS = 500;
    static MAX_ISSUE_DESCRIPTION_CHARS = 2e3;
    static ISSUE_OVERFLOW_SUMMARY = "Additional log issues omitted";
    logIssues = [];
    logIssuesBySummary = /* @__PURE__ */ new Map();
    logIssueOverflowCount = 0;
    parsingErrors = [];
    parsingDiagnostics = [];
    parsingDiagnosticsByType = /* @__PURE__ */ new Map();
    parsingErrorOverflowCount = 0;
    maxSizeTimestamp = null;
    reasons = /* @__PURE__ */ new Set();
    lastTimestamp = 0;
    /** Timestamp of the preceding physical event, used only for ordering diagnostics. */
    lastObservedTimestamp = null;
    discontinuity = false;
    namespaces = /* @__PURE__ */ new Set();
    governorLimits = createGovernorLimits();
    /**
     * Takes string input of a log and returns the ApexLog class, which represents a log tree
     * @param {string} debugLog
     * @returns {ApexLog}
     */
    parse(debugLog) {
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
        (left, right) => (left.startTime ?? 0) - (right.startTime ?? 0)
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
    resetState() {
      this.logIssues = [];
      this.logIssuesBySummary = /* @__PURE__ */ new Map();
      this.logIssueOverflowCount = 0;
      this.parsingErrors = [];
      this.parsingDiagnostics = [];
      this.parsingDiagnosticsByType = /* @__PURE__ */ new Map();
      this.parsingErrorOverflowCount = 0;
      this.maxSizeTimestamp = null;
      this.reasons = /* @__PURE__ */ new Set();
      this.lastTimestamp = 0;
      this.lastObservedTimestamp = null;
      this.discontinuity = false;
      this.namespaces = /* @__PURE__ */ new Set();
      this.governorLimits = createGovernorLimits();
    }
    addGovernorLimits(apexLog) {
      const totalLimits = apexLog.governorLimits;
      if (totalLimits) {
        for (const limitsForNs of apexLog.governorLimits.byNamespace.values()) {
          for (const [key, value] of Object.entries(limitsForNs)) {
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
    parseLine(line, lastEntry, rawLineNumber) {
      const parts = splitLogFields(line);
      const type = parts[1] ?? "";
      const metaCtor = getLogEventClass(type);
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
            line
          );
          return this.createMalformedFallback(parts, line, lastEntry);
        }
      }
      const hasType = !!(type && typePattern.test(type));
      if (!hasType && lastEntry?.acceptsText) {
        const continuation = `
${line}`;
        const remaining = Math.max(0, 1e5 - lastEntry.text.length);
        if (remaining > 0) {
          lastEntry.text += continuation.slice(0, remaining);
        }
        if (continuation.length > remaining) {
          this.addLogIssue(
            lastEntry.timestamp,
            "Text-Truncation",
            `Text for the event beginning at log line ${lastEntry.rawLineNumber ?? "unknown"} exceeded 100 KB and was truncated to protect parser memory.`,
            "skip"
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
            line
          );
          return entry;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          this.addParsingError(
            `Malformed ${type} event: ${detail}. Raw line: ${line.slice(0, 300)}`,
            "MALFORMED_EVENT",
            rawLineNumber,
            line
          );
          return this.createMalformedFallback(parts, line, lastEntry);
        }
      } else if (lastEntry && line.startsWith("*** Skipped")) {
        this.addLogIssue(
          lastEntry.timestamp,
          "Skipped-Lines",
          `${line}. A section of the log has been skipped and the log has been truncated. Full details of this section of log can not be provided.`,
          "skip"
        );
      } else if (lastEntry && line.indexOf("MAXIMUM DEBUG LOG SIZE REACHED") !== -1) {
        this.addLogIssue(
          lastEntry.timestamp,
          "Max-Size-reached",
          "The maximum log size has been reached. Part of the log has been truncated.",
          "skip"
        );
        this.maxSizeTimestamp = lastEntry.timestamp;
      } else if (!hasType && settingsPattern.test(line)) ;
      else {
        this.addParsingError(
          `Invalid log line: ${line.slice(0, 500)}`,
          "INVALID_LOG_LINE",
          rawLineNumber,
          line
        );
      }
      return null;
    }
    /**
     * Retain a malformed record without allowing its invalid timestamp to throw
     * again from UnknownLogLine. The original line remains the evidence source;
     * only the constructor input receives the last safe monotonic timestamp.
     */
    createMalformedFallback(parts, line, lastEntry) {
      const timestampMatch = String(parts[0] || "").match(/\((\d+)\)$/);
      const parsedTimestamp = timestampMatch ? Number(timestampMatch[1]) : NaN;
      const timestampIsValid = Number.isSafeInteger(parsedTimestamp) && parsedTimestamp >= 0;
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
    *generateLogLines(log) {
      const firstTransactionRecord = log.match(
        /(^|[\r\n])((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{1,9} \(\d+\)\|(?:USER_INFO|EXECUTION_STARTED))(?=\||\r\n|\r|\n|$)/
      );
      let startIndex = firstTransactionRecord ? (firstTransactionRecord.index ?? 0) + firstTransactionRecord[1].length : 0;
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
      let lastEntry = null;
      while (startIndex < log.length) {
        const crIndex = log.indexOf("\r", startIndex);
        const lfIndex = log.indexOf("\n", startIndex);
        const eolIndex = crIndex === -1 ? lfIndex : lfIndex === -1 ? crIndex : Math.min(crIndex, lfIndex);
        const lineEnd = eolIndex === -1 ? log.length : eolIndex;
        const line = log.slice(startIndex, lineEnd);
        if (line) {
          const entry = this.parseLine(line, lastEntry, rawLineNumber);
          if (entry) {
            entry.rawLineNumber = rawLineNumber;
            if (this.lastObservedTimestamp !== null && entry.timestamp < this.lastObservedTimestamp) {
              this.addLogIssue(
                entry.timestamp,
                "Timestamp-Violation",
                `Log line ${rawLineNumber} has timestamp ${entry.timestamp}, earlier than the preceding event timestamp ${this.lastObservedTimestamp}. The log may be corrupted or truncated, so affected durations are not reliable.`,
                "unexpected"
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
        startIndex = log.charCodeAt(eolIndex) === 13 && log.charCodeAt(eolIndex + 1) === 10 ? eolIndex + 2 : eolIndex + 1;
      }
    }
    toLogTree(lineGenerator) {
      const rootMethod = new ApexLog(this), stack = [];
      let line;
      const lineIter = new LineIterator(lineGenerator);
      while (line = lineIter.fetch()) {
        if (line.isParent) {
          this.parseTree(line, lineIter, stack, 0);
        } else if (line.isExit) {
          line.pairingStatus = "orphan_end";
          line.durationIsPartial = true;
          this.addLogIssue(
            line.timestamp,
            "Unexpected-Exit",
            "An exit event was found without a corresponding entry event.",
            "unexpected"
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
    parseTree(currentLine, lineIter, stack, depth = 0) {
      const MAX_DEPTH = 500;
      if (depth >= MAX_DEPTH) {
        this.addLogIssue(
          currentLine.timestamp,
          "Maximum-Nesting-Depth",
          `Execution nesting exceeded the parser safety limit of ${MAX_DEPTH} levels. The affected subtree is incomplete.`,
          "unexpected"
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
          while (nextLine = lineIter.peek()) {
            this.discontinuity ||= nextLine.discontinuity;
            if (!exitOnNextLine && !nextLine.nextLineIsExit && nextLine.isExit && !nextLine.exitTypes.length && this.endMethod(currentLine, nextLine, lineIter, stack)) {
              if (this.isMatchingEnd(currentLine, nextLine)) {
                currentLine.onEnd?.(nextLine, stack);
              }
              break;
            } else if (exitOnNextLine && (nextLine.nextLineIsExit || nextLine.isExit || nextLine.exitTypes.length > 0)) {
              currentLine.exitStamp = nextLine.timestamp;
              currentLine.exitRawLineNumber = nextLine.rawLineNumber;
              currentLine.exitLogLine = nextLine.logLine;
              currentLine.pairingStatus = "complete";
              currentLine.onEnd?.(nextLine, stack);
              break;
            } else if (this.discontinuity && this.maxSizeTimestamp !== null && nextLine.timestamp > this.maxSizeTimestamp) {
              currentLine.isTruncated = true;
              currentLine.pairingStatus = "closed_at_truncation";
              currentLine.durationIsPartial = true;
              break;
            }
            lineIter.fetch();
            this.lastTimestamp = nextLine.timestamp;
            nextLine.namespace ||= currentLine.namespace || "default";
            nextLine.parent = currentLine;
            currentLine.children.push(nextLine);
            if (nextLine.isParent) {
              this.parseTree(nextLine, lineIter, stack, depth + 1);
            }
          }
          if (!nextLine || currentLine.isTruncated) {
            const endedAtTruncation = currentLine.isTruncated;
            currentLine.exitStamp = this.lastTimestamp ?? currentLine.timestamp;
            this.addLogIssue(
              currentLine.exitStamp,
              "Unexpected-End",
              "An entry event was found without a corresponding exit event e.g a `METHOD_ENTRY` event without a `METHOD_EXIT`",
              "unexpected"
            );
            if (currentLine.isTruncated) {
              this.updateLogIssue(
                currentLine.exitStamp,
                "Max-Size-reached",
                "The maximum log size has been reached. Part of the log has been truncated.",
                "skip"
              );
              this.maxSizeTimestamp = currentLine.exitStamp;
            }
            currentLine.isTruncated = true;
            if (currentLine.pairingStatus === "not_applicable") {
              currentLine.pairingStatus = endedAtTruncation ? "closed_at_truncation" : "missing_end";
              currentLine.durationIsPartial = true;
            }
          }
        } finally {
          stack.pop();
          currentLine.recalculateDurations();
        }
      }
    }
    isMatchingEnd(startMethod, endLine) {
      if (!endLine.type || !startMethod.exitTypes?.includes(endLine.type)) {
        return false;
      }
      if (!startMethod.type || !LINE_SENSITIVE_ENTRY_TYPES.has(startMethod.type)) {
        return true;
      }
      return endLine.lineNumber === startMethod.lineNumber || !endLine.lineNumber || !startMethod.lineNumber;
    }
    endMethod(startMethod, endLine, lineIter, stack) {
      startMethod.exitStamp = endLine.timestamp;
      if (this.isMatchingEnd(startMethod, endLine)) {
        startMethod.pairingStatus = "complete";
        startMethod.exitRawLineNumber = endLine.rawLineNumber;
        startMethod.exitLogLine = endLine.logLine;
        this.discontinuity = false;
        lineIter.fetch();
        return true;
      } else if (this.discontinuity) {
        startMethod.pairingStatus = "closed_by_exception";
        startMethod.durationIsPartial = true;
        return true;
      } else {
        if (stack.some((m) => this.isMatchingEnd(m, endLine))) {
          startMethod.pairingStatus = "missing_end";
          startMethod.durationIsPartial = true;
          this.addLogIssue(
            endLine.timestamp,
            "Unexpected-End",
            `A ${startMethod.type} event was closed by the ${endLine.type} exit of an ancestor because its own exit event was missing.`,
            "unexpected"
          );
          return true;
        }
        this.addLogIssue(
          endLine.timestamp,
          "Unexpected-Exit",
          "An exit event was found without a corresponding entry event e.g a `METHOD_EXIT` event without a `METHOD_ENTRY`",
          "unexpected"
        );
        endLine.pairingStatus = "orphan_end";
        endLine.durationIsPartial = true;
        return false;
      }
    }
    /** Preserve an over-depth subtree without further recursive calls. */
    consumeDepthLimitedSubtree(root, lineIter, ancestorStack) {
      const frames = [root];
      const closeMissingFrames = (lowestFrameToKeep, boundaryTimestamp) => {
        while (frames.length - 1 > lowestFrameToKeep) {
          const incomplete = frames.pop();
          incomplete.exitStamp = boundaryTimestamp;
          if (incomplete === root) incomplete.isTruncated = true;
          incomplete.pairingStatus = incomplete === root ? "depth_limit" : "missing_end";
          incomplete.durationIsPartial = true;
          incomplete.recalculateDurations();
          this.addLogIssue(
            boundaryTimestamp,
            "Unexpected-End",
            `A ${incomplete.type} event was closed by an ancestor exit because its own exit event was missing.`,
            "unexpected"
          );
        }
      };
      while (frames.length) {
        const next = lineIter.peek();
        if (!next) break;
        const frame = frames[frames.length - 1];
        if (next.isExit) {
          let matchingFrame = -1;
          for (let index = frames.length - 1; index >= 0; index -= 1) {
            if (this.isMatchingEnd(frames[index], next)) {
              matchingFrame = index;
              break;
            }
          }
          if (matchingFrame >= 0) {
            closeMissingFrames(matchingFrame, next.timestamp);
            const matched = frames[frames.length - 1];
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
          if (ancestorStack.some((ancestor) => this.isMatchingEnd(ancestor, next))) {
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
      for (const frame of frames) {
        frame.exitStamp ??= this.lastTimestamp;
        frame.isTruncated = true;
        frame.pairingStatus = "depth_limit";
        frame.durationIsPartial = true;
        frame.recalculateDurations();
      }
    }
    flattenByDepth(nodes) {
      const result = /* @__PURE__ */ new Map();
      let currentDepth = 0;
      let currentNodes = nodes.filter((n) => n.children.length);
      let len = currentNodes.length;
      while (len) {
        result.set(currentDepth++, currentNodes);
        const children = [];
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
    aggregateTotals(nodes) {
      const len = nodes.length;
      if (!len) {
        return;
      }
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
    mergeManagedPackageEvents(root) {
      const stack = [root];
      while (stack.length) {
        const node = stack.pop();
        const children = node.children;
        const len = children.length;
        let write = 0;
        let lastPkg = null;
        for (let i = 0; i < len; i++) {
          const child = children[i];
          if (!child) {
            continue;
          }
          const isPkg = child.type === "ENTERING_MANAGED_PKG";
          if (lastPkg && child.isParent) {
            if (isPkg && child.namespace === lastPkg.namespace) {
              lastPkg.exitStamp = child.exitStamp ?? child.timestamp;
              continue;
            } else if (!isPkg && child.exitStamp != null) {
              lastPkg.recalculateDurations();
              lastPkg = null;
            }
          }
          if (isPkg) {
            lastPkg?.recalculateDurations();
            lastPkg = child;
          }
          if (child.isParent) {
            stack.push(child);
          }
          children[write++] = child;
        }
        if (write < children.length) {
          children.length = write;
          lastPkg?.recalculateDurations();
        }
      }
    }
    addLogIssue(startTime, summary, description, type) {
      const boundedSummary = this.boundIssueText(
        summary,
        _ApexLogParser.MAX_ISSUE_SUMMARY_CHARS
      );
      const existing = this.logIssuesBySummary.get(boundedSummary);
      if (existing) {
        existing.occurrences = (existing.occurrences ?? 1) + 1;
        existing.lastTime = startTime;
        return;
      }
      if (this.logIssues.length >= _ApexLogParser.MAX_LOG_ISSUES) {
        this.addOverflowIssue(startTime);
        return;
      }
      const issue = {
        startTime,
        lastTime: startTime,
        occurrences: 1,
        summary: boundedSummary,
        description: this.boundIssueText(
          description,
          _ApexLogParser.MAX_ISSUE_DESCRIPTION_CHARS
        ),
        type
      };
      this.reasons.add(boundedSummary);
      this.logIssues.push(issue);
      this.logIssuesBySummary.set(boundedSummary, issue);
    }
    addOverflowIssue(startTime) {
      let overflow = this.logIssuesBySummary.get(
        _ApexLogParser.ISSUE_OVERFLOW_SUMMARY
      );
      if (!overflow) {
        const evicted = this.logIssues.pop();
        this.logIssuesBySummary.delete(evicted.summary);
        this.reasons.delete(evicted.summary);
        const evictedOccurrences = evicted.occurrences ?? 1;
        overflow = {
          startTime: evicted.startTime ?? startTime,
          lastTime: startTime,
          occurrences: evictedOccurrences,
          summary: _ApexLogParser.ISSUE_OVERFLOW_SUMMARY,
          description: "Additional issue occurrences exceeded the parser safety cap; aggregate occurrence and timing evidence is retained here.",
          type: "unexpected"
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
    boundIssueText(value, maxChars) {
      return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}\u2026`;
    }
    addParsingError(message, type, rawLineNumber, sample) {
      let diagnostic = this.parsingDiagnosticsByType.get(type);
      if (!diagnostic) {
        diagnostic = {
          type,
          count: 0,
          firstLine: rawLineNumber,
          lastLine: rawLineNumber,
          samples: []
        };
        this.parsingDiagnosticsByType.set(type, diagnostic);
        this.parsingDiagnostics.push(diagnostic);
      }
      diagnostic.count += 1;
      diagnostic.lastLine = rawLineNumber;
      const boundedSample = sample.slice(0, 500);
      if (diagnostic.samples.length < 3 && !diagnostic.samples.includes(boundedSample)) {
        diagnostic.samples.push(boundedSample);
      }
      if (!this.parsingErrors.includes(message) && this.parsingErrors.length < _ApexLogParser.MAX_PARSING_ERRORS) {
        this.parsingErrors.push(message);
        return;
      }
      if (this.parsingErrors.includes(message)) return;
      this.parsingErrorOverflowCount += 1;
    }
    updateLogIssue(startTime, summary, description, type) {
      const boundedSummary = this.boundIssueText(
        summary,
        _ApexLogParser.MAX_ISSUE_SUMMARY_CHARS
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
    getDebugLevels(log) {
      const match = log.match(settingsPattern);
      if (!match) {
        return [];
      }
      const settings = match[0], settingList = settings.substring(settings.indexOf(" ") + 1).split(";");
      return settingList.map((entry) => {
        const parts = entry.split(",");
        return new DebugLevel(parts[0] || "", parts[1] || "");
      });
    }
  };
  var DebugLevel = class {
    logCategory;
    logLevel;
    constructor(category, level) {
      this.logCategory = category;
      this.logLevel = level;
    }
  };
  var LineIterator = class {
    next;
    lineGenerator;
    constructor(lineGenerator) {
      this.lineGenerator = lineGenerator;
      this.next = this.lineGenerator.next().value;
    }
    peek() {
      return this.next;
    }
    fetch() {
      const result = this.next;
      this.next = this.lineGenerator.next().value;
      return result;
    }
  };
  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }
  function asString(value) {
    return typeof value === "string" ? value : void 0;
  }
  function asNumber(value) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
      return value;
    if (typeof value === "string")
      return parseSafeIntegerToken(value) ?? void 0;
    return void 0;
  }
  function readPath(obj, keys) {
    if (!isRecord(obj)) return void 0;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== null && obj[key] !== void 0)
        return obj[key];
    }
    return void 0;
  }
  async function runVendorParser(logText) {
    const parser = new ApexLogParser();
    if (typeof parser.parse === "function") {
      return parser.parse(logText);
    }
    throw new Error(
      "Parser contract violation: ApexLogParser.parse() is required."
    );
  }
  function normalizeTimeline(parserResult) {
    const nodes = [];
    const rootChildren = readPath(parserResult, ["children"]);
    const stack = Array.isArray(rootChildren) ? rootChildren.map((node) => ({ node, parentId: null })).reverse() : [];
    while (stack.length > 0) {
      const frame = stack.pop();
      const child = frame.node;
      const type = asString(readPath(child, ["type"])) ?? "UNKNOWN";
      const timestampNs = asNumber(readPath(child, ["timestamp"])) ?? null;
      const endNs = asNumber(readPath(child, ["exitStamp"])) ?? null;
      const lineNumber = asNumber(readPath(child, ["lineNumber"])) ?? null;
      const rawLineNumber = asNumber(readPath(child, ["rawLineNumber"])) ?? null;
      const exitRawLineNumber = asNumber(readPath(child, ["exitRawLineNumber"])) ?? null;
      const text = asString(readPath(child, ["text"])) ?? null;
      const namespace = asString(readPath(child, ["namespace"])) ?? null;
      const pairingStatus = asString(readPath(child, ["pairingStatus"])) ?? "not_applicable";
      const durationIsPartial = readPath(child, ["durationIsPartial"]) === true || timestampNs !== null && endNs !== null && endNs < timestampNs || !["not_applicable", "complete"].includes(pairingStatus);
      const durationNs = !durationIsPartial && timestampNs !== null && endNs !== null && endNs >= timestampNs ? endNs - timestampNs : null;
      const id = `event-${nodes.length + 1}`;
      const event = {
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
        classification: readPath(child, ["classification"]) === "unsupported" ? "unsupported" : "supported",
        evidence: {
          startLine: rawLineNumber,
          endLine: exitRawLineNumber ?? rawLineNumber,
          ...rawLineNumber !== null ? {
            lineIds: exitRawLineNumber !== null && exitRawLineNumber !== rawLineNumber ? [rawLineNumber, exitRawLineNumber] : [rawLineNumber]
          } : {},
          confidence: "direct"
        }
      };
      nodes.push(event);
      const children = readPath(child, ["children"]);
      if (Array.isArray(children)) {
        for (let index = children.length - 1; index >= 0; index -= 1) {
          stack.push({ node: children[index], parentId: id });
        }
      }
    }
    const idSortKey = (id) => {
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
  function normalizeIssues(parserResult) {
    const issues = Array.isArray(readPath(parserResult, ["logIssues"])) ? readPath(parserResult, ["logIssues"]) : [];
    return issues.map((issue, index) => {
      const firstTimestampNs = asNumber(readPath(issue, ["startTime"])) ?? null;
      return {
        id: `issue-${index + 1}`,
        summary: asString(readPath(issue, ["summary"])) ?? "Log issue",
        description: asString(readPath(issue, ["description"])) ?? "",
        occurrences: asNumber(readPath(issue, ["occurrences"])) ?? 1,
        firstTimestampNs,
        lastTimestampNs: asNumber(readPath(issue, ["lastTime"])) ?? firstTimestampNs,
        confidence: "direct"
      };
    });
  }
  function normalizeParsingDiagnostics(parserResult) {
    const allowedTypes = /* @__PURE__ */ new Set([
      "INVALID_LOG_LINE",
      "UNSUPPORTED_EVENT",
      "MALFORMED_EVENT"
    ]);
    const diagnostics = readPath(parserResult, ["parsingDiagnostics"]);
    if (!Array.isArray(diagnostics)) return [];
    const lineNumber = (value) => {
      const parsed = asNumber(value);
      return parsed !== void 0 && parsed >= 1 ? Math.floor(parsed) : null;
    };
    return diagnostics.flatMap((entry) => {
      const type = asString(readPath(entry, ["type"]));
      if (!type || !allowedTypes.has(type)) {
        return [];
      }
      const samples = readPath(entry, ["samples"]);
      return [
        {
          type,
          count: Math.max(
            0,
            Math.floor(asNumber(readPath(entry, ["count"])) ?? 0)
          ),
          firstLine: lineNumber(readPath(entry, ["firstLine"])),
          lastLine: lineNumber(readPath(entry, ["lastLine"])),
          samples: Array.isArray(samples) ? samples.filter((sample) => typeof sample === "string").map((sample) => sample.slice(0, 500)).slice(0, 3) : []
        }
      ];
    });
  }
  async function parseLog(logText, options = {}) {
    const {
      sourceName = "inline.log",
      sourceType = "file",
      includeRawLines = false,
      enablePhaseInference = true
    } = options;
    const t0 = performance.now();
    const parserResult = await runVendorParser(logText);
    const parseTimeMs = Math.round((performance.now() - t0) * 1e3) / 1e3;
    const rawLines = includeRawLines ? logText.split(/\r\n|\r|\n/).map((text, index) => ({
      id: index + 1,
      lineNumber: index + 1,
      text
    })) : void 0;
    return {
      sourceName,
      sourceType,
      parserResult,
      parseTimeMs,
      ...rawLines ? { rawLines } : {},
      normalizedTimeline: normalizeTimeline(parserResult),
      issues: normalizeIssues(parserResult),
      parserDiagnostics: normalizeParsingDiagnostics(parserResult),
      parsingErrorOverflowCount: Math.max(
        0,
        Math.floor(
          asNumber(readPath(parserResult, ["parsingErrorOverflowCount"])) ?? 0
        )
      ),
      logIssueOverflowCount: Math.max(
        0,
        Math.floor(
          asNumber(readPath(parserResult, ["logIssueOverflowCount"])) ?? 0
        )
      ),
      capabilities: {
        includeRawLines,
        phaseInferenceEnabled: enablePhaseInference
      }
    };
  }
  function jsonPrimitive(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
      return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    return null;
  }
  function cloneJsonLike(value) {
    let result = null;
    const active = /* @__PURE__ */ new WeakSet();
    const tasks = [
      { kind: "value", value, assign: (next) => result = next }
    ];
    while (tasks.length > 0) {
      const task = tasks.pop();
      if (task.kind === "leave") {
        active.delete(task.value);
        continue;
      }
      const source = task.value;
      if (typeof source !== "object" || source === null) {
        task.assign(jsonPrimitive(source));
        continue;
      }
      if (active.has(source)) {
        task.assign(null);
        continue;
      }
      const target = Array.isArray(source) ? new Array(source.length).fill(null) : {};
      task.assign(target);
      active.add(source);
      tasks.push({ kind: "leave", value: source });
      const keys = Array.isArray(source) ? Array.from({ length: source.length }, (_, index) => String(index)) : Object.keys(source);
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        let child;
        try {
          child = source[key];
        } catch {
          continue;
        }
        const supported = child === null || typeof child === "string" || typeof child === "boolean" || typeof child === "number" || typeof child === "object";
        if (!supported && !Array.isArray(target)) continue;
        tasks.push({
          kind: "value",
          value: child,
          assign: (next) => {
            if (Array.isArray(target)) {
              target[Number(key)] = next;
            } else {
              Object.defineProperty(target, key, {
                value: next,
                enumerable: true,
                configurable: true,
                writable: true
              });
            }
          }
        });
      }
    }
    return result;
  }
  function basename(filePath) {
    return filePath.split(/[/\\]/).pop() ?? filePath;
  }
  function isRecord2(value) {
    return typeof value === "object" && value !== null;
  }
  function asNumber2(value) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
      return value;
    if (typeof value === "string")
      return parseSafeIntegerToken(value) ?? void 0;
    return void 0;
  }
  function asString2(value) {
    return typeof value === "string" ? value : void 0;
  }
  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }
  function readPath2(obj, keys) {
    if (!isRecord2(obj)) return void 0;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null)
        return obj[key];
    }
    return void 0;
  }
  function parseLogId(fileName) {
    const m = fileName.match(/(07L[a-zA-Z0-9]{12,})/);
    return m?.[1] ?? null;
  }
  function normalizeClock(value) {
    if (!value) return null;
    const m = value.match(/^((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)\.(\d{1,9})$/);
    if (!m) return null;
    const ms = m[2].padEnd(3, "0").slice(0, 3);
    return `${m[1]}.${ms}`;
  }
  function eventClockFromLogLine(logLine) {
    if (!logLine) return null;
    const timePart = logLine.split(" ")[0];
    return normalizeClock(timePart);
  }
  function parseUserInfoFromLogLine(logLine) {
    const parts = splitLogFields(String(logLine || ""), 8);
    if (parts.length < 7) {
      return { userId: null, username: null, timezone: null };
    }
    const userId = parts[3]?.trim() || null;
    const username = parts[4]?.trim() || null;
    const timezone = parts[6]?.trim() || null;
    return { userId, username, timezone };
  }
  function countByKey(events, key) {
    const counts = /* @__PURE__ */ new Map();
    for (const event of events) {
      const value = key(event).trim() || "unknown";
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return Object.fromEntries(counts);
  }
  function toLimit(used, max) {
    if (used === void 0 || max === void 0 || max <= 0) {
      return {
        used: used ?? null,
        max: max ?? null,
        pct: null,
        status: "unknown"
      };
    }
    const pct = Math.round(used / max * 1e4) / 100;
    const status = pct >= 95 ? "critical" : pct >= 80 ? "warn" : "ok";
    return { used, max, pct, status };
  }
  function flattenEvents(root) {
    const out = [];
    const rootChildren = asArray(readPath2(root, ["children"]));
    const stack = rootChildren.map((node) => ({ node, parentIdx: null })).reverse();
    while (stack.length > 0) {
      const frame = stack.pop();
      const child = frame.node;
      const timestampNs = asNumber2(readPath2(child, ["timestamp"])) ?? 0;
      const endTimestampNs = asNumber2(readPath2(child, ["exitStamp"])) ?? null;
      const rawPairingStatus = asString2(readPath2(child, ["pairingStatus"]));
      const pairingStatus = rawPairingStatus === "complete" || rawPairingStatus === "missing_end" || rawPairingStatus === "orphan_end" || rawPairingStatus === "closed_by_exception" || rawPairingStatus === "closed_at_truncation" || rawPairingStatus === "depth_limit" ? rawPairingStatus : "not_applicable";
      const durationIsPartial = readPath2(child, ["durationIsPartial"]) === true || pairingStatus === "missing_end" || pairingStatus === "orphan_end" || pairingStatus === "closed_by_exception" || pairingStatus === "closed_at_truncation" || pairingStatus === "depth_limit";
      const hasValidDurationBoundary = !durationIsPartial && endTimestampNs !== null && endTimestampNs >= timestampNs;
      const durationSelfNs = hasValidDurationBoundary ? asNumber2(readPath2(readPath2(child, ["duration"]), ["self"])) ?? null : null;
      const durationTotalNs = hasValidDurationBoundary ? endTimestampNs - timestampNs : null;
      const entry = {
        idx: out.length,
        parentIdx: frame.parentIdx,
        type: asString2(readPath2(child, ["type"])) ?? "UNKNOWN",
        timestampNs,
        timestampIsInferred: readPath2(child, ["timestampIsInferred"]) === true,
        endTimestampNs,
        durationSelfNs,
        durationTotalNs,
        pairingStatus,
        namespace: asString2(readPath2(child, ["namespace"])) ?? "default",
        category: asString2(readPath2(child, ["category"])) ?? "",
        debugCategory: asString2(readPath2(child, ["debugCategory"])) ?? "",
        cpuType: asString2(readPath2(child, ["cpuType"])) ?? "",
        lineNumber: asNumber2(readPath2(child, ["rawLineNumber"])) ?? null,
        sourceLineNumber: asNumber2(readPath2(child, ["lineNumber"])) ?? null,
        text: asString2(readPath2(child, ["text"])) ?? "",
        logLine: asString2(readPath2(child, ["logLine"])) ?? "",
        exitLineNumber: asNumber2(readPath2(child, ["exitRawLineNumber"])) ?? null,
        exitLogLine: asString2(readPath2(child, ["exitLogLine"])) ?? null,
        credentialId: asString2(readPath2(child, ["credentialId"])) ?? null,
        credentialName: asString2(readPath2(child, ["credentialName"])) ?? null,
        endpoint: asString2(readPath2(child, ["endpoint"])) ?? null,
        method: asString2(readPath2(child, ["method"])) ?? null,
        externalCredentialType: asString2(readPath2(child, ["externalCredentialType"])) ?? null,
        requestSizeBytes: asNumber2(readPath2(child, ["requestSizeBytes"])) ?? null,
        retryOn401: typeof readPath2(child, ["retryOn401"]) === "boolean" ? readPath2(child, ["retryOn401"]) : null,
        statusCode: asNumber2(readPath2(child, ["statusCode"])) ?? null,
        responseSizeBytes: asNumber2(readPath2(child, ["responseSizeBytes"])) ?? null,
        overallCalloutTimeMs: asNumber2(readPath2(child, ["overallCalloutTimeMs"])) ?? null,
        connectTimeMs: asNumber2(readPath2(child, ["connectTimeMs"])) ?? null,
        responseText: asString2(readPath2(child, ["responseText"])) ?? null,
        responseLineNumber: asNumber2(readPath2(child, ["responseLineNumber"])) ?? null,
        responseTimestampNs: asNumber2(readPath2(child, ["responseTimestamp"])) ?? null,
        responseLogLine: asString2(readPath2(child, ["responseLogLine"])) ?? null,
        isContinuation: readPath2(child, ["isContinuation"]) === true,
        isParent: readPath2(child, ["isParent"]) === true,
        aggregations: asNumber2(readPath2(child, ["aggregations"])) ?? null,
        soqlCountTotal: asNumber2(readPath2(readPath2(child, ["soqlCount"]), ["total"])) ?? null,
        soqlRowCountTotal: readPath2(child, ["rowCountIsKnown"]) === false ? null : asNumber2(readPath2(readPath2(child, ["soqlRowCount"]), ["total"])) ?? null,
        soslCountTotal: asNumber2(readPath2(readPath2(child, ["soslCount"]), ["total"])) ?? null,
        soslRowCountTotal: readPath2(child, ["rowCountIsKnown"]) === false ? null : asNumber2(readPath2(readPath2(child, ["soslRowCount"]), ["total"])) ?? null,
        dmlCountTotal: asNumber2(readPath2(readPath2(child, ["dmlCount"]), ["total"])) ?? null,
        dmlRowCountTotal: readPath2(child, ["rowCountIsKnown"]) === false ? null : asNumber2(readPath2(readPath2(child, ["dmlRowCount"]), ["total"])) ?? null
      };
      out.push(entry);
      const children = asArray(readPath2(child, ["children"]));
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({ node: children[index], parentIdx: entry.idx });
      }
    }
    return out;
  }
  function parseDmlText(text) {
    const compact = text.match(/DML\.(\w+)\[([^\]]+)]/i);
    const op = text.match(/Op:(\w+)/i)?.[1] ?? compact?.[1] ?? null;
    const sobject = text.match(/Type:([^|\s]+)/i)?.[1] ?? compact?.[2] ?? null;
    return { operation: op, sobject };
  }
  function parseCalloutRequestText(text) {
    const normalized = text || "";
    const endpoint = normalized.match(
      /Endpoint\s*=\s*(.*?)(?=,\s*(?:Method|Header|Body|Timeout|Compressed|ClientCertificateName)\s*=|\]\s*$)/i
    )?.[1]?.trim() ?? normalized.match(/\bhttps?:\/\/[^\s,\]]+/i)?.[0]?.trim() ?? null;
    const method = normalized.match(/Method\s*=\s*([A-Z]+)/i)?.[1]?.toUpperCase() ?? normalized.match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i)?.[1]?.toUpperCase() ?? null;
    let host = null;
    if (endpoint) {
      try {
        host = new URL(endpoint).host || null;
      } catch {
        host = null;
      }
    }
    return { endpoint, host, method };
  }
  function parseCalloutResponseText(text) {
    const t = String(text || "");
    const codeMatch = t.match(/StatusCode[=:\s]+(\d{3})(?!\d)/i) ?? t.match(/\b([1-5]\d{2})\b/);
    const statusCode = parseSafeIntegerToken(codeMatch?.[1]);
    const statusMatch = t.match(/Status\s*=\s*([^,\]]+)/i);
    const statusText = statusMatch ? statusMatch[1].trim() : null;
    return { statusCode, statusText };
  }
  function queueableClassFromText(text) {
    if (!text) return null;
    if (!/queueable/i.test(text)) return null;
    const beforeParen = text.split("(")[0]?.trim() ?? "";
    if (beforeParen) return beforeParen;
    return text.trim() || null;
  }
  function isErrorEventType(type) {
    if (type === "EXCEPTION_THROWN" || type === "FATAL_ERROR" || type === "VALIDATION_ERROR")
      return true;
    if (type.endsWith("_VIOLATION")) return true;
    return type.includes("ERROR") || type.includes("EXCEPTION");
  }
  function isSpanCandidate(event) {
    if (!event.isParent) return false;
    if ((event.durationTotalNs ?? 0) <= 0) return false;
    return event.type.startsWith("CODE_UNIT_") || event.type.startsWith("METHOD_") || event.type.startsWith("CONSTRUCTOR_") || event.type.startsWith("SYSTEM_METHOD_") || event.type.startsWith("SYSTEM_CONSTRUCTOR_") || event.type.startsWith("VF_") || event.type.startsWith("FLOW_") || event.type.startsWith("WF_") || event.type.startsWith("SOQL_") || event.type.startsWith("SOSL_") || event.type.startsWith("DML_") || event.type.startsWith("NBA_") || event.type === "CALLOUT_REQUEST" || event.type === "NAMED_CREDENTIAL_REQUEST";
  }
  function buildSpanLabel(event) {
    if (event.type === "SOQL_EXECUTE_BEGIN") return event.text || "SOQL";
    if (event.type === "DML_BEGIN") return event.text || "DML";
    if (event.type === "FLOW_START_INTERVIEW_BEGIN")
      return event.text || "Flow interview";
    if (event.type === "FLOW_ELEMENT_BEGIN") return event.text || "Flow element";
    if (event.type === "CODE_UNIT_STARTED") return event.text || "Code Unit";
    return event.text || event.type;
  }
  function parseValidationCodeUnitLabel(label) {
    const parts = String(label || "").split(":");
    if (parts.length < 2) return { sobject: null, context: null };
    return {
      sobject: parts[1] || null,
      context: parts[2] || null
    };
  }
  var SALESFORCE_ID_RE = /\b[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?\b/;
  function isSalesforceId(value) {
    return typeof value === "string" && /^(?:[a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/.test(value);
  }
  var STANDARD_KEY_PREFIXES = {
    "001": "Account",
    "003": "Contact",
    "005": "User",
    "006": "Opportunity",
    "00k": "OpportunityLineItem",
    "00Q": "Lead",
    "00T": "Task",
    "00U": "Event",
    "500": "Case",
    "01t": "Product2",
    "01u": "PricebookEntry",
    "01s": "Pricebook2",
    "800": "Contract",
    "810": "ContractLineItem",
    "707": "AsyncApexJob",
    "01p": "ApexClass",
    "01q": "ApexTrigger",
    a0C: "SBQQ__Quote__c",
    a0j: "SBQQ__QuoteLine__c",
    a0n: "SBQQ__Subscription__c",
    "0Hn": "SBQQ__QuoteLineGroup__c",
    "07L": "ApexLog"
  };
  function getKeyPrefix(id) {
    if (!id || id.length < 3) return "";
    return id.substring(0, 3);
  }
  function inferSObjectFromVarName(name) {
    const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).map((word) => word.toLowerCase()).filter(Boolean);
    const has = (...candidates) => candidates.some((candidate) => words.includes(candidate));
    if (has(
      "opportunitylineitem",
      "opportunitylineitems",
      "opplineitem",
      "opplineitems",
      "oli",
      "olis"
    ) || has("opportunity", "opp") && (has("lineitem", "lineitems") || has("line", "lines") && has("item", "items")))
      return "OpportunityLineItem";
    if (has("opportunity", "opportunities", "opp", "opps")) return "Opportunity";
    if (has("account", "accounts", "acct", "accts")) return "Account";
    if (has("contact", "contacts")) return "Contact";
    if (has("product2", "product", "products")) return "Product2";
    if (has("contract", "contracts")) return "Contract";
    if (has("quoteline", "quotelines") || has("quote", "quotes") && has("line", "lines"))
      return "SBQQ__QuoteLine__c";
    if (has("quote", "quotes")) return "SBQQ__Quote__c";
    if (has("subscription", "subscriptions")) return "SBQQ__Subscription__c";
    if (has("case", "cases")) return "Case";
    if (has("lead", "leads")) return "Lead";
    if (has("user", "users")) return "User";
    return null;
  }
  function addPrefixCandidate(candidates, id, sObjectType) {
    const prefix = getKeyPrefix(id);
    const types = candidates.get(prefix) ?? /* @__PURE__ */ new Set();
    types.add(sObjectType);
    candidates.set(prefix, types);
  }
  function subqueryRanges(query) {
    const ranges = [];
    const stack = [];
    let quote = null;
    let quoteStart = -1;
    let lineComment = false;
    let lineCommentStart = -1;
    let blockComment = false;
    let blockCommentStart = -1;
    for (let index = 0; index < query.length; index += 1) {
      const char = query[index];
      const next = query[index + 1];
      if (lineComment) {
        if (char === "\n" || char === "\r") {
          ranges.push({ start: lineCommentStart, end: index });
          lineComment = false;
        }
        continue;
      }
      if (blockComment) {
        if (char === "*" && next === "/") {
          ranges.push({ start: blockCommentStart, end: index + 1 });
          blockComment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (char === "\\") index += 1;
        else if (char === quote) {
          if (next === quote) index += 1;
          else {
            ranges.push({ start: quoteStart, end: index });
            quote = null;
          }
        }
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        quoteStart = index;
        continue;
      }
      if (char === "/" && next === "/") {
        lineComment = true;
        lineCommentStart = index;
        index += 1;
        continue;
      }
      if (char === "/" && next === "*") {
        blockComment = true;
        blockCommentStart = index;
        index += 1;
        continue;
      }
      if (char === "(") {
        let tokenStart = index + 1;
        while (/\s/.test(query[tokenStart] ?? "")) tokenStart += 1;
        stack.push({
          start: index,
          isSubquery: query.slice(tokenStart, tokenStart + 6).toUpperCase() === "SELECT" && !/[A-Z0-9_]/i.test(query[tokenStart + 6] ?? "")
        });
      } else if (char === ")") {
        const frame = stack.pop();
        if (frame?.isSubquery) ranges.push({ start: frame.start, end: index });
      }
    }
    for (const frame of stack) {
      if (frame.isSubquery)
        ranges.push({ start: frame.start, end: query.length });
    }
    if (quote) ranges.push({ start: quoteStart, end: query.length });
    if (lineComment) ranges.push({ start: lineCommentStart, end: query.length });
    if (blockComment)
      ranges.push({ start: blockCommentStart, end: query.length });
    ranges.sort(
      (left, right) => left.start - right.start || left.end - right.end
    );
    const merged = [];
    for (const range of ranges) {
      const previous = merged.at(-1);
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        merged.push({ ...range });
      }
    }
    return merged;
  }
  function extractLiteralIdPredicateIds(query) {
    const ids = /* @__PURE__ */ new Set();
    const excluded = subqueryRanges(query);
    const isExcluded = (index) => {
      let low = 0;
      let high = excluded.length - 1;
      while (low <= high) {
        const middle = low + Math.floor((high - low) / 2);
        const range = excluded[middle];
        if (index <= range.start) high = middle - 1;
        else if (index >= range.end) low = middle + 1;
        else return true;
      }
      return false;
    };
    const field = String.raw`(?:\b[A-Za-z_][A-Za-z0-9_]*\s*\.\s*)?\bId\b`;
    const idToken = String.raw`[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?`;
    const equalsPattern = new RegExp(
      String.raw`${field}\s*=\s*(['"])(${idToken})\1`,
      "gi"
    );
    const inPattern = new RegExp(String.raw`${field}\s+IN\s*\(([^)]*)\)`, "gi");
    const quotedIdPattern = new RegExp(String.raw`(['"])(${idToken})\1`, "g");
    for (const match of query.matchAll(equalsPattern)) {
      if (!isExcluded(match.index) && isSalesforceId(match[2])) ids.add(match[2]);
    }
    for (const match of query.matchAll(inPattern)) {
      if (isExcluded(match.index)) continue;
      for (const idMatch of (match[1] ?? "").matchAll(quotedIdPattern)) {
        if (isSalesforceId(idMatch[2])) ids.add(idMatch[2]);
      }
    }
    return [...ids];
  }
  function resolveSObjectType(id, prefixMap) {
    const prefix = getKeyPrefix(id);
    return prefixMap.get(prefix) ?? null;
  }
  function buildDynamicPrefixMap(databaseSoql, variableAssignments) {
    const prefixMap = /* @__PURE__ */ new Map();
    for (const [prefix, sObj] of Object.entries(STANDARD_KEY_PREFIXES)) {
      prefixMap.set(prefix, sObj);
    }
    const queryCandidates = /* @__PURE__ */ new Map();
    for (const query of databaseSoql) {
      if (!query.targetObject) continue;
      for (const id of extractLiteralIdPredicateIds(String(query.query || ""))) {
        addPrefixCandidate(queryCandidates, id, query.targetObject);
      }
    }
    const ambiguousQueryPrefixes = /* @__PURE__ */ new Set();
    for (const [prefix, types] of queryCandidates) {
      if (prefixMap.has(prefix)) continue;
      if (types.size === 1) prefixMap.set(prefix, types.values().next().value);
      else ambiguousQueryPrefixes.add(prefix);
    }
    const variableCandidates = /* @__PURE__ */ new Map();
    for (const va of variableAssignments) {
      if (!isRecord2(va.parsedValue)) continue;
      const inferred = inferSObjectFromVarName(va.variableName);
      if (!inferred) continue;
      const directId = asString2(va.parsedValue.Id);
      if (isSalesforceId(directId)) {
        addPrefixCandidate(variableCandidates, directId, inferred);
      }
      for (const [key, val] of Object.entries(va.parsedValue)) {
        if (isSalesforceId(key)) {
          if (isRecord2(val))
            addPrefixCandidate(variableCandidates, key, inferred);
        }
      }
    }
    for (const [prefix, types] of variableCandidates) {
      if (!prefixMap.has(prefix) && !ambiguousQueryPrefixes.has(prefix) && types.size === 1) {
        prefixMap.set(prefix, types.values().next().value);
      }
    }
    return prefixMap;
  }
  function extractRecordGraph(allEvents, variableAssignments, prefixMap, limitPerType = 100) {
    const recordsById = /* @__PURE__ */ new Map();
    const vaEventQueues = /* @__PURE__ */ new Map();
    for (const event of allEvents) {
      if (event.type !== "VARIABLE_ASSIGNMENT") continue;
      const rawParts = splitLogFields(event.logLine, 5);
      const sep = event.text.indexOf("|");
      const name = (rawParts[1] === "VARIABLE_ASSIGNMENT" ? rawParts[3] || "" : sep !== -1 ? event.text.slice(0, sep) : event.text).trim();
      if (!vaEventQueues.has(name)) vaEventQueues.set(name, []);
      vaEventQueues.get(name).push(event);
    }
    for (const va of variableAssignments) {
      if (!va.parsedValue || typeof va.parsedValue !== "object") continue;
      const queue = vaEventQueues.get(va.variableName) ?? [];
      const eventForVa = queue.shift();
      const timestampNs = eventForVa?.timestampNs ?? null;
      const lineNumber = eventForVa?.lineNumber ?? null;
      if (Array.isArray(va.parsedValue)) {
        for (const item of va.parsedValue) {
          if (isSalesforceId(item)) {
            if (!recordsById.has(item)) {
              recordsById.set(item, {
                id: item,
                sObjectType: resolveSObjectType(item, prefixMap),
                keyPrefix: getKeyPrefix(item),
                fields: [],
                relationships: [],
                provenance: {
                  variableName: va.variableName,
                  timestampNs,
                  lineNumber,
                  source: "variable_assignment"
                }
              });
            }
          } else if (isRecord2(item)) {
            extractRecordFromObject(
              item,
              va.variableName,
              timestampNs,
              lineNumber,
              prefixMap,
              recordsById
            );
          }
        }
      } else if (isRecord2(va.parsedValue)) {
        const obj = va.parsedValue;
        const directId = asString2(obj.Id);
        if (isSalesforceId(directId)) {
          extractRecordFromObject(
            obj,
            va.variableName,
            timestampNs,
            lineNumber,
            prefixMap,
            recordsById
          );
        } else {
          for (const [key, val] of Object.entries(obj)) {
            if (isSalesforceId(key)) {
              if (isRecord2(val)) {
                const valRecord = val;
                const recordObj = isSalesforceId(valRecord.Id) ? valRecord : { ...valRecord, Id: key };
                extractRecordFromObject(
                  recordObj,
                  va.variableName,
                  timestampNs,
                  lineNumber,
                  prefixMap,
                  recordsById
                );
              }
            }
          }
        }
      }
    }
    const bySObject = /* @__PURE__ */ new Map();
    for (const record of recordsById.values()) {
      const key = record.sObjectType || `Unknown (${record.keyPrefix})`;
      if (!bySObject.has(key)) bySObject.set(key, []);
      bySObject.get(key).push(record);
    }
    const truncatedTypes = [];
    let totalRecords = 0;
    const entries = Array.from(bySObject.entries()).map(([sObjectType, records]) => {
      totalRecords += records.length;
      const shown = records.slice(0, limitPerType);
      if (records.length > limitPerType) {
        truncatedTypes.push({
          sObjectType,
          total: records.length,
          shown: shown.length
        });
      }
      return {
        sObjectType,
        keyPrefix: records[0]?.keyPrefix ?? "???",
        recordCount: records.length,
        records: shown,
        truncated: records.length > limitPerType
      };
    }).sort((a, b) => b.recordCount - a.recordCount);
    return {
      entries,
      meta: {
        totalSObjectTypes: bySObject.size,
        totalRecords,
        truncatedTypes,
        limitPerType
      }
    };
  }
  function extractRecordFromObject(obj, variableName, timestampNs, lineNumber, prefixMap, recordsById) {
    const stack = [
      { record: obj, provenanceName: variableName }
    ];
    const visited = /* @__PURE__ */ new WeakSet();
    while (stack.length > 0) {
      const frame = stack.pop();
      if (visited.has(frame.record)) continue;
      visited.add(frame.record);
      const id = asString2(frame.record.Id);
      if (!isSalesforceId(id)) continue;
      const existing = recordsById.get(id);
      if (existing && existing.fields.length > 0) continue;
      const fields = [];
      const relationships = [];
      for (const [field, value] of Object.entries(frame.record)) {
        if (field === "Id") continue;
        if (field.endsWith("__r") && isRecord2(value)) {
          const relObj = value;
          const relId = asString2(relObj.Id);
          if (isSalesforceId(relId)) {
            relationships.push({
              field,
              relatedId: relId,
              relatedSObject: resolveSObjectType(relId, prefixMap)
            });
            stack.push({
              record: relObj,
              provenanceName: `${frame.provenanceName}.${field}`
            });
          }
          for (const [relField, relValue] of Object.entries(relObj)) {
            if (relField !== "Id" && !relField.endsWith("__r") && !isRecord2(relValue)) {
              fields.push({ field: `${field}.${relField}`, value: relValue });
            }
          }
          continue;
        }
        if (isSalesforceId(value)) {
          const relSObject = resolveSObjectType(value, prefixMap);
          relationships.push({
            field,
            relatedId: value,
            relatedSObject: relSObject
          });
        }
        if (!isRecord2(value) && !Array.isArray(value)) {
          fields.push({ field, value });
        }
      }
      recordsById.set(id, {
        id,
        sObjectType: resolveSObjectType(id, prefixMap),
        keyPrefix: getKeyPrefix(id),
        fields,
        relationships,
        provenance: {
          variableName: frame.provenanceName,
          timestampNs,
          lineNumber,
          source: "variable_assignment"
        }
      });
    }
  }
  function extractTargetObject(query) {
    const q = String(query || "");
    let depth = 0;
    let quote = null;
    let lineComment = false;
    let blockComment = false;
    for (let index = 0; index < q.length; index += 1) {
      const char = q[index];
      const next = q[index + 1];
      if (lineComment) {
        if (char === "\n" || char === "\r") lineComment = false;
        continue;
      }
      if (blockComment) {
        if (char === "*" && next === "/") {
          blockComment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (char === "\\") {
          index += 1;
        } else if (char === quote) {
          if (next === quote) index += 1;
          else quote = null;
        }
        continue;
      }
      if ((char === "'" || char === '"') && !quote) {
        quote = char;
        continue;
      }
      if (char === "/" && next === "*") {
        blockComment = true;
        index += 1;
        continue;
      }
      if (char === "/" && next === "/") {
        lineComment = true;
        index += 1;
        continue;
      }
      if (char === "(") {
        depth += 1;
        continue;
      }
      if (char === ")") {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth !== 0 || q.slice(index, index + 4).toUpperCase() !== "FROM") {
        continue;
      }
      const before = q[index - 1];
      const after = q[index + 4];
      if (before && /[A-Z0-9_]/i.test(before) || after && /[A-Z0-9_]/i.test(after)) {
        continue;
      }
      let objectStart = index + 4;
      while (/\s/.test(q[objectStart] || "")) objectStart += 1;
      const objectMatch = q.slice(objectStart).match(/^[A-Z_][A-Z0-9_]*/i);
      return objectMatch?.[0] ?? null;
    }
    return null;
  }
  function parseExplainPlan(text) {
    const raw = String(text || "");
    if (/No explain plan is available/i.test(raw)) {
      return {
        available: false,
        indexed: false,
        raw
      };
    }
    const out = {
      available: true,
      indexed: /Index on /i.test(raw),
      raw
    };
    const indexMatch = raw.match(/Index on [^:]+ : \[([^\]]+)\]/i);
    if (indexMatch?.[1]) {
      out.indexFields = indexMatch[1].split(",").map((f) => f.trim()).filter(Boolean);
    }
    const metricToken = (label) => {
      const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const token = raw.match(
        new RegExp(
          `\\b${escapedLabel}\\s*:?\\s*([^\\s;{}\\[\\]]+?)(?=,\\s*(?:[A-Za-z_]|$)|\\s|;|[{}\\[\\]]|$)`,
          "i"
        )
      )?.[1];
      return token ?? null;
    };
    const cardinality = parseSafeIntegerToken(metricToken("cardinality"));
    const sobjectCardinality = parseSafeIntegerToken(
      metricToken("sobjectCardinality")
    );
    const relativeCostToken = metricToken("relativeCost");
    if (cardinality !== null) out.cardinality = cardinality;
    if (sobjectCardinality !== null) out.sobjectCardinality = sobjectCardinality;
    if (relativeCostToken !== null && /^(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(relativeCostToken)) {
      const relativeCost = Number(relativeCostToken);
      if (Number.isFinite(relativeCost) && relativeCost >= 0) {
        out.relativeCost = relativeCost;
      }
    }
    return out;
  }
  function parseVariableAssignment(event) {
    if (event.type !== "VARIABLE_ASSIGNMENT") return null;
    const logParts = splitLogFields(String(event.logLine || ""), 5);
    const hasRawTokens = logParts[1] === "VARIABLE_ASSIGNMENT" && logParts.length >= 5;
    const variableName = hasRawTokens ? logParts[3]?.trim() || "" : String(event.text || "").split("|", 1)[0]?.trim() || "";
    let rawValue;
    if (hasRawTokens) {
      rawValue = (logParts[4] || "").replace(/\|0x[\da-f]+\s*$/i, "").trim();
    } else {
      const separator = String(event.text || "").indexOf("|");
      rawValue = separator >= 0 ? event.text.slice(separator + 1).trim() : "";
    }
    if (!variableName) return null;
    let parsedValue = rawValue;
    if (rawValue === "null") {
      parsedValue = null;
    } else if (rawValue.startsWith("{") || rawValue.startsWith("[") || rawValue.startsWith('"')) {
      try {
        parsedValue = JSON.parse(rawValue);
      } catch {
        parsedValue = rawValue;
      }
    }
    let isEmptyCollection = false;
    if (Array.isArray(parsedValue)) isEmptyCollection = parsedValue.length === 0;
    else if (isRecord2(parsedValue))
      isEmptyCollection = Object.keys(parsedValue).length === 0;
    return {
      variableName,
      rawValue,
      parsedValue,
      isEmptyCollection
    };
  }
  function parseVariableScope(event) {
    if (event.type !== "VARIABLE_SCOPE_BEGIN") return null;
    const logParts = splitLogFields(String(event.logLine || ""), 6);
    const hasRawTokens = logParts[1] === "VARIABLE_SCOPE_BEGIN" && logParts.length >= 5;
    const displayParts = splitLogFields(String(event.text || ""), 3);
    const variableName = hasRawTokens ? logParts[3]?.trim() || "" : displayParts[0]?.trim() || "";
    const typeName = hasRawTokens ? logParts[4]?.trim() || "" : displayParts[1]?.trim() || "";
    if (!variableName || !typeName) return null;
    return { variableName, typeName };
  }
  function upperBoundTimestamp(timeline, timestampNs) {
    let low = 0;
    let high = timeline.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (timeline[middle].timestampNs <= timestampNs) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }
  function buildLimitTimeline(snapshotsRaw) {
    const entries = [];
    for (const snap of snapshotsRaw) {
      if (!isRecord2(snap)) continue;
      const ts = asNumber2(readPath2(snap, ["timestamp"])) ?? 0;
      const limits = readPath2(snap, ["limits"]);
      if (!isRecord2(limits)) continue;
      const soqlQ = readPath2(limits, ["soqlQueries"]);
      const queryRows = readPath2(limits, ["queryRows"]);
      const dmlS = readPath2(limits, ["dmlStatements"]);
      entries.push({
        timestampNs: ts,
        soql: isRecord2(soqlQ) ? asNumber2(soqlQ.used) ?? null : null,
        soqlRows: isRecord2(queryRows) ? asNumber2(queryRows.used) ?? null : null,
        dml: isRecord2(dmlS) ? asNumber2(dmlS.used) ?? null : null
      });
    }
    return entries.sort((a, b) => a.timestampNs - b.timestampNs);
  }
  function computeGovernorDelta(timeline, startNs, endNs) {
    if (startNs > endNs) {
      return {
        soqlBefore: null,
        soqlAfter: null,
        soqlRowsBefore: null,
        soqlRowsAfter: null,
        dmlBefore: null,
        dmlAfter: null
      };
    }
    const beforeInsertionIndex = upperBoundTimestamp(timeline, startNs);
    const before = timeline[beforeInsertionIndex - 1] ?? null;
    const endInsertionIndex = upperBoundTimestamp(timeline, endNs);
    const lastAtOrBeforeEnd = timeline[endInsertionIndex - 1] ?? null;
    const after = lastAtOrBeforeEnd && lastAtOrBeforeEnd.timestampNs >= startNs ? lastAtOrBeforeEnd : timeline[endInsertionIndex] ?? null;
    return {
      soqlBefore: before?.soql ?? null,
      soqlAfter: after?.soql ?? null,
      soqlRowsBefore: before?.soqlRows ?? null,
      soqlRowsAfter: after?.soqlRows ?? null,
      dmlBefore: before?.dml ?? null,
      dmlAfter: after?.dml ?? null
    };
  }
  function addExactBytes(total, delta) {
    if (total === null) return null;
    const next = total + delta;
    return Number.isSafeInteger(next) ? next : null;
  }
  function exactDifference(left, right) {
    if (left === null || right === null) return null;
    const difference = left - right;
    return Number.isSafeInteger(difference) ? difference : null;
  }
  function buildHeapAnalysis(allEvents, spans, executionPhases, spanIdByEventIdx) {
    const allocations = [];
    const deallocations = [];
    for (const event of allEvents) {
      if (event.type !== "HEAP_ALLOCATE" && event.type !== "HEAP_DEALLOCATE")
        continue;
      const bytesToken = String(event.text || "").match(
        /(?:^|\|)\s*Bytes:\s*([^|\s]+)/i
      )?.[1];
      const parsedBytes = parseSafeIntegerToken(bytesToken);
      const bytes = parsedBytes !== null && parsedBytes > 0 ? parsedBytes : 0;
      if (bytes === 0) continue;
      const parentSpanId = event.parentIdx !== null ? spanIdByEventIdx.get(event.parentIdx) ?? null : null;
      const entry = {
        lineNumber: event.lineNumber,
        bytes,
        timestampNs: event.timestampNs,
        parentSpanId,
        namespace: event.namespace
      };
      if (event.type === "HEAP_ALLOCATE") {
        allocations.push(entry);
      } else {
        deallocations.push(entry);
      }
    }
    const totalAllocatedBytes = allocations.reduce(
      (sum, allocation) => addExactBytes(sum, allocation.bytes),
      0
    );
    const totalDeallocatedBytes = deallocations.reduce(
      (sum, deallocation) => addExactBytes(sum, deallocation.bytes),
      0
    );
    const allHeapEvents = [...allocations, ...deallocations].sort(
      (a, b) => a.timestampNs - b.timestampNs
    );
    const allocationSet = new Set(allocations);
    const sampleInterval = Math.max(1, Math.floor(allHeapEvents.length / 200));
    const watermarkSamples = [];
    let runningTotal = 0;
    let peakBytes = 0;
    let peakTimestampNs = null;
    for (let i = 0; i < allHeapEvents.length; i++) {
      const ev = allHeapEvents[i];
      const isAllocation = allocationSet.has(ev);
      runningTotal = addExactBytes(
        runningTotal,
        isAllocation ? ev.bytes : -ev.bytes
      );
      if (runningTotal !== null && runningTotal < 0) runningTotal = 0;
      if (runningTotal === null) {
        peakBytes = null;
        peakTimestampNs = null;
      } else if (peakBytes !== null && runningTotal > peakBytes) {
        peakBytes = runningTotal;
        peakTimestampNs = ev.timestampNs;
      }
      if (i % sampleInterval === 0 || i === allHeapEvents.length - 1) {
        watermarkSamples.push({
          timestampNs: ev.timestampNs,
          cumulativeBytes: runningTotal
        });
      }
    }
    if (peakTimestampNs !== null && !watermarkSamples.some((s) => s.timestampNs === peakTimestampNs)) {
      watermarkSamples.push({
        timestampNs: peakTimestampNs,
        cumulativeBytes: peakBytes
      });
      watermarkSamples.sort((a, b) => a.timestampNs - b.timestampNs);
    }
    const byLine = /* @__PURE__ */ new Map();
    for (const alloc of allocations) {
      const key = `${alloc.lineNumber ?? "unknown"}|${alloc.namespace}`;
      const existing = byLine.get(key);
      if (existing) {
        existing.bytes = addExactBytes(existing.bytes, alloc.bytes);
        existing.count += 1;
      } else {
        byLine.set(key, {
          bytes: alloc.bytes,
          count: 1,
          namespace: alloc.namespace,
          parentSpanId: alloc.parentSpanId
        });
      }
    }
    const hotspotsByLine = Array.from(byLine.entries()).map(([key, data]) => {
      const lineNumber = key.split("|")[0];
      const num = Number(lineNumber);
      return {
        lineNumber: lineNumber === "unknown" || !Number.isSafeInteger(num) ? null : num,
        totalBytes: data.bytes,
        count: data.count,
        avgBytes: data.bytes === null ? null : Math.round(data.bytes / data.count),
        namespace: data.namespace,
        parentSpanId: data.parentSpanId
      };
    }).sort((a, b) => (b.totalBytes ?? -1) - (a.totalBytes ?? -1)).slice(0, 25);
    const namespaceTotals = /* @__PURE__ */ new Map();
    for (const alloc of allocations) {
      const ns = alloc.namespace || "default";
      const aggregate = namespaceTotals.get(ns) ?? { totalBytes: 0, count: 0 };
      aggregate.totalBytes = addExactBytes(aggregate.totalBytes, alloc.bytes);
      aggregate.count += 1;
      namespaceTotals.set(ns, aggregate);
    }
    const byNamespace = Object.fromEntries(namespaceTotals);
    const byPhase = executionPhases.map((phase, index) => {
      const phaseStart = phase.timing.startNs;
      const phaseEnd = phase.timing.endNs ?? phaseStart;
      const nextPhaseStart = executionPhases[index + 1]?.timing.startNs ?? null;
      let allocatedBytes = 0;
      let allocationCount = 0;
      for (const alloc of allocations) {
        if (alloc.timestampNs >= phaseStart && (nextPhaseStart === null ? alloc.timestampNs <= phaseEnd : alloc.timestampNs < nextPhaseStart)) {
          allocatedBytes = addExactBytes(allocatedBytes, alloc.bytes);
          allocationCount += 1;
        }
      }
      return {
        phaseId: phase.id,
        phaseLabel: phase.label,
        allocatedBytes,
        allocationCount
      };
    });
    return {
      totalAllocatedBytes,
      totalDeallocatedBytes,
      netAllocatedBytes: exactDifference(
        totalAllocatedBytes,
        totalDeallocatedBytes
      ),
      allocationCount: allocations.length,
      deallocationCount: deallocations.length,
      peakCumulativeBytes: peakBytes,
      peakTimestampNs,
      hotspotsByLine,
      watermarkSamples,
      byNamespace,
      byPhase
    };
  }
  function firstPointAtOrAfter(trajectory, timestampNs) {
    let low = 0;
    let high = trajectory.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (trajectory[middle].timestampNs < timestampNs) low = middle + 1;
      else high = middle;
    }
    return trajectory[low];
  }
  function buildGovernorBurnRate(snapshotsRaw, allEvents, executionPhases, durationMs, governorLimits) {
    const trajectory = [];
    for (const snap of snapshotsRaw) {
      if (!isRecord2(snap)) continue;
      const ts = asNumber2(readPath2(snap, ["timestamp"])) ?? 0;
      const ns = asString2(readPath2(snap, ["namespace"])) ?? "default";
      const limits = readPath2(snap, ["limits"]);
      if (!isRecord2(limits)) continue;
      const soqlQ = readPath2(limits, ["soqlQueries"]);
      const queryRows = readPath2(limits, ["queryRows"]);
      const dmlS = readPath2(limits, ["dmlStatements"]);
      const dmlR = readPath2(limits, ["dmlRows"]);
      const cpuT = readPath2(limits, ["cpuTime"]);
      const heapS = readPath2(limits, ["heapSize"]);
      const callouts = readPath2(limits, ["callouts"]);
      const futureCalls = readPath2(limits, ["futureCalls"]);
      const queueables = readPath2(limits, ["queueableJobsAddedToQueue"]);
      trajectory.push({
        timestampNs: ts,
        namespace: ns,
        soqlUsed: isRecord2(soqlQ) ? asNumber2(soqlQ.used) ?? null : null,
        soqlRowsUsed: isRecord2(queryRows) ? asNumber2(queryRows.used) ?? null : null,
        dmlUsed: isRecord2(dmlS) ? asNumber2(dmlS.used) ?? null : null,
        dmlRowsUsed: isRecord2(dmlR) ? asNumber2(dmlR.used) ?? null : null,
        cpuUsed: isRecord2(cpuT) ? asNumber2(cpuT.used) ?? null : null,
        heapUsed: isRecord2(heapS) ? asNumber2(heapS.used) ?? null : null,
        calloutsUsed: isRecord2(callouts) ? asNumber2(callouts.used) ?? null : null,
        futureCallsUsed: isRecord2(futureCalls) ? asNumber2(futureCalls.used) ?? null : null,
        queueablesUsed: isRecord2(queueables) ? asNumber2(queueables.used) ?? null : null
      });
    }
    trajectory.sort((a, b) => a.timestampNs - b.timestampNs);
    const rateNamespace = trajectory.some(
      (point) => point.namespace === "default"
    ) ? "default" : trajectory[0]?.namespace;
    const rateTrajectory = rateNamespace ? trajectory.filter((point) => point.namespace === rateNamespace) : [];
    const first = rateTrajectory[0];
    const last = rateTrajectory[rateTrajectory.length - 1];
    const burnRates = [];
    if (first && last && isRecord2(governorLimits)) {
      const elapsedNs = last.timestampNs - first.timestampNs;
      const elapsedSec = elapsedNs > 0 ? elapsedNs / 1e9 : null;
      const limitDefs = [
        {
          name: "soqlQueries",
          firstUsed: first.soqlUsed,
          lastUsed: last.soqlUsed,
          limitKey: "soqlQueries"
        },
        {
          name: "soqlRows",
          firstUsed: first.soqlRowsUsed,
          lastUsed: last.soqlRowsUsed,
          limitKey: "queryRows"
        },
        {
          name: "dmlStatements",
          firstUsed: first.dmlUsed,
          lastUsed: last.dmlUsed,
          limitKey: "dmlStatements"
        },
        {
          name: "dmlRows",
          firstUsed: first.dmlRowsUsed,
          lastUsed: last.dmlRowsUsed,
          limitKey: "dmlRows"
        },
        {
          name: "cpuTime",
          firstUsed: first.cpuUsed,
          lastUsed: last.cpuUsed,
          limitKey: "cpuTime"
        },
        {
          name: "heapSize",
          firstUsed: first.heapUsed,
          lastUsed: last.heapUsed,
          limitKey: "heapSize"
        },
        {
          name: "callouts",
          firstUsed: first.calloutsUsed,
          lastUsed: last.calloutsUsed,
          limitKey: "callouts"
        },
        {
          name: "futureCalls",
          firstUsed: first.futureCallsUsed,
          lastUsed: last.futureCallsUsed,
          limitKey: "futureCalls"
        },
        {
          name: "queueableJobsAddedToQueue",
          firstUsed: first.queueablesUsed,
          lastUsed: last.queueablesUsed,
          limitKey: "queueableJobsAddedToQueue"
        }
      ];
      for (const def of limitDefs) {
        const limObj = readPath2(governorLimits, [def.limitKey]);
        const max = isRecord2(limObj) ? asNumber2(limObj.limit) ?? null : null;
        const used = def.lastUsed;
        const pctUsed = used !== null && max !== null && max > 0 ? Math.round(used / max * 1e4) / 100 : null;
        let burnRatePerSec = null;
        let projectedHeadroom = null;
        if (elapsedSec !== null && def.firstUsed !== null && def.lastUsed !== null && def.lastUsed >= def.firstUsed) {
          const delta = def.lastUsed - def.firstUsed;
          burnRatePerSec = Math.round(delta / elapsedSec * 1e3) / 1e3;
          if (max !== null && burnRatePerSec > 0) {
            const remaining = Math.max(0, max - def.lastUsed);
            const raw = remaining / burnRatePerSec;
            projectedHeadroom = Number.isFinite(raw) ? Math.min(Math.round(raw * 1e3) / 1e3, 999999) : null;
          }
        }
        const status = pctUsed === null ? "unknown" : pctUsed >= 95 ? "critical" : pctUsed >= 80 ? "warn" : "ok";
        burnRates.push({
          limitName: def.name,
          used,
          max,
          pctUsed,
          burnRatePerSec,
          projectedHeadroom,
          status
        });
      }
    }
    const byNamespace = /* @__PURE__ */ Object.create(null);
    for (const point of trajectory) {
      const ns = point.namespace;
      if (!byNamespace[ns]) {
        byNamespace[ns] = {
          soqlUsed: point.soqlUsed ?? null,
          soqlRowsUsed: point.soqlRowsUsed ?? null,
          dmlUsed: point.dmlUsed ?? null,
          dmlRowsUsed: point.dmlRowsUsed ?? null,
          cpuUsed: point.cpuUsed ?? null,
          heapUsed: point.heapUsed ?? null,
          calloutsUsed: point.calloutsUsed ?? null,
          futureCallsUsed: point.futureCallsUsed ?? null,
          queueablesUsed: point.queueablesUsed ?? null
        };
      } else {
        const existing = byNamespace[ns];
        if (point.soqlUsed !== null) existing.soqlUsed = point.soqlUsed;
        if (point.soqlRowsUsed !== null)
          existing.soqlRowsUsed = point.soqlRowsUsed;
        if (point.dmlUsed !== null) existing.dmlUsed = point.dmlUsed;
        if (point.dmlRowsUsed !== null) existing.dmlRowsUsed = point.dmlRowsUsed;
        if (point.cpuUsed !== null) existing.cpuUsed = point.cpuUsed;
        if (point.heapUsed !== null) existing.heapUsed = point.heapUsed;
        if (point.calloutsUsed !== null)
          existing.calloutsUsed = point.calloutsUsed;
        if (point.futureCallsUsed !== null)
          existing.futureCallsUsed = point.futureCallsUsed;
        if (point.queueablesUsed !== null)
          existing.queueablesUsed = point.queueablesUsed;
      }
    }
    const phaseHeadroom = [];
    const totalPhases = executionPhases.length;
    for (let i = 0; i < totalPhases; i++) {
      const phase = executionPhases[i];
      const phaseEndNs = phase.timing.endNs ?? phase.timing.startNs;
      const closestPoint = firstPointAtOrAfter(rateTrajectory, phaseEndNs) ?? last;
      if (!closestPoint || !isRecord2(governorLimits)) {
        phaseHeadroom.push({
          phaseId: phase.id,
          phaseLabel: phase.label,
          soqlPctAfter: null,
          soqlRowsPctAfter: null,
          dmlPctAfter: null,
          cpuPctAfter: null,
          heapPctAfter: null,
          calloutsPctAfter: null,
          futureCallsPctAfter: null,
          queueablesPctAfter: null,
          phasesRemaining: totalPhases - i - 1,
          warning: null
        });
        continue;
      }
      const pctOf = (used, limitKey) => {
        if (used === null) return null;
        const limObj = readPath2(governorLimits, [limitKey]);
        const max = isRecord2(limObj) ? asNumber2(limObj.limit) ?? null : null;
        if (max === null || max <= 0) return null;
        return Math.round(used / max * 1e4) / 100;
      };
      const soqlPct = pctOf(closestPoint.soqlUsed, "soqlQueries");
      const soqlRowsPct = pctOf(closestPoint.soqlRowsUsed, "queryRows");
      const dmlPct = pctOf(closestPoint.dmlUsed, "dmlStatements");
      const cpuPct = pctOf(closestPoint.cpuUsed, "cpuTime");
      const heapPct = pctOf(closestPoint.heapUsed, "heapSize");
      const calloutsPct = pctOf(closestPoint.calloutsUsed, "callouts");
      const futureCallsPct = pctOf(closestPoint.futureCallsUsed, "futureCalls");
      const queueablesPct = pctOf(
        closestPoint.queueablesUsed,
        "queueableJobsAddedToQueue"
      );
      const phasesRemaining = totalPhases - i - 1;
      let warning = null;
      const criticalPcts = [
        soqlPct,
        soqlRowsPct,
        dmlPct,
        cpuPct,
        heapPct,
        calloutsPct,
        futureCallsPct,
        queueablesPct
      ].filter((p) => p !== null && p >= 80);
      if (criticalPcts.length > 0 && phasesRemaining > 0) {
        warning = `${criticalPcts.length} limit(s) at \u226580% with ${phasesRemaining} phase(s) remaining`;
      }
      phaseHeadroom.push({
        phaseId: phase.id,
        phaseLabel: phase.label,
        soqlPctAfter: soqlPct,
        soqlRowsPctAfter: soqlRowsPct,
        dmlPctAfter: dmlPct,
        cpuPctAfter: cpuPct,
        heapPctAfter: heapPct,
        calloutsPctAfter: calloutsPct,
        futureCallsPctAfter: futureCallsPct,
        queueablesPctAfter: queueablesPct,
        phasesRemaining,
        warning
      });
    }
    return { trajectory, burnRates, byNamespace, phaseHeadroom };
  }
  function addKnownFinite(current, value) {
    if (current === null || value === null || !Number.isFinite(current) || !Number.isFinite(value) || current < 0 || value < 0)
      return null;
    const total = current + value;
    return Number.isFinite(total) && total >= 0 ? total : null;
  }
  function addKnownSafeInteger(current, value) {
    if (current === null || value === null || !Number.isSafeInteger(current) || !Number.isSafeInteger(value) || current < 0 || value < 0)
      return null;
    const total = current + value;
    return Number.isSafeInteger(total) && total >= 0 ? total : null;
  }
  function assessDebugLevelQuality(parserResult) {
    const debugLevelsRaw = asArray(readPath2(parserResult, ["debugLevels"]));
    const levelsByCategory = /* @__PURE__ */ new Map();
    for (const entry of debugLevelsRaw) {
      const category = (asString2(readPath2(entry, ["logCategory"])) ?? "").trim();
      if (!category) continue;
      const level = (asString2(readPath2(entry, ["logLevel"])) ?? "").trim();
      levelsByCategory.set(category.toUpperCase(), { category, level });
    }
    const levels = [...levelsByCategory.values()];
    const warnings = [];
    const levelRank = /* @__PURE__ */ new Map([
      ["NONE", 0],
      ["ERROR", 1],
      ["WARN", 2],
      ["INFO", 3],
      ["DEBUG", 4],
      ["FINE", 5],
      ["FINER", 6],
      ["FINEST", 7]
    ]);
    const getLevelRank = (level) => levelRank.get(level.toUpperCase()) ?? 0;
    for (const entry of levels) {
      const cat = entry.category.toUpperCase();
      const rank = getLevelRank(entry.level);
      if (cat === "CALLOUT" && rank < 5) {
        warnings.push({
          category: entry.category,
          currentLevel: entry.level,
          recommendation: "Set Callout to FINE or FINER for request/response detail",
          impact: "Callout URLs, HTTP methods, and response codes are not captured at INFO level"
        });
      }
      if (cat === "APEX_CODE" && rank < 5) {
        warnings.push({
          category: entry.category,
          currentLevel: entry.level,
          recommendation: "Set Apex Code to FINE+ for method entry/exit and variable assignments",
          impact: "Method-level timing, variable values, and execution flow are limited"
        });
      }
      if (cat === "DATABASE" && rank < 5) {
        warnings.push({
          category: entry.category,
          currentLevel: entry.level,
          recommendation: "Set Database to FINE+ for SOQL explain plans and DML detail",
          impact: "Query explain plans and row-level DML detail are not available"
        });
      }
      if (cat === "SYSTEM" && rank < 5) {
        warnings.push({
          category: entry.category,
          currentLevel: entry.level,
          recommendation: "Set System to FINE+ for system method entry/exit events",
          impact: "System method timing data is incomplete"
        });
      }
      if (cat === "VALIDATION" && rank < 3) {
        warnings.push({
          category: entry.category,
          currentLevel: entry.level,
          recommendation: "Set Validation to INFO+ for validation rule evaluation details",
          impact: "Validation rule formulas and outcomes are not captured"
        });
      }
      if (cat === "WORKFLOW" && rank < 3) {
        warnings.push({
          category: entry.category,
          currentLevel: entry.level,
          recommendation: "Set Workflow to INFO+ for workflow rule and process builder detail",
          impact: "Workflow rule evaluation and field update details are missing"
        });
      }
      if (cat === "DATA_ACCESS" && rank === 0) {
        warnings.push({
          category: entry.category,
          currentLevel: entry.level,
          recommendation: "Set Data Access to INFO+ if you need sharing/FLS evaluation details",
          impact: "Data access and sharing-related events are completely suppressed"
        });
      }
    }
    if (!levelsByCategory.has("APEX_CODE")) {
      warnings.push({
        category: "APEX_CODE",
        currentLevel: "Not configured",
        recommendation: "Set Apex Code to FINE+ for method entry/exit and variable assignments",
        impact: "Apex Code debug-level evidence is missing, so method and variable coverage cannot be verified"
      });
    }
    if (!levelsByCategory.has("DATABASE")) {
      warnings.push({
        category: "DATABASE",
        currentLevel: "Not configured",
        recommendation: "Set Database to FINE+ for SOQL explain plans and DML detail",
        impact: "Database debug-level evidence is missing, so query and DML coverage cannot be verified"
      });
    }
    const apexLevel = levelsByCategory.get("APEX_CODE");
    const dbLevel = levelsByCategory.get("DATABASE");
    const apexRank = apexLevel ? getLevelRank(apexLevel.level) : 0;
    const dbRank = dbLevel ? getLevelRank(dbLevel.level) : 0;
    let overallQuality = "low";
    if (apexRank >= 7 && dbRank >= 7) {
      overallQuality = "high";
    } else if (apexRank >= 5 && dbRank >= 5) {
      overallQuality = "medium";
    }
    return { levels, warnings, overallQuality };
  }
  function buildCpuAttribution(spans) {
    const byType = /* @__PURE__ */ new Map();
    const byNamespace = /* @__PURE__ */ new Map();
    for (const span of spans) {
      const cpuKey = span.cpuType || "unknown";
      const typeAggregate = byType.get(cpuKey) ?? { durationMs: 0, count: 0 };
      typeAggregate.durationMs = addKnownFinite(
        typeAggregate.durationMs,
        span.selfDurationMs
      );
      typeAggregate.count += 1;
      byType.set(cpuKey, typeAggregate);
      const ns = span.namespace || "default";
      const namespaceAggregate = byNamespace.get(ns) ?? {
        selfDurationMs: 0,
        totalDurationMs: 0,
        spanCount: 0
      };
      namespaceAggregate.selfDurationMs = addKnownFinite(
        namespaceAggregate.selfDurationMs,
        span.selfDurationMs
      );
      namespaceAggregate.totalDurationMs = addKnownFinite(
        namespaceAggregate.totalDurationMs,
        span.durationMs
      );
      namespaceAggregate.spanCount += 1;
      byNamespace.set(ns, namespaceAggregate);
    }
    for (const entry of byType.values()) {
      if (entry.durationMs !== null) {
        entry.durationMs = Math.round(entry.durationMs * 1e3) / 1e3;
      }
    }
    for (const entry of byNamespace.values()) {
      if (entry.selfDurationMs !== null) {
        entry.selfDurationMs = Math.round(entry.selfDurationMs * 1e3) / 1e3;
      }
      if (entry.totalDurationMs !== null) {
        entry.totalDurationMs = Math.round(entry.totalDurationMs * 1e3) / 1e3;
      }
    }
    return {
      byType: Object.fromEntries(byType),
      byNamespace: Object.fromEntries(byNamespace)
    };
  }
  function buildManagedPackageImpact(namespaces, spans, allEvents, totalDurationMs) {
    const packages = /* @__PURE__ */ new Set();
    for (const namespace of namespaces) {
      if (namespace !== "default") packages.add(namespace);
    }
    if (packages.size === 0) return [];
    const byNamespace = /* @__PURE__ */ new Map();
    for (const namespace of packages) {
      byNamespace.set(namespace, {
        spanCount: 0,
        totalDurationMs: 0,
        selfDurationMs: 0,
        soqlCount: 0,
        soqlRows: 0,
        dmlCount: 0,
        dmlRows: 0
      });
    }
    for (const span of spans) {
      const aggregate = byNamespace.get(span.namespace);
      if (!aggregate) continue;
      aggregate.spanCount += 1;
      aggregate.totalDurationMs = addKnownFinite(
        aggregate.totalDurationMs,
        span.durationMs
      );
      aggregate.selfDurationMs = addKnownFinite(
        aggregate.selfDurationMs,
        span.selfDurationMs
      );
    }
    for (const event of allEvents) {
      const aggregate = byNamespace.get(event.namespace);
      if (!aggregate) continue;
      if (event.type === "SOQL_EXECUTE_BEGIN") {
        aggregate.soqlCount += 1;
        aggregate.soqlRows = addKnownSafeInteger(
          aggregate.soqlRows,
          event.pairingStatus === "complete" ? event.soqlRowCountTotal : null
        );
      } else if (event.type === "DML_BEGIN") {
        aggregate.dmlCount += 1;
        aggregate.dmlRows = addKnownSafeInteger(
          aggregate.dmlRows,
          event.pairingStatus === "complete" ? event.dmlRowCountTotal : null
        );
      }
    }
    return Array.from(byNamespace, ([namespace, aggregate]) => {
      const totalDuration = aggregate.totalDurationMs;
      return {
        namespace,
        spanCount: aggregate.spanCount,
        totalDurationMs: totalDuration === null ? null : Math.round(totalDuration * 1e3) / 1e3,
        selfDurationMs: aggregate.selfDurationMs === null ? null : Math.round(aggregate.selfDurationMs * 1e3) / 1e3,
        soqlCount: aggregate.soqlCount,
        soqlRows: aggregate.soqlRows,
        dmlCount: aggregate.dmlCount,
        dmlRows: aggregate.dmlRows,
        pctOfTotalDuration: totalDuration !== null && totalDurationMs !== null && totalDurationMs > 0 ? Math.round(totalDuration / totalDurationMs * 1e4) / 100 : null
      };
    }).sort(
      (left, right) => (right.totalDurationMs ?? -1) - (left.totalDurationMs ?? -1)
    );
  }
  function sumExactRows(entries) {
    let total = 0;
    for (const entry of entries) {
      if (entry.rows === null) return null;
      total += entry.rows;
      if (!Number.isSafeInteger(total)) return null;
    }
    return total;
  }
  function findPhaseIndex(phaseStarts, finalPhaseEndNs, timestampNs) {
    let low = 0;
    let high = phaseStarts.length - 1;
    let result = -1;
    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2);
      if (phaseStarts[middle] <= timestampNs) {
        result = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (result === phaseStarts.length - 1 && timestampNs > finalPhaseEndNs) {
      return -1;
    }
    return result;
  }
  function createPhaseBuckets(phaseCount) {
    return Array.from({ length: phaseCount }, () => []);
  }
  function buildExecutionPhases(spans, databaseSoql, databaseDml, variableAssignments, allEvents, snapshotsRaw, totalDurationMs, prefixMap) {
    const rootSpan = spans.find((s) => s.eventType === "CODE_UNIT_STARTED");
    if (!rootSpan) return [];
    const directChildren = spans.filter(
      (s) => s.parentId === rootSpan.id && (s.eventType.startsWith("METHOD_") || s.eventType.startsWith("CONSTRUCTOR_"))
    );
    let phaseSpans;
    let parentLabel;
    if (directChildren.length === 1) {
      const executeSpan = directChildren[0];
      parentLabel = executeSpan.label;
      phaseSpans = spans.filter(
        (s) => s.parentId === executeSpan.id && (s.eventType.startsWith("METHOD_") || s.eventType.startsWith("CONSTRUCTOR_") || s.eventType === "SOQL_EXECUTE_BEGIN" || s.eventType === "DML_BEGIN")
      );
      if (phaseSpans.length === 0) {
        phaseSpans = directChildren;
        parentLabel = rootSpan.label;
      }
    } else {
      phaseSpans = directChildren;
      parentLabel = rootSpan.label;
    }
    const parentClassName = parentLabel.split(".")[0]?.replace(/^.*?[\\/]/, "") ?? null;
    const limitTimeline = buildLimitTimeline(snapshotsRaw);
    phaseSpans.sort((a, b) => a.startNs - b.startNs);
    const vaEventQueues = /* @__PURE__ */ new Map();
    for (const event of allEvents) {
      if (event.type !== "VARIABLE_ASSIGNMENT") continue;
      const sep = event.text.indexOf("|");
      const name = sep !== -1 ? event.text.slice(0, sep) : event.text;
      if (!vaEventQueues.has(name)) vaEventQueues.set(name, []);
      vaEventQueues.get(name).push(event);
    }
    const vaByTimestamp = variableAssignments.map((va) => {
      const queue = vaEventQueues.get(va.variableName) ?? [];
      const event = queue.shift();
      return {
        ...va,
        timestampNs: event?.timestampNs ?? null,
        lineNumber: event?.lineNumber ?? null
      };
    }).sort((a, b) => (a.timestampNs ?? 0) - (b.timestampNs ?? 0));
    const phaseStarts = phaseSpans.map((span) => span.startNs);
    const finalPhase = phaseSpans.at(-1);
    const finalPhaseEndNs = finalPhase ? finalPhase.endNs ?? finalPhase.startNs + 1e9 : 0;
    const soqlByPhase = createPhaseBuckets(phaseSpans.length);
    const dmlByPhase = createPhaseBuckets(phaseSpans.length);
    const vaByPhase = createPhaseBuckets(
      phaseSpans.length
    );
    for (const query of databaseSoql) {
      const timestampNs = query.evidence.timestampNs;
      if (timestampNs === null) continue;
      const phaseIndex = findPhaseIndex(
        phaseStarts,
        finalPhaseEndNs,
        timestampNs
      );
      if (phaseIndex >= 0) soqlByPhase[phaseIndex].push(query);
    }
    for (const operation of databaseDml) {
      const timestampNs = operation.evidence.timestampNs;
      if (operation.source !== "event" || timestampNs === null) continue;
      const phaseIndex = findPhaseIndex(
        phaseStarts,
        finalPhaseEndNs,
        timestampNs
      );
      if (phaseIndex >= 0) dmlByPhase[phaseIndex].push(operation);
    }
    for (const assignment of vaByTimestamp) {
      if (assignment.timestampNs === null) continue;
      const phaseIndex = findPhaseIndex(
        phaseStarts,
        finalPhaseEndNs,
        assignment.timestampNs
      );
      if (phaseIndex >= 0) vaByPhase[phaseIndex].push(assignment);
    }
    const seenIdsBefore = /* @__PURE__ */ new Set();
    return phaseSpans.map((span, index) => {
      const phaseStartNs = span.startNs;
      const nextPhaseStart = index < phaseSpans.length - 1 ? phaseSpans[index + 1].startNs : null;
      const phaseEndNs = span.endNs ?? nextPhaseStart ?? phaseStartNs + 1e9;
      const soqlInPhase = soqlByPhase[index];
      const dmlInPhase = dmlByPhase[index];
      const totalSoqlRows = sumExactRows(soqlInPhase);
      const totalDmlRows = sumExactRows(dmlInPhase);
      const govDelta = computeGovernorDelta(
        limitTimeline,
        phaseStartNs,
        phaseEndNs
      );
      const vasInPhase = vaByPhase[index];
      const phaseIds = /* @__PURE__ */ new Set();
      const emptyResults = [];
      const significantAssignments = [];
      for (const va of vasInPhase) {
        collectSalesforceIds(va.parsedValue ?? va.rawValue, phaseIds);
        if (va.isEmptyCollection && /^map/i.test(va.variableName)) {
          emptyResults.push(va.variableName);
        }
        if (isRecord2(va.parsedValue) && Object.keys(va.parsedValue).length > 0) {
          const keys = Object.keys(va.parsedValue);
          const recordCount = keys.length;
          const firstVal = Object.values(va.parsedValue)[0];
          const firstKey = keys[0];
          const looksLikeRecordMap = isRecord2(firstVal) || typeof firstKey === "string" && firstKey.length >= 15;
          if (looksLikeRecordMap) {
            significantAssignments.push({
              variableName: va.variableName,
              sObjectType: inferSObjectFromVarName(va.variableName),
              recordCount,
              timestampNs: va.timestampNs
            });
          }
        }
      }
      const inputIds = Array.from(phaseIds).filter((id) => seenIdsBefore.has(id));
      const outputIds = Array.from(phaseIds).filter(
        (id) => !seenIdsBefore.has(id)
      );
      for (const id of phaseIds) seenIdsBefore.add(id);
      const warnings = [];
      for (const q of soqlInPhase) {
        const qFindings = [];
        if (q.rows === 0) qFindings.push("returned 0 rows");
        if ((q.durationMs ?? 0) >= 50)
          qFindings.push(`took ${q.durationMs?.toFixed(1)}ms`);
        if (q.explain?.available === false) qFindings.push("no explain plan");
        if (qFindings.length > 0) {
          warnings.push(
            `SOQL on ${q.targetObject ?? "unknown"}: ${qFindings.join(", ")}`
          );
        }
      }
      if (emptyResults.length > 0) {
        warnings.push(`Empty result maps: ${emptyResults.join(", ")}`);
      }
      const phaseDmlNoOp = dmlInPhase.find(
        (d) => d.operation?.toLowerCase() === "update" && d.durationMs === 0 && d.rows === 0
      );
      if (phaseDmlNoOp) {
        warnings.push(
          `DML update on ${phaseDmlNoOp.sObject ?? "unknown"} was a no-op`
        );
      }
      const childPhaseIds = spans.filter(
        (s) => s.parentId === span.id && (s.eventType.startsWith("METHOD_") || s.eventType.startsWith("CONSTRUCTOR_"))
      ).map((s) => s.id);
      return {
        id: span.id,
        label: span.label,
        phaseIndex: index,
        calledFrom: {
          className: parentClassName,
          lineNumber: span.evidence.lineNumber
        },
        timing: {
          startNs: phaseStartNs,
          endNs: phaseEndNs,
          durationMs: span.durationMs,
          selfDurationMs: span.selfDurationMs,
          pctOfTotal: totalDurationMs !== null && totalDurationMs > 0 && span.durationMs !== null ? Math.round(span.durationMs / totalDurationMs * 1e4) / 100 : null
        },
        database: {
          soqlInPhase: soqlInPhase.map((q) => ({
            id: q.id,
            targetObject: q.targetObject,
            rows: q.rows,
            durationMs: q.durationMs,
            explain: q.explain
          })),
          dmlInPhase: dmlInPhase.map((d) => ({
            id: d.id,
            operation: d.operation,
            sObject: d.sObject,
            rows: d.rows,
            durationMs: d.durationMs
          })),
          totalSoqlRows,
          totalDmlRows
        },
        governorDelta: govDelta,
        dataFlow: {
          inputIds: inputIds.slice(0, 50),
          outputIds: outputIds.slice(0, 50),
          recordsProcessed: phaseIds.size,
          emptyResults,
          significantAssignments
        },
        warnings,
        childPhaseIds
      };
    });
  }
  function collectSalesforceIds(value, out) {
    const stack = [value];
    const visited = /* @__PURE__ */ new WeakSet();
    while (stack.length > 0) {
      const current = stack.pop();
      if (typeof current === "string") {
        const matches = current.match(new RegExp(SALESFORCE_ID_RE.source, "g"));
        if (matches) {
          for (const id of matches) {
            if (/\d/.test(id)) out.add(id);
          }
        }
        continue;
      }
      if (Array.isArray(current)) {
        if (visited.has(current)) continue;
        visited.add(current);
        for (let index = current.length - 1; index >= 0; index -= 1) {
          stack.push(current[index]);
        }
        continue;
      }
      if (isRecord2(current)) {
        if (visited.has(current)) continue;
        visited.add(current);
        for (const [key, nestedValue] of Object.entries(current)) {
          stack.push(nestedValue, key);
        }
      }
    }
  }
  function detectExecutionContext(rootCodeUnit, allEvents, variableAssignments) {
    const root = String(rootCodeUnit || "").toLowerCase();
    let anonymousEvent = false;
    let futureEvent = false;
    let queueableEvent = false;
    let batchEvent = false;
    let platformEvent = false;
    let triggerEvent = false;
    let scheduledEvent = false;
    for (const event of allEvents) {
      const text = event.text || "";
      if (event.type === "CODE_UNIT_STARTED") {
        anonymousEvent ||= /execute_anonymous_apex|execute anonymous/i.test(text);
        scheduledEvent ||= /\bschedulable\b|scheduled\s+apex/i.test(text);
        platformEvent ||= /platform event|__e\b/i.test(text);
        triggerEvent ||= /\btrigger event\b/i.test(text);
      }
      futureEvent ||= event.type === "FUTURE_METHOD_BEGIN";
      queueableEvent ||= event.type === "QUEUEABLE_BEGIN" || event.type === "SYSTEM_METHOD_ENTRY" && /QueueableContextImpl/i.test(text);
      batchEvent ||= event.type === "BATCH_APEX_START_BEGIN" || event.type === "BATCH_APEX_EXECUTE_BEGIN";
      platformEvent ||= event.type.startsWith("EVENT_SERVICE_") && /__e\b|platform event/i.test(text);
    }
    if (/execute_anonymous_apex|execute anonymous/i.test(root) || anonymousEvent) {
      return {
        type: "anonymous_apex",
        label: "Anonymous Apex",
        confidence: "direct",
        signals: ["CODE_UNIT_STARTED text contains execute anonymous"],
        contextSource: "auto",
        phaseModel: "anonymous"
      };
    }
    if (futureEvent) {
      return {
        type: "future_method",
        label: "Future Method",
        confidence: "direct",
        signals: ["FUTURE_METHOD_BEGIN event found"],
        contextSource: "auto",
        phaseModel: "async"
      };
    }
    if (queueableEvent) {
      return {
        type: "queueable",
        label: "Queueable Apex",
        confidence: "direct",
        signals: [
          "QUEUEABLE_BEGIN event found or SYSTEM_METHOD_ENTRY with QueueableContextImpl"
        ],
        contextSource: "auto",
        phaseModel: "async"
      };
    }
    if (batchEvent) {
      return {
        type: "batch_execute",
        label: "Batch Apex",
        confidence: "direct",
        signals: [
          "BATCH_APEX_START_BEGIN or BATCH_APEX_EXECUTE_BEGIN event found"
        ],
        contextSource: "auto",
        phaseModel: "batch"
      };
    }
    if (platformEvent) {
      return {
        type: "platform_event",
        label: "Platform Event",
        confidence: "direct",
        signals: [
          "CODE_UNIT_STARTED/EVENT_SERVICE_* indicates platform event context"
        ],
        contextSource: "auto",
        phaseModel: "trigger"
      };
    }
    if (/\btrigger event\b/i.test(root) || triggerEvent) {
      return {
        type: "synchronous_trigger",
        label: "Trigger",
        confidence: "direct",
        signals: ["rootCodeUnit or CODE_UNIT_STARTED contains trigger event"],
        contextSource: "auto",
        phaseModel: "trigger"
      };
    }
    if (/(?:schedulable|scheduledapex)(?:[.$]|$)/i.test(root) || scheduledEvent) {
      return {
        type: "scheduled",
        label: "Scheduled Apex",
        confidence: "derived",
        signals: [
          "rootCodeUnit or CODE_UNIT_STARTED contains Schedulable/Scheduled"
        ],
        contextSource: "auto",
        phaseModel: "scheduled"
      };
    }
    if (variableAssignments.some(
      (variable) => variable.variableName === "scope" && (Array.isArray(variable.parsedValue) || typeof variable.parsedValue === "object" && variable.parsedValue !== null)
    ) || /batch(?:able)?(?:[.$]|$)/i.test(root)) {
      return {
        type: "batch_execute",
        label: "Batch Apex",
        confidence: "derived",
        signals: ["scope variable assignment or batch in root code unit name"],
        contextSource: "auto",
        phaseModel: "batch"
      };
    }
    return {
      type: "apex_class",
      label: "Apex Class",
      confidence: "derived",
      signals: ["no specific context signals found, defaulting to Apex Class"],
      contextSource: "auto",
      phaseModel: "trigger"
    };
  }
  var CONTEXT_TYPE_LABELS = {
    anonymous_apex: "Anonymous Apex",
    queueable: "Queueable Apex",
    future_method: "Future Method",
    batch_execute: "Batch Apex",
    scheduled: "Scheduled Apex",
    platform_event: "Platform Event",
    synchronous_trigger: "Trigger",
    apex_class: "Apex Class"
  };
  var CONTEXT_TO_PHASE_MODEL = {
    anonymous_apex: "anonymous",
    future_method: "async",
    queueable: "async",
    scheduled: "scheduled",
    batch_execute: "batch",
    platform_event: "trigger",
    synchronous_trigger: "trigger",
    apex_class: "trigger",
    unknown: "trigger"
  };
  function buildContextOverride(contextValue) {
    if (!Object.hasOwn(CONTEXT_TYPE_LABELS, contextValue)) return null;
    const label = CONTEXT_TYPE_LABELS[contextValue];
    if (!label) return null;
    return {
      type: contextValue,
      label,
      confidence: "override",
      signals: [`--context flag: ${contextValue}`],
      contextSource: "override",
      phaseModel: CONTEXT_TO_PHASE_MODEL[contextValue] ?? "trigger"
    };
  }
  var VALID_CONTEXT_VALUES = Object.keys(CONTEXT_TYPE_LABELS);
  var SETUP_SOBJECTS = /* @__PURE__ */ new Set([
    "user",
    "userrole",
    "profile",
    "permissionset",
    "permissionsetassignment",
    "groupmember",
    "queuesobject",
    "objectpermissions",
    "fieldpermissions",
    "setupentityaccess",
    "permissionsetlicenseassign",
    "userpermissionaccess",
    "packagelicense",
    "userpackagelicense"
  ]);
  function isSetupSObject(sObject) {
    const normalized = sObject.toLowerCase().trim();
    if (normalized.endsWith("__c")) return false;
    return SETUP_SOBJECTS.has(normalized);
  }
  function detectMixedDml(databaseDml) {
    const eventDml = databaseDml.filter(
      (d) => d.source === "event" && d.sObject !== null
    );
    const setupEntries = eventDml.filter((d) => isSetupSObject(d.sObject));
    const nonSetupEntries = eventDml.filter((d) => !isSetupSObject(d.sObject));
    if (setupEntries.length === 0 || nonSetupEntries.length === 0) {
      return {
        detected: false,
        setupObjects: [],
        nonSetupObjects: [],
        evidence: []
      };
    }
    return {
      detected: true,
      setupObjects: [...new Set(setupEntries.map((d) => d.sObject))],
      nonSetupObjects: [...new Set(nonSetupEntries.map((d) => d.sObject))],
      evidence: [...setupEntries, ...nonSetupEntries].slice(0, 6).map((d) => ({
        lineNumber: d.evidence.lineNumber,
        timestampNs: d.evidence.timestampNs,
        sObject: d.sObject
      }))
    };
  }
  function extractTriggerName(label) {
    const sfdc = label.match(/__sfdc_trigger\/[^/]+\/([^/\s]+)/);
    if (sfdc?.[1]) return sfdc[1];
    const triggerEvent = label.match(/^([^\s]+)\s+on\s+\S+\s+trigger/i);
    if (triggerEvent?.[1]) return triggerEvent[1];
    return label.split(" ")[0] ?? label;
  }
  function detectRecursiveTriggers(spans, limit = 50, evidenceLimit = 50) {
    const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 50;
    const normalizedEvidenceLimit = Number.isFinite(evidenceLimit) ? Math.max(0, Math.floor(evidenceLimit)) : 50;
    const triggerSpans = spans.filter(
      (s) => s.eventType === "CODE_UNIT_STARTED" && (String(s.label || "").includes("trigger event") || String(s.label || "").startsWith("__sfdc_trigger/"))
    );
    const byName = /* @__PURE__ */ new Map();
    for (const span of triggerSpans) {
      const key = extractTriggerName(
        String(span.label || "").trim()
      ).toLowerCase();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(span);
    }
    const parentOf = new Map(
      spans.map((s) => [s.id, s.parentId ?? null])
    );
    const recursive = [];
    let totalCount = 0;
    for (const [, group] of byName) {
      if (group.length <= 1) continue;
      const groupIds = new Set(group.map((span) => span.id));
      let hasNesting = false;
      for (const span of group) {
        let current = parentOf.get(span.id) ?? null;
        const seen = /* @__PURE__ */ new Set();
        while (current !== null && !seen.has(current)) {
          if (groupIds.has(current)) {
            hasNesting = true;
            break;
          }
          seen.add(current);
          current = parentOf.get(current) ?? null;
        }
        if (hasNesting) break;
      }
      if (!hasNesting) continue;
      totalCount += 1;
      const insertionIndex = recursive.findIndex(
        (entry2) => group.length > entry2.count
      );
      if (normalizedLimit === 0 || recursive.length >= normalizedLimit && insertionIndex === -1) {
        continue;
      }
      const retainedLineNumbers = /* @__PURE__ */ new Set();
      const retainedRawLogLineTexts = /* @__PURE__ */ new Set();
      let lineNumberEvidenceCount = 0;
      let rawLogLineTextEvidenceCount = 0;
      let lineNumbersTruncated = false;
      let rawLogLineTextsTruncated = false;
      for (const span of group) {
        const lineNumber = Number(span.evidence?.lineNumber);
        if (Number.isSafeInteger(lineNumber) && lineNumber >= 1) {
          lineNumberEvidenceCount += 1;
          if (!retainedLineNumbers.has(lineNumber)) {
            if (retainedLineNumbers.size < normalizedEvidenceLimit) {
              retainedLineNumbers.add(lineNumber);
            } else {
              lineNumbersTruncated = true;
            }
          }
        }
        const raw = span.evidence?.raw;
        if (raw) {
          rawLogLineTextEvidenceCount += 1;
          const boundedRaw = raw.length <= 2e3 ? raw : `${raw.slice(0, 1999)}\u2026`;
          if (!retainedRawLogLineTexts.has(boundedRaw)) {
            if (retainedRawLogLineTexts.size < normalizedEvidenceLimit) {
              retainedRawLogLineTexts.add(boundedRaw);
            } else {
              rawLogLineTextsTruncated = true;
            }
          }
        }
      }
      const lineNumbers = Array.from(retainedLineNumbers).sort((a, b) => a - b);
      const rawLogLineTexts = Array.from(retainedRawLogLineTexts);
      const entry = {
        triggerName: extractTriggerName(String(group[0].label || "").trim()),
        count: group.length,
        lineNumbers,
        rawLogLineTexts,
        evidenceMeta: {
          lineNumberCount: lineNumberEvidenceCount,
          rawLogLineTextCount: rawLogLineTextEvidenceCount,
          lineNumbersTruncated,
          rawLogLineTextsTruncated
        }
      };
      if (insertionIndex === -1) recursive.push(entry);
      else recursive.splice(insertionIndex, 0, entry);
      if (recursive.length > normalizedLimit) recursive.pop();
    }
    return {
      detected: totalCount > 0,
      meta: {
        totalCount,
        truncated: totalCount > normalizedLimit,
        limit: normalizedLimit,
        evidenceLimit: normalizedEvidenceLimit
      },
      recursiveTriggers: recursive
    };
  }
  function extractSystemModeTransitions(allEvents, spanIdByEventIdx) {
    const transitions = [];
    for (const event of allEvents) {
      if (event.type !== "SYSTEM_MODE_ENTER" && event.type !== "SYSTEM_MODE_EXIT")
        continue;
      const isEntering = event.type === "SYSTEM_MODE_ENTER";
      const modeValue = String(event.text || "").trim().toLowerCase();
      const isSystemMode = modeValue === "true";
      const enclosingSpanId = event.parentIdx !== null ? spanIdByEventIdx.get(event.parentIdx) ?? null : null;
      transitions.push({
        timestampNs: event.timestampNs,
        lineNumber: event.lineNumber,
        entering: isEntering,
        isSystemMode,
        enclosingSpanId
      });
    }
    return transitions;
  }
  var TRIGGER_CHILD_WINDOW_NS = 1e8;
  var MAX_CASCADE_DEPTH = 5;
  function isTriggerEvent(event) {
    return event.type === "CODE_UNIT_STARTED" && (event.text.includes("trigger event") || event.text.startsWith("__sfdc_trigger/"));
  }
  function buildTriggerCascade(allEvents, databaseDml, childLimit = 20) {
    const triggerEvents = allEvents.filter(isTriggerEvent);
    if (triggerEvents.length === 0) {
      return {
        cascades: [],
        meta: { totalRootTriggers: 0, maxDepth: 0, truncatedNodes: [] }
      };
    }
    const eventByIdx = new Map(allEvents.map((event) => [event.idx, event]));
    const triggerIdxSet = new Set(triggerEvents.map((event) => event.idx));
    const nearestTriggerAncestor = /* @__PURE__ */ new Map();
    const findNearestTriggerAncestor = (event) => {
      if (nearestTriggerAncestor.has(event.idx)) {
        return nearestTriggerAncestor.get(event.idx) ?? null;
      }
      const traversed = [];
      const seen = /* @__PURE__ */ new Set();
      let parentIdx = event.parentIdx;
      let owner = null;
      while (parentIdx !== null && !seen.has(parentIdx)) {
        seen.add(parentIdx);
        if (triggerIdxSet.has(parentIdx)) {
          owner = parentIdx;
          break;
        }
        if (nearestTriggerAncestor.has(parentIdx)) {
          owner = nearestTriggerAncestor.get(parentIdx) ?? null;
          break;
        }
        traversed.push(parentIdx);
        parentIdx = eventByIdx.get(parentIdx)?.parentIdx ?? null;
      }
      nearestTriggerAncestor.set(event.idx, owner);
      for (const idx of traversed) nearestTriggerAncestor.set(idx, owner);
      return owner;
    };
    for (const event of allEvents) findNearestTriggerAncestor(event);
    const childTriggersByOwner = /* @__PURE__ */ new Map();
    for (const trigger of triggerEvents) {
      const owner = findNearestTriggerAncestor(trigger);
      if (owner === null) continue;
      const children = childTriggersByOwner.get(owner) ?? [];
      children.push(trigger);
      childTriggersByOwner.set(owner, children);
    }
    const eventDml = databaseDml.filter((entry) => entry.source === "event");
    const dmlEvents = allEvents.filter((event) => event.type === "DML_BEGIN");
    const dmlByOwner = /* @__PURE__ */ new Map();
    for (let i = 0; i < Math.min(eventDml.length, dmlEvents.length); i += 1) {
      const owner = findNearestTriggerAncestor(dmlEvents[i]);
      if (owner === null) continue;
      const entries = dmlByOwner.get(owner) ?? [];
      entries.push(eventDml[i]);
      dmlByOwner.set(owner, entries);
    }
    const truncatedNodes = [];
    let maxDepthReached = 0;
    const buildNode = (triggerEvent, depth, visited) => {
      maxDepthReached = Math.max(maxDepthReached, depth);
      const nextVisited = new Set(visited).add(triggerEvent.idx);
      const ownedDml = [...dmlByOwner.get(triggerEvent.idx) ?? []].sort(
        (a, b) => (a.evidence.timestampNs ?? Number.MAX_SAFE_INTEGER) - (b.evidence.timestampNs ?? Number.MAX_SAFE_INTEGER)
      );
      const directChildren = [
        ...childTriggersByOwner.get(triggerEvent.idx) ?? []
      ].sort((a, b) => a.timestampNs - b.timestampNs);
      const childrenByDmlId = /* @__PURE__ */ new Map();
      let latestDmlIndex = -1;
      for (const child of directChildren) {
        if (nextVisited.has(child.idx)) continue;
        while (latestDmlIndex + 1 < ownedDml.length && (ownedDml[latestDmlIndex + 1].evidence.timestampNs ?? Number.MAX_SAFE_INTEGER) < child.timestampNs) {
          latestDmlIndex += 1;
        }
        const dml = ownedDml[latestDmlIndex];
        const dmlTimestamp = dml?.evidence.timestampNs ?? null;
        if (!dml || dmlTimestamp === null || child.timestampNs > dmlTimestamp + TRIGGER_CHILD_WINDOW_NS) {
          continue;
        }
        const children2 = childrenByDmlId.get(dml.id) ?? [];
        children2.push(child);
        childrenByDmlId.set(dml.id, children2);
      }
      const children = ownedDml.map((dml) => {
        const allTriggered = childrenByDmlId.get(dml.id) ?? [];
        const shownTriggers = allTriggered.slice(0, childLimit);
        if (allTriggered.length > childLimit) {
          truncatedNodes.push({
            parentId: dml.id,
            totalChildren: allTriggered.length,
            shown: childLimit
          });
        }
        return {
          id: dml.id,
          label: `${dml.operation ?? "DML"} on ${dml.sObject ?? "unknown"}`,
          type: "dml",
          sObject: dml.sObject,
          operation: dml.operation,
          namespace: dml.namespace,
          durationMs: dml.durationMs,
          children: depth < MAX_CASCADE_DEPTH ? shownTriggers.map(
            (child) => buildNode(child, depth + 2, nextVisited)
          ) : [],
          depth: depth + 1
        };
      });
      return {
        id: `trigger-${triggerEvent.idx + 1}`,
        label: triggerEvent.text || "Trigger",
        type: "trigger",
        sObject: null,
        operation: null,
        namespace: triggerEvent.namespace,
        durationMs: triggerEvent.durationTotalNs !== null ? Math.round(triggerEvent.durationTotalNs / 1e6 * 1e3) / 1e3 : null,
        children,
        depth
      };
    };
    const rootTriggers = triggerEvents.filter(
      (event) => findNearestTriggerAncestor(event) === null
    );
    const cascades = rootTriggers.sort((a, b) => a.timestampNs - b.timestampNs).map((event) => buildNode(event, 0, /* @__PURE__ */ new Set()));
    return {
      cascades,
      meta: {
        totalRootTriggers: rootTriggers.length,
        maxDepth: maxDepthReached,
        truncatedNodes
      }
    };
  }
  function parseCursorInteger(text, field) {
    const pattern = field === "rows" ? /\b(?:Rows?|Row Count|Number of rows(?: in (?:the )?result set)?|Size)\s*[:=]\s*([^\s|]+)/i : /\b(?:Offset|Cursor Offset(?: Position)?)\s*[:=]\s*([^\s|]+)/i;
    const match = pattern.exec(text);
    if (!match) return null;
    const token = match[1].replace(/,$/, "");
    return parseSafeIntegerToken(token);
  }
  function parseCursorQueryId(text) {
    const labeled = /\b(?:Query|Cursor)(?:\s*Id|\s*ID)?\s*[:=]\s*([^|,\s]+)/i.exec(text);
    if (labeled?.[1]) return labeled[1];
    return splitLogFields(text).map((part) => part.trim()).find(
      (part) => /^[A-Za-z0-9_-]{6,}$/.test(part) && !/^\d+$/.test(part)
    ) ?? null;
  }
  function extractCursorOperations(allEvents) {
    const cursorEvents = allEvents.filter(
      (event) => ["CURSOR_CREATE_BEGIN", "CURSOR_FETCH", "CURSOR_FETCH_PAGE"].includes(
        event.type
      )
    );
    return cursorEvents.map((event, index) => {
      const operation = event.type === "CURSOR_CREATE_BEGIN" ? "create" : event.type === "CURSOR_FETCH_PAGE" ? "fetchPage" : "fetch";
      const endPayload = event.exitLogLine ? splitLogFields(event.exitLogLine, 4)[3] ?? "" : "";
      const detailText = operation === "create" ? endPayload : event.text;
      const durationNs = operation === "create" ? event.durationTotalNs : null;
      return {
        id: `cursor-${index + 1}`,
        operation,
        queryId: parseCursorQueryId(detailText),
        query: operation === "create" ? event.text || null : null,
        offset: parseCursorInteger(detailText, "offset"),
        rows: parseCursorInteger(detailText, "rows"),
        durationNs,
        durationMs: durationNs !== null ? Math.round(durationNs / 1e6 * 1e3) / 1e3 : null,
        namespace: event.namespace,
        evidence: {
          lineNumber: event.lineNumber,
          endLineNumber: event.exitLineNumber,
          sourceLineNumber: event.sourceLineNumber,
          timestampNs: event.timestampNs,
          raw: event.logLine || null,
          endRaw: event.exitLogLine
        }
      };
    });
  }
  function extractNamedCredentials(allEvents) {
    const requestEvents = allEvents.filter(
      (e) => e.type === "NAMED_CREDENTIAL_REQUEST" && !e.isContinuation
    );
    const responses = allEvents.filter(
      (e) => e.type === "NAMED_CREDENTIAL_RESPONSE" && !e.isContinuation
    );
    const responseDetails = allEvents.filter(
      (e) => e.type === "NAMED_CREDENTIAL_RESPONSE_DETAIL"
    );
    let responseCursor = 0;
    let detailCursor = 0;
    return requestEvents.map((e, i) => {
      const parts = String(e.text || "").split(" : ");
      const credentialName = e.credentialName ?? parts[0]?.trim() ?? null;
      const endpoint = e.endpoint ?? parts[1]?.trim() ?? null;
      const methodRaw = e.method ?? parts[2]?.trim() ?? null;
      const method = methodRaw ? methodRaw.toUpperCase() : null;
      const nextRequestTs = requestEvents[i + 1]?.timestampNs ?? Number.MAX_SAFE_INTEGER;
      while (responseCursor < responses.length && responses[responseCursor].timestampNs < e.timestampNs) {
        responseCursor += 1;
      }
      const candidate = responses[responseCursor];
      const response = candidate && candidate.timestampNs < nextRequestTs ? candidate : void 0;
      if (response) responseCursor += 1;
      while (detailCursor < responseDetails.length && responseDetails[detailCursor].timestampNs < e.timestampNs) {
        detailCursor += 1;
      }
      const detailCandidate = responseDetails[detailCursor];
      const responseDetail = detailCandidate && detailCandidate.timestampNs < nextRequestTs ? detailCandidate : void 0;
      if (responseDetail) detailCursor += 1;
      let statusCode = null;
      let statusText = null;
      if (response) {
        const parsed = parseCalloutResponseText(response.text);
        statusCode = parsed.statusCode;
        statusText = parsed.statusText;
      }
      if (responseDetail?.statusCode !== null && responseDetail?.statusCode !== void 0) {
        statusCode = responseDetail.statusCode;
      }
      const durationMs = responseDetail?.overallCalloutTimeMs ?? (e.durationTotalNs !== null ? Math.round(e.durationTotalNs / 1e6 * 1e3) / 1e3 : null);
      return {
        id: `named-credential-${i + 1}`,
        credentialId: e.credentialId ?? responseDetail?.credentialId ?? null,
        credentialName,
        endpoint,
        method,
        externalCredentialType: e.externalCredentialType ?? null,
        requestSizeBytes: e.requestSizeBytes ?? null,
        retryOn401: e.retryOn401 ?? null,
        statusCode,
        statusText,
        responseSizeBytes: responseDetail?.responseSizeBytes ?? null,
        connectTimeMs: responseDetail?.connectTimeMs ?? null,
        durationNs: responseDetail?.overallCalloutTimeMs !== null && responseDetail?.overallCalloutTimeMs !== void 0 ? responseDetail.overallCalloutTimeMs * 1e6 : e.durationTotalNs,
        durationMs,
        namespace: e.namespace,
        evidence: {
          lineNumber: e.lineNumber,
          timestampNs: e.timestampNs,
          raw: e.logLine || null
        }
      };
    });
  }
  function compactIssueType(type) {
    const raw = String(type || "").trim();
    if (!raw) return "Issue";
    return raw.replace(/_WARNING$/i, "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
  }
  function normalizeSoqlPattern(query) {
    if (!query) return "";
    let normalized = "";
    for (let index = 0; index < query.length; index += 1) {
      const char = query[index];
      if (char === "'") {
        normalized += "'?'";
        for (index += 1; index < query.length; index += 1) {
          const literalChar = query[index];
          if (literalChar === "\\") {
            index += 1;
            continue;
          }
          if (literalChar === "'") {
            if (query[index + 1] === "'") {
              index += 1;
              continue;
            }
            break;
          }
        }
        continue;
      }
      if (char === ":") {
        let bindEnd = index + 1;
        while (/\s/.test(query[bindEnd] || "")) bindEnd += 1;
        if (/[A-Z_]/i.test(query[bindEnd] || "")) {
          bindEnd += 1;
          while (/[A-Z0-9_.]/i.test(query[bindEnd] || "")) bindEnd += 1;
          normalized += ":?";
          index = bindEnd - 1;
          continue;
        }
      }
      normalized += char;
    }
    return normalized.replace(/\b\d+\b/g, "?").replace(/\s+/g, " ").trim();
  }
  function buildSoqlPatternAnalysis(databaseSoql, limit = 30) {
    const groups = /* @__PURE__ */ new Map();
    const timestampsByPattern = /* @__PURE__ */ new Map();
    for (const query of databaseSoql) {
      const pattern = normalizeSoqlPattern(query.query);
      if (!pattern) continue;
      const existing = groups.get(pattern);
      if (existing) {
        existing.executionCount += 1;
        if (existing.totalRows !== null && query.rows !== null) {
          const nextTotal = existing.totalRows + query.rows;
          existing.totalRows = Number.isSafeInteger(nextTotal) ? nextTotal : null;
        } else {
          existing.totalRows = null;
        }
        if (existing.totalDurationMs !== null && query.durationMs !== null && Number.isFinite(query.durationMs) && query.durationMs >= 0) {
          const nextDuration = existing.totalDurationMs + query.durationMs;
          existing.totalDurationMs = Number.isFinite(nextDuration) ? nextDuration : null;
        } else {
          existing.totalDurationMs = null;
        }
        existing.queryIds.push(query.id);
      } else {
        groups.set(pattern, {
          pattern,
          targetObject: query.targetObject,
          executionCount: 1,
          totalRows: query.rows,
          totalDurationMs: query.durationMs !== null && Number.isFinite(query.durationMs) && query.durationMs >= 0 ? query.durationMs : null,
          avgDurationMs: null,
          queryIds: [query.id],
          isLoopSuspect: false,
          loopEvidence: null
        });
      }
      const timestamp = query.evidence.timestampNs;
      if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
        const timestamps = timestampsByPattern.get(pattern);
        if (timestamps) timestamps.push(timestamp);
        else timestampsByPattern.set(pattern, [timestamp]);
      }
    }
    const result = [];
    let singleExecutionCount = 0;
    for (const group of groups.values()) {
      group.avgDurationMs = group.executionCount > 0 && group.totalDurationMs !== null ? Math.round(group.totalDurationMs / group.executionCount * 1e3) / 1e3 : null;
      if (group.executionCount >= 3) {
        group.isLoopSuspect = true;
        const queryTimestamps = timestampsByPattern.get(group.pattern) ?? [];
        if (queryTimestamps.length >= 2) {
          let earliest = queryTimestamps[0];
          let latest = earliest;
          for (let index = 1; index < queryTimestamps.length; index += 1) {
            earliest = Math.min(earliest, queryTimestamps[index]);
            latest = Math.max(latest, queryTimestamps[index]);
          }
          const burstNs = latest - earliest;
          if (burstNs <= 5e8) {
            group.loopEvidence = `Pattern executed ${group.executionCount} times within ${Math.round(burstNs / 1e6 * 10) / 10} ms \u2014 likely loop-based SOQL`;
          } else {
            group.loopEvidence = `Pattern executed ${group.executionCount} times across different execution windows`;
          }
        }
      }
      result.push(group);
      if (group.executionCount === 1) singleExecutionCount++;
    }
    const filtered = result.filter((g) => g.executionCount > 1);
    const sorted = filtered.sort((a, b) => b.executionCount - a.executionCount);
    const truncated = sorted.slice(0, limit);
    return {
      patterns: truncated,
      meta: {
        totalDistinctPatterns: groups.size,
        returnedPatterns: truncated.length,
        truncated: sorted.length > limit,
        limit,
        singleExecutionPatterns: singleExecutionCount
      }
    };
  }
  function extractSavepoints(allEvents, executionPhases) {
    const entries = [];
    for (const event of allEvents) {
      if (event.type !== "SAVEPOINT_SET" && event.type !== "SAVEPOINT_ROLLBACK")
        continue;
      const spType = event.type === "SAVEPOINT_SET" ? "set" : "rollback";
      const name = event.text || "unnamed";
      const enclosingEventId = event.parentIdx !== null ? `event-${event.parentIdx + 1}` : null;
      const enclosingPhase = executionPhases.find((p) => {
        const end = p.timing.endNs ?? p.timing.startNs;
        return event.timestampNs >= p.timing.startNs && event.timestampNs <= end;
      });
      entries.push({
        id: `sp-${entries.length + 1}`,
        type: spType,
        name,
        timestampNs: event.timestampNs,
        lineNumber: event.lineNumber,
        rawLine: event.logLine || null,
        enclosingSpanId: null,
        enclosingEventId,
        enclosingPhaseId: enclosingPhase?.id ?? null
      });
    }
    return entries;
  }
  function parseViewstateBytes(text) {
    const source = String(text || "").trim();
    if (!source) return null;
    const sizeWithUnit = source.match(
      /(?<![\d.+-])(\d+(?:\.\d+)?)\s*(bytes?|kb|mb|b)\b/i
    );
    if (!sizeWithUnit) return null;
    const value = Number(sizeWithUnit[1]);
    const unit = sizeWithUnit[2].toLowerCase();
    if (!Number.isFinite(value) || value < 0) return null;
    if ((unit === "b" || unit.startsWith("byte")) && !Number.isSafeInteger(value))
      return null;
    const multiplier = unit === "mb" ? 1024 * 1024 : unit === "kb" ? 1024 : 1;
    const bytes = Math.round(value * multiplier);
    return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
  }
  function sumExactRows2(entries) {
    let total = 0;
    for (const entry of entries) {
      if (entry.rows === null) return null;
      total += entry.rows;
      if (!Number.isSafeInteger(total)) return null;
    }
    return total;
  }
  function boundedLimit(value, fallback) {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
  }
  var BoundedCollector = class {
    constructor(limit, compare) {
      this.limit = limit;
      this.compare = compare;
    }
    limit;
    compare;
    retained = [];
    totalCount = 0;
    add(value) {
      this.totalCount += 1;
      if (this.limit === 0) return;
      if (this.retained.length < this.limit) {
        this.retained.push(value);
        this.bubbleUp(this.retained.length - 1);
        return;
      }
      if (this.compare(value, this.retained[0]) >= 0) return;
      this.retained[0] = value;
      this.sinkDown(0);
    }
    values() {
      return this.retained.slice().sort(this.compare);
    }
    bubbleUp(index) {
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (this.compare(this.retained[parent], this.retained[index]) >= 0)
          return;
        [this.retained[parent], this.retained[index]] = [
          this.retained[index],
          this.retained[parent]
        ];
        index = parent;
      }
    }
    sinkDown(index) {
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let largest = index;
        if (left < this.retained.length && this.compare(this.retained[left], this.retained[largest]) > 0) {
          largest = left;
        }
        if (right < this.retained.length && this.compare(this.retained[right], this.retained[largest]) > 0) {
          largest = right;
        }
        if (largest === index) return;
        [this.retained[index], this.retained[largest]] = [
          this.retained[largest],
          this.retained[index]
        ];
        index = largest;
      }
    }
  };
  function buildInsightsReport(params) {
    const {
      filePath,
      fileBytes,
      generatedAt,
      parseTimeMs,
      parserResult,
      contextOverride,
      limits = {}
    } = params;
    const triggerNamesLimit = boundedLimit(limits.triggerNames, 50);
    const soqlPatternsLimit = boundedLimit(limits.soqlPatterns, 25);
    const triggerCascadeChildrenLimit = boundedLimit(
      limits.triggerCascadeChildren,
      20
    );
    const spanHotspotsLimit = boundedLimit(limits.spanHotspots, 25);
    const recordsPerSObjectLimit = boundedLimit(limits.recordsPerSObject, 100);
    const cursorOperationsLimit = boundedLimit(limits.cursorOperations, 100);
    const errorItemsLimit = boundedLimit(limits.errorItems, 500);
    const recursiveTriggersLimit = boundedLimit(limits.recursiveTriggers, 50);
    const fileName = basename(filePath);
    const logId = parseLogId(fileName);
    const allEvents = flattenEvents(parserResult);
    const allCursorOperations = extractCursorOperations(allEvents);
    const cursorOperations = allCursorOperations.slice(0, cursorOperationsLimit);
    const issues = asArray(readPath2(parserResult, ["logIssues"]));
    const parsingErrors = asArray(readPath2(parserResult, ["parsingErrors"]));
    const parsingDiagnostics = asArray(
      readPath2(parserResult, ["parsingDiagnostics"])
    );
    const parsingErrorOverflowCount = asNumber2(readPath2(parserResult, ["parsingErrorOverflowCount"])) ?? 0;
    const namespaces = asArray(readPath2(parserResult, ["namespaces"])).filter(
      (v) => typeof v === "string"
    );
    const governorLimits = readPath2(parserResult, ["governorLimits"]) ?? {};
    const executionStartEvent = allEvents.find(
      (event) => event.type === "EXECUTION_STARTED"
    );
    const hasCompleteExecutionBoundary = executionStartEvent?.pairingStatus === "complete" && executionStartEvent.durationTotalNs !== null && !executionStartEvent.timestampIsInferred;
    const relativeStartNs = executionStartEvent?.timestampIsInferred ? null : executionStartEvent?.timestampNs ?? null;
    const relativeEndNs = hasCompleteExecutionBoundary ? executionStartEvent.endTimestampNs : null;
    const durationMs = hasCompleteExecutionBoundary ? Math.round(executionStartEvent.durationTotalNs / 1e6) : null;
    const userInfoEvent = allEvents.find((e) => e.type === "USER_INFO");
    const parsedUserInfo = parseUserInfoFromLogLine(userInfoEvent?.logLine ?? "");
    const startTimestamp = executionStartEvent ? eventClockFromLogLine(executionStartEvent.logLine) : null;
    const endTimestamp = hasCompleteExecutionBoundary ? eventClockFromLogLine(executionStartEvent.exitLogLine) : null;
    const rootCodeUnit = allEvents.find((e) => e.type === "CODE_UNIT_STARTED")?.text ?? null;
    const allTriggerNames = Array.from(
      new Set(
        allEvents.filter(
          (e) => e.type === "CODE_UNIT_STARTED" && e.text.includes("trigger event")
        ).map((e) => e.text.replace(/.*?\|/, "").trim())
      )
    );
    const triggerNames = allTriggerNames.slice(0, triggerNamesLimit);
    const triggerNamesMeta = {
      items: triggerNames,
      totalCount: allTriggerNames.length,
      truncated: allTriggerNames.length > triggerNamesLimit,
      limit: triggerNamesLimit
    };
    const flowInterviews = allEvents.filter((e) => e.type === "FLOW_START_INTERVIEW_BEGIN").map((e, i) => ({
      flowInterviewId: `flow-${i + 1}`,
      flowApiName: e.text || "Unknown Flow",
      status: "started",
      evidence: {
        lineStart: e.lineNumber,
        lineEnd: e.lineNumber
      }
    }));
    const debugEvents = allEvents.filter(
      (e) => e.type === "USER_DEBUG" || e.type.startsWith("USER_DEBUG_") || e.type === "DATAWEAVE_USER_DEBUG"
    ).map((e, i) => ({
      id: `debug-${i + 1}`,
      eventType: e.type,
      level: e.type === "DATAWEAVE_USER_DEBUG" ? null : e.type === "USER_DEBUG" ? e.text.match(
        /^(FINEST|FINER|FINE|DEBUG|INFO|WARN|ERROR)\s*\|/
      )?.[1] ?? null : e.type.slice("USER_DEBUG_".length),
      timestampNs: e.timestampNs,
      lineNumber: e.lineNumber,
      sourceLineNumber: e.sourceLineNumber,
      namespace: e.namespace,
      message: e.text,
      evidence: e.logLine || null
    }));
    const traceEvents = allEvents.map((e, i) => {
      const durationNs = e.durationTotalNs ?? null;
      const endNs = e.endTimestampNs ?? null;
      let durationMs2 = null;
      if (durationNs !== null) {
        durationMs2 = Math.round(durationNs / 1e6 * 1e3) / 1e3;
      }
      return {
        id: `event-${i + 1}`,
        idx: e.idx,
        type: e.type,
        timestampNs: e.timestampNs,
        timestampIsInferred: e.timestampIsInferred,
        endNs,
        durationNs,
        durationMs: durationMs2,
        lineNumber: e.lineNumber,
        sourceLineNumber: e.sourceLineNumber,
        namespace: e.namespace,
        text: e.text || null,
        raw: e.logLine || null
      };
    });
    const soqlEvents = allEvents.filter((e) => e.type === "SOQL_EXECUTE_BEGIN");
    const soslEvents = allEvents.filter((e) => e.type === "SOSL_EXECUTE_BEGIN");
    const dmlEvents = allEvents.filter((e) => e.type === "DML_BEGIN");
    const calloutEvents = allEvents.filter(
      (e) => e.type === "CALLOUT_REQUEST" && !e.isContinuation
    );
    const calloutFragmentsByParent = /* @__PURE__ */ new Map();
    for (const event of allEvents) {
      if (event.type !== "CALLOUT_REQUEST" || !event.isContinuation || event.parentIdx === null) {
        continue;
      }
      const fragments = calloutFragmentsByParent.get(event.parentIdx) ?? [];
      fragments.push(event.text);
      calloutFragmentsByParent.set(event.parentIdx, fragments);
    }
    const soqlExplainByParent = /* @__PURE__ */ new Map();
    const soqlExplainByLine = /* @__PURE__ */ new Map();
    for (const explainEvent of allEvents.filter(
      (e) => e.type === "SOQL_EXECUTE_EXPLAIN"
    )) {
      const plan = parseExplainPlan(explainEvent.text);
      if (explainEvent.parentIdx !== null) {
        soqlExplainByParent.set(explainEvent.parentIdx, plan);
      } else if (explainEvent.sourceLineNumber !== null) {
        soqlExplainByLine.set(explainEvent.sourceLineNumber, plan);
      }
    }
    const databaseSoql = soqlEvents.map((e, i) => ({
      id: `soql-${i + 1}`,
      query: e.text || null,
      targetObject: extractTargetObject(e.text || null),
      aggregations: e.aggregations,
      // A begin node owns a zero-initialized counter even when its end record is
      // missing. Only a typed, completely paired end proves that Salesforce
      // observed a row count (including an actual zero).
      rows: e.pairingStatus === "complete" ? e.soqlRowCountTotal : null,
      count: e.soqlCountTotal,
      durationNs: e.durationTotalNs,
      durationMs: e.durationTotalNs !== null ? Math.round(e.durationTotalNs / 1e6 * 1e3) / 1e3 : null,
      explain: soqlExplainByParent.get(e.idx) ?? (e.sourceLineNumber !== null ? soqlExplainByLine.get(e.sourceLineNumber) ?? null : null),
      namespace: e.namespace,
      category: e.category || null,
      debugCategory: e.debugCategory || null,
      evidence: {
        lineNumber: e.lineNumber,
        sourceLineNumber: e.sourceLineNumber,
        timestampNs: e.timestampNs,
        raw: e.logLine || null
      }
    }));
    const databaseSosl = soslEvents.map((e, i) => ({
      id: `sosl-${i + 1}`,
      query: e.text || null,
      rows: e.pairingStatus === "complete" ? e.soslRowCountTotal : null,
      count: e.soslCountTotal,
      durationNs: e.durationTotalNs,
      durationMs: e.durationTotalNs !== null ? Math.round(e.durationTotalNs / 1e6 * 1e3) / 1e3 : null,
      namespace: e.namespace,
      category: e.category || null,
      debugCategory: e.debugCategory || null,
      evidence: {
        lineNumber: e.lineNumber,
        sourceLineNumber: e.sourceLineNumber,
        timestampNs: e.timestampNs,
        raw: e.logLine || null
      }
    }));
    const databaseDmlFromEvents = dmlEvents.map((e, i) => {
      const parsed = parseDmlText(e.text);
      return {
        id: `dml-${i + 1}`,
        operation: parsed.operation,
        sObject: parsed.sobject,
        rows: e.pairingStatus === "complete" ? e.dmlRowCountTotal : null,
        count: e.dmlCountTotal,
        durationNs: e.durationTotalNs,
        durationMs: e.durationTotalNs !== null ? Math.round(e.durationTotalNs / 1e6 * 1e3) / 1e3 : null,
        namespace: e.namespace,
        category: e.category || null,
        debugCategory: e.debugCategory || null,
        text: e.text || null,
        source: "event",
        evidence: {
          lineNumber: e.lineNumber,
          sourceLineNumber: e.sourceLineNumber,
          timestampNs: e.timestampNs,
          raw: e.logLine || null
        }
      };
    });
    const databaseDml = databaseDmlFromEvents;
    const databaseCallouts = calloutEvents.map((e, i) => {
      const requestText = [
        e.text,
        ...calloutFragmentsByParent.get(e.idx) ?? []
      ].join("\n");
      const parsed = parseCalloutRequestText(requestText);
      const responseParsed = e.responseText ? parseCalloutResponseText(e.responseText) : { statusCode: null, statusText: null };
      return {
        id: `callout-${i + 1}`,
        endpoint: parsed.endpoint,
        host: parsed.host,
        method: parsed.method,
        statusCode: responseParsed.statusCode,
        statusText: responseParsed.statusText,
        responseLineNumber: e.responseLineNumber ?? null,
        durationNs: e.durationTotalNs,
        durationMs: e.durationTotalNs !== null ? Math.round(e.durationTotalNs / 1e6 * 1e3) / 1e3 : null,
        namespace: e.namespace,
        category: e.category || null,
        debugCategory: e.debugCategory || null,
        text: requestText || null,
        evidence: {
          lineNumber: e.lineNumber,
          sourceLineNumber: e.sourceLineNumber,
          timestampNs: e.timestampNs,
          raw: e.logLine || null
        }
      };
    });
    const spanCandidates = allEvents.filter(isSpanCandidate);
    const unitIdByEventIdx = /* @__PURE__ */ new Map();
    const spans = spanCandidates.map((event, i) => {
      const unitId = `unit-${i + 1}`;
      unitIdByEventIdx.set(event.idx, unitId);
      return {
        id: unitId,
        eventId: `event-${event.idx + 1}`,
        parentId: event.parentIdx !== null ? unitIdByEventIdx.get(event.parentIdx) ?? null : null,
        eventType: event.type,
        label: buildSpanLabel(event),
        namespace: event.namespace,
        category: event.category || null,
        debugCategory: event.debugCategory || null,
        cpuType: event.cpuType || null,
        startNs: event.timestampNs,
        endNs: event.endTimestampNs,
        durationNs: event.durationTotalNs,
        durationMs: event.durationTotalNs !== null ? Math.round(event.durationTotalNs / 1e6 * 1e3) / 1e3 : null,
        selfDurationNs: event.durationSelfNs,
        selfDurationMs: event.durationSelfNs !== null ? Math.round(event.durationSelfNs / 1e6 * 1e3) / 1e3 : null,
        evidence: {
          lineNumber: event.lineNumber,
          raw: event.logLine || null
        }
      };
    });
    const validationUnits = spans.filter(
      (s) => s.eventType === "CODE_UNIT_STARTED" && String(s.label || "").startsWith("Validation:")
    );
    const validationBlocks = validationUnits.map((unit) => {
      const startNs = unit.startNs;
      const endNs = unit.endNs ?? unit.startNs;
      const meta = parseValidationCodeUnitLabel(String(unit.label || ""));
      const eventsInWindow = allEvents.filter(
        (event) => event.timestampNs >= startNs && event.timestampNs <= endNs
      ).filter((event) => event.type.startsWith("VALIDATION_")).sort((a, b) => a.timestampNs - b.timestampNs);
      const rules = [];
      let currentRule = null;
      for (const event of eventsInWindow) {
        if (event.type === "VALIDATION_RULE") {
          currentRule = {
            ruleName: event.text || null,
            formula: null,
            outcome: "UNKNOWN",
            errorText: null,
            timestampNs: event.timestampNs
          };
          rules.push(currentRule);
          continue;
        }
        if (!currentRule) {
          currentRule = {
            ruleName: null,
            formula: null,
            outcome: "UNKNOWN",
            errorText: null,
            timestampNs: event.timestampNs
          };
          rules.push(currentRule);
        }
        if (event.type === "VALIDATION_FORMULA")
          currentRule.formula = event.text || null;
        if (event.type === "VALIDATION_PASS") currentRule.outcome = "PASS";
        if (event.type === "VALIDATION_ERROR") {
          currentRule.outcome = "ERROR";
          currentRule.errorText = event.text || null;
        }
      }
      return {
        eventId: unit.eventId,
        label: unit.label,
        namespace: unit.namespace,
        startNs,
        endNs,
        sobject: meta.sobject,
        context: meta.context,
        totals: {
          ruleCount: rules.length,
          passCount: rules.filter((rule) => rule.outcome === "PASS").length,
          errorCount: rules.filter((rule) => rule.outcome === "ERROR").length
        },
        rules
      };
    });
    const flowUnits = spans.filter(
      (s) => s.eventType === "CODE_UNIT_STARTED" && String(s.label || "").startsWith("Flow:")
    );
    const flowBlocks = flowUnits.map((unit) => {
      const startNs = unit.startNs;
      const endNs = unit.endNs ?? unit.startNs;
      const eventsInWindow = allEvents.filter(
        (event) => event.timestampNs >= startNs && event.timestampNs <= endNs
      ).filter((event) => event.type.startsWith("FLOW_")).sort((a, b) => a.timestampNs - b.timestampNs);
      return {
        eventId: unit.eventId,
        label: unit.label,
        namespace: unit.namespace,
        startNs,
        endNs,
        totals: {
          eventCount: eventsInWindow.length,
          errorCount: eventsInWindow.filter(
            (event) => event.type.includes("ERROR") || event.type.includes("FAULT")
          ).length
        },
        steps: eventsInWindow.map((event) => ({
          timestampNs: event.timestampNs,
          type: event.type,
          text: event.text || null,
          lineNumber: event.lineNumber
        }))
      };
    });
    const workflowUnits = spans.filter(
      (s) => s.eventType === "CODE_UNIT_STARTED" && String(s.label || "").startsWith("Workflow:")
    );
    const workflowBlocks = workflowUnits.map((unit) => {
      const startNs = unit.startNs;
      const endNs = unit.endNs ?? unit.startNs;
      const eventsInWindow = allEvents.filter(
        (event) => event.timestampNs >= startNs && event.timestampNs <= endNs
      ).filter(
        (event) => event.type.startsWith("WF_") || event.type === "EVENT_SERVICE_PUB_BEGIN"
      ).sort((a, b) => a.timestampNs - b.timestampNs);
      return {
        eventId: unit.eventId,
        label: unit.label,
        namespace: unit.namespace,
        startNs,
        endNs,
        totals: {
          eventCount: eventsInWindow.length,
          errorCount: eventsInWindow.filter(
            (event) => event.type.includes("ERROR")
          ).length
        },
        steps: eventsInWindow.map((event) => ({
          timestampNs: event.timestampNs,
          type: event.type,
          text: event.text || null,
          lineNumber: event.lineNumber
        }))
      };
    });
    const eventIdsByType = /* @__PURE__ */ new Map();
    const eventIdsByLine = /* @__PURE__ */ new Map();
    const eventRangesByTimestamp = [];
    for (let i = 0; i < traceEvents.length; i += 1) {
      const eventView = traceEvents[i];
      const sourceEvent = allEvents[i];
      const eventId = String(eventView.id);
      const type = String(eventView.type || "UNKNOWN");
      const idsForType = eventIdsByType.get(type);
      if (idsForType) idsForType.push(eventId);
      else eventIdsByType.set(type, [eventId]);
      if (typeof eventView.lineNumber === "number" && Number.isFinite(eventView.lineNumber) && eventView.lineNumber >= 1) {
        const lineKey = String(eventView.lineNumber);
        const idsForLine = eventIdsByLine.get(lineKey);
        if (idsForLine) idsForLine.push(eventId);
        else eventIdsByLine.set(lineKey, [eventId]);
      }
      const startNs = Number(sourceEvent?.timestampNs ?? 0);
      const endNs = Number(
        sourceEvent?.endTimestampNs ?? sourceEvent?.timestampNs ?? 0
      );
      eventRangesByTimestamp.push({
        eventId,
        type,
        startNs,
        endNs: endNs >= startNs ? endNs : startNs,
        lineNumber: typeof eventView.lineNumber === "number" ? eventView.lineNumber : null
      });
    }
    const eventsByType = Object.fromEntries(eventIdsByType);
    const lineToEventIds = Object.fromEntries(eventIdsByLine);
    const boundIssueText = (value, maxChars) => value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}\u2026`;
    const errorItemOrder = /* @__PURE__ */ new WeakMap();
    const nextErrorItemOrder = [0, 0, 0, 0];
    const compareErrorItems = (left, right) => {
      const timestampDifference = (left.evidence.timestampNs ?? 0) - (right.evidence.timestampNs ?? 0);
      if (timestampDifference !== 0) return timestampDifference;
      const lineDifference = (left.evidence.lineNumber ?? 0) - (right.evidence.lineNumber ?? 0);
      if (lineDifference !== 0) return lineDifference;
      return (errorItemOrder.get(left) ?? 0) - (errorItemOrder.get(right) ?? 0);
    };
    const errorItems = new BoundedCollector(
      errorItemsLimit,
      compareErrorItems
    );
    const collectErrorItem = (item, category) => {
      errorItemOrder.set(
        item,
        category * 1e9 + nextErrorItemOrder[category]
      );
      nextErrorItemOrder[category] += 1;
      errorItems.add(item);
    };
    let rawEventErrorCount = 0;
    const firstEventByTimestamp = /* @__PURE__ */ new Map();
    for (const event of allEvents) {
      if (!firstEventByTimestamp.has(event.timestampNs)) {
        firstEventByTimestamp.set(event.timestampNs, event);
      }
      if (!isErrorEventType(event.type)) continue;
      rawEventErrorCount += 1;
      collectErrorItem(
        {
          type: event.type,
          summary: boundIssueText(event.text || event.type, 500),
          description: event.text && event.text.includes("\n") ? boundIssueText(event.text, 2e3) : "",
          namespace: event.namespace,
          evidence: {
            lineNumber: event.lineNumber,
            timestampNs: event.timestampNs,
            raw: event.logLine ? boundIssueText(event.logLine, 2e3) : null
          }
        },
        2
      );
    }
    let issueErrorCount = 0;
    for (const issue of issues) {
      issueErrorCount += 1;
      const timestampNs = asNumber2(readPath2(issue, ["startTime"])) ?? null;
      const supportingEvent = timestampNs === null ? null : firstEventByTimestamp.get(timestampNs) ?? null;
      const lastTimestampNs = asNumber2(readPath2(issue, ["lastTime"])) ?? timestampNs;
      const lastSupportingEvent = lastTimestampNs === null ? null : firstEventByTimestamp.get(lastTimestampNs) ?? null;
      collectErrorItem(
        {
          type: asString2(readPath2(issue, ["type"])) ?? "issue",
          summary: boundIssueText(
            asString2(readPath2(issue, ["summary"])) ?? "Log issue",
            500
          ),
          description: boundIssueText(
            asString2(readPath2(issue, ["description"])) ?? "",
            2e3
          ),
          occurrences: asNumber2(readPath2(issue, ["occurrences"])) ?? 1,
          eventType: supportingEvent?.type ?? null,
          enclosingCodeUnit: supportingEvent && supportingEvent.parentIdx !== null ? allEvents[supportingEvent.parentIdx]?.text ?? null : null,
          firstOccurrence: {
            timestampNs,
            lineNumber: supportingEvent?.lineNumber ?? null
          },
          lastOccurrence: {
            timestampNs: lastTimestampNs,
            lineNumber: lastSupportingEvent?.lineNumber ?? null
          },
          namespace: supportingEvent?.namespace ?? "default",
          evidence: {
            lineNumber: supportingEvent?.lineNumber ?? null,
            timestampNs,
            raw: supportingEvent?.logLine ? boundIssueText(supportingEvent.logLine, 2e3) : null
          }
        },
        0
      );
    }
    let parseErrorCount = 0;
    for (const entry of parsingErrors) {
      parseErrorCount += 1;
      collectErrorItem(
        {
          type: "parsing_error",
          summary: "Parser warning",
          description: boundIssueText(String(entry), 2e3),
          namespace: "default",
          evidence: { lineNumber: null, timestampNs: null, raw: null }
        },
        1
      );
    }
    if (parsingErrorOverflowCount > 0) {
      parseErrorCount += 1;
      collectErrorItem(
        {
          type: "parsing_error",
          summary: "Additional parser warnings omitted",
          description: `${parsingErrorOverflowCount} additional diagnostics exceeded the parser safety cap.`,
          namespace: "default",
          evidence: { lineNumber: null, timestampNs: null, raw: null }
        },
        1
      );
    }
    const variableAssignments = allEvents.map(parseVariableAssignment).filter((entry) => entry !== null);
    const variableScopes = allEvents.map(parseVariableScope).filter((entry) => entry !== null);
    const variableTypeByName = /* @__PURE__ */ new Map();
    for (const scope of variableScopes) {
      if (!variableTypeByName.has(scope.variableName)) {
        variableTypeByName.set(scope.variableName, scope.typeName);
      }
    }
    const scopeRecordIds = /* @__PURE__ */ new Set();
    for (const va of variableAssignments) {
      const name = va.variableName.toLowerCase();
      if (name === "scope" || name.endsWith("ids") || name.endsWith("id")) {
        collectSalesforceIds(va.parsedValue ?? va.rawValue, scopeRecordIds);
      }
    }
    const eventDml = databaseDml.filter((dml) => dml.source === "event");
    const dmlEventRows = sumExactRows2(eventDml);
    const dmlByObject = eventDml.reduce(
      (acc, dml) => {
        const key = dml.sObject || dml.operation || "Unknown";
        const current = acc[key];
        if (current === null || dml.rows === null) {
          acc[key] = null;
        } else {
          const next = (current ?? 0) + dml.rows;
          acc[key] = Number.isSafeInteger(next) ? next : null;
        }
        return acc;
      },
      {}
    );
    const executionContext = (contextOverride ? buildContextOverride(contextOverride) : null) ?? detectExecutionContext(rootCodeUnit, allEvents, variableAssignments);
    const executionType = executionContext.label;
    const mixedDml = detectMixedDml(databaseDml);
    const recursiveTriggerDetection = detectRecursiveTriggers(
      spans,
      recursiveTriggersLimit
    );
    const namedCredentials = extractNamedCredentials(allEvents);
    const NC_PAIR_WINDOW_NS = 2e7;
    const pairedCalloutIds = /* @__PURE__ */ new Set();
    const pairedNcIds = /* @__PURE__ */ new Set();
    const integrationOperations = [];
    let integrationIdCounter = 0;
    let calloutCursor = 0;
    for (const nc of namedCredentials) {
      const ncTs = nc.evidence.timestampNs ?? -1;
      while (calloutCursor < databaseCallouts.length && (databaseCallouts[calloutCursor].evidence.timestampNs ?? -1) < ncTs) {
        calloutCursor += 1;
      }
      const candidate = databaseCallouts[calloutCursor];
      const candidateTs = candidate?.evidence.timestampNs ?? -1;
      const lineDistance = candidate?.evidence.lineNumber !== null && candidate?.evidence.lineNumber !== void 0 && nc.evidence.lineNumber !== null ? candidate.evidence.lineNumber - nc.evidence.lineNumber : Number.MAX_SAFE_INTEGER;
      const paired = candidate && candidateTs < ncTs + NC_PAIR_WINDOW_NS && lineDistance > 0 && lineDistance <= 3 ? candidate : void 0;
      if (paired) {
        calloutCursor += 1;
        pairedCalloutIds.add(paired.id);
        pairedNcIds.add(nc.id);
        integrationIdCounter += 1;
        integrationOperations.push({
          id: `integration-${integrationIdCounter}`,
          credentialName: nc.credentialName,
          endpoint: paired.endpoint ?? nc.endpoint,
          host: paired.host,
          method: paired.method ?? nc.method,
          statusCode: paired.statusCode ?? nc.statusCode,
          statusText: paired.statusText ?? nc.statusText,
          durationMs: paired.durationMs ?? nc.durationMs,
          namespace: paired.namespace,
          evidence: paired.evidence,
          calloutId: paired.id,
          namedCredentialId: nc.id
        });
      }
    }
    for (const c of databaseCallouts) {
      if (pairedCalloutIds.has(c.id)) continue;
      integrationIdCounter += 1;
      integrationOperations.push({
        id: `integration-${integrationIdCounter}`,
        credentialName: null,
        endpoint: c.endpoint,
        host: c.host,
        method: c.method,
        statusCode: c.statusCode,
        statusText: c.statusText,
        durationMs: c.durationMs,
        namespace: c.namespace,
        evidence: c.evidence,
        calloutId: c.id,
        namedCredentialId: null
      });
    }
    for (const nc of namedCredentials) {
      if (pairedNcIds.has(nc.id)) continue;
      integrationIdCounter += 1;
      integrationOperations.push({
        id: `integration-${integrationIdCounter}`,
        credentialName: nc.credentialName,
        endpoint: nc.endpoint,
        host: null,
        method: nc.method,
        statusCode: nc.statusCode,
        statusText: nc.statusText,
        durationMs: nc.durationMs,
        namespace: nc.namespace,
        evidence: nc.evidence,
        calloutId: null,
        namedCredentialId: nc.id
      });
    }
    let syntheticWarningCount = 0;
    const addSyntheticWarning = (warning) => {
      syntheticWarningCount += 1;
      collectErrorItem(warning, 3);
    };
    let emptyQueryCount = 0;
    for (const query of databaseSoql) {
      const findings = [];
      let highestSeverity = "info";
      const isEmptyResult = query.rows === 0;
      if (isEmptyResult) emptyQueryCount += 1;
      const isSlow = (query.durationMs ?? 0) >= 50;
      const noExplain = query.explain?.available === false;
      if (isEmptyResult) {
        findings.push("returned 0 rows");
      }
      if (isSlow) {
        findings.push(`took ${query.durationMs?.toFixed(1)} ms`);
        highestSeverity = "warn";
      }
      if (noExplain) {
        findings.push("no explain plan available (likely empty bind variables)");
        highestSeverity = "warn";
      }
      if (findings.length === 0) continue;
      if (isEmptyResult && isSlow) highestSeverity = "warn";
      if (isEmptyResult && !isSlow && !noExplain) highestSeverity = "info";
      const objectName = query.targetObject ?? "SOQL query";
      const findingsSummary = findings.join(", ");
      const queryType = isEmptyResult && isSlow ? "SOQL_QUERY_WARNING" : isEmptyResult ? "EMPTY_QUERY_WARNING" : isSlow ? "SLOW_QUERY_WARNING" : "NO_EXPLAIN_PLAN_WARNING";
      const queryDescription = queryType === "SOQL_QUERY_WARNING" ? "A query that returns nothing but still runs slowly often means Salesforce scanned many rows before filtering \u2014 a sign the filter fields may not be indexed." : queryType === "NO_EXPLAIN_PLAN_WARNING" ? "Query ran with empty or null bind variables \u2014 Salesforce skips explain plan generation when all inputs are empty at runtime." : "";
      addSyntheticWarning({
        type: queryType,
        summary: `${objectName}: ${findingsSummary}`,
        description: queryDescription,
        severity: highestSeverity,
        namespace: query.namespace,
        evidence: {
          lineNumber: query.evidence.lineNumber,
          timestampNs: query.evidence.timestampNs,
          raw: query.evidence.raw
        }
      });
    }
    const seenEmptyMaps = /* @__PURE__ */ new Set();
    let emptyMapCandidates = 0;
    for (const entry of variableAssignments) {
      if (!entry.isEmptyCollection || !/^map/i.test(entry.variableName)) continue;
      emptyMapCandidates += 1;
      if (emptyMapCandidates > 50) break;
      if (seenEmptyMaps.has(entry.variableName)) continue;
      seenEmptyMaps.add(entry.variableName);
      const evidenceEvent = allEvents.find(
        (event) => event.type === "VARIABLE_ASSIGNMENT" && event.text.startsWith(`${entry.variableName} |`)
      );
      const variableType = variableTypeByName.get(entry.variableName) ?? null;
      const displayType = variableType || "Map";
      addSyntheticWarning({
        type: "EMPTY_RESULT_MAP_WARNING",
        summary: `${displayType} ${entry.variableName} is empty`,
        description: `${displayType} "${entry.variableName}" was assigned an empty collection, which can short-circuit downstream processing.`,
        severity: "warn",
        namespace: evidenceEvent?.namespace ?? "default",
        evidence: {
          lineNumber: evidenceEvent?.lineNumber ?? null,
          timestampNs: evidenceEvent?.timestampNs ?? null,
          raw: evidenceEvent?.logLine ?? null
        }
      });
    }
    const noOpDml = databaseDml.find(
      (dml) => dml.operation?.toLowerCase() === "update" && dml.durationMs === 0 && dml.rows === 0
    );
    if (noOpDml) {
      addSyntheticWarning({
        type: "NO_OP_DML_WARNING",
        summary: `${noOpDml.sObject ?? "Update"}: wrote 0 rows`,
        description: "",
        severity: "warn",
        namespace: noOpDml.namespace,
        evidence: {
          lineNumber: noOpDml.evidence.lineNumber,
          timestampNs: noOpDml.evidence.timestampNs,
          raw: noOpDml.evidence.raw
        }
      });
    }
    if (mixedDml.detected) {
      addSyntheticWarning({
        type: "MIXED_DML_OPERATION",
        summary: `Mixed DML: setup objects (${mixedDml.setupObjects.join(", ")}) and non-setup objects (${mixedDml.nonSetupObjects.slice(0, 3).join(", ")}) in same transaction`,
        description: `Salesforce does not allow DML on setup objects (${mixedDml.setupObjects.join(", ")}) and non-setup objects in the same transaction context. This typically causes a System.MixedDmlException.`,
        severity: "warn",
        namespace: "default",
        evidence: {
          lineNumber: mixedDml.evidence[0]?.lineNumber ?? null,
          timestampNs: mixedDml.evidence[0]?.timestampNs ?? null,
          raw: null
        }
      });
    }
    for (const rt of recursiveTriggerDetection.recursiveTriggers) {
      addSyntheticWarning({
        type: "RECURSIVE_TRIGGER",
        summary: `Trigger "${rt.triggerName}" fired ${rt.count} times in this transaction`,
        description: "Repeated trigger execution can increase CPU usage, repeat DML, and create unintended re-entry behavior.",
        severity: "warn",
        namespace: "default",
        evidence: {
          // lineNumber intentionally omitted — rt.lineNumbers are Apex source lines, not raw log rows.
          // Use rawLogLineTexts for raw log row lookup in the viewer instead.
          lineNumber: null,
          timestampNs: null,
          raw: rt.rawLogLineTexts[0] ?? null,
          rawLogLineTexts: rt.rawLogLineTexts
        }
      });
    }
    const VIEWSTATE_WARN_BYTES = 120 * 1024;
    for (const event of allEvents) {
      if (event.type !== "VF_SERIALIZE_VIEWSTATE_END") continue;
      const bytes = parseViewstateBytes(event.text) ?? parseViewstateBytes(event.logLine);
      if (bytes === null || bytes < VIEWSTATE_WARN_BYTES) continue;
      const kb = Math.round(bytes / 1024 * 10) / 10;
      addSyntheticWarning({
        type: "VF_VIEWSTATE_SIZE_WARNING",
        summary: `Visualforce viewstate is ${kb} KB`,
        description: "Large viewstate payloads increase page weight and can cause state-size limit issues. Reduce serialized component state where possible.",
        severity: "warn",
        namespace: event.namespace || "default",
        evidence: {
          lineNumber: event.lineNumber,
          timestampNs: event.timestampNs,
          raw: event.logLine || null
        }
      });
    }
    const soql = isRecord2(governorLimits) ? readPath2(governorLimits, ["soqlQueries"]) : void 0;
    const rows = isRecord2(governorLimits) ? readPath2(governorLimits, ["queryRows"]) : void 0;
    const dmlStatements = isRecord2(governorLimits) ? readPath2(governorLimits, ["dmlStatements"]) : void 0;
    const dmlRows = isRecord2(governorLimits) ? readPath2(governorLimits, ["dmlRows"]) : void 0;
    const cpu = isRecord2(governorLimits) ? readPath2(governorLimits, ["cpuTime"]) : void 0;
    const heap = isRecord2(governorLimits) ? readPath2(governorLimits, ["heapSize"]) : void 0;
    const callouts = isRecord2(governorLimits) ? readPath2(governorLimits, ["callouts"]) : void 0;
    const queueables = isRecord2(governorLimits) ? readPath2(governorLimits, ["queueableJobsAddedToQueue"]) : void 0;
    const emailInvocations = isRecord2(governorLimits) ? readPath2(governorLimits, ["emailInvocations"]) : void 0;
    const futureCalls = isRecord2(governorLimits) ? readPath2(governorLimits, ["futureCalls"]) : void 0;
    const soqlUsed = asNumber2(readPath2(soql, ["used"]));
    const soqlRowsUsed = asNumber2(readPath2(rows, ["used"]));
    const dmlStatementsUsed = asNumber2(readPath2(dmlStatements, ["used"]));
    const dmlRowsUsed = asNumber2(readPath2(dmlRows, ["used"]));
    const hasSoqlUsageEvidence = (asNumber2(readPath2(soql, ["limit"])) ?? 0) > 0;
    const hasSoqlRowsUsageEvidence = (asNumber2(readPath2(rows, ["limit"])) ?? 0) > 0;
    const hasDmlUsageEvidence = (asNumber2(readPath2(dmlStatements, ["limit"])) ?? 0) > 0;
    const hasDmlRowsUsageEvidence = (asNumber2(readPath2(dmlRows, ["limit"])) ?? 0) > 0;
    const snapshotsRaw = isRecord2(governorLimits) ? asArray(readPath2(governorLimits, ["snapshots"])) : [];
    const byType = countByKey(allEvents, (e) => e.type);
    const byNamespace = countByKey(allEvents, (e) => e.namespace);
    const byCategory = countByKey(allEvents, (e) => e.category || "unknown");
    const byDebugCategory = countByKey(
      allEvents,
      (e) => e.debugCategory || "unknown"
    );
    const spanHotspots = [...spans].sort((a, b) => (b.durationNs ?? 0) - (a.durationNs ?? 0)).slice(0, spanHotspotsLimit).map((span) => ({
      eventId: span.eventId,
      eventType: span.eventType,
      label: span.label,
      durationMs: span.durationMs,
      namespace: span.namespace,
      startNs: span.startNs,
      lineNumber: isRecord2(span.evidence) ? asNumber2(span.evidence.lineNumber) ?? null : null,
      parentId: span.parentId
    }));
    const queueableBeginEvents = allEvents.filter(
      (event) => event.type === "QUEUEABLE_BEGIN"
    );
    const asynchronousEventTypes = /* @__PURE__ */ new Set([
      "QUEUEABLE_BEGIN",
      "FUTURE_METHOD_BEGIN",
      "BATCH_APEX_START_BEGIN",
      "BATCH_APEX_EXECUTE_BEGIN",
      "EVENT_SERVICE_PUB_BEGIN",
      "EVENT_SERVICE_SUB_BEGIN"
    ]);
    const asynchronousContinuations = allEvents.filter((event) => asynchronousEventTypes.has(event.type)).map((event) => ({
      kind: event.type,
      identity: event.text || null,
      jobIds: Array.from(
        new Set(
          event.logLine.match(/\b707[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?\b/g) ?? []
        )
      ),
      evidence: {
        lineNumber: event.lineNumber,
        timestampNs: event.timestampNs,
        raw: event.logLine || null
      },
      relationship: event.type.endsWith("_SUB_BEGIN") ? "current" : "related",
      guidance: event.type.endsWith("_SUB_BEGIN") ? "This event is part of the current transaction." : "Analyze the related transaction's separate debug log to continue the execution chain."
    }));
    const queueableHotspots = queueableBeginEvents.map((queueableEvent, i) => {
      const queueableClass = queueableClassFromText(queueableEvent.text ?? "") ?? `Queueable #${i + 1}`;
      return {
        eventId: `event-${queueableEvent.idx + 1}`,
        eventType: "QUEUEABLE_BEGIN",
        label: `${queueableClass} (queued)`,
        durationMs: queueableEvent.durationTotalNs !== null ? Math.round(queueableEvent.durationTotalNs / 1e6 * 1e3) / 1e3 : null,
        namespace: queueableEvent.namespace,
        startNs: queueableEvent.timestampNs,
        lineNumber: queueableEvent.lineNumber,
        parentId: null
      };
    });
    const queueableByLabel = /* @__PURE__ */ new Map();
    for (const hotspot of queueableHotspots) {
      if (!queueableByLabel.has(hotspot.label))
        queueableByLabel.set(hotspot.label, hotspot);
    }
    const hotspots = [...queueableByLabel.values(), ...spanHotspots].sort(
      (a, b) => (a.startNs ?? Number.MAX_SAFE_INTEGER) - (b.startNs ?? Number.MAX_SAFE_INTEGER)
    ).slice(0, spanHotspotsLimit);
    const prefixMap = buildDynamicPrefixMap(databaseSoql, variableAssignments);
    const executionPhases = buildExecutionPhases(
      spans,
      databaseSoql,
      databaseDml,
      variableAssignments,
      allEvents,
      snapshotsRaw,
      durationMs
    );
    const { entries: recordGraph } = extractRecordGraph(
      allEvents,
      variableAssignments,
      prefixMap
    );
    const phaseSummary = executionPhases.map((phase) => ({
      id: phase.id,
      label: phase.label,
      durationMs: phase.timing.durationMs,
      pctOfTotal: phase.timing.pctOfTotal,
      soqlCount: phase.database.soqlInPhase.length,
      soqlRows: phase.database.totalSoqlRows,
      dmlCount: phase.database.dmlInPhase.length,
      dmlRows: phase.database.totalDmlRows,
      warningCount: phase.warnings.length,
      hasErrors: phase.warnings.some((w) => w.toLowerCase().includes("error"))
    }));
    const heapAnalysis = buildHeapAnalysis(
      allEvents,
      spans,
      executionPhases,
      unitIdByEventIdx
    );
    const governorBurnRate = buildGovernorBurnRate(
      snapshotsRaw,
      allEvents,
      executionPhases,
      durationMs,
      governorLimits
    );
    const { patterns: allSoqlPatterns } = buildSoqlPatternAnalysis(databaseSoql);
    const soqlPatterns = allSoqlPatterns.slice(0, soqlPatternsLimit);
    const savepoints = extractSavepoints(allEvents, executionPhases);
    const systemModeTransitions = extractSystemModeTransitions(
      allEvents,
      unitIdByEventIdx
    );
    const triggerCascadeResult = buildTriggerCascade(
      allEvents,
      databaseDml,
      triggerCascadeChildrenLimit
    );
    const triggerCascade = triggerCascadeResult.cascades;
    const debugLevelQuality = assessDebugLevelQuality(parserResult);
    const cpuAttribution = buildCpuAttribution(spans);
    const managedPackageImpact = buildManagedPackageImpact(
      namespaces,
      spans,
      allEvents,
      durationMs
    );
    for (const pattern of soqlPatterns) {
      if (!pattern.isLoopSuspect) continue;
      addSyntheticWarning({
        type: "SOQL_LOOP_SUSPECT",
        summary: `${pattern.targetObject ?? "SOQL"}: same pattern executed ${pattern.executionCount} times (possible N+1)`,
        description: pattern.loopEvidence ?? `Query pattern on ${pattern.targetObject ?? "unknown"} executed ${pattern.executionCount} times.`,
        severity: "warn",
        namespace: "default",
        evidence: {
          lineNumber: null,
          timestampNs: null,
          raw: null
        }
      });
    }
    let rollbackCount = 0;
    for (const rb of savepoints) {
      if (rb.type !== "rollback") continue;
      rollbackCount += 1;
      addSyntheticWarning({
        type: "SAVEPOINT_ROLLBACK",
        summary: `Savepoint "${rb.name}" was rolled back`,
        description: `A savepoint rollback was detected, indicating a partial transaction failure or defensive error handling.`,
        severity: "warn",
        namespace: "default",
        evidence: {
          lineNumber: rb.lineNumber,
          timestampNs: rb.timestampNs,
          raw: null
        }
      });
    }
    for (const br of governorBurnRate.burnRates) {
      if (br.status === "critical") {
        addSyntheticWarning({
          type: "GOVERNOR_LIMIT_CRITICAL",
          summary: `${br.limitName} at ${br.pctUsed}% (${br.used}/${br.max})`,
          description: `Governor limit "${br.limitName}" is at critical level. Burn rate: ${br.burnRatePerSec}/sec.${br.projectedHeadroom !== null ? ` Projected headroom: ${br.projectedHeadroom}s at current rate.` : ""}`,
          severity: "warn",
          namespace: "default",
          evidence: {
            lineNumber: null,
            timestampNs: null,
            raw: null
          }
        });
      }
    }
    const allErrorItems = errorItems.values();
    return {
      schema: {
        name: "apex-log-insights",
        version: "3.0.0",
        generatedAtUtc: generatedAt,
        notes: [
          "Generated by Apex Log Insights (apex-log-insights).",
          "Facts are extracted from parser output with evidence pointers where available.",
          "v3.0.0: Hard schema cutover to event-native indexes. Removed trace.spans/spanTree and span-based indexes.",
          "v0.12.0: Added heapAnalysis, governorBurnRate, soqlPatterns, savepoints, systemModeTransitions, triggerCascade, debugLevelQuality, cpuAttribution, managedPackageImpact.",
          "v0.13.0: Added context.executionContext, database.namedCredentials, callout response details (statusCode/statusText/responseLineNumber), mixedDmlAnalysis, recursiveTriggerAnalysis.",
          "v0.14.0: Evidence model fix \u2014 evidence.raw now set on rawEventErrors and recursive trigger warnings; recursiveTriggers include rawLogLineTexts for raw-log-row lookup; highlights carry raw through. Viewer resolves rawLogLineNumber via text lookup for trust-worthy clickable links.",
          "v0.15.0: Added database.integrationOperations \u2014 paired callout + named credential entries into a unified model. Unpaired callouts and NCs remain as standalone entries. Old callouts/namedCredentials arrays retained for backward compat."
        ],
        compat: "breaking schema change"
      },
      source: {
        origin: "node-cli",
        input: {
          type: "salesforce-apex-debug-log",
          logId,
          fileName,
          ingestion: {
            mode: "local-file",
            network: "disabled"
          }
        },
        integrity: {
          rawTextSha256: null,
          parserVersion: "apex-log-insights@1.0.0",
          upstreamParser: {
            name: "certinia/debug-log-analyzer apex-log-parser",
            source: "vendored"
          }
        }
      },
      context: {
        org: {
          orgId: null,
          instance: null,
          namespaceContext: namespaces
        },
        user: {
          userId: parsedUserInfo.userId,
          username: parsedUserInfo.username,
          profile: null,
          locale: null,
          timezone: parsedUserInfo.timezone
        },
        transaction: {
          startTimestamp,
          endTimestamp,
          durationMs,
          requestType: executionType,
          sObject: null,
          operation: null,
          recordIds: Array.from(scopeRecordIds).slice(0, 50),
          rootCodeUnit
        },
        executionContext: cloneJsonLike(executionContext)
      },
      overview: {
        status: {
          outcome: rawEventErrorCount > 0 || issueErrorCount > 0 ? "error" : syntheticWarningCount > 0 ? "warn" : "ok",
          errorCount: rawEventErrorCount + issueErrorCount,
          warningCount: parseErrorCount + syntheticWarningCount
        },
        highlights: allErrorItems.slice(0, 10).map((item) => {
          const sev = "severity" in item ? String(item.severity || "") : "";
          const kind = sev === "info" ? "info" : sev === "warn" ? "warning" : "error";
          return {
            kind,
            title: compactIssueType(item.type ?? null),
            summary: item.summary,
            evidence: {
              lineStart: item.evidence.lineNumber ?? 0,
              lineEnd: item.evidence.lineNumber ?? 0,
              timestampNs: item.evidence.timestampNs ?? null,
              raw: item.evidence.raw ?? null
            }
          };
        }),
        whatRan: {
          observedComponents: {
            apexClassesCount: byType.CODE_UNIT_STARTED ?? 0,
            triggersCount: triggerNamesMeta.totalCount,
            flowsCount: Object.entries(byType).filter(([key]) => key.startsWith("FLOW_")).reduce((sum, [, value]) => sum + value, 0),
            validationRulesCount: Object.entries(byType).filter(([key]) => key.startsWith("VALIDATION_")).reduce((sum, [, value]) => sum + value, 0),
            managedPackagesCount: namespaces.filter((n) => n !== "default").length
          },
          triggerNames: triggerNamesMeta.items,
          triggerNamesMeta,
          flowInterviews,
          managedPackages: namespaces.filter((n) => n !== "default").map((namespace) => ({ namespace, package: namespace }))
        },
        topMetrics: {
          totalDurationMs: durationMs,
          cpuTimeMs: asNumber2(readPath2(cpu, ["used"])) ?? null,
          heapBytesMax: asNumber2(readPath2(heap, ["used"])) ?? null,
          soql: {
            count: hasSoqlUsageEvidence && soqlUsed !== void 0 ? soqlUsed : databaseSoql.length,
            rows: hasSoqlRowsUsageEvidence && soqlRowsUsed !== void 0 ? soqlRowsUsed : sumExactRows2(databaseSoql)
          },
          sosl: {
            count: databaseSosl.length,
            rows: sumExactRows2(databaseSosl)
          },
          dml: {
            statements: hasDmlUsageEvidence && dmlStatementsUsed !== void 0 ? dmlStatementsUsed : databaseDml.length,
            rows: hasDmlRowsUsageEvidence && dmlRowsUsed !== void 0 ? dmlRowsUsed : sumExactRows2(databaseDml)
          },
          callouts: {
            count: asNumber2(readPath2(callouts, ["used"])) ?? null,
            timeMs: null
          },
          wallClock: {
            start: startTimestamp,
            end: endTimestamp
          },
          relativeTimeNs: {
            start: relativeStartNs,
            end: relativeEndNs
          },
          emailInvocations: {
            count: asNumber2(readPath2(emailInvocations, ["used"])) ?? null
          },
          futureCalls: {
            count: asNumber2(readPath2(futureCalls, ["used"])) ?? null
          },
          queueablesEnqueued: {
            count: asNumber2(readPath2(queueables, ["used"])) ?? null
          }
        },
        trust: {
          policy: "facts-only",
          noAiInference: true,
          evidenceFirst: true
        },
        phaseSummary
      },
      limits: {
        cumulative: {
          defaultNamespace: {
            soqlQueries: toLimit(
              asNumber2(readPath2(soql, ["used"])),
              asNumber2(readPath2(soql, ["limit"]))
            ),
            soqlRows: toLimit(
              asNumber2(readPath2(rows, ["used"])),
              asNumber2(readPath2(rows, ["limit"]))
            ),
            dmlStatements: toLimit(
              asNumber2(readPath2(dmlStatements, ["used"])),
              asNumber2(readPath2(dmlStatements, ["limit"]))
            ),
            dmlRows: toLimit(
              asNumber2(readPath2(dmlRows, ["used"])),
              asNumber2(readPath2(dmlRows, ["limit"]))
            ),
            cpuTimeMs: toLimit(
              asNumber2(readPath2(cpu, ["used"])),
              asNumber2(readPath2(cpu, ["limit"]))
            ),
            heapBytes: toLimit(
              asNumber2(readPath2(heap, ["used"])),
              asNumber2(readPath2(heap, ["limit"]))
            ),
            callouts: toLimit(
              asNumber2(readPath2(callouts, ["used"])),
              asNumber2(readPath2(callouts, ["limit"]))
            ),
            queueables: toLimit(
              asNumber2(readPath2(queueables, ["used"])),
              asNumber2(readPath2(queueables, ["limit"]))
            )
          }
        },
        snapshots: snapshotsRaw.map((s, i) => ({
          id: `lim-${i + 1}`,
          timestampNs: asNumber2(readPath2(s, ["timestamp"])) ?? null,
          namespace: asString2(readPath2(s, ["namespace"])) ?? "default",
          scope: "snapshot",
          raw: null,
          limits: cloneJsonLike(readPath2(s, ["limits"]) ?? {})
        }))
      },
      performance: {
        parseTimeMs,
        timelineEventCount: allEvents.length,
        hotspots,
        hotspotsMeta: {
          totalCount: queueableByLabel.size + spans.length,
          truncated: queueableByLabel.size + spans.length > spanHotspotsLimit,
          limit: spanHotspotsLimit
        }
      },
      analysis: {
        executionType,
        scopeRecordIds: Array.from(scopeRecordIds).slice(0, 50),
        dmlImpact: {
          totalRows: dmlEventRows,
          byObject: dmlByObject
        },
        findings: {
          zeroRowQueries: emptyQueryCount,
          missingExplainPlans: databaseSoql.reduce(
            (count, query) => count + (query.explain?.available === false ? 1 : 0),
            0
          ),
          slowQueries: databaseSoql.reduce(
            (count, query) => count + ((query.durationMs ?? 0) >= 50 ? 1 : 0),
            0
          ),
          loopSuspectQueries: allSoqlPatterns.reduce(
            (count, pattern) => count + (pattern.isLoopSuspect ? 1 : 0),
            0
          ),
          savepointRollbacks: rollbackCount,
          criticalLimits: governorBurnRate.burnRates.reduce(
            (count, burnRate) => count + (burnRate.status === "critical" ? 1 : 0),
            0
          ),
          peakHeapBytes: heapAnalysis.peakCumulativeBytes
        },
        recordSummary: {
          totalUniqueRecords: recordGraph.reduce(
            (sum, g) => sum + g.recordCount,
            0
          ),
          bySObject: recordGraph.map((g) => ({
            sObjectType: g.sObjectType,
            keyPrefix: g.keyPrefix,
            count: g.recordCount
          }))
        }
      },
      executionPhases: cloneJsonLike(executionPhases),
      asynchronousContinuations: cloneJsonLike(
        asynchronousContinuations
      ),
      recordGraph: cloneJsonLike(
        recordGraph.map((entry) => ({
          sObjectType: entry.sObjectType,
          keyPrefix: entry.keyPrefix,
          recordCount: entry.recordCount,
          recordsTruncated: entry.records.length > recordsPerSObjectLimit,
          recordLimit: recordsPerSObjectLimit,
          records: entry.records.slice(0, recordsPerSObjectLimit).map((r) => ({
            id: r.id,
            sObjectType: r.sObjectType,
            fields: r.fields.slice(0, 30),
            // cap fields per record
            relationships: r.relationships,
            provenance: r.provenance
          }))
        }))
      ),
      components: {
        namespaces,
        byType,
        byNamespace,
        byCategory,
        byDebugCategory
      },
      trace: {
        events: traceEvents,
        debugEvents,
        validationBlocks,
        flowBlocks,
        workflowBlocks
      },
      database: {
        soql: cloneJsonLike(databaseSoql),
        sosl: cloneJsonLike(databaseSosl),
        dml: cloneJsonLike(databaseDml),
        callouts: cloneJsonLike(databaseCallouts),
        namedCredentials: cloneJsonLike(namedCredentials),
        integrationOperations: cloneJsonLike(
          integrationOperations
        ),
        cursors: cloneJsonLike(cursorOperations),
        cursorsMeta: {
          totalCount: allCursorOperations.length,
          truncated: allCursorOperations.length > cursorOperationsLimit,
          limit: cursorOperationsLimit
        },
        soqlPatterns: cloneJsonLike(soqlPatterns),
        soqlPatternsMeta: {
          totalCount: allSoqlPatterns.length,
          truncated: allSoqlPatterns.length > soqlPatternsLimit,
          limit: soqlPatternsLimit
        }
      },
      heapAnalysis: cloneJsonLike(heapAnalysis),
      governorBurnRate: cloneJsonLike(governorBurnRate),
      savepoints: cloneJsonLike(savepoints),
      systemModeTransitions: cloneJsonLike(
        systemModeTransitions
      ),
      triggerCascade: cloneJsonLike(triggerCascade),
      triggerCascadeMeta: cloneJsonLike(
        triggerCascadeResult.meta
      ),
      debugLevelQuality: cloneJsonLike(debugLevelQuality),
      cpuAttribution: cloneJsonLike(cpuAttribution),
      managedPackageImpact: cloneJsonLike(
        managedPackageImpact
      ),
      mixedDmlAnalysis: cloneJsonLike(mixedDml),
      recursiveTriggerAnalysis: cloneJsonLike(
        recursiveTriggerDetection
      ),
      errors: {
        count: errorItems.totalCount,
        items: allErrorItems,
        truncated: allErrorItems.length < errorItems.totalCount,
        limit: errorItemsLimit
      },
      parserDiagnostics: cloneJsonLike(
        parsingDiagnostics
      ),
      rawLog: {
        available: true,
        bytes: fileBytes
      },
      indexes: {
        eventCount: traceEvents.length,
        eventsByType,
        lineToEventIds,
        eventRangesByTimestamp,
        byNamespace,
        byCategory,
        byDebugCategory
      },
      uiNavigation: {
        deepLinks: {
          overview: "report.html?tab=overview",
          components: "report.html?tab=components",
          performance: "report.html?tab=performance",
          database: "report.html?tab=database",
          callTree: "report.html?tab=call-tree",
          errors: "report.html?tab=errors",
          rawLog: "report.html?tab=raw-log",
          heap: "report.html?tab=heap",
          governorLimits: "report.html?tab=governor-limits",
          triggers: "report.html?tab=triggers",
          packages: "report.html?tab=packages"
        },
        filters: {
          supported: [
            { key: "minDurationMs", type: "number" },
            { key: "type", type: "string" },
            { key: "namespace", type: "string" },
            { key: "hasError", type: "boolean" },
            { key: "text", type: "string" },
            { key: "cpuType", type: "string" },
            { key: "isLoopSuspect", type: "boolean" }
          ]
        }
      },
      parser: {
        mode: "facts-only",
        upstream: {
          name: "Certinia Apex Log Parser",
          keyOutputs: [
            "ApexLog event tree",
            "durations self/total",
            "soql/dml aggregate counters per event",
            "governor limits with snapshots",
            "log issues and parsing errors"
          ]
        },
        provenance: {
          spanSource: "Parent events from Certinia ApexLog tree with duration.total > 0",
          databaseSource: "SOQL_EXECUTE_BEGIN and DML_BEGIN events with text/count/duration fields",
          errorSource: "logIssues + parsingErrors + error-like event types",
          executionPhasesSource: "Direct method/constructor children of root CODE_UNIT_STARTED span, enriched with time-windowed SOQL/DML/variable data",
          recordGraphSource: "VARIABLE_ASSIGNMENT events with parsed JSON values; ID prefix resolution from standard lookup + dynamic SOQL target correlation",
          heapAnalysisSource: "HEAP_ALLOCATE and HEAP_DEALLOCATE events with byte sizes; watermark is cumulative running total sampled at ~200 points",
          governorBurnRateSource: "LIMIT_USAGE_FOR_NS snapshot data with linear burn rate extrapolation between first and last snapshots",
          soqlPatternsSource: "Normalized SOQL query text (bind vars and literals replaced) grouped by pattern; N+1 flagged at 3+ executions",
          savepointsSource: "SAVEPOINT_SET and SAVEPOINT_ROLLBACK events with enclosing event and execution phase correlation",
          systemModeSource: "SYSTEM_MODE_ENTER and SYSTEM_MODE_EXIT events with mode value (true=system, false=user)",
          triggerCascadeSource: "CODE_UNIT_STARTED trigger events correlated with DML_BEGIN event timing and parent-event ancestry to build DML\u2192trigger chains",
          debugLevelQualitySource: "debugLevels from ApexLog header line, assessed against recommended thresholds per category",
          cpuAttributionSource: "Span durations grouped by cpuType and namespace from Certinia parser output",
          managedPackageImpactSource: "Spans and events filtered by non-default namespace with aggregated SOQL/DML/duration metrics",
          executionContextSource: "Heuristic classification from CODE_UNIT_STARTED text, FUTURE_METHOD_BEGIN, BATCH_APEX_EXECUTE_BEGIN, QueueableContextImpl, and root code unit name patterns",
          namedCredentialsSource: "NAMED_CREDENTIAL_REQUEST and NAMED_CREDENTIAL_RESPONSE events with credential name, endpoint, method, and response status",
          calloutResponseSource: "CALLOUT_RESPONSE events paired with CALLOUT_REQUEST spans by timestamp proximity; status code and text parsed from response text",
          mixedDmlAnalysisSource: "DML_BEGIN events classified as setup vs non-setup sObjects; mixed_dml detected when both types appear in the same transaction",
          recursiveTriggerAnalysisSource: "Trigger CODE_UNIT_STARTED spans grouped by normalized trigger name; count > 1 indicates possible recursive execution"
        }
      }
    };
  }
  var EXECUTION_PHASE_DEFINITIONS = [
    {
      id: "phase-01-load-original-record",
      index: 1,
      name: "Load Original Record",
      syntheticDoc: "docs/synthetic_logs/phase-01-load-original-record.md",
      defaultConfidence: "inferred"
    },
    {
      id: "phase-02-system-validation",
      index: 2,
      name: "System Validation",
      syntheticDoc: "docs/synthetic_logs/phase-02a-system-validation-ui.md",
      defaultConfidence: "derived"
    },
    {
      id: "phase-03-before-triggers",
      index: 3,
      name: "Before Triggers",
      syntheticDoc: "docs/synthetic_logs/phase-03-before-triggers.md",
      defaultConfidence: "direct"
    },
    {
      id: "phase-04-before-save-flows",
      index: 4,
      name: "Before-Save Flows",
      syntheticDoc: "docs/synthetic_logs/phase-04-before-save-flows.md",
      defaultConfidence: "direct"
    },
    {
      id: "phase-05-validation-rules",
      index: 5,
      name: "Validation Rules",
      syntheticDoc: "docs/synthetic_logs/phase-05-validation-rules.md",
      defaultConfidence: "direct"
    },
    {
      id: "phase-06-duplicate-rules",
      index: 6,
      name: "Duplicate Rules",
      syntheticDoc: "docs/synthetic_logs/phase-06-07-duplicate-rules-and-save.md",
      defaultConfidence: "derived"
    },
    {
      id: "phase-07-save-to-database",
      index: 7,
      name: "Save To Database",
      syntheticDoc: "docs/synthetic_logs/phase-06-07-duplicate-rules-and-save.md",
      defaultConfidence: "derived"
    },
    {
      id: "phase-08-after-triggers",
      index: 8,
      name: "After Triggers",
      syntheticDoc: "docs/synthetic_logs/phase-08-after-triggers.md",
      defaultConfidence: "direct"
    },
    {
      id: "phase-09-assignment-rules",
      index: 9,
      name: "Assignment Rules",
      syntheticDoc: "docs/synthetic_logs/phase-09-10-assignment-auto-response.md",
      defaultConfidence: "derived"
    },
    {
      id: "phase-10-auto-response-rules",
      index: 10,
      name: "Auto-Response Rules",
      syntheticDoc: "docs/synthetic_logs/phase-09-10-assignment-auto-response.md",
      defaultConfidence: "derived"
    },
    {
      id: "phase-11-workflow-rules",
      index: 11,
      name: "Workflow Rules",
      syntheticDoc: "docs/synthetic_logs/phase-11-11a-workflow-rules.md",
      defaultConfidence: "direct"
    },
    {
      id: "phase-12-escalation-rules",
      index: 12,
      name: "Escalation Rules",
      syntheticDoc: "docs/synthetic_logs/phase-12-13-escalation-process-builder.md",
      defaultConfidence: "derived"
    },
    {
      id: "phase-13-process-builder",
      index: 13,
      name: "Process Builder",
      syntheticDoc: "docs/synthetic_logs/phase-12-13-escalation-process-builder.md",
      defaultConfidence: "derived"
    },
    {
      id: "phase-14-after-save-flows",
      index: 14,
      name: "After-Save Flows",
      syntheticDoc: "docs/synthetic_logs/phase-14-after-save-flows.md",
      defaultConfidence: "direct"
    },
    {
      id: "phase-15-entitlement-rules",
      index: 15,
      name: "Entitlement Rules",
      syntheticDoc: "docs/synthetic_logs/phase-15-16-17-entitlement-rollup.md",
      defaultConfidence: "derived"
    },
    {
      id: "phase-16-rollup-summary",
      index: 16,
      name: "Rollup Summary",
      syntheticDoc: "docs/synthetic_logs/phase-15-16-17-entitlement-rollup.md",
      defaultConfidence: "derived"
    },
    {
      id: "phase-17-criteria-evaluation",
      index: 17,
      name: "Criteria Evaluation",
      syntheticDoc: "docs/synthetic_logs/phase-15-16-17-entitlement-rollup.md",
      defaultConfidence: "derived"
    },
    {
      id: "phase-17a-process-builder",
      index: 17,
      name: "Process Builder",
      syntheticDoc: "docs/synthetic_logs/phase-12-13-escalation-process-builder.md",
      defaultConfidence: "direct"
    },
    {
      id: "phase-17b-workflow-criteria",
      index: 17,
      name: "Workflow Criteria",
      syntheticDoc: "docs/synthetic_logs/phase-11-11a-workflow-rules.md",
      defaultConfidence: "direct"
    },
    {
      id: "phase-18-sharing-rules",
      index: 18,
      name: "Sharing Rules",
      syntheticDoc: "docs/synthetic_logs/phase-18-criteria-based-sharing-rules.md",
      defaultConfidence: "derived"
    },
    {
      id: "phase-19-dml-commit",
      index: 19,
      name: "DML Commit",
      syntheticDoc: "docs/synthetic_logs/phase-19-dml-commit.md",
      defaultConfidence: "direct"
    },
    {
      id: "phase-20-post-commit-logic",
      index: 20,
      name: "Post-Commit Logic",
      syntheticDoc: "docs/synthetic_logs/phase-20-post-commit-logic.md",
      defaultConfidence: "derived"
    }
  ];
  var REPORT_LIMIT_DEFAULTS = {
    eventsPerType: 20,
    triggerNames: 50,
    soqlPatterns: 25,
    triggerCascadeChildren: 20,
    spanHotspots: 25,
    recordsPerSObject: 100,
    cursorOperations: 100,
    errorItems: 500,
    recursiveTriggers: 50
  };
  function boundedLimit2(value, fallback) {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
  }
  function normalizeReportLimits(limits) {
    const normalized = {};
    for (const key of Object.keys(REPORT_LIMIT_DEFAULTS)) {
      if (limits[key] !== void 0) {
        normalized[key] = boundedLimit2(limits[key], REPORT_LIMIT_DEFAULTS[key]);
      }
    }
    return normalized;
  }
  function buildLogCompleteness(parseResult, rawLines) {
    const reasons = [];
    let hasMaximumSizeMarker = false;
    let hasSkippedLinesMarker = false;
    let hasStart = false;
    let hasFinish = false;
    for (const line of rawLines) {
      const text = line.text;
      hasMaximumSizeMarker ||= /MAXIMUM DEBUG LOG SIZE REACHED/i.test(text);
      hasSkippedLinesMarker ||= /^\*\*\* Skipped .* Bytes of detailed log/i.test(
        text
      );
      hasStart ||= /\|EXECUTION_STARTED(?:\||\s|$)/.test(text);
      hasFinish ||= /\|EXECUTION_FINISHED(?:\||\s|$)/.test(text);
    }
    if (hasMaximumSizeMarker)
      reasons.push(
        "Salesforce reported that the maximum debug log size was reached."
      );
    if (hasSkippedLinesMarker)
      reasons.push("Salesforce reported skipped log lines.");
    if (parseResult.issues.some(
      (issue) => /truncat|skipped.lines|max.size|timestamp/i.test(
        `${issue.summary} ${issue.description}`
      )
    )) {
      reasons.push("The parser detected a gap or truncation signal.");
    }
    const parserDiagnostics = Array.isArray(parseResult.parserDiagnostics) ? parseResult.parserDiagnostics : [];
    const diagnosticCount = parserDiagnostics.reduce(
      (total, diagnostic) => total + diagnostic.count,
      0
    );
    if (diagnosticCount > 0) {
      reasons.push(
        `The parser could not fully interpret ${diagnosticCount} log ${diagnosticCount === 1 ? "record" : "records"}.`
      );
    }
    if (!hasStart) reasons.push("EXECUTION_STARTED was not observed.");
    if (!hasFinish) reasons.push("EXECUTION_FINISHED was not observed.");
    const uniqueReasons = Array.from(new Set(reasons));
    return {
      status: uniqueReasons.length === 0 ? "complete" : /maximum|skipped|truncation/i.test(uniqueReasons.join(" ")) ? "incomplete" : "uncertain",
      hasExecutionStart: hasStart,
      hasExecutionFinish: hasFinish,
      reasons: uniqueReasons
    };
  }
  function buildFailureContexts(parseResult) {
    const failureTypes = /* @__PURE__ */ new Set([
      "EXCEPTION_THROWN",
      "FATAL_ERROR",
      "VF_FATAL_ERROR"
    ]);
    return parseResult.normalizedTimeline.flatMap((event, index) => {
      if (!failureTypes.has(event.type)) return [];
      const precedingEvents = parseResult.normalizedTimeline.slice(Math.max(0, index - 8), index).map((entry) => ({
        id: entry.id,
        type: entry.type,
        text: entry.text,
        lineNumber: entry.evidence.startLine
      }));
      return [
        {
          id: event.id,
          type: event.type,
          message: event.text,
          lineNumber: event.evidence.startLine,
          precedingEvents
        }
      ];
    });
  }
  function isRecord3(value) {
    return typeof value === "object" && value !== null;
  }
  function asRecord(value) {
    return isRecord3(value) ? value : {};
  }
  function asArray2(value) {
    return Array.isArray(value) ? value : [];
  }
  function asString3(value) {
    return typeof value === "string" ? value : void 0;
  }
  function asNumber3(value) {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
      return value;
    if (typeof value === "string")
      return parseSafeIntegerToken(value) ?? void 0;
    return void 0;
  }
  function lineEvidence(entry) {
    const lineNumber = asNumber3(
      asRecord(entry).lineNumber ?? asRecord(asRecord(entry).evidence).lineNumber
    ) ?? null;
    if (lineNumber === null) {
      return {
        startLine: null,
        endLine: null
      };
    }
    return {
      startLine: lineNumber,
      endLine: lineNumber,
      lineIds: [lineNumber]
    };
  }
  function firstPhaseEvidence(events, fallbackLine, confidence) {
    const lines = events.map((event) => event.lineNumber).filter(
      (line) => typeof line === "number" && Number.isFinite(line)
    );
    if (lines.length === 0 && fallbackLine === null) {
      return {
        startLine: null,
        endLine: null,
        confidence
      };
    }
    const unique = Array.from(new Set(lines));
    const startLine = unique.length > 0 ? Math.min(...unique) : fallbackLine;
    const endLine = unique.length > 0 ? Math.max(...unique) : fallbackLine;
    return {
      startLine,
      endLine,
      ...unique.length > 0 ? { lineIds: unique } : {},
      confidence
    };
  }
  function coerceRawLines(rawLines, rawLogText) {
    if (rawLines) return rawLines;
    if (typeof rawLogText === "string") {
      return rawLogText.split(/\r\n|\r|\n/).map((text, index) => ({
        id: index + 1,
        lineNumber: index + 1,
        text
      }));
    }
    return [];
  }
  function pickEventsByType(parseResult, matcher, limit = 20) {
    const matched = parseResult.normalizedTimeline.filter(matcher);
    return {
      events: matched.slice(0, limit).map((event) => ({
        id: event.id,
        type: event.type,
        lineNumber: event.evidence.startLine
      })),
      totalCount: matched.length,
      truncated: matched.length > limit
    };
  }
  function findRawLineMatches(rawLines, matcher, limit = 20) {
    const matched = rawLines.filter(matcher);
    return {
      lines: matched.slice(0, limit),
      totalCount: matched.length,
      truncated: matched.length > limit
    };
  }
  function rawLineEvents(prefix, lines) {
    return lines.map((line, index) => ({
      id: `${prefix}-${index + 1}`,
      type: prefix,
      lineNumber: line.lineNumber
    }));
  }
  function buildPhaseSignals(base, parseResult, rawLines, limits = {}) {
    const context = asRecord(base.context);
    const transaction = asRecord(context.transaction);
    const rootCodeUnit = asString3(transaction.rootCodeUnit) ?? "";
    const executionType = asString3(transaction.requestType) ?? "";
    const database = asRecord(base.database);
    const errors = asRecord(base.errors);
    const warnings = asArray2(errors.items).map((item) => asRecord(item)).filter((item) => {
      const severity = asString3(item.severity);
      return severity === "warn" || severity === "info";
    });
    const eventsPerTypeLimit = boundedLimit2(
      limits.eventsPerType,
      REPORT_LIMIT_DEFAULTS.eventsPerType
    );
    const truncationWarnings = [];
    const byTypePrefix = (prefix) => pickEventsByType(
      parseResult,
      (event) => event.type.startsWith(prefix),
      eventsPerTypeLimit
    );
    const byText = (regex) => findRawLineMatches(
      rawLines,
      (line) => regex.test(line.text),
      eventsPerTypeLimit
    ).lines;
    const byTextWithMeta = (regex) => findRawLineMatches(
      rawLines,
      (line) => regex.test(line.text),
      eventsPerTypeLimit
    );
    const hasText = (regex) => rawLines.some((line) => regex.test(line.text));
    const dmlRows = asArray2(database.dml).filter(
      (entry) => asString3(asRecord(entry).source) === "event"
    );
    const wfEventsResult = byTypePrefix("WF_");
    const wfEvents = wfEventsResult.events;
    if (wfEventsResult.truncated) {
      truncationWarnings.push(
        `Workflow events truncated: showing ${wfEvents.length} of ${wfEventsResult.totalCount}`
      );
    }
    const flowEventsResult = byTypePrefix("FLOW_");
    const flowEvents = flowEventsResult.events;
    if (flowEventsResult.truncated) {
      truncationWarnings.push(
        `Flow events truncated: showing ${flowEvents.length} of ${flowEventsResult.totalCount}`
      );
    }
    const validationEventsResult = pickEventsByType(
      parseResult,
      (event) => event.type.startsWith("VALIDATION_") || /validation/i.test(String(event.text || "")),
      eventsPerTypeLimit
    );
    const validationEvents = validationEventsResult.events;
    if (validationEventsResult.truncated) {
      truncationWarnings.push(
        `Validation events truncated: showing ${validationEvents.length} of ${validationEventsResult.totalCount}`
      );
    }
    const escalationEventsResult = pickEventsByType(
      parseResult,
      (event) => event.type === "WF_ESCALATION_RULE" || event.type === "WF_ESCALATION_ACTION",
      eventsPerTypeLimit
    );
    const escalationEvents = escalationEventsResult.events;
    const entitlementEventsResult = pickEventsByType(
      parseResult,
      (event) => event.type === "SLA_PROCESS_CASE" || event.type === "SLA_EVAL_MILESTONE" || event.type === "SLA_END",
      eventsPerTypeLimit
    );
    const entitlementEvents = entitlementEventsResult.events;
    const sharingEventsResult = pickEventsByType(
      parseResult,
      (event) => (event.type === "WF_RULE_EVAL_BEGIN" || event.type === "WF_RULE_EVAL_END" || event.type === "WF_RULE_EVAL") && /sharing/i.test(String(event.text || "")),
      eventsPerTypeLimit
    );
    const sharingEvents = sharingEventsResult.events;
    const duplicateResult = byTextWithMeta(
      /DUPLICATE|MATCHING_RULE|duplicate rule/i
    );
    const duplicateEvents = rawLineEvents(
      "DUPLICATE_RULE",
      duplicateResult.lines
    );
    if (duplicateResult.truncated) {
      truncationWarnings.push(
        `Duplicate rule matches truncated: showing ${duplicateResult.lines.length} of ${duplicateResult.totalCount}`
      );
    }
    const assignmentResult = byTextWithMeta(
      /ASSIGNMENT_RULE|Assignment rule|assigned to/i
    );
    const assignmentEvents = rawLineEvents(
      "ASSIGNMENT_RULE",
      assignmentResult.lines
    );
    if (assignmentResult.truncated) {
      truncationWarnings.push(
        `Assignment rule matches truncated: showing ${assignmentResult.lines.length} of ${assignmentResult.totalCount}`
      );
    }
    const autoResponseResult = byTextWithMeta(
      /AUTO_RESPONSE|Auto-Response|auto response/i
    );
    const autoResponseEvents = rawLineEvents(
      "AUTO_RESPONSE_RULE",
      autoResponseResult.lines
    );
    const processBuilderResult = byTextWithMeta(
      /PROCESS_BUILDER|Process Builder|launched by process/i
    );
    const processBuilderEvents = rawLineEvents(
      "PROCESS_BUILDER",
      processBuilderResult.lines
    );
    const rollupResult = byTextWithMeta(
      /ROLLUP|Roll-Up|grandparent|parent record/i
    );
    const rollupEvents = rawLineEvents("ROLLUP_SUMMARY", rollupResult.lines);
    const criteriaResult = byTextWithMeta(/criteria/i);
    const criteriaEvents = rawLineEvents("CRITERIA_EVAL", criteriaResult.lines);
    const processBldEventsResult = pickEventsByType(
      parseResult,
      (event) => event.type === "PROCESS_STARTED" || event.type === "PROCESS_INSTANCE_DETAIL",
      eventsPerTypeLimit
    );
    const processBldEvents = [
      ...processBldEventsResult.events,
      ...processBuilderEvents
    ];
    const wfCriteriaEventsResult = pickEventsByType(
      parseResult,
      (event) => event.type === "WF_CRITERIA_BEGIN" || event.type === "WF_CRITERIA_END" || event.type === "WF_RULE_EVAL_BEGIN" || event.type === "WF_RULE_EVAL_END" || event.type === "WF_RULE_EVAL",
      eventsPerTypeLimit
    );
    const wfCriteriaEvents = wfCriteriaEventsResult.events;
    const postCommitEventsResult = pickEventsByType(
      parseResult,
      (event) => /EMAIL_QUEUE|FUTURE_METHOD_BEGIN|BATCH_APEX_START|FLOW_CREATE_INTERVIEW_BEGIN/.test(
        event.type
      ) || /queueable|future method|post-commit|email queued/i.test(
        String(event.text || "")
      ),
      eventsPerTypeLimit
    );
    const postCommitEvents = postCommitEventsResult.events;
    const beforeTriggerEventsResult = pickEventsByType(
      parseResult,
      (event) => event.type === "CODE_UNIT_STARTED" && /trigger event Before/i.test(String(event.text || "")),
      eventsPerTypeLimit
    );
    const beforeTriggerEvents = beforeTriggerEventsResult.events;
    if (beforeTriggerEventsResult.truncated) {
      truncationWarnings.push(
        `Before-trigger events truncated: showing ${beforeTriggerEvents.length} of ${beforeTriggerEventsResult.totalCount}`
      );
    }
    const afterTriggerEventsResult = pickEventsByType(
      parseResult,
      (event) => event.type === "CODE_UNIT_STARTED" && /trigger event After/i.test(String(event.text || "")),
      eventsPerTypeLimit
    );
    const afterTriggerEvents = afterTriggerEventsResult.events;
    if (afterTriggerEventsResult.truncated) {
      truncationWarnings.push(
        `After-trigger events truncated: showing ${afterTriggerEvents.length} of ${afterTriggerEventsResult.totalCount}`
      );
    }
    const rawLineByNumber = /* @__PURE__ */ new Map();
    for (const line of rawLines) {
      if (!rawLineByNumber.has(line.lineNumber)) {
        rawLineByNumber.set(line.lineNumber, line);
      }
    }
    const beforeSaveFlowEvents = flowEvents.filter(
      (event) => /before save/i.test(
        event.lineNumber != null ? rawLineByNumber.get(event.lineNumber)?.text ?? "" : ""
      )
    );
    const afterSaveFlowEvents = flowEvents.filter(
      (event) => /after save|Case_Notification_Flow|High_Priority_Escalation_Flow/i.test(
        event.lineNumber != null ? rawLineByNumber.get(event.lineNumber)?.text ?? "" : ""
      )
    );
    const fatalErrorResult = pickEventsByType(
      parseResult,
      (event) => event.type === "FATAL_ERROR",
      eventsPerTypeLimit
    );
    const hasFatalError = fatalErrorResult.events.length > 0;
    const hasExecution = Boolean(
      rootCodeUnit || executionType || parseResult.normalizedTimeline.length > 0
    );
    const signals = {
      "phase-01-load-original-record": {
        observed: false,
        inferred: hasExecution,
        confidence: "inferred",
        events: rawLineEvents(
          "LOAD_ORIGINAL",
          byText(/trigger\.old|Phase1 - trigger\.old/i)
        ),
        warnings: parseResult.capabilities.phaseInferenceEnabled ? [
          "Phase inferred from transaction context because Salesforce does not emit a direct event for this load step."
        ] : []
      },
      "phase-02-system-validation": {
        observed: validationEvents.length > 0 || hasText(
          /system validation phase active|layout rules|required fields|foreign key|self-referential/i
        ),
        inferred: !validationEvents.length && hasExecution,
        confidence: validationEvents.length > 0 ? "direct" : "derived",
        events: validationEvents.length > 0 ? validationEvents : rawLineEvents(
          "SYSTEM_VALIDATION",
          byText(/system validation|foreign key|self-reference/i)
        ),
        warnings: []
      },
      "phase-03-before-triggers": {
        observed: beforeTriggerEvents.length > 0,
        inferred: false,
        confidence: "direct",
        events: beforeTriggerEvents,
        warnings: []
      },
      "phase-04-before-save-flows": {
        observed: beforeSaveFlowEvents.length > 0 || hasText(/Before-Save|BeforeSave|Opportunity_BeforeSave_Enrichment/i),
        inferred: false,
        confidence: beforeSaveFlowEvents.length > 0 ? "direct" : "derived",
        events: beforeSaveFlowEvents.length > 0 ? beforeSaveFlowEvents : rawLineEvents(
          "FLOW_BEFORE_SAVE",
          byText(
            /Before-Save|BeforeSave|Opportunity_BeforeSave_Enrichment/i
          )
        ),
        warnings: []
      },
      "phase-05-validation-rules": {
        observed: validationEvents.length > 0,
        inferred: false,
        confidence: "direct",
        events: validationEvents,
        warnings: []
      },
      "phase-06-duplicate-rules": {
        observed: duplicateEvents.length > 0,
        inferred: duplicateEvents.length === 0 && dmlRows.length > 0 && hasText(/duplicate/i),
        confidence: duplicateEvents.length > 0 ? "direct" : "derived",
        events: duplicateEvents,
        warnings: []
      },
      "phase-07-save-to-database": {
        observed: dmlRows.length > 0,
        inferred: dmlRows.length === 0 && (afterTriggerEvents.length > 0 || hasText(/trigger\.new IDs|soft-save|soft save/i)),
        confidence: dmlRows.length > 0 ? "direct" : "inferred",
        events: dmlRows.length > 0 ? dmlRows.slice(0, 10).map((entry, index) => ({
          id: asString3(asRecord(entry).id) ?? `dml-${index + 1}`,
          type: "DML_BEGIN",
          lineNumber: asNumber3(asRecord(asRecord(entry).evidence).lineNumber) ?? null
        })) : rawLineEvents(
          "SOFT_SAVE",
          byText(/trigger\.new IDs|soft-save|soft save/i)
        ),
        warnings: dmlRows.length === 0 && (afterTriggerEvents.length > 0 || hasText(/trigger\.new IDs|soft-save|soft save/i)) ? [
          "Soft save inferred from after-trigger execution and post-save record IDs."
        ] : []
      },
      "phase-08-after-triggers": {
        observed: afterTriggerEvents.length > 0,
        inferred: false,
        confidence: "direct",
        events: afterTriggerEvents,
        warnings: []
      },
      "phase-09-assignment-rules": {
        observed: assignmentEvents.length > 0,
        inferred: false,
        confidence: assignmentEvents.length > 0 ? "direct" : "derived",
        events: assignmentEvents,
        warnings: []
      },
      "phase-10-auto-response-rules": {
        observed: autoResponseEvents.length > 0,
        inferred: false,
        confidence: autoResponseEvents.length > 0 ? "direct" : "derived",
        events: autoResponseEvents,
        warnings: []
      },
      "phase-11-workflow-rules": {
        observed: wfEvents.length > 0,
        inferred: false,
        confidence: "direct",
        events: wfEvents,
        warnings: []
      },
      "phase-12-escalation-rules": {
        observed: escalationEvents.length > 0,
        inferred: false,
        confidence: escalationEvents.length > 0 ? "direct" : "derived",
        events: escalationEvents,
        warnings: []
      },
      "phase-13-process-builder": {
        observed: processBuilderEvents.length > 0,
        inferred: processBuilderEvents.length === 0 && hasText(/Flow Automations|launched by processes/i),
        confidence: processBuilderEvents.length > 0 ? "direct" : "derived",
        events: processBuilderEvents,
        warnings: []
      },
      "phase-14-after-save-flows": {
        observed: afterSaveFlowEvents.length > 0 || flowEvents.length > 0 && afterTriggerEvents.length > 0,
        inferred: false,
        confidence: afterSaveFlowEvents.length > 0 ? "direct" : "derived",
        events: afterSaveFlowEvents.length > 0 ? afterSaveFlowEvents : flowEvents,
        warnings: []
      },
      "phase-15-entitlement-rules": {
        observed: entitlementEvents.length > 0,
        inferred: false,
        confidence: entitlementEvents.length > 0 ? "direct" : "derived",
        events: entitlementEvents,
        warnings: []
      },
      "phase-16-rollup-summary": {
        observed: rollupEvents.length > 0,
        inferred: rollupEvents.length === 0 && hasText(/Roll-Up Summary|parent record/i),
        confidence: rollupEvents.length > 0 ? "direct" : "derived",
        events: rollupEvents,
        warnings: []
      },
      "phase-17-criteria-evaluation": {
        observed: criteriaEvents.length > 0 || hasText(
          /Grandparent RUS cascade|Grandparent save complete|OpportunityGroup__c/i
        ),
        inferred: criteriaEvents.length === 0 && !hasText(
          /Grandparent RUS cascade|Grandparent save complete|OpportunityGroup__c/i
        ) && hasText(/Criteria-Based|criteria/i),
        confidence: criteriaEvents.length > 0 ? "derived" : hasText(
          /Grandparent RUS cascade|Grandparent save complete|OpportunityGroup__c/i
        ) ? "derived" : "derived",
        events: criteriaEvents.length > 0 ? criteriaEvents : rawLineEvents(
          "GRANDPARENT_RUS",
          byText(
            /Grandparent RUS cascade|Grandparent save complete|OpportunityGroup__c/i
          )
        ),
        warnings: []
      },
      "phase-17a-process-builder": {
        observed: processBldEvents.length > 0,
        inferred: false,
        confidence: processBldEvents.length > 0 ? "direct" : "derived",
        events: processBldEvents,
        warnings: []
      },
      "phase-17b-workflow-criteria": {
        observed: wfCriteriaEvents.length > 0,
        inferred: false,
        confidence: wfCriteriaEvents.length > 0 ? "direct" : "derived",
        events: wfCriteriaEvents,
        warnings: []
      },
      "phase-18-sharing-rules": {
        observed: sharingEvents.length > 0,
        inferred: sharingEvents.length === 0 && hasText(/Criteria-Based Sharing Rules|sharing rules/i),
        confidence: sharingEvents.length > 0 ? "direct" : "derived",
        events: sharingEvents,
        warnings: []
      },
      "phase-19-dml-commit": {
        observed: false,
        inferred: dmlRows.length > 0 && !hasFatalError && hasExecution,
        confidence: "inferred",
        events: rawLineEvents(
          "DML_COMMIT",
          byText(/EXECUTION_FINISHED|LIMIT_USAGE_FOR_NS/i)
        ),
        warnings: parseResult.capabilities.phaseInferenceEnabled && dmlRows.length > 0 && !hasFatalError ? [
          "Commit inferred from successful transaction completion and absence of FATAL_ERROR before EXECUTION_FINISHED."
        ] : []
      },
      "phase-20-post-commit-logic": {
        observed: postCommitEvents.length > 0,
        inferred: false,
        confidence: postCommitEvents.length > 0 ? "direct" : "derived",
        events: postCommitEvents,
        warnings: warnings.filter(
          (warning) => /queueable|future|email|post-commit/i.test(
            asString3(warning.summary) ?? ""
          )
        ).slice(0, 5).map((warning) => asString3(warning.summary) ?? "Post-commit activity")
      }
    };
    return { signals, truncationWarnings };
  }
  function buildPhaseOutputs(base, parseResult, rawLines, limits = {}) {
    const context = asRecord(base.context);
    const transaction = asRecord(context.transaction);
    const database = asRecord(base.database);
    const rootCodeUnit = asString3(transaction.rootCodeUnit) ?? "";
    const executionType = asString3(transaction.requestType) ?? "";
    const defaultFallbackLine = asNumber3(
      asRecord(asArray2(asRecord(asRecord(base.trace).events))[0])["lineNumber"]
    ) ?? null;
    const { signals, truncationWarnings } = buildPhaseSignals(
      base,
      parseResult,
      rawLines,
      limits
    );
    const soqlCount = asArray2(database.soql).length;
    const dmlCount = asArray2(database.dml).filter(
      (entry) => asString3(asRecord(entry).source) === "event"
    ).length;
    const outputs = EXECUTION_PHASE_DEFINITIONS.map((definition) => {
      const signal = signals[definition.id];
      const observed = signal.observed;
      const inferred = !observed && signal.inferred && parseResult.capabilities.phaseInferenceEnabled;
      const status = observed ? "observed" : inferred ? "inferred" : "not_observed";
      const confidence = observed ? "direct" : inferred ? "inferred" : definition.defaultConfidence === "direct" ? "derived" : definition.defaultConfidence;
      const evidence = firstPhaseEvidence(
        signal.events,
        defaultFallbackLine,
        confidence
      );
      return {
        id: definition.id,
        name: definition.name,
        index: definition.index,
        status,
        confidence,
        inputs: {
          executionType,
          rootCodeUnit
        },
        outputs: {
          observedEventCount: signal.events.length,
          soqlCount,
          dmlCount
        },
        events: signal.events,
        warnings: signal.warnings,
        evidence,
        syntheticDoc: definition.syntheticDoc
      };
    });
    return { outputs, truncationWarnings };
  }
  function buildEvidenceIndex(rawLines, base, phases) {
    const indexedLines = rawLines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      text: line.text
    }));
    const events = asArray2(asRecord(asRecord(base.trace).events)).map(
      (event) => asRecord(event)
    );
    const eventRefs = events.map((event, index) => ({
      id: asString3(event.id) ?? `event-${index + 1}`,
      lineNumber: asNumber3(event.lineNumber) ?? null,
      label: asString3(event.text) ?? asString3(event.type) ?? "Event",
      type: asString3(event.type) ?? "UNKNOWN"
    }));
    const issueRefs = asArray2(asRecord(base.errors).items).map((item, index) => {
      const issue = asRecord(item);
      return {
        id: `issue-${index + 1}`,
        lineNumber: asNumber3(asRecord(issue.evidence).lineNumber) ?? null,
        summary: asString3(issue.summary) ?? asString3(issue.type) ?? "Issue"
      };
    });
    return {
      lines: indexedLines,
      events: eventRefs,
      issues: issueRefs,
      phases: phases.map((phase) => ({
        id: phase.id,
        startLine: phase.evidence.startLine,
        endLine: phase.evidence.endLine,
        confidence: phase.evidence.confidence
      })),
      lineToEvents: cloneJsonLike(
        asRecord(asRecord(base.indexes).lineToEventIds)
      )
    };
  }
  function buildOfflineReport(input) {
    const generatedAt = input.source.generatedAt ?? (/* @__PURE__ */ new Date()).toISOString();
    const limits = normalizeReportLimits(input.limits ?? {});
    const base = buildInsightsReport({
      filePath: input.source.fileName,
      fileBytes: input.source.bytes,
      generatedAt,
      parseTimeMs: input.parseResult.parseTimeMs,
      parserResult: input.parseResult.parserResult,
      limits
    });
    const rawLines = coerceRawLines(input.parseResult.rawLines, input.rawLogText);
    const { outputs: phases, truncationWarnings: phaseTruncationWarnings } = buildPhaseOutputs(base, input.parseResult, rawLines, limits);
    const source = {
      ...cloneJsonLike(asRecord(base.source)),
      fileName: input.source.fileName,
      bytes: input.source.bytes,
      generatedAt,
      sourceType: input.parseResult.sourceType,
      parserCore: "parseLog",
      includeRawLines: input.parseResult.capabilities.includeRawLines
    };
    const metadata = {
      generatedAt,
      parser: {
        parseTimeMs: input.parseResult.parseTimeMs,
        mode: asString3(asRecord(base.parser).mode) ?? "facts-only",
        phaseInferenceEnabled: input.parseResult.capabilities.phaseInferenceEnabled,
        logIssueOverflowCount: input.parseResult.logIssueOverflowCount
      },
      namespaces: cloneJsonLike(
        asArray2(asRecord(asRecord(base.components).namespaces)).filter(
          (value) => typeof value === "string"
        )
      ),
      rawLineCount: rawLines.length,
      syntheticCoverage: {
        phaseCount: EXECUTION_PHASE_DEFINITIONS.length,
        docBacked: EXECUTION_PHASE_DEFINITIONS.map((phase) => ({
          id: phase.id,
          syntheticDoc: phase.syntheticDoc
        }))
      },
      truncationWarnings: phaseTruncationWarnings,
      logCompleteness: buildLogCompleteness(input.parseResult, rawLines),
      limits
    };
    const entryPoint = {
      type: asString3(asRecord(asRecord(base.context).transaction).requestType) ?? null,
      name: asString3(asRecord(asRecord(base.context).transaction).rootCodeUnit) ?? null,
      recordIds: cloneJsonLike(
        asArray2(asRecord(asRecord(base.context).transaction).recordIds).filter(
          (value) => typeof value === "string"
        )
      ),
      evidence: lineEvidence(asArray2(asRecord(asRecord(base.trace).events))[0])
    };
    const timeline = input.parseResult.normalizedTimeline.map((event) => ({
      id: event.id,
      type: event.type,
      timestampNs: event.timestampNs,
      timestampIsInferred: event.timestampIsInferred,
      endNs: event.endNs,
      durationNs: event.durationNs,
      lineNumber: event.lineNumber,
      text: event.text,
      namespace: event.namespace,
      parentId: event.parentId,
      pairingStatus: event.pairingStatus,
      durationIsPartial: event.durationIsPartial,
      classification: event.classification,
      evidence: event.evidence
    }));
    const execution = {
      blocks: [],
      tree: []
    };
    const database = cloneJsonLike(asRecord(base.database));
    const governorLimits = {
      current: cloneJsonLike(asRecord(asRecord(base.limits).cumulative)),
      snapshots: cloneJsonLike(asArray2(asRecord(base.limits).snapshots)),
      burnRate: cloneJsonLike(asRecord(base.governorBurnRate))
    };
    const issues = cloneJsonLike(asArray2(asRecord(asRecord(base.errors).items)));
    const evidenceIndex = buildEvidenceIndex(rawLines, base, phases);
    const failureContexts = buildFailureContexts(input.parseResult);
    const uiHints = {
      brand: {
        productName: "Apex Log Insights"
      },
      offline: {
        localOnly: true,
        networkRequired: false
      },
      navigation: cloneJsonLike(asRecord(base.uiNavigation)),
      truthLinks: {
        enabled: true,
        contextLinesDefault: 5
      }
    };
    const baseSnapshot = cloneJsonLike(base);
    return {
      ...baseSnapshot,
      reportVersion: "3.0.0",
      generatedAt,
      source,
      metadata,
      entryPoint,
      execution,
      timeline,
      phases: cloneJsonLike(phases),
      database,
      governorLimits,
      issues,
      parserDiagnostics: cloneJsonLike(
        Array.isArray(input.parseResult.parserDiagnostics) ? input.parseResult.parserDiagnostics : []
      ),
      evidenceIndex,
      failureContexts,
      uiHints
    };
  }
  async function processWorkerParseMessage(message, options) {
    try {
      const request = message ?? {};
      if (request.type !== "PARSE_LOG") {
        return {
          type: "PARSE_RESULT",
          ok: false,
          error: `Unknown message type: ${String(request.type)}`
        };
      }
      if (typeof request.logText !== "string" || request.logText.length === 0) {
        return {
          type: "PARSE_RESULT",
          ok: false,
          error: "PARSE_LOG requires non-empty logText."
        };
      }
      if (request.fileId !== void 0 && (typeof request.fileId !== "string" || request.fileId.length === 0)) {
        return {
          type: "PARSE_RESULT",
          ok: false,
          error: "PARSE_LOG fileId must be a non-empty string when provided."
        };
      }
      const logText = request.logText;
      const logBytes = utf8ByteLength(logText);
      if (logBytes > MAX_LOG_BYTES) {
        return {
          type: "PARSE_RESULT",
          ok: false,
          error: "Log exceeds the 25 MiB worker input limit."
        };
      }
      const fileName = request.fileId ?? "debug.log";
      const parseResult = await parseLog(logText, {
        sourceName: fileName,
        sourceType: options.sourceType,
        includeRawLines: true,
        enablePhaseInference: true
      });
      const report = buildOfflineReport({
        source: {
          fileName,
          bytes: logBytes,
          generatedAt: (/* @__PURE__ */ new Date()).toISOString()
        },
        parseResult,
        rawLogText: logText
      });
      return { type: "PARSE_RESULT", ok: true, report };
    } catch (error) {
      const message2 = error instanceof Error ? error.message : String(error);
      return { type: "PARSE_RESULT", ok: false, error: message2 };
    }
  }

  // src/worker-entry.ts
  var MAX_WORKER_LOG_BYTES = MAX_LOG_BYTES;
  var workerSelf = typeof self === "undefined" ? null : self;
  async function processWorkerMessage(data) {
    return processWorkerParseMessage(data, { sourceType: "salesforce-page" });
  }
  function installWorkerMessageHandler(scope) {
    scope.onmessage = async (event) => {
      const response = await processWorkerMessage(event.data);
      scope.postMessage(response);
    };
  }
  if (workerSelf) installWorkerMessageHandler(workerSelf);
})();
