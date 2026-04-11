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
  /**
   * Should the exitstamp be the timestamp of the next line?
   * These kind of lines can not be used as exit lines for anything othe than other pseudo exits.
   */
  nextLineIsExit = false;
  /**
   * The line number within the containing class
   */
  lineNumber = null;
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
      this.duration.total = this.duration.self = this.exitStamp - this.timestamp;
    }
  }
  parseTimestamp(text) {
    const start = text.indexOf("(");
    if (start !== -1) {
      return Number(text.slice(start + 1, -1));
    }
    throw new Error(`Unable to parse timestamp: '${text}'`);
  }
  parseLineNumber(text) {
    switch (true) {
      case text === "[EXTERNAL]":
        return "EXTERNAL";
      case !!text: {
        const lineNumberStr = text.slice(1, -1);
        if (lineNumberStr) {
          return Number(lineNumberStr);
        }
        throw new Error(`Unable to parse line number: '${text}'`);
      }
      default:
        return 0;
    }
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
};
var BasicExitLine = class extends LogEvent {
  isExit = true;
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
    const firstChild = this.children.find((child) => {
      return child.timestamp;
    });
    this.timestamp = firstChild?.timestamp || 0;
    if (firstChild?.logLine) {
      this.startTime = parseWallClockTime(firstChild.logLine);
    }
    let endTime;
    const reverseLen = this.children.length - 1;
    for (let i = reverseLen; i >= 0; i--) {
      const child = this.children[i];
      if (child?.exitStamp) {
        endTime ??= child.exitStamp;
        if (child.duration) {
          this.executionEndTime = child.exitStamp;
          break;
        }
      }
      endTime ??= child?.timestamp;
    }
    this.exitStamp = endTime || 0;
    this.recalculateDurations();
  }
};
function parseObjectNamespace(text) {
  if (!text) {
    return "";
  }
  const sep = text.indexOf("__");
  if (sep === -1) {
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
  const match = /^(\d{1,2}):(\d{2}):(\d{2})\.(\d+)\s+/.exec(logLine);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const raw = match[4];
  const fraction = Number(raw.slice(0, 3).padEnd(3, "0"));
  if (hours > 23 || minutes > 59 || seconds > 59) {
    return null;
  }
  return (hours * 3600 + minutes * 60 + seconds) * 1e3 + fraction;
}
function parseRows(text) {
  if (!text) {
    return 0;
  }
  const idx = text.indexOf("Rows:");
  if (idx !== -1) {
    const rowCount = text.slice(idx + 5).trim();
    if (rowCount) {
      return Number(rowCount);
    }
  }
  const trimmed = text.trim();
  const asNumber4 = Number(trimmed);
  if (trimmed && !Number.isNaN(asNumber4)) {
    return asNumber4;
  }
  return 0;
}
var BulkHeapAllocateLine = class extends LogEvent {
  logCategory = "Apex Code";
  constructor(parser, parts) {
    super(parser, parts);
    this.text = parts[2] || "";
  }
};
var CalloutRequestLine = class extends DurationLogEvent {
  constructor(parser, parts) {
    super(
      parser,
      parts,
      ["CALLOUT_RESPONSE"],
      LOG_CATEGORY.Callout,
      "free",
      DEBUG_CATEGORY.Callout
    );
    this.text = parts[3] ?? "";
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
};
var CalloutResponseLine = class extends LogEvent {
  isExit = true;
  constructor(parser, parts) {
    super(parser, parts);
    this.text = parts[3] ?? "";
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
};
var NamedCredentialRequestLine = class extends LogEvent {
  constructor(parser, parts) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Callout;
    this.text = `${parts[3] ?? ""} : ${parts[4] ?? ""} : ${parts[5] ?? ""} : ${parts[6] ?? ""}`;
  }
};
var NamedCredentialResponseLine = class extends LogEvent {
  constructor(parser, parts) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Callout;
    this.text = parts[3] || "";
  }
};
var NamedCredentialResponseDetailLine = class extends LogEvent {
  constructor(parser, parts) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Callout;
    this.text = `${parts[3] ?? ""} : ${parts[4] ?? ""} ${parts[5] ?? ""} : ${parts[6] ?? ""} ${parts[7] ?? ""}`;
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
    if (constructorParts.length >= 2 && possibleNs) {
      return possibleNs;
    }
    return "";
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
    super(parser, parts, ["METHOD_EXIT"], LOG_CATEGORY.Apex, "method", DEBUG_CATEGORY.ApexCode);
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
    if (methodNameParts.length === 4) {
      return methodNameParts[0] ?? "";
    } else if (methodNameParts.length === 2) {
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
        this.namespace = this.text.slice(0, index);
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
        this.text = name || parts[4] || "";
        const triggerParts = parts[5]?.split("/") || [];
        this.namespace = triggerParts.length === 3 ? triggerParts[1] || "default" : "default";
        break;
      }
      default: {
        this.cpuType = "method";
        this.text = name;
        const openBracket = name.lastIndexOf("(");
        const methodName = openBracket !== -1 ? name.slice(0, openBracket + 1).split(".") : name.split(".");
        if (methodName.length === 3 || methodName.length === 2 && !methodName[1]?.endsWith("(")) {
          this.namespace = methodName[0] || "default";
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
    super(parser, parts, ["DML_END"], LOG_CATEGORY.DML, "free", DEBUG_CATEGORY.Database);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = "DML " + parts[3] + " " + parts[4];
    const rowCountString = parts[5];
    this.dmlRowCount.total = this.dmlRowCount.self = rowCountString ? parseRows(rowCountString) : 0;
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
var SOQLExecuteBeginLine = class extends DurationLogEvent {
  aggregations = 0;
  children = [];
  soqlCount = {
    self: 1,
    total: 1
  };
  constructor(parser, parts) {
    super(parser, parts, ["SOQL_EXECUTE_END"], LOG_CATEGORY.SOQL, "free", DEBUG_CATEGORY.Database);
    this.lineNumber = this.parseLineNumber(parts[2]);
    const [, , , aggregations, soqlString] = parts;
    const aggregationText = aggregations || "";
    if (aggregationText) {
      const aggregationIndex = aggregationText.indexOf("Aggregations:");
      this.aggregations = Number(aggregationText.slice(aggregationIndex + 13));
    }
    this.text = soqlString || "";
  }
  onEnd(end, _stack) {
    this.soqlRowCount.total = this.soqlRowCount.self = end.soqlRowCount.total;
  }
};
var SOQLExecuteEndLine = class extends LogEvent {
  isExit = true;
  constructor(parser, parts) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.soqlRowCount.total = this.soqlRowCount.self = parseRows(parts[3] || "");
  }
};
function parseNumericField(text, prefix) {
  if (!text) return null;
  const idx = text.indexOf(prefix);
  if (idx === -1) return null;
  const raw = Number(text.slice(idx + prefix.length));
  return Number.isFinite(raw) ? raw : null;
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
        this.sObjectCardinality = parseNumericField(sobjCardinalityText, "sobjectCardinality: ");
        this.relativeCost = parseNumericField(costText, "relativeCost ");
      }
    }
  }
};
var SOSLExecuteBeginLine = class extends DurationLogEvent {
  soslCount = {
    self: 1,
    total: 1
  };
  constructor(parser, parts) {
    super(parser, parts, ["SOSL_EXECUTE_END"], LOG_CATEGORY.SOQL, "free", DEBUG_CATEGORY.Database);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `SOSL: ${parts[3]}`;
  }
  onEnd(end, _stack) {
    this.soslRowCount.total = this.soslRowCount.self = end.soslRowCount.total;
  }
};
var SOSLExecuteEndLine = class extends LogEvent {
  isExit = true;
  constructor(parser, parts) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.soslRowCount.total = this.soslRowCount.self = parseRows(parts[3] || "");
  }
};
var QueueableBeginLine = class extends DurationLogEvent {
  constructor(parser, parts) {
    super(parser, parts, ["QUEUEABLE_END"], LOG_CATEGORY.CodeUnit, "custom", DEBUG_CATEGORY.ApexCode);
    const linePart = String(parts[2] || "");
    if (/^\[[^\]]+\]$/.test(linePart)) this.lineNumber = this.parseLineNumber(linePart);
    this.text = String(parts.slice(3).join("|") || "").trim();
  }
};
var QueueableEndLine = class extends LogEvent {
  isExit = true;
  constructor(parser, parts) {
    super(parser, parts);
    const linePart = String(parts[2] || "");
    if (/^\[[^\]]+\]$/.test(linePart)) this.lineNumber = this.parseLineNumber(linePart);
    this.text = String(parts.slice(3).join("|") || "").trim();
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
    ["Maximum heap size", "heapSize"],
    ["Number of callouts", "callouts"],
    ["Number of Email Invocations", "emailInvocations"],
    ["Number of future calls", "futureCalls"],
    ["Number of queueable jobs added to the queue", "queueableJobsAddedToQueue"],
    ["Number of Mobile Apex push calls", "mobileApexPushCalls"]
  ]);
  namespace = "default";
  constructor(parser, parts) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.ApexProfiling;
    this.acceptsText = true;
    this.text = parts[2] || "";
  }
  onAfter(parser, _next) {
    const rawNs = this.text.split(/\r?\n/)[0]?.replace(/\|$/, "").trim() ?? "";
    this.namespace = rawNs.replace(/^\((.+)\)$/, "$1");
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
          const used = parseInt(match[2].replace(/,/g, ""), 10);
          const limit = parseInt(match[3].replace(/,/g, ""), 10);
          if (key && !isNaN(used) && !isNaN(limit)) {
            limits[key] = { used, limit };
          }
        }
      }
    }
    parser.governorLimits.byNamespace.set(this.namespace, limits);
    parser.governorLimits.snapshots.push({
      timestamp: this.timestamp,
      namespace: this.namespace,
      limits
    });
  }
};
var NBANodeBegin = class extends DurationLogEvent {
  constructor(parser, parts) {
    super(parser, parts, ["NBA_NODE_END"], LOG_CATEGORY.Automation, "method", DEBUG_CATEGORY.NBA);
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
    super(parser, parts, ["QUERY_MORE_END"], LOG_CATEGORY.SOQL, "custom", DEBUG_CATEGORY.Database);
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
    const rawNs = parts[2] || "", lastDot = rawNs.lastIndexOf(".");
    this.text = this.namespace = lastDot < 0 ? rawNs : rawNs.substring(lastDot + 1);
  }
  onAfter(parser, end) {
    if (end) {
      this.exitStamp = end.timestamp;
      this.recalculateDurations();
    }
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
    this.text = parts[3] || "";
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
    this.text = parts[2] || "";
  }
  onAfter(parser, _next) {
    const newLineIndex = this.text.indexOf("\n");
    const summary = newLineIndex > -1 ? this.text.slice(0, newLineIndex + 1) : this.text;
    const detailText = summary.length !== this.text.length ? this.text : "";
    parser.addLogIssue(this.timestamp, "FATAL ERROR! cause=" + summary, detailText, "error");
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
  ["VF_DESERIALIZE_CONTINUATION_STATE_BEGIN", VFDeserializeContinuationStateBegin],
  ["VF_SERIALIZE_VIEWSTATE_BEGIN", VFSeralizeViewStateStartLine],
  ["VF_PAGE_MESSAGE", VFPageMessageLine],
  ["DML_BEGIN", DMLBeginLine],
  ["DML_END", DMLEndLine],
  ["DML_ERROR", DMLErrorLine],
  ["IDEAS_QUERY_EXECUTE", IdeasQueryExecuteLine],
  ["SOQL_EXECUTE_BEGIN", SOQLExecuteBeginLine],
  ["SOQL_EXECUTE_END", SOQLExecuteEndLine],
  ["SOQL_EXECUTE_EXPLAIN", SOQLExecuteExplainLine],
  ["SOSL_EXECUTE_BEGIN", SOSLExecuteBeginLine],
  ["SOSL_EXECUTE_END", SOSLExecuteEndLine],
  ["QUEUEABLE_BEGIN", QueueableBeginLine],
  ["QUEUEABLE_END", QueueableEndLine],
  ["HEAP_ALLOCATE", HeapAllocateLine],
  ["HEAP_DEALLOCATE", HeapDeallocateLine],
  ["STATEMENT_EXECUTE", StatementExecuteLine],
  ["VARIABLE_SCOPE_BEGIN", VariableScopeBeginLine],
  ["VARIABLE_ASSIGNMENT", VariableAssignmentLine],
  ["USER_INFO", UserInfoLine],
  ["USER_DEBUG", UserDebugLine],
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
  ["EVENT_SERVICE_PUB_BEGIN", EventServicePubBeginLine],
  ["EVENT_SERVICE_PUB_END", EventServicePubEndLine],
  ["EVENT_SERVICE_PUB_DETAIL", EventServicePubDetailLine],
  ["EVENT_SERVICE_SUB_BEGIN", EventServiceSubBeginLine],
  ["EVENT_SERVICE_SUB_DETAIL", EventServiceSubDetailLine],
  ["EVENT_SERVICE_SUB_END", EventServiceSubEndLine],
  ["FLOW_START_INTERVIEWS_BEGIN", FlowStartInterviewsBeginLine],
  ["FLOW_START_INTERVIEWS_ERROR", FlowStartInterviewsErrorLine],
  ["FLOW_START_INTERVIEW_BEGIN", FlowStartInterviewBeginLine],
  ["FLOW_START_INTERVIEW_LIMIT_USAGE", FlowStartInterviewLimitUsageLine],
  ["FLOW_START_SCHEDULED_RECORDS", FlowStartScheduledRecordsLine],
  ["FLOW_CREATE_INTERVIEW_ERROR", FlowCreateInterviewErrorLine],
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
  ["WF_FIELD_UPDATE", WFFieldUpdateLine],
  ["WF_RULE_EVAL_BEGIN", WFRuleEvalBeginLine],
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
  "FUTURE_METHOD_BEGIN",
  "BATCH_APEX_START_BEGIN",
  "BATCH_APEX_EXECUTE_BEGIN",
  "BULK_COUNTABLE_STATEMENT_EXECUTE",
  "TEMPLATE_PROCESSING_ERROR",
  "EXTERNAL_SERVICE_REQUEST",
  "FLOW_CREATE_INTERVIEW_BEGIN",
  "FLOW_CREATE_INTERVIEW_END",
  "VARIABLE_SCOPE_END",
  "PUSH_NOTIFICATION_NOT_ENABLED",
  "SLA_NULL_START_DATE",
  "VALIDATION_FAIL",
  "WF_FLOW_ACTION_BEGIN",
  "WF_FLOW_ACTION_END",
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
  "DATAWEAVE_USER_DEBUG",
  "USER_DEBUG_FINER",
  "USER_DEBUG_FINEST",
  "USER_DEBUG_FINE",
  "USER_DEBUG_DEBUG",
  "USER_DEBUG_INFO",
  "USER_DEBUG_WARN",
  "USER_DEBUG_ERROR",
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
  "FUTURE_METHOD_END",
  "BATCH_APEX_EXECUTE_END",
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
  "ORG_CACHE_PUT_END",
  "ORG_CACHE_GET_END",
  "ORG_CACHE_REMOVE_END",
  "SESSION_CACHE_PUT_END",
  "SESSION_CACHE_GET_END",
  "SESSION_CACHE_REMOVE_END"
]);
var typePattern = /^[A-Z_]*$/;
var settingsPattern = /^\d+\.\d+\sAPEX_CODE,\w+;APEX_PROFILING,.+$/m;
var ApexLogParser = class {
  logIssues = [];
  parsingErrors = [];
  maxSizeTimestamp = null;
  reasons = /* @__PURE__ */ new Set();
  lastTimestamp = 0;
  discontinuity = false;
  namespaces = /* @__PURE__ */ new Set();
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
   * Takes string input of a log and returns the ApexLog class, which represents a log tree
   * @param {string} debugLog
   * @returns {ApexLog}
   */
  parse(debugLog) {
    const lineGenerator = this.generateLogLines(debugLog);
    const apexLog = this.toLogTree(lineGenerator);
    apexLog.size = debugLog.length;
    apexLog.debugLevels = this.getDebugLevels(debugLog);
    apexLog.logIssues = this.logIssues;
    apexLog.parsingErrors = this.parsingErrors;
    apexLog.namespaces = Array.from(this.namespaces);
    apexLog.governorLimits = this.governorLimits;
    this.addGovernorLimits(apexLog);
    return apexLog;
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
  parseLine(line, lastEntry) {
    const parts = line.split("|");
    const type = parts[1] ?? "";
    const metaCtor = getLogEventClass(type);
    if (metaCtor) {
      const entry = new metaCtor(this, parts);
      entry.logLine = line;
      lastEntry?.onAfter?.(this, entry);
      if (entry.namespace) {
        this.namespaces.add(entry.namespace);
      }
      return entry;
    }
    const hasType = !!(type && typePattern.test(type));
    if (!hasType && lastEntry?.acceptsText) {
      if (lastEntry.text.length < 1e5) {
        lastEntry.text += "\n" + line;
      } else if (lastEntry.text.length === 1e5) {
        this.addLogIssue(
          lastEntry.timestamp,
          "Text-Truncation",
          `Text field for event at line ${lastEntry.lineNumber} exceeded 100KB and was truncated to prevent memory exhaustion.`,
          "skip"
        );
      }
    } else if (hasType) {
      const message = `Unsupported log event name: ${type}`;
      if (!this.parsingErrors.includes(message)) {
        this.parsingErrors.push(message);
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
      this.parsingErrors.push(`Invalid log line: ${line}`);
    }
    return null;
  }
  *generateLogLines(log) {
    let startIndex = log.search(/^\d{2}:\d{2}:\d{2}\.\d{1,3} \(\d+\)\|EXECUTION_STARTED$/m);
    if (startIndex === -1) {
      startIndex = 0;
    }
    const hascrlf = log.indexOf("\r\n", startIndex) > -1;
    let lastEntry = null;
    let lfIndex = null;
    let eolIndex = lfIndex = log.indexOf("\n", startIndex);
    let crlfIndex = -1;
    while (eolIndex !== -1) {
      if (hascrlf && eolIndex > crlfIndex) {
        crlfIndex = log.indexOf("\r", eolIndex - 1);
        eolIndex = crlfIndex + 1 === eolIndex ? crlfIndex : lfIndex;
      }
      const line2 = log.slice(startIndex, eolIndex);
      if (line2) {
        const entry = this.parseLine(line2, lastEntry);
        if (entry) {
          lastEntry = entry;
          yield entry;
        }
      }
      startIndex = lfIndex + 1;
      lfIndex = log.indexOf("\n", startIndex);
      if (lfIndex === -1) {
        eolIndex = -1;
      } else {
        eolIndex = lfIndex;
      }
    }
    const line = log.slice(startIndex, log.length);
    if (line) {
      const entry = this.parseLine(line, lastEntry);
      if (entry) {
        entry?.onAfter?.(this);
        yield entry;
      }
    }
  }
  toLogTree(lineGenerator) {
    const rootMethod = new ApexLog(this), stack = [];
    let line;
    const lineIter = new LineIterator(lineGenerator);
    while (line = lineIter.fetch()) {
      if (line.isParent) {
        this.parseTree(line, lineIter, stack, 0);
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
      currentLine.exitStamp = currentLine.timestamp;
      return;
    }
    if (currentLine.timestamp < this.lastTimestamp) {
      this.addLogIssue(
        currentLine.timestamp,
        "Timestamp-Violation",
        "A timestamp earlier than the previous entry was detected. The log may be corrupted or truncated, which can affect duration calculations.",
        "unexpected"
      );
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
            currentLine.onEnd?.(nextLine, stack);
            break;
          } else if (exitOnNextLine && (nextLine.nextLineIsExit || nextLine.isExit || nextLine.exitTypes.length > 0)) {
            currentLine.exitStamp = nextLine.timestamp;
            currentLine.onEnd?.(nextLine, stack);
            break;
          } else if (this.discontinuity && this.maxSizeTimestamp && nextLine.timestamp > this.maxSizeTimestamp) {
            currentLine.isTruncated = true;
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
        }
      } finally {
        stack.pop();
        currentLine.recalculateDurations();
      }
    }
  }
  isMatchingEnd(startMethod, endLine) {
    return !!(endLine.type && startMethod.exitTypes?.includes(endLine.type) && (endLine.lineNumber === startMethod.lineNumber || !endLine.lineNumber || !startMethod.lineNumber));
  }
  endMethod(startMethod, endLine, lineIter, stack) {
    startMethod.exitStamp = endLine.timestamp;
    if (this.isMatchingEnd(startMethod, endLine)) {
      this.discontinuity = false;
      lineIter.fetch();
      return true;
    } else if (this.discontinuity) {
      return true;
    } else {
      if (stack.some((m) => this.isMatchingEnd(m, endLine))) {
        return true;
      }
      this.addLogIssue(
        endLine.timestamp,
        "Unexpected-Exit",
        "An exit event was found without a corresponding entry event e.g a `METHOD_EXIT` event without a `METHOD_ENTRY`",
        "unexpected"
      );
      return false;
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
            lastPkg.exitStamp = child.exitStamp || child.timestamp;
            continue;
          } else if (!isPkg && child.exitStamp) {
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
    if (!this.reasons.has(summary)) {
      this.reasons.add(summary);
      this.logIssues.push({
        startTime,
        summary,
        description,
        type
      });
      this.logIssues.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    }
  }
  updateLogIssue(startTime, summary, description, type) {
    const elem = this.logIssues.findIndex((item) => {
      return item.summary === summary;
    });
    if (elem > -1) {
      this.logIssues.splice(elem, 1);
    }
    this.reasons.delete(summary);
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
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return void 0;
}
function readPath(obj, keys) {
  if (!isRecord(obj)) return void 0;
  for (const key of keys) {
    if (key in obj && obj[key] !== null && obj[key] !== void 0) return obj[key];
  }
  return void 0;
}
async function runVendorParser(logText) {
  const parser = new ApexLogParser();
  if (typeof parser.parse === "function") {
    return parser.parse(logText);
  }
  throw new Error("Parser contract violation: ApexLogParser.parse() is required.");
}
function preprocessLogText(logText) {
  return logText.split(/\r?\n/).map((line) => {
    const shortDml = line.match(
      /^(\d{2}:\d{2}:\d{2}\.\d+\s+\(\d+\)\|DML_BEGIN\|\[[^\]]+\])\|(Insert|Update|Upsert|Delete|Undelete|Merge)\|([^|]+)\|(\d+)$/
    );
    if (shortDml) {
      const [, prefix, operation, sObject, rows] = shortDml;
      return `${prefix}|Op:${operation}|Type:${sObject}|Rows:${rows}`;
    }
    return line;
  }).join("\n");
}
function normalizeTimeline(parserResult) {
  const nodes = [];
  const visit = (node, parentId) => {
    const children = Array.isArray(readPath(node, ["children"])) ? readPath(node, ["children"]) : [];
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      const type = asString(readPath(child, ["type"])) ?? "UNKNOWN";
      const timestampNs = asNumber(readPath(child, ["timestamp"])) ?? null;
      const endNs = asNumber(readPath(child, ["exitStamp"])) ?? null;
      const durationObj = readPath(child, ["duration"]);
      const durationNs = asNumber(isRecord(durationObj) ? durationObj.total : void 0) ?? null;
      const lineNumber = asNumber(readPath(child, ["lineNumber"])) ?? null;
      const text = asString(readPath(child, ["text"])) ?? null;
      const namespace = asString(readPath(child, ["namespace"])) ?? null;
      const id = `event-${nodes.length + 1}`;
      const event = {
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
          ...lineNumber !== null ? { lineIds: [lineNumber] } : {},
          confidence: "direct"
        }
      };
      nodes.push(event);
      visit(child, id);
    }
  };
  visit(parserResult, null);
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
  return issues.map((issue, index) => ({
    id: `issue-${index + 1}`,
    summary: asString(readPath(issue, ["summary"])) ?? "Log issue",
    description: asString(readPath(issue, ["description"])) ?? "",
    confidence: "direct"
  }));
}
async function parseLog(logText, options = {}) {
  const {
    sourceName = "inline.log",
    sourceType = "file",
    includeRawLines = false,
    enablePhaseInference = true
  } = options;
  const t0 = performance.now();
  const parserResult = await runVendorParser(preprocessLogText(logText));
  const parseTimeMs = Math.round((performance.now() - t0) * 1e3) / 1e3;
  const rawLines = includeRawLines ? logText.split(/\r?\n/).map((text, index) => ({
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
    capabilities: {
      includeRawLines,
      phaseInferenceEnabled: enablePhaseInference
    }
  };
}
function basename(filePath) {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}
function isRecord2(value) {
  return typeof value === "object" && value !== null;
}
function asNumber2(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
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
    if (key in obj && obj[key] != null) return obj[key];
  }
  return void 0;
}
function cloneJsonLike(value) {
  return JSON.parse(JSON.stringify(value));
}
function parseLogId(fileName) {
  const m = fileName.match(/(07L[a-zA-Z0-9]{12,})/);
  return m?.[1] ?? null;
}
function normalizeClock(value) {
  if (!value) return null;
  const m = value.match(/^(\d{2}:\d{2}:\d{2})\.(\d{1,3})$/);
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
  const parts = String(logLine || "").split("|");
  if (parts.length < 7) {
    return { userId: null, username: null, timezone: null };
  }
  const userId = parts[3]?.trim() || null;
  const username = parts[4]?.trim() || null;
  const timezone = parts[6]?.trim() || null;
  return { userId, username, timezone };
}
function countByKey(events, key) {
  const out = {};
  for (const event of events) {
    const value = key(event).trim() || "unknown";
    out[value] = (out[value] ?? 0) + 1;
  }
  return out;
}
function toLimit(used, max) {
  if (used === void 0 || max === void 0 || max <= 0) {
    return { used: used ?? null, max: max ?? null, pct: null, status: "unknown" };
  }
  const pct = Math.round(used / max * 1e4) / 100;
  const status = pct >= 95 ? "critical" : pct >= 80 ? "warn" : "ok";
  return { used, max, pct, status };
}
function flattenEvents(root) {
  const out = [];
  const walk = (node, parentIdx) => {
    const children = asArray(readPath2(node, ["children"]));
    for (const child of children) {
      const timestampNs = asNumber2(readPath2(child, ["timestamp"])) ?? 0;
      const endTimestampNs = asNumber2(readPath2(child, ["exitStamp"])) ?? null;
      const durationSelfNs = asNumber2(readPath2(readPath2(child, ["duration"]), ["self"])) ?? null;
      const durationTotalNs = asNumber2(readPath2(readPath2(child, ["duration"]), ["total"])) ?? null;
      const entry = {
        idx: out.length,
        parentIdx,
        type: asString2(readPath2(child, ["type"])) ?? "UNKNOWN",
        timestampNs,
        endTimestampNs,
        durationSelfNs,
        durationTotalNs,
        namespace: asString2(readPath2(child, ["namespace"])) ?? "default",
        category: asString2(readPath2(child, ["category"])) ?? "",
        debugCategory: asString2(readPath2(child, ["debugCategory"])) ?? "",
        cpuType: asString2(readPath2(child, ["cpuType"])) ?? "",
        lineNumber: asNumber2(readPath2(child, ["lineNumber"])) ?? null,
        text: asString2(readPath2(child, ["text"])) ?? "",
        logLine: asString2(readPath2(child, ["logLine"])) ?? "",
        isParent: readPath2(child, ["isParent"]) === true,
        aggregations: asNumber2(readPath2(child, ["aggregations"])) ?? null,
        soqlCountTotal: asNumber2(readPath2(readPath2(child, ["soqlCount"]), ["total"])) ?? null,
        soqlRowCountTotal: asNumber2(readPath2(readPath2(child, ["soqlRowCount"]), ["total"])) ?? null,
        soslCountTotal: asNumber2(readPath2(readPath2(child, ["soslCount"]), ["total"])) ?? null,
        soslRowCountTotal: asNumber2(readPath2(readPath2(child, ["soslRowCount"]), ["total"])) ?? null,
        dmlCountTotal: asNumber2(readPath2(readPath2(child, ["dmlCount"]), ["total"])) ?? null,
        dmlRowCountTotal: asNumber2(readPath2(readPath2(child, ["dmlRowCount"]), ["total"])) ?? null
      };
      out.push(entry);
      walk(child, entry.idx);
    }
  };
  walk(root, null);
  return out;
}
function parseDmlText(text) {
  const op = text.match(/Op:(\w+)/i)?.[1] ?? null;
  const sobject = text.match(/Type:([^|\s]+)/i)?.[1] ?? null;
  return { operation: op, sobject };
}
function parseCalloutRequestText(text) {
  const normalized = text || "";
  const endpoint = normalized.match(/Endpoint\s*=\s*([^,\]]+)/i)?.[1]?.trim() ?? normalized.match(/\bhttps?:\/\/[^\s,\]]+/i)?.[0]?.trim() ?? null;
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
  const codeMatch = t.match(/StatusCode[=:\s]+(\d{3})/i) ?? t.match(/\b([1-5]\d{2})\b/);
  const statusCode = codeMatch ? parseInt(codeMatch[1], 10) : null;
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
  if (type === "EXCEPTION_THROWN" || type === "FATAL_ERROR" || type === "VALIDATION_ERROR") return true;
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
  if (event.type === "FLOW_START_INTERVIEW_BEGIN") return event.text || "Flow interview";
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
  "a0C": "SBQQ__Quote__c",
  "a0j": "SBQQ__QuoteLine__c",
  "a0n": "SBQQ__Subscription__c",
  "0Hn": "SBQQ__QuoteLineGroup__c",
  "07L": "ApexLog"
};
function getKeyPrefix(id) {
  if (!id || id.length < 3) return "";
  return id.substring(0, 3);
}
function inferSObjectFromVarName(name) {
  const lower = name.toLowerCase();
  if (lower.includes("opportunitylineitem") || lower.includes("opplineitem") || lower.includes("oli")) return "OpportunityLineItem";
  if (lower.includes("opportunity") || lower.includes("opp")) return "Opportunity";
  if (lower.includes("account") || lower.includes("acct")) return "Account";
  if (lower.includes("contact")) return "Contact";
  if (lower.includes("product2") || lower.includes("product")) return "Product2";
  if (lower.includes("contract")) return "Contract";
  if (lower.includes("quote") && lower.includes("line")) return "SBQQ__QuoteLine__c";
  if (lower.includes("quote")) return "SBQQ__Quote__c";
  if (lower.includes("subscription")) return "SBQQ__Subscription__c";
  if (lower.includes("case")) return "Case";
  if (lower.includes("lead")) return "Lead";
  if (lower.includes("user")) return "User";
  return null;
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
  for (const va of variableAssignments) {
    if (!isRecord2(va.parsedValue)) continue;
    const directId = asString2(va.parsedValue.Id);
    if (directId && directId.length >= 15) {
      const prefix = getKeyPrefix(directId);
      if (!prefixMap.has(prefix)) {
        const inferred = inferSObjectFromVarName(va.variableName);
        if (inferred) prefixMap.set(prefix, inferred);
      }
    }
    for (const [key, val] of Object.entries(va.parsedValue)) {
      if (typeof key === "string" && key.length >= 15 && SALESFORCE_ID_RE.test(key)) {
        const prefix = getKeyPrefix(key);
        if (!prefixMap.has(prefix) && isRecord2(val)) {
          const inferred = inferSObjectFromVarName(va.variableName);
          if (inferred) prefixMap.set(prefix, inferred);
        }
      }
    }
  }
  for (const q of databaseSoql) {
    if (!q.targetObject) continue;
    const bindIds = String(q.query || "").match(SALESFORCE_ID_RE);
    if (bindIds) {
      for (const bid of bindIds) {
        const prefix = getKeyPrefix(bid);
        if (!prefixMap.has(prefix)) {
          if (/WHERE\s+Id\s+IN/i.test(String(q.query || ""))) {
            prefixMap.set(prefix, q.targetObject);
          }
        }
      }
    }
  }
  return prefixMap;
}
function extractRecordGraph(allEvents, variableAssignments, prefixMap, limitPerType = 100) {
  const recordsById = /* @__PURE__ */ new Map();
  const vaEventQueues = /* @__PURE__ */ new Map();
  for (const event of allEvents) {
    if (event.type !== "VARIABLE_ASSIGNMENT") continue;
    const sep = event.text.indexOf("|");
    const name = sep !== -1 ? event.text.slice(0, sep) : event.text;
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
        if (typeof item === "string" && item.length >= 15) {
          if (SALESFORCE_ID_RE.test(item)) {
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
          }
        } else if (isRecord2(item)) {
          extractRecordFromObject(item, va.variableName, timestampNs, lineNumber, prefixMap, recordsById);
        }
      }
    } else if (isRecord2(va.parsedValue)) {
      const obj = va.parsedValue;
      const directId = asString2(obj.Id);
      if (directId && directId.length >= 15) {
        extractRecordFromObject(obj, va.variableName, timestampNs, lineNumber, prefixMap, recordsById);
      } else {
        for (const [key, val] of Object.entries(obj)) {
          if (typeof key === "string" && key.length >= 15) {
            if (SALESFORCE_ID_RE.test(key) && isRecord2(val)) {
              const valRecord = val;
              const recordObj = asString2(valRecord.Id) ? valRecord : { Id: key, ...valRecord };
              extractRecordFromObject(recordObj, va.variableName, timestampNs, lineNumber, prefixMap, recordsById);
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
      truncatedTypes.push({ sObjectType, total: records.length, shown: shown.length });
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
function extractRecordFromObject(obj, variableName, timestampNs, lineNumber, prefixMap, recordsById, visited = /* @__PURE__ */ new Set()) {
  if (visited.has(obj)) return;
  visited.add(obj);
  const id = asString2(obj.Id);
  if (!id || id.length < 15) return;
  const existing = recordsById.get(id);
  if (existing && existing.fields.length > 0) return;
  const fields = [];
  const relationships = [];
  for (const [field, value] of Object.entries(obj)) {
    if (field === "Id") continue;
    if (field.endsWith("__r") && isRecord2(value)) {
      const relObj = value;
      const relId = asString2(relObj.Id);
      if (relId) {
        relationships.push({
          field,
          relatedId: relId,
          relatedSObject: resolveSObjectType(relId, prefixMap)
        });
        extractRecordFromObject(relObj, `${variableName}.${field}`, timestampNs, lineNumber, prefixMap, recordsById, visited);
      }
      for (const [relField, relValue] of Object.entries(relObj)) {
        if (relField !== "Id" && !relField.endsWith("__r") && !isRecord2(relValue)) {
          fields.push({ field: `${field}.${relField}`, value: relValue });
        }
      }
      continue;
    }
    if (typeof value === "string" && value.length >= 15) {
      if (SALESFORCE_ID_RE.test(value)) {
        const relSObject = resolveSObjectType(value, prefixMap);
        relationships.push({
          field,
          relatedId: value,
          relatedSObject: relSObject
        });
      }
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
      variableName,
      timestampNs,
      lineNumber,
      source: "variable_assignment"
    }
  });
}
function extractTargetObject(query) {
  const q = String(query || "");
  const m = q.match(/\bFROM\s+([a-zA-Z0-9_]+)/i);
  return m?.[1] ?? null;
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
  const cardinality = raw.match(/cardinality:\s*(\d+)/i)?.[1];
  const sobjectCardinality = raw.match(/sobjectCardinality:\s*(\d+)/i)?.[1];
  const relativeCost = raw.match(/relativeCost\s+(\d+(?:\.\d+)?)/i)?.[1];
  if (cardinality !== void 0) {
    const v = Number(cardinality);
    if (Number.isFinite(v)) out.cardinality = v;
  }
  if (sobjectCardinality !== void 0) {
    const v = Number(sobjectCardinality);
    if (Number.isFinite(v)) out.sobjectCardinality = v;
  }
  if (relativeCost !== void 0) {
    const v = Number(relativeCost);
    if (Number.isFinite(v)) out.relativeCost = v;
  }
  return out;
}
function parseVariableAssignment(event) {
  if (event.type !== "VARIABLE_ASSIGNMENT") return null;
  const parts = String(event.text || "").split("|").map((p) => p.trim());
  const variableName = parts[0] || "";
  const rawValue = parts[1] || "";
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
  else if (isRecord2(parsedValue)) isEmptyCollection = Object.keys(parsedValue).length === 0;
  return {
    variableName,
    rawValue,
    parsedValue,
    isEmptyCollection
  };
}
function parseVariableScope(event) {
  if (event.type !== "VARIABLE_SCOPE_BEGIN") return null;
  const parts = String(event.text || "").split("|").map((p) => p.trim());
  const variableName = parts[0] || "";
  const typeName = parts[1] || "";
  if (!variableName || !typeName) return null;
  return { variableName, typeName };
}
function parseCumulativeProfilingLine(line) {
  const executionMatch = line.match(/executed\s+(\d+)\s+times?\s+in\s+(\d+)\s+ms/i);
  if (!executionMatch) return null;
  const executionCount = Number(executionMatch[1]);
  const timeMs = Number(executionMatch[2]);
  const classMatch = line.match(/Class\.([^:]+):\s*line\s*(\d+)/);
  return {
    className: classMatch?.[1] ?? null,
    lineNumber: classMatch?.[2] ? Number(classMatch[2]) : null,
    executionCount,
    timeMs,
    rawLine: line.trim()
  };
}
function parseCumulativeDmlOperation(line) {
  const dmlMatch = line.match(/:\s*(Insert|Update|Upsert|Delete|Undelete|Merge):\s*([^:]+):\s*executed/i);
  if (!dmlMatch) return { operation: null, sObject: null };
  return {
    operation: dmlMatch[1] ?? null,
    sObject: dmlMatch[2]?.trim() ?? null
  };
}
function collectCumulativeProfilingSections(allEvents) {
  const out = {
    dmlOperations: [],
    methodInvocations: [],
    soqlOperations: []
  };
  const profilingEvents = allEvents.filter((event) => event.type === "CUMULATIVE_PROFILING");
  for (const event of profilingEvents) {
    const lines = String(event.text || "").split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const header = lines[0].toLowerCase();
    const bodyLines = lines.slice(1);
    if (header.startsWith("dml operations")) {
      for (const line of bodyLines) {
        const parsed = parseCumulativeProfilingLine(line);
        if (!parsed) continue;
        const dmlMeta = parseCumulativeDmlOperation(line);
        out.dmlOperations.push({
          ...parsed,
          operation: dmlMeta.operation,
          sObject: dmlMeta.sObject
        });
      }
      continue;
    }
    if (header.startsWith("method invocations")) {
      for (const line of bodyLines) {
        const parsed = parseCumulativeProfilingLine(line);
        if (parsed) out.methodInvocations.push(parsed);
      }
      continue;
    }
    if (header.startsWith("soql operations")) {
      for (const line of bodyLines) {
        const parsed = parseCumulativeProfilingLine(line);
        if (parsed) out.soqlOperations.push(parsed);
      }
    }
  }
  return out;
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
  let before = null;
  let after = null;
  for (const entry of timeline) {
    if (entry.timestampNs <= startNs) {
      before = entry;
    }
    if (entry.timestampNs >= startNs && entry.timestampNs <= endNs) {
      after = entry;
    }
  }
  if (!after) {
    for (const entry of timeline) {
      if (entry.timestampNs > endNs) {
        after = entry;
        break;
      }
    }
  }
  return {
    soqlBefore: before?.soql ?? null,
    soqlAfter: after?.soql ?? null,
    soqlRowsBefore: before?.soqlRows ?? null,
    soqlRowsAfter: after?.soqlRows ?? null,
    dmlBefore: before?.dml ?? null,
    dmlAfter: after?.dml ?? null
  };
}
function buildHeapAnalysis(allEvents, spans, executionPhases, spanIdByEventIdx) {
  const allocations = [];
  const deallocations = [];
  for (const event of allEvents) {
    if (event.type !== "HEAP_ALLOCATE" && event.type !== "HEAP_DEALLOCATE") continue;
    const bytesMatch = String(event.text || "").match(/Bytes:(\d+)/i);
    const bytes = bytesMatch ? Number(bytesMatch[1]) : 0;
    if (bytes === 0 && event.type === "HEAP_ALLOCATE") continue;
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
  const totalAllocatedBytes = allocations.reduce((sum, a) => sum + a.bytes, 0);
  const totalDeallocatedBytes = deallocations.reduce((sum, d) => sum + d.bytes, 0);
  const allHeapEvents = [...allocations, ...deallocations].sort((a, b) => a.timestampNs - b.timestampNs);
  const allocationSet = new Set(allocations);
  const sampleInterval = Math.max(1, Math.floor(allHeapEvents.length / 200));
  const watermarkSamples = [];
  let runningTotal = 0;
  let peakBytes = 0;
  let peakTimestampNs = null;
  for (let i = 0; i < allHeapEvents.length; i++) {
    const ev = allHeapEvents[i];
    const isAllocation = allocationSet.has(ev);
    runningTotal += isAllocation ? ev.bytes : -ev.bytes;
    if (runningTotal < 0) runningTotal = 0;
    if (runningTotal > peakBytes) {
      peakBytes = runningTotal;
      peakTimestampNs = ev.timestampNs;
    }
    if (i % sampleInterval === 0 || i === allHeapEvents.length - 1) {
      watermarkSamples.push({ timestampNs: ev.timestampNs, cumulativeBytes: runningTotal });
    }
  }
  if (peakTimestampNs !== null && !watermarkSamples.some((s) => s.timestampNs === peakTimestampNs)) {
    watermarkSamples.push({ timestampNs: peakTimestampNs, cumulativeBytes: peakBytes });
    watermarkSamples.sort((a, b) => a.timestampNs - b.timestampNs);
  }
  const byLine = /* @__PURE__ */ new Map();
  for (const alloc of allocations) {
    const key = `${alloc.lineNumber ?? "unknown"}|${alloc.namespace}`;
    const existing = byLine.get(key);
    if (existing) {
      existing.bytes += alloc.bytes;
      existing.count += 1;
    } else {
      byLine.set(key, { bytes: alloc.bytes, count: 1, namespace: alloc.namespace, parentSpanId: alloc.parentSpanId });
    }
  }
  const hotspotsByLine = Array.from(byLine.entries()).map(([key, data]) => {
    const lineNumber = key.split("|")[0];
    const num = Number(lineNumber);
    return {
      lineNumber: lineNumber === "unknown" || isNaN(num) ? null : num,
      totalBytes: data.bytes,
      count: data.count,
      avgBytes: Math.round(data.bytes / data.count),
      namespace: data.namespace,
      parentSpanId: data.parentSpanId
    };
  }).sort((a, b) => b.totalBytes - a.totalBytes).slice(0, 25);
  const byNamespace = {};
  for (const alloc of allocations) {
    const ns = alloc.namespace || "default";
    if (!byNamespace[ns]) byNamespace[ns] = { totalBytes: 0, count: 0 };
    byNamespace[ns].totalBytes += alloc.bytes;
    byNamespace[ns].count += 1;
  }
  const byPhase = executionPhases.map((phase) => {
    const phaseStart = phase.timing.startNs;
    const phaseEnd = phase.timing.endNs ?? phaseStart;
    let allocatedBytes = 0;
    let allocationCount = 0;
    for (const alloc of allocations) {
      if (alloc.timestampNs >= phaseStart && alloc.timestampNs <= phaseEnd) {
        allocatedBytes += alloc.bytes;
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
    netAllocatedBytes: totalAllocatedBytes - totalDeallocatedBytes,
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
  const first = trajectory[0];
  const last = trajectory[trajectory.length - 1];
  const burnRates = [];
  if (first && last && isRecord2(governorLimits)) {
    const elapsedSec = Math.max(1e-3, (last.timestampNs - first.timestampNs) / 1e9);
    const limitDefs = [
      { name: "soqlQueries", firstUsed: first.soqlUsed, lastUsed: last.soqlUsed, limitKey: "soqlQueries" },
      { name: "soqlRows", firstUsed: first.soqlRowsUsed, lastUsed: last.soqlRowsUsed, limitKey: "queryRows" },
      { name: "dmlStatements", firstUsed: first.dmlUsed, lastUsed: last.dmlUsed, limitKey: "dmlStatements" },
      { name: "dmlRows", firstUsed: first.dmlRowsUsed, lastUsed: last.dmlRowsUsed, limitKey: "dmlRows" },
      { name: "cpuTime", firstUsed: first.cpuUsed, lastUsed: last.cpuUsed, limitKey: "cpuTime" },
      { name: "heapSize", firstUsed: first.heapUsed, lastUsed: last.heapUsed, limitKey: "heapSize" },
      { name: "callouts", firstUsed: first.calloutsUsed, lastUsed: last.calloutsUsed, limitKey: "callouts" },
      { name: "futureCalls", firstUsed: first.futureCallsUsed, lastUsed: last.futureCallsUsed, limitKey: "futureCalls" },
      { name: "queueableJobsAddedToQueue", firstUsed: first.queueablesUsed, lastUsed: last.queueablesUsed, limitKey: "queueableJobsAddedToQueue" }
    ];
    for (const def of limitDefs) {
      const limObj = readPath2(governorLimits, [def.limitKey]);
      const max = isRecord2(limObj) ? asNumber2(limObj.limit) ?? null : null;
      const used = def.lastUsed;
      const pctUsed = used !== null && max !== null && max > 0 ? Math.round(used / max * 1e4) / 100 : null;
      let burnRatePerSec = null;
      let projectedHeadroom = null;
      if (def.firstUsed !== null && def.lastUsed !== null) {
        const delta = def.lastUsed - def.firstUsed;
        burnRatePerSec = Math.round(delta / elapsedSec * 1e3) / 1e3;
        if (max !== null && burnRatePerSec > 0) {
          const remaining = max - (def.lastUsed ?? 0);
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
  const byNamespace = {};
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
      if (point.soqlRowsUsed !== null) existing.soqlRowsUsed = point.soqlRowsUsed;
      if (point.dmlUsed !== null) existing.dmlUsed = point.dmlUsed;
      if (point.dmlRowsUsed !== null) existing.dmlRowsUsed = point.dmlRowsUsed;
      if (point.cpuUsed !== null) existing.cpuUsed = point.cpuUsed;
      if (point.heapUsed !== null) existing.heapUsed = point.heapUsed;
      if (point.calloutsUsed !== null) existing.calloutsUsed = point.calloutsUsed;
      if (point.futureCallsUsed !== null) existing.futureCallsUsed = point.futureCallsUsed;
      if (point.queueablesUsed !== null) existing.queueablesUsed = point.queueablesUsed;
    }
  }
  const phaseHeadroom = [];
  const totalPhases = executionPhases.length;
  for (let i = 0; i < totalPhases; i++) {
    const phase = executionPhases[i];
    const phaseEndNs = phase.timing.endNs ?? phase.timing.startNs;
    const closestPoint = trajectory.find((t) => t.timestampNs >= phaseEndNs) ?? last;
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
    const queueablesPct = pctOf(closestPoint.queueablesUsed, "queueableJobsAddedToQueue");
    const phasesRemaining = totalPhases - i - 1;
    let warning = null;
    const criticalPcts = [soqlPct, soqlRowsPct, dmlPct, cpuPct, heapPct, calloutsPct, futureCallsPct, queueablesPct].filter((p) => p !== null && p >= 80);
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
function assessDebugLevelQuality(parserResult) {
  const debugLevelsRaw = asArray(readPath2(parserResult, ["debugLevels"]));
  const levels = debugLevelsRaw.map((entry) => ({
    category: asString2(readPath2(entry, ["logCategory"])) ?? "",
    level: asString2(readPath2(entry, ["logLevel"])) ?? ""
  })).filter((e) => e.category !== "");
  const warnings = [];
  const levelRank = {
    NONE: 0,
    ERROR: 1,
    WARN: 2,
    INFO: 3,
    DEBUG: 4,
    FINE: 5,
    FINER: 6,
    FINEST: 7
  };
  const getLevelRank = (level) => levelRank[level.toUpperCase()] ?? 0;
  for (const entry of levels) {
    const cat = entry.category.toUpperCase();
    const rank = getLevelRank(entry.level);
    if (cat === "CALLOUT" && rank < levelRank.FINE) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation: "Set Callout to FINE or FINER for request/response detail",
        impact: "Callout URLs, HTTP methods, and response codes are not captured at INFO level"
      });
    }
    if (cat === "APEX_CODE" && rank < levelRank.FINE) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation: "Set Apex Code to FINE+ for method entry/exit and variable assignments",
        impact: "Method-level timing, variable values, and execution flow are limited"
      });
    }
    if (cat === "DATABASE" && rank < levelRank.FINE) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation: "Set Database to FINE+ for SOQL explain plans and DML detail",
        impact: "Query explain plans and row-level DML detail are not available"
      });
    }
    if (cat === "SYSTEM" && rank < levelRank.FINE) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation: "Set System to FINE+ for system method entry/exit events",
        impact: "System method timing data is incomplete"
      });
    }
    if (cat === "VALIDATION" && rank < levelRank.INFO) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation: "Set Validation to INFO+ for validation rule evaluation details",
        impact: "Validation rule formulas and outcomes are not captured"
      });
    }
    if (cat === "WORKFLOW" && rank < levelRank.INFO) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation: "Set Workflow to INFO+ for workflow rule and process builder detail",
        impact: "Workflow rule evaluation and field update details are missing"
      });
    }
    if (cat === "DATA_ACCESS" && rank === levelRank.NONE) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation: "Set Data Access to INFO+ if you need sharing/FLS evaluation details",
        impact: "Data access and sharing-related events are completely suppressed"
      });
    }
  }
  const apexLevel = levels.find((l) => l.category.toUpperCase() === "APEX_CODE");
  const dbLevel = levels.find((l) => l.category.toUpperCase() === "DATABASE");
  const apexRank = apexLevel ? getLevelRank(apexLevel.level) : 0;
  const dbRank = dbLevel ? getLevelRank(dbLevel.level) : 0;
  let overallQuality = "low";
  if (apexRank >= levelRank.FINEST && dbRank >= levelRank.FINEST) {
    overallQuality = "high";
  } else if (apexRank >= levelRank.FINE && dbRank >= levelRank.FINE) {
    overallQuality = "medium";
  }
  return { levels, warnings, overallQuality };
}
function buildCpuAttribution(spans) {
  const byType = {};
  const byNamespace = {};
  for (const span of spans) {
    const cpuKey = span.cpuType || "unknown";
    if (!byType[cpuKey]) byType[cpuKey] = { durationMs: 0, count: 0 };
    byType[cpuKey].durationMs += span.selfDurationMs ?? 0;
    byType[cpuKey].count += 1;
    const ns = span.namespace || "default";
    if (!byNamespace[ns]) byNamespace[ns] = { selfDurationMs: 0, totalDurationMs: 0, spanCount: 0 };
    byNamespace[ns].selfDurationMs += span.selfDurationMs ?? 0;
    byNamespace[ns].totalDurationMs += span.durationMs ?? 0;
    byNamespace[ns].spanCount += 1;
  }
  for (const entry of Object.values(byType)) {
    entry.durationMs = Math.round(entry.durationMs * 1e3) / 1e3;
  }
  for (const entry of Object.values(byNamespace)) {
    entry.selfDurationMs = Math.round(entry.selfDurationMs * 1e3) / 1e3;
    entry.totalDurationMs = Math.round(entry.totalDurationMs * 1e3) / 1e3;
  }
  return { byType, byNamespace };
}
function buildManagedPackageImpact(namespaces, spans, allEvents, totalDurationMs) {
  const packages = namespaces.filter((ns) => ns !== "default");
  if (packages.length === 0) return [];
  return packages.map((ns) => {
    const pkgSpans = spans.filter((s) => s.namespace === ns);
    const pkgEvents = allEvents.filter((e) => e.namespace === ns);
    const totalDuration = pkgSpans.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
    const selfDuration = pkgSpans.reduce((sum, s) => sum + (s.selfDurationMs ?? 0), 0);
    const soqlEvents = pkgEvents.filter((e) => e.type === "SOQL_EXECUTE_BEGIN");
    const dmlEvents = pkgEvents.filter((e) => e.type === "DML_BEGIN");
    const soqlRows = soqlEvents.reduce((sum, e) => sum + (e.soqlRowCountTotal ?? 0), 0);
    const dmlRows = dmlEvents.reduce((sum, e) => sum + (e.dmlRowCountTotal ?? 0), 0);
    return {
      namespace: ns,
      spanCount: pkgSpans.length,
      totalDurationMs: Math.round(totalDuration * 1e3) / 1e3,
      selfDurationMs: Math.round(selfDuration * 1e3) / 1e3,
      soqlCount: soqlEvents.length,
      soqlRows,
      dmlCount: dmlEvents.length,
      dmlRows,
      pctOfTotalDuration: totalDurationMs > 0 ? Math.round(totalDuration / totalDurationMs * 1e4) / 100 : null
    };
  }).sort((a, b) => b.totalDurationMs - a.totalDurationMs);
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
    return { ...va, timestampNs: event?.timestampNs ?? null, lineNumber: event?.lineNumber ?? null };
  }).sort((a, b) => (a.timestampNs ?? 0) - (b.timestampNs ?? 0));
  const seenIdsBefore = /* @__PURE__ */ new Set();
  return phaseSpans.map((span, index) => {
    const phaseStartNs = span.startNs;
    const nextPhaseStart = index < phaseSpans.length - 1 ? phaseSpans[index + 1].startNs : null;
    const phaseEndNs = span.endNs ?? nextPhaseStart ?? phaseStartNs + 1e9;
    const soqlInPhase = databaseSoql.filter((q) => {
      const qStart = q.evidence.timestampNs;
      return qStart != null && qStart >= phaseStartNs && qStart <= phaseEndNs;
    });
    const dmlInPhase = databaseDml.filter((d) => {
      const dStart = d.evidence.timestampNs;
      return d.source === "event" && dStart != null && dStart >= phaseStartNs && dStart <= phaseEndNs;
    });
    const totalSoqlRows = soqlInPhase.reduce((sum, q) => sum + (q.rows ?? 0), 0);
    const totalDmlRows = dmlInPhase.reduce((sum, d) => sum + (d.rows ?? 0), 0);
    const govDelta = computeGovernorDelta(limitTimeline, phaseStartNs, phaseEndNs);
    const vasInPhase = vaByTimestamp.filter(
      (va) => va.timestampNs != null && va.timestampNs >= phaseStartNs && va.timestampNs <= phaseEndNs
    );
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
    const outputIds = Array.from(phaseIds).filter((id) => !seenIdsBefore.has(id));
    for (const id of phaseIds) seenIdsBefore.add(id);
    const warnings = [];
    for (const q of soqlInPhase) {
      const qFindings = [];
      if ((q.rows ?? 0) === 0) qFindings.push("returned 0 rows");
      if ((q.durationMs ?? 0) >= 50) qFindings.push(`took ${q.durationMs?.toFixed(1)}ms`);
      if (q.explain?.available === false) qFindings.push("no explain plan");
      if (qFindings.length > 0) {
        warnings.push(`SOQL on ${q.targetObject ?? "unknown"}: ${qFindings.join(", ")}`);
      }
    }
    if (emptyResults.length > 0) {
      warnings.push(`Empty result maps: ${emptyResults.join(", ")}`);
    }
    const phaseDmlNoOp = dmlInPhase.find(
      (d) => d.operation?.toLowerCase() === "update" && (d.durationMs ?? 0) === 0 && (d.rows ?? 0) === 0
    );
    if (phaseDmlNoOp) {
      warnings.push(`DML update on ${phaseDmlNoOp.sObject ?? "unknown"} was a no-op`);
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
        pctOfTotal: totalDurationMs > 0 && span.durationMs !== null ? Math.round(span.durationMs / totalDurationMs * 1e4) / 100 : null
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
  if (typeof value === "string") {
    const matches = value.match(SALESFORCE_ID_RE);
    if (matches) {
      for (const id of matches) out.add(id);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectSalesforceIds(entry, out);
    return;
  }
  if (isRecord2(value)) {
    for (const v of Object.values(value)) collectSalesforceIds(v, out);
  }
}
function detectExecutionContext(rootCodeUnit, allEvents, variableAssignments) {
  const root = String(rootCodeUnit || "").toLowerCase();
  if (/execute_anonymous_apex|execute anonymous/i.test(root) || allEvents.some((e) => e.type === "CODE_UNIT_STARTED" && /execute_anonymous_apex|execute anonymous/i.test(e.text || ""))) {
    return {
      type: "anonymous_apex",
      label: "Anonymous Apex",
      confidence: "direct",
      signals: ["CODE_UNIT_STARTED text contains execute anonymous"],
      contextSource: "auto",
      phaseModel: "anonymous"
    };
  }
  if (allEvents.some((e) => e.type === "FUTURE_METHOD_BEGIN")) {
    return {
      type: "future_method",
      label: "Future Method",
      confidence: "direct",
      signals: ["FUTURE_METHOD_BEGIN event found"],
      contextSource: "auto",
      phaseModel: "async"
    };
  }
  if (allEvents.some((e) => e.type === "QUEUEABLE_BEGIN") || allEvents.some((e) => e.type === "SYSTEM_METHOD_ENTRY" && /QueueableContextImpl/i.test(e.text || ""))) {
    return {
      type: "queueable",
      label: "Queueable Apex",
      confidence: "direct",
      signals: ["QUEUEABLE_BEGIN event found or SYSTEM_METHOD_ENTRY with QueueableContextImpl"],
      contextSource: "auto",
      phaseModel: "async"
    };
  }
  if (root.includes("schedulable") || root.includes("scheduledapex") || allEvents.some(
    (e) => e.type === "CODE_UNIT_STARTED" && /schedulable|scheduled apex/i.test(e.text || "")
  )) {
    return {
      type: "scheduled",
      label: "Scheduled Apex",
      confidence: "derived",
      signals: ["rootCodeUnit or CODE_UNIT_STARTED contains Schedulable/Scheduled"],
      contextSource: "auto",
      phaseModel: "scheduled"
    };
  }
  if (allEvents.some((e) => e.type === "BATCH_APEX_START_BEGIN" || e.type === "BATCH_APEX_EXECUTE_BEGIN")) {
    return {
      type: "batch_execute",
      label: "Batch Apex",
      confidence: "direct",
      signals: ["BATCH_APEX_START_BEGIN or BATCH_APEX_EXECUTE_BEGIN event found"],
      contextSource: "auto",
      phaseModel: "batch"
    };
  }
  if (variableAssignments.some((v) => v.variableName === "scope" && (Array.isArray(v.parsedValue) || typeof v.parsedValue === "object" && v.parsedValue !== null)) || root.includes("batch") || root.includes("batchable")) {
    return {
      type: "batch_execute",
      label: "Batch Apex",
      confidence: "derived",
      signals: ["scope variable assignment or batch in root code unit name"],
      contextSource: "auto",
      phaseModel: "batch"
    };
  }
  if (allEvents.some(
    (e) => e.type === "CODE_UNIT_STARTED" && /platform event|__e\b/i.test(e.text || "") || e.type.startsWith("EVENT_SERVICE_") && /__e\b|platform event/i.test(e.text || "")
  )) {
    return {
      type: "platform_event",
      label: "Platform Event",
      confidence: "direct",
      signals: ["CODE_UNIT_STARTED/EVENT_SERVICE_* indicates platform event context"],
      contextSource: "auto",
      phaseModel: "trigger"
    };
  }
  if (root.includes("trigger") || allEvents.some((e) => e.type === "CODE_UNIT_STARTED" && /trigger event/i.test(e.text || ""))) {
    return {
      type: "synchronous_trigger",
      label: "Trigger",
      confidence: "direct",
      signals: ["rootCodeUnit or CODE_UNIT_STARTED contains trigger event"],
      contextSource: "auto",
      phaseModel: "trigger"
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
  const eventDml = databaseDml.filter((d) => d.source === "event" && d.sObject !== null);
  const setupEntries = eventDml.filter((d) => isSetupSObject(d.sObject));
  const nonSetupEntries = eventDml.filter((d) => !isSetupSObject(d.sObject));
  if (setupEntries.length === 0 || nonSetupEntries.length === 0) {
    return { detected: false, setupObjects: [], nonSetupObjects: [], evidence: [] };
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
function detectRecursiveTriggers(spans) {
  const triggerSpans = spans.filter(
    (s) => s.eventType === "CODE_UNIT_STARTED" && (String(s.label || "").includes("trigger event") || String(s.label || "").startsWith("__sfdc_trigger/"))
  );
  const byName = /* @__PURE__ */ new Map();
  for (const span of triggerSpans) {
    const key = extractTriggerName(String(span.label || "").trim()).toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(span);
  }
  const parentOf = new Map(
    spans.map((s) => [s.id, s.parentId ?? null])
  );
  function isAncestor(ancestorId, descendantId) {
    let current = parentOf.get(descendantId) ?? null;
    const seen = /* @__PURE__ */ new Set();
    while (current !== null) {
      if (seen.has(current)) break;
      seen.add(current);
      if (current === ancestorId) return true;
      current = parentOf.get(current) ?? null;
    }
    return false;
  }
  const recursive = [];
  for (const [, group] of byName) {
    if (group.length <= 1) continue;
    let hasNesting = false;
    outer:
      for (let i = 0; i < group.length; i++) {
        for (let j = 0; j < group.length; j++) {
          if (i === j) continue;
          if (isAncestor(group[i].id, group[j].id)) {
            hasNesting = true;
            break outer;
          }
        }
      }
    if (!hasNesting) continue;
    const lineNumbers = group.map((s) => Number(s?.evidence?.lineNumber)).filter((n) => Number.isFinite(n) && n >= 1).filter((n, i, arr) => arr.indexOf(n) === i).sort((a, b) => a - b);
    const rawLogLineTexts = group.map((s) => s?.evidence?.raw ?? null).filter((r) => r !== null && r.length > 0).filter((r, i, arr) => arr.indexOf(r) === i);
    recursive.push({
      triggerName: extractTriggerName(String(group[0].label || "").trim()),
      count: group.length,
      lineNumbers,
      rawLogLineTexts
    });
  }
  recursive.sort((a, b) => b.count - a.count);
  return { detected: recursive.length > 0, recursiveTriggers: recursive };
}
function extractSystemModeTransitions(allEvents, spanIdByEventIdx) {
  const transitions = [];
  for (const event of allEvents) {
    if (event.type !== "SYSTEM_MODE_ENTER" && event.type !== "SYSTEM_MODE_EXIT") continue;
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
function buildTriggerCascade(allEvents, databaseDml, childLimit = 20) {
  const triggerEvents = allEvents.filter(
    (event) => event.type === "CODE_UNIT_STARTED" && (String(event.text || "").includes("trigger event") || String(event.text || "").startsWith("__sfdc_trigger/"))
  );
  if (triggerEvents.length === 0) return { cascades: [], meta: { totalRootTriggers: 0, maxDepth: 0, truncatedNodes: [] } };
  const parentByIdx = new Map(
    allEvents.map((event) => [event.idx, event.parentIdx])
  );
  const triggerIdxSet = new Set(triggerEvents.map((event) => event.idx));
  const truncatedNodes = [];
  let maxDepthReached = 0;
  const isTriggerDescendantOf = (candidateIdx, ancestorIdx) => {
    let cursor = parentByIdx.get(candidateIdx) ?? null;
    const seen = /* @__PURE__ */ new Set();
    while (cursor !== null) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      if (cursor === ancestorIdx) return true;
      cursor = parentByIdx.get(cursor) ?? null;
    }
    return false;
  };
  const dmlByWindow = databaseDml.filter((d) => d.source === "event" && d.evidence.timestampNs !== null).sort((a, b) => (a.evidence.timestampNs ?? 0) - (b.evidence.timestampNs ?? 0));
  const buildNode = (triggerEvent, depth, visitedTriggerIdx) => {
    maxDepthReached = Math.max(maxDepthReached, depth);
    const startNs = triggerEvent.timestampNs;
    const endNs = triggerEvent.endTimestampNs ?? triggerEvent.timestampNs;
    const nextVisited = new Set(visitedTriggerIdx);
    nextVisited.add(triggerEvent.idx);
    const dmlInTrigger = dmlByWindow.filter((d) => {
      const ts = d.evidence.timestampNs ?? 0;
      return ts >= startNs && ts <= endNs;
    });
    const children = [];
    for (const dml of dmlInTrigger) {
      const dmlNode = {
        id: dml.id,
        label: `${dml.operation ?? "DML"} on ${dml.sObject ?? "unknown"}`,
        type: "dml",
        sObject: dml.sObject,
        operation: dml.operation,
        namespace: dml.namespace,
        durationMs: dml.durationMs,
        children: [],
        depth: depth + 1
      };
      const dmlTs = dml.evidence.timestampNs ?? 0;
      const maxTs = Math.min(endNs, dmlTs + 1e8);
      const allTriggered = triggerEvents.filter((candidate) => {
        if (nextVisited.has(candidate.idx)) return false;
        if (candidate.timestampNs <= dmlTs || candidate.timestampNs > maxTs) return false;
        return isTriggerDescendantOf(candidate.idx, triggerEvent.idx);
      }).sort((a, b) => a.timestampNs - b.timestampNs);
      const triggeredByDml = allTriggered.slice(0, childLimit);
      if (allTriggered.length > childLimit) {
        truncatedNodes.push({
          parentId: dml.id,
          totalChildren: allTriggered.length,
          shown: childLimit
        });
      }
      for (const childTrigger of triggeredByDml) {
        if (depth < 5) {
          dmlNode.children.push(buildNode(childTrigger, depth + 2, nextVisited));
        }
      }
      children.push(dmlNode);
    }
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
    (event) => !Array.from(triggerIdxSet).some(
      (ancestorIdx) => ancestorIdx !== event.idx && isTriggerDescendantOf(event.idx, ancestorIdx)
    )
  );
  const cascades = rootTriggers.sort((a, b) => a.timestampNs - b.timestampNs).map((event) => {
    if (!event) return null;
    return buildNode(event, 0, /* @__PURE__ */ new Set());
  }).filter((node) => node !== null);
  return {
    cascades,
    meta: {
      totalRootTriggers: rootTriggers.length,
      maxDepth: maxDepthReached,
      truncatedNodes
    }
  };
}
function extractNamedCredentials(allEvents) {
  const requestEvents = allEvents.filter((e) => e.type === "NAMED_CREDENTIAL_REQUEST");
  const pendingResponses = allEvents.filter((e) => e.type === "NAMED_CREDENTIAL_RESPONSE");
  return requestEvents.map((e, i) => {
    const parts = String(e.text || "").split(" : ");
    const credentialName = parts[0]?.trim() || null;
    const endpoint = parts[1]?.trim() || null;
    const methodRaw = parts[2]?.trim() || null;
    const method = methodRaw ? methodRaw.toUpperCase() : null;
    const nextRequestTs = requestEvents[i + 1]?.timestampNs ?? Number.MAX_SAFE_INTEGER;
    const responseIdx = pendingResponses.findIndex(
      (r) => r.timestampNs >= e.timestampNs && r.timestampNs < nextRequestTs
    );
    const response = responseIdx !== -1 ? pendingResponses.splice(responseIdx, 1)[0] : void 0;
    let statusCode = null;
    let statusText = null;
    if (response) {
      const parsed = parseCalloutResponseText(response.text);
      statusCode = parsed.statusCode;
      statusText = parsed.statusText;
    }
    return {
      id: `named-credential-${i + 1}`,
      credentialName,
      endpoint,
      method,
      statusCode,
      statusText,
      durationNs: e.durationTotalNs,
      durationMs: e.durationTotalNs !== null ? Math.round(e.durationTotalNs / 1e6 * 1e3) / 1e3 : null,
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
  return query.replace(/:\s*\w+/g, ":?").replace(/'[^']*'/g, "'?'").replace(/\b\d+\b/g, "?").replace(/\s+/g, " ").trim();
}
function buildSoqlPatternAnalysis(databaseSoql, limit = 30) {
  const groups = /* @__PURE__ */ new Map();
  for (const query of databaseSoql) {
    const pattern = normalizeSoqlPattern(query.query);
    if (!pattern) continue;
    const existing = groups.get(pattern);
    if (existing) {
      existing.executionCount += 1;
      existing.totalRows += query.rows ?? 0;
      existing.totalDurationMs += query.durationMs ?? 0;
      existing.queryIds.push(query.id);
    } else {
      groups.set(pattern, {
        pattern,
        targetObject: query.targetObject,
        executionCount: 1,
        totalRows: query.rows ?? 0,
        totalDurationMs: query.durationMs ?? 0,
        avgDurationMs: 0,
        queryIds: [query.id],
        isLoopSuspect: false,
        loopEvidence: null
      });
    }
  }
  const result = [];
  let singleExecutionCount = 0;
  for (const group of groups.values()) {
    group.avgDurationMs = group.executionCount > 0 ? Math.round(group.totalDurationMs / group.executionCount * 1e3) / 1e3 : 0;
    if (group.executionCount >= 3) {
      group.isLoopSuspect = true;
      const queryTimestamps = databaseSoql.filter((q) => group.queryIds.includes(q.id)).map((q) => q.evidence.timestampNs).filter((ts) => typeof ts === "number" && Number.isFinite(ts)).sort((a, b) => a - b);
      if (queryTimestamps.length >= 2) {
        const burstNs = queryTimestamps[queryTimestamps.length - 1] - queryTimestamps[0];
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
    if (event.type !== "SAVEPOINT_SET" && event.type !== "SAVEPOINT_ROLLBACK") continue;
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
  const bytesDirect = source.match(/(\d+)\s*bytes?/i);
  if (bytesDirect) return Number(bytesDirect[1]);
  const sizeWithUnit = source.match(/(\d+(?:\.\d+)?)\s*(kb|mb|b)\b/i);
  if (!sizeWithUnit) return null;
  const value = Number(sizeWithUnit[1]);
  const unit = sizeWithUnit[2].toLowerCase();
  if (!Number.isFinite(value)) return null;
  if (unit === "mb") return Math.round(value * 1024 * 1024);
  if (unit === "kb") return Math.round(value * 1024);
  return Math.round(value);
}
function buildInsightsReport(params) {
  const { filePath, fileBytes, generatedAt, parseTimeMs, parserResult, contextOverride } = params;
  const fileName = basename(filePath);
  const logId = parseLogId(fileName);
  const allEvents = flattenEvents(parserResult);
  const issues = asArray(readPath2(parserResult, ["logIssues"]));
  const parsingErrors = asArray(readPath2(parserResult, ["parsingErrors"]));
  const namespaces = asArray(readPath2(parserResult, ["namespaces"])).filter((v) => typeof v === "string");
  const governorLimits = readPath2(parserResult, ["governorLimits"]) ?? {};
  const startNs = asNumber2(readPath2(parserResult, ["startTime"])) ?? 0;
  const endNs = asNumber2(readPath2(parserResult, ["executionEndTime"])) ?? 0;
  const firstEvent = allEvents[0];
  const lastEvent = allEvents[allEvents.length - 1];
  let durationMs = 0;
  if (firstEvent && lastEvent) {
    const firstNs = asNumber2(firstEvent.timestampNs) ?? 0;
    const lastNs = asNumber2(lastEvent.timestampNs) ?? 0;
    if (lastNs > firstNs) {
      durationMs = Math.max(0, Math.round((lastNs - firstNs) / 1e6));
    }
  }
  if (durationMs === 0 && endNs > startNs) {
    durationMs = Math.max(0, Math.round((endNs - startNs) / 1e6));
  }
  const userInfoEvent = allEvents.find((e) => e.type === "USER_INFO");
  const parsedUserInfo = parseUserInfoFromLogLine(userInfoEvent?.logLine ?? "");
  const startTimestamp = firstEvent ? eventClockFromLogLine(firstEvent.logLine) : null;
  const endTimestamp = lastEvent ? eventClockFromLogLine(lastEvent.logLine) : null;
  const rootCodeUnit = allEvents.find((e) => e.type === "CODE_UNIT_STARTED")?.text ?? null;
  const allTriggerNames = Array.from(
    new Set(
      allEvents.filter((e) => e.type === "CODE_UNIT_STARTED" && e.text.includes("trigger event")).map((e) => e.text.replace(/.*?\|/, "").trim())
    )
  );
  const triggerNamesLimit = 50;
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
  const debugEvents = allEvents.filter((e) => e.type === "USER_DEBUG").map((e, i) => ({
    id: `debug-${i + 1}`,
    timestampNs: e.timestampNs,
    lineNumber: e.lineNumber,
    namespace: e.namespace,
    message: e.text,
    evidence: e.logLine || null
  }));
  const traceEvents = allEvents.map((e, i) => {
    const durationNs = e.durationTotalNs ?? null;
    const endNs2 = e.endTimestampNs ?? null;
    let durationMs2 = null;
    if (durationNs !== null && durationNs > 0) {
      durationMs2 = Math.round(durationNs / 1e6 * 1e3) / 1e3;
    } else if (endNs2 !== null && e.timestampNs !== null && endNs2 > e.timestampNs) {
      durationMs2 = Math.round((endNs2 - e.timestampNs) / 1e6 * 1e3) / 1e3;
    }
    return {
      id: `event-${i + 1}`,
      idx: e.idx,
      type: e.type,
      timestampNs: e.timestampNs,
      endNs: endNs2,
      durationNs,
      durationMs: durationMs2,
      lineNumber: e.lineNumber,
      namespace: e.namespace,
      text: e.text || null,
      raw: e.logLine || null
    };
  });
  const soqlEvents = allEvents.filter((e) => e.type === "SOQL_EXECUTE_BEGIN");
  const soslEvents = allEvents.filter((e) => e.type === "SOSL_EXECUTE_BEGIN");
  const dmlEvents = allEvents.filter((e) => e.type === "DML_BEGIN");
  const calloutEvents = allEvents.filter((e) => e.type === "CALLOUT_REQUEST");
  const soqlExplainByLine = /* @__PURE__ */ new Map();
  for (const explainEvent of allEvents.filter((e) => e.type === "SOQL_EXECUTE_EXPLAIN")) {
    if (explainEvent.lineNumber === null) continue;
    soqlExplainByLine.set(explainEvent.lineNumber, parseExplainPlan(explainEvent.text));
  }
  collectCumulativeProfilingSections(allEvents);
  const databaseSoql = soqlEvents.map((e, i) => ({
    id: `soql-${i + 1}`,
    query: e.text || null,
    targetObject: extractTargetObject(e.text || null),
    aggregations: e.aggregations,
    rows: e.soqlRowCountTotal,
    count: e.soqlCountTotal,
    durationNs: e.durationTotalNs,
    durationMs: e.durationTotalNs !== null ? Math.round(e.durationTotalNs / 1e6 * 1e3) / 1e3 : null,
    explain: e.lineNumber !== null ? soqlExplainByLine.get(e.lineNumber) ?? null : null,
    namespace: e.namespace,
    category: e.category || null,
    debugCategory: e.debugCategory || null,
    evidence: {
      lineNumber: e.lineNumber,
      timestampNs: e.timestampNs,
      raw: e.logLine || null
    }
  }));
  const databaseSosl = soslEvents.map((e, i) => ({
    id: `sosl-${i + 1}`,
    query: e.text || null,
    rows: e.soslRowCountTotal,
    count: e.soslCountTotal,
    durationNs: e.durationTotalNs,
    durationMs: e.durationTotalNs !== null ? Math.round(e.durationTotalNs / 1e6 * 1e3) / 1e3 : null,
    namespace: e.namespace,
    category: e.category || null,
    debugCategory: e.debugCategory || null,
    evidence: {
      lineNumber: e.lineNumber,
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
      rows: e.dmlRowCountTotal,
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
        timestampNs: e.timestampNs,
        raw: e.logLine || null
      }
    };
  });
  const databaseDml = databaseDmlFromEvents;
  const availableResponses = allEvents.filter((e) => e.type === "CALLOUT_RESPONSE").map((e, idx) => ({ event: e, idx }));
  const databaseCallouts = calloutEvents.map((e, i) => {
    const parsed = parseCalloutRequestText(e.text);
    const nextRequestTs = calloutEvents[i + 1]?.timestampNs ?? Number.MAX_SAFE_INTEGER;
    const matchIdx = availableResponses.findIndex(
      ({ event: r }) => r.timestampNs >= e.timestampNs && r.timestampNs < nextRequestTs
    );
    const responseEvent = matchIdx !== -1 ? availableResponses.splice(matchIdx, 1)[0].event : null;
    const responseParsed = responseEvent ? parseCalloutResponseText(responseEvent.text) : { statusCode: null, statusText: null };
    return {
      id: `callout-${i + 1}`,
      endpoint: parsed.endpoint,
      host: parsed.host,
      method: parsed.method,
      statusCode: responseParsed.statusCode,
      statusText: responseParsed.statusText,
      responseLineNumber: responseEvent?.lineNumber ?? null,
      durationNs: e.durationTotalNs,
      durationMs: e.durationTotalNs !== null ? Math.round(e.durationTotalNs / 1e6 * 1e3) / 1e3 : null,
      namespace: e.namespace,
      category: e.category || null,
      debugCategory: e.debugCategory || null,
      text: e.text || null,
      evidence: {
        lineNumber: e.lineNumber,
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
    const startNs2 = unit.startNs;
    const endNs2 = unit.endNs ?? unit.startNs;
    const meta = parseValidationCodeUnitLabel(String(unit.label || ""));
    const eventsInWindow = allEvents.filter((event) => event.timestampNs >= startNs2 && event.timestampNs <= endNs2).filter((event) => event.type.startsWith("VALIDATION_")).sort((a, b) => a.timestampNs - b.timestampNs);
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
      if (event.type === "VALIDATION_FORMULA") currentRule.formula = event.text || null;
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
      startNs: startNs2,
      endNs: endNs2,
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
    const startNs2 = unit.startNs;
    const endNs2 = unit.endNs ?? unit.startNs;
    const eventsInWindow = allEvents.filter((event) => event.timestampNs >= startNs2 && event.timestampNs <= endNs2).filter((event) => event.type.startsWith("FLOW_")).sort((a, b) => a.timestampNs - b.timestampNs);
    return {
      eventId: unit.eventId,
      label: unit.label,
      namespace: unit.namespace,
      startNs: startNs2,
      endNs: endNs2,
      totals: {
        eventCount: eventsInWindow.length,
        errorCount: eventsInWindow.filter((event) => event.type.includes("ERROR") || event.type.includes("FAULT")).length
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
    const startNs2 = unit.startNs;
    const endNs2 = unit.endNs ?? unit.startNs;
    const eventsInWindow = allEvents.filter((event) => event.timestampNs >= startNs2 && event.timestampNs <= endNs2).filter((event) => event.type.startsWith("WF_") || event.type === "EVENT_SERVICE_PUB_BEGIN").sort((a, b) => a.timestampNs - b.timestampNs);
    return {
      eventId: unit.eventId,
      label: unit.label,
      namespace: unit.namespace,
      startNs: startNs2,
      endNs: endNs2,
      totals: {
        eventCount: eventsInWindow.length,
        errorCount: eventsInWindow.filter((event) => event.type.includes("ERROR")).length
      },
      steps: eventsInWindow.map((event) => ({
        timestampNs: event.timestampNs,
        type: event.type,
        text: event.text || null,
        lineNumber: event.lineNumber
      }))
    };
  });
  const eventsByType = {};
  const lineToEventIds = {};
  const eventRangesByTimestamp = [];
  for (let i = 0; i < traceEvents.length; i += 1) {
    const eventView = traceEvents[i];
    const sourceEvent = allEvents[i];
    const eventId = String(eventView.id);
    const type = String(eventView.type || "UNKNOWN");
    if (!eventsByType[type]) eventsByType[type] = [];
    eventsByType[type].push(eventId);
    if (typeof eventView.lineNumber === "number" && Number.isFinite(eventView.lineNumber) && eventView.lineNumber >= 1) {
      const lineKey = String(eventView.lineNumber);
      if (!lineToEventIds[lineKey]) lineToEventIds[lineKey] = [];
      lineToEventIds[lineKey].push(eventId);
    }
    const startNs2 = Number(sourceEvent?.timestampNs ?? 0);
    const endNs2 = Number(sourceEvent?.endTimestampNs ?? sourceEvent?.timestampNs ?? 0);
    eventRangesByTimestamp.push({
      eventId,
      type,
      startNs: startNs2,
      endNs: endNs2 >= startNs2 ? endNs2 : startNs2,
      lineNumber: typeof eventView.lineNumber === "number" ? eventView.lineNumber : null
    });
  }
  const rawEventErrors = allEvents.filter((event) => isErrorEventType(event.type)).map((event) => {
    const summary = event.text || event.type;
    const description = event.text && event.text.includes("\n") ? event.text : "";
    return {
      type: event.type,
      summary,
      description,
      namespace: event.namespace,
      evidence: {
        lineNumber: event.lineNumber,
        timestampNs: event.timestampNs,
        raw: event.logLine || null
      }
    };
  });
  const issueErrors = issues.map((issue) => ({
    type: asString2(readPath2(issue, ["type"])) ?? "issue",
    summary: asString2(readPath2(issue, ["summary"])) ?? "Log issue",
    description: asString2(readPath2(issue, ["description"])) ?? "",
    namespace: "default",
    evidence: {
      lineNumber: asNumber2(readPath2(issue, ["lineNumber"])) ?? null,
      timestampNs: null
    }
  }));
  const parseErrors = parsingErrors.map((entry) => ({
    type: "parsing_error",
    summary: "Parser warning",
    description: String(entry),
    namespace: "default",
    evidence: {
      lineNumber: null,
      timestampNs: null
    }
  }));
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
  const dmlEventRows = databaseDml.filter((dml) => dml.source === "event").reduce((sum, dml) => sum + (dml.rows ?? 0), 0);
  const dmlByObject = databaseDml.filter((dml) => dml.source === "event").reduce((acc, dml) => {
    const key = dml.sObject || dml.operation || "Unknown";
    acc[key] = (acc[key] ?? 0) + (dml.rows ?? 0);
    return acc;
  }, {});
  const executionContext = (contextOverride ? buildContextOverride(contextOverride) : null) ?? detectExecutionContext(rootCodeUnit, allEvents, variableAssignments);
  const executionType = executionContext.label;
  const mixedDml = detectMixedDml(databaseDml);
  const recursiveTriggerDetection = detectRecursiveTriggers(spans);
  const namedCredentials = extractNamedCredentials(allEvents);
  const NC_PAIR_WINDOW_NS = 2e7;
  const pairedCalloutIds = /* @__PURE__ */ new Set();
  const pairedNcIds = /* @__PURE__ */ new Set();
  const integrationOperations = [];
  let integrationIdCounter = 0;
  for (const nc of namedCredentials) {
    const ncTs = nc.evidence.timestampNs ?? -1;
    const paired = databaseCallouts.find(
      (c) => !pairedCalloutIds.has(c.id) && (c.evidence.timestampNs ?? -1) >= ncTs && (c.evidence.timestampNs ?? -1) < ncTs + NC_PAIR_WINDOW_NS
    );
    if (paired) {
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
  const syntheticWarnings = [];
  const emptyQueries = databaseSoql.filter((query) => Number(query.rows ?? 0) === 0);
  for (const query of databaseSoql) {
    const findings = [];
    let highestSeverity = "info";
    const isEmptyResult = Number(query.rows ?? 0) === 0;
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
    syntheticWarnings.push({
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
  const emptyMapAssignments = variableAssignments.filter(
    (entry) => entry.isEmptyCollection && /^map/i.test(entry.variableName)
  );
  const seenEmptyMaps = /* @__PURE__ */ new Set();
  for (const entry of emptyMapAssignments.slice(0, 50)) {
    if (seenEmptyMaps.has(entry.variableName)) continue;
    seenEmptyMaps.add(entry.variableName);
    const evidenceEvent = allEvents.find(
      (event) => event.type === "VARIABLE_ASSIGNMENT" && event.text.startsWith(`${entry.variableName} |`)
    );
    const variableType = variableTypeByName.get(entry.variableName) ?? null;
    const displayType = variableType || "Map";
    syntheticWarnings.push({
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
    (dml) => dml.operation?.toLowerCase() === "update" && (dml.durationMs ?? 0) === 0 && Number(dml.rows ?? 0) === 0
  );
  if (noOpDml) {
    syntheticWarnings.push({
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
    syntheticWarnings.push({
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
    syntheticWarnings.push({
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
  const viewstateEvents = allEvents.filter((event) => event.type === "VF_SERIALIZE_VIEWSTATE_END");
  for (const event of viewstateEvents) {
    const bytes = parseViewstateBytes(event.text) ?? parseViewstateBytes(event.logLine);
    if (bytes === null || bytes < VIEWSTATE_WARN_BYTES) continue;
    const kb = Math.round(bytes / 1024 * 10) / 10;
    syntheticWarnings.push({
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
  const snapshotsRaw = isRecord2(governorLimits) ? asArray(readPath2(governorLimits, ["snapshots"])) : [];
  const byType = countByKey(allEvents, (e) => e.type);
  const byNamespace = countByKey(allEvents, (e) => e.namespace);
  const byCategory = countByKey(allEvents, (e) => e.category || "unknown");
  const byDebugCategory = countByKey(allEvents, (e) => e.debugCategory || "unknown");
  const spanHotspots = [...spans].sort((a, b) => (b.durationNs ?? 0) - (a.durationNs ?? 0)).slice(0, 25).map((span) => ({
    eventId: span.eventId,
    eventType: span.eventType,
    label: span.label,
    durationMs: span.durationMs,
    namespace: span.namespace,
    startNs: span.startNs,
    lineNumber: isRecord2(span.evidence) ? asNumber2(span.evidence.lineNumber) ?? null : null,
    parentId: span.parentId
  }));
  const queueableBeginEvents = allEvents.filter((event) => event.type === "QUEUEABLE_BEGIN");
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
    if (!queueableByLabel.has(hotspot.label)) queueableByLabel.set(hotspot.label, hotspot);
  }
  const hotspots = [...queueableByLabel.values(), ...spanHotspots].sort((a, b) => (a.startNs ?? Number.MAX_SAFE_INTEGER) - (b.startNs ?? Number.MAX_SAFE_INTEGER)).slice(0, 25);
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
  const { entries: recordGraph } = extractRecordGraph(allEvents, variableAssignments, prefixMap);
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
  const heapAnalysis = buildHeapAnalysis(allEvents, spans, executionPhases, unitIdByEventIdx);
  const governorBurnRate = buildGovernorBurnRate(
    snapshotsRaw,
    allEvents,
    executionPhases,
    durationMs,
    governorLimits
  );
  const { patterns: soqlPatterns } = buildSoqlPatternAnalysis(databaseSoql);
  const savepoints = extractSavepoints(allEvents, executionPhases);
  const systemModeTransitions = extractSystemModeTransitions(allEvents, unitIdByEventIdx);
  const triggerCascadeResult = buildTriggerCascade(allEvents, databaseDml);
  const triggerCascade = triggerCascadeResult.cascades;
  const debugLevelQuality = assessDebugLevelQuality(parserResult);
  const cpuAttribution = buildCpuAttribution(spans);
  const managedPackageImpact = buildManagedPackageImpact(namespaces, spans, allEvents, durationMs);
  for (const pattern of soqlPatterns) {
    if (!pattern.isLoopSuspect) continue;
    syntheticWarnings.push({
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
  const rollbacks = savepoints.filter((sp) => sp.type === "rollback");
  for (const rb of rollbacks) {
    syntheticWarnings.push({
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
      syntheticWarnings.push({
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
  const allErrorItems = [...issueErrors, ...parseErrors, ...rawEventErrors, ...syntheticWarnings].sort((a, b) => {
    const tsA = a.evidence.timestampNs ?? 0;
    const tsB = b.evidence.timestampNs ?? 0;
    if (tsA !== tsB) return tsA - tsB;
    const lineA = a.evidence.lineNumber ?? 0;
    const lineB = b.evidence.lineNumber ?? 0;
    return lineA - lineB;
  });
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
        outcome: rawEventErrors.length > 0 || issueErrors.length > 0 ? "error" : syntheticWarnings.length > 0 ? "warn" : "ok",
        errorCount: rawEventErrors.length + issueErrors.length,
        warningCount: parseErrors.length + syntheticWarnings.length
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
          count: soqlUsed !== void 0 && soqlUsed > 0 ? soqlUsed : databaseSoql.length,
          rows: soqlRowsUsed !== void 0 && soqlRowsUsed > 0 ? soqlRowsUsed : databaseSoql.reduce((sum, q) => sum + (q.rows ?? 0), 0)
        },
        sosl: {
          count: databaseSosl.length,
          rows: databaseSosl.reduce((sum, q) => sum + (q.rows ?? 0), 0)
        },
        dml: {
          statements: dmlStatementsUsed !== void 0 && dmlStatementsUsed > 0 ? dmlStatementsUsed : databaseDml.length,
          rows: dmlRowsUsed !== void 0 && dmlRowsUsed > 0 ? dmlRowsUsed : databaseDml.reduce((sum, d) => sum + (d.rows ?? 0), 0)
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
          start: startNs,
          end: endNs
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
          soqlQueries: toLimit(asNumber2(readPath2(soql, ["used"])), asNumber2(readPath2(soql, ["limit"]))),
          soqlRows: toLimit(asNumber2(readPath2(rows, ["used"])), asNumber2(readPath2(rows, ["limit"]))),
          dmlStatements: toLimit(
            asNumber2(readPath2(dmlStatements, ["used"])),
            asNumber2(readPath2(dmlStatements, ["limit"]))
          ),
          dmlRows: toLimit(asNumber2(readPath2(dmlRows, ["used"])), asNumber2(readPath2(dmlRows, ["limit"]))),
          cpuTimeMs: toLimit(asNumber2(readPath2(cpu, ["used"])), asNumber2(readPath2(cpu, ["limit"]))),
          heapBytes: toLimit(asNumber2(readPath2(heap, ["used"])), asNumber2(readPath2(heap, ["limit"]))),
          callouts: toLimit(asNumber2(readPath2(callouts, ["used"])), asNumber2(readPath2(callouts, ["limit"]))),
          queueables: toLimit(asNumber2(readPath2(queueables, ["used"])), asNumber2(readPath2(queueables, ["limit"])))
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
      hotspots
    },
    analysis: {
      executionType,
      scopeRecordIds: Array.from(scopeRecordIds).slice(0, 50),
      dmlImpact: {
        totalRows: dmlEventRows,
        byObject: dmlByObject
      },
      findings: {
        zeroRowQueries: emptyQueries.length,
        missingExplainPlans: databaseSoql.filter((q) => q.explain?.available === false).length,
        slowQueries: databaseSoql.filter((q) => (q.durationMs ?? 0) >= 50).length,
        loopSuspectQueries: soqlPatterns.filter((p) => p.isLoopSuspect).length,
        savepointRollbacks: savepoints.filter((sp) => sp.type === "rollback").length,
        criticalLimits: governorBurnRate.burnRates.filter((br) => br.status === "critical").length,
        peakHeapBytes: heapAnalysis.peakCumulativeBytes
      },
      recordSummary: {
        totalUniqueRecords: recordGraph.reduce((sum, g) => sum + g.recordCount, 0),
        bySObject: recordGraph.map((g) => ({
          sObjectType: g.sObjectType,
          keyPrefix: g.keyPrefix,
          count: g.recordCount
        }))
      }
    },
    executionPhases: cloneJsonLike(executionPhases),
    recordGraph: cloneJsonLike(
      recordGraph.map((entry) => ({
        sObjectType: entry.sObjectType,
        keyPrefix: entry.keyPrefix,
        recordCount: entry.recordCount,
        records: entry.records.map((r) => ({
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
      integrationOperations: cloneJsonLike(integrationOperations),
      soqlPatterns: cloneJsonLike(soqlPatterns)
    },
    heapAnalysis: cloneJsonLike(heapAnalysis),
    governorBurnRate: cloneJsonLike(governorBurnRate),
    savepoints: cloneJsonLike(savepoints),
    systemModeTransitions: cloneJsonLike(systemModeTransitions),
    triggerCascade: cloneJsonLike(triggerCascade),
    debugLevelQuality: cloneJsonLike(debugLevelQuality),
    cpuAttribution: cloneJsonLike(cpuAttribution),
    managedPackageImpact: cloneJsonLike(managedPackageImpact),
    mixedDmlAnalysis: cloneJsonLike(mixedDml),
    recursiveTriggerAnalysis: cloneJsonLike(recursiveTriggerDetection),
    errors: {
      count: allErrorItems.length,
      items: allErrorItems
    },
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
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return void 0;
}
function cloneJsonLike2(value) {
  return JSON.parse(JSON.stringify(value));
}
function lineEvidence(entry) {
  const lineNumber = asNumber3(asRecord(entry).lineNumber ?? asRecord(asRecord(entry).evidence).lineNumber) ?? null;
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
  const lines = events.map((event) => event.lineNumber).filter((line) => typeof line === "number" && Number.isFinite(line));
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
    return rawLogText.split(/\r?\n/).map((text, index) => ({
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
      lineNumber: event.lineNumber
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
  const eventsPerTypeLimit = limits.eventsPerType ?? 20;
  const truncationWarnings = [];
  const byTypePrefix = (prefix) => pickEventsByType(parseResult, (event) => event.type.startsWith(prefix), eventsPerTypeLimit);
  const byText = (regex) => findRawLineMatches(rawLines, (line) => regex.test(line.text), eventsPerTypeLimit).lines;
  const byTextWithMeta = (regex) => findRawLineMatches(rawLines, (line) => regex.test(line.text), eventsPerTypeLimit);
  const hasText = (regex) => rawLines.some((line) => regex.test(line.text));
  const dmlRows = asArray2(database.dml).filter((entry) => asString3(asRecord(entry).source) === "event");
  const wfEventsResult = byTypePrefix("WF_");
  const wfEvents = wfEventsResult.events;
  if (wfEventsResult.truncated) {
    truncationWarnings.push(`Workflow events truncated: showing ${wfEvents.length} of ${wfEventsResult.totalCount}`);
  }
  const flowEventsResult = byTypePrefix("FLOW_");
  const flowEvents = flowEventsResult.events;
  if (flowEventsResult.truncated) {
    truncationWarnings.push(`Flow events truncated: showing ${flowEvents.length} of ${flowEventsResult.totalCount}`);
  }
  const validationEventsResult = pickEventsByType(
    parseResult,
    (event) => event.type.startsWith("VALIDATION_") || /validation/i.test(String(event.text || "")),
    eventsPerTypeLimit
  );
  const validationEvents = validationEventsResult.events;
  if (validationEventsResult.truncated) {
    truncationWarnings.push(`Validation events truncated: showing ${validationEvents.length} of ${validationEventsResult.totalCount}`);
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
    (event) => (event.type === "WF_RULE_EVAL_BEGIN" || event.type === "WF_RULE_EVAL_END") && /sharing/i.test(String(event.text || "")),
    eventsPerTypeLimit
  );
  const sharingEvents = sharingEventsResult.events;
  const duplicateResult = byTextWithMeta(/DUPLICATE|MATCHING_RULE|duplicate rule/i);
  const duplicateEvents = rawLineEvents("DUPLICATE_RULE", duplicateResult.lines);
  if (duplicateResult.truncated) {
    truncationWarnings.push(`Duplicate rule matches truncated: showing ${duplicateResult.lines.length} of ${duplicateResult.totalCount}`);
  }
  const assignmentResult = byTextWithMeta(/ASSIGNMENT_RULE|Assignment rule|assigned to/i);
  const assignmentEvents = rawLineEvents("ASSIGNMENT_RULE", assignmentResult.lines);
  if (assignmentResult.truncated) {
    truncationWarnings.push(`Assignment rule matches truncated: showing ${assignmentResult.lines.length} of ${assignmentResult.totalCount}`);
  }
  const autoResponseResult = byTextWithMeta(/AUTO_RESPONSE|Auto-Response|auto response/i);
  const autoResponseEvents = rawLineEvents("AUTO_RESPONSE_RULE", autoResponseResult.lines);
  const processBuilderResult = byTextWithMeta(/PROCESS_BUILDER|Process Builder|launched by process/i);
  const processBuilderEvents = rawLineEvents("PROCESS_BUILDER", processBuilderResult.lines);
  const rollupResult = byTextWithMeta(/ROLLUP|Roll-Up|grandparent|parent record/i);
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
    (event) => event.type === "WF_CRITERIA_BEGIN" || event.type === "WF_CRITERIA_END" || event.type === "WF_RULE_EVAL_BEGIN" || event.type === "WF_RULE_EVAL_END",
    eventsPerTypeLimit
  );
  const wfCriteriaEvents = wfCriteriaEventsResult.events;
  const postCommitEventsResult = pickEventsByType(
    parseResult,
    (event) => /EMAIL_QUEUE|FUTURE_METHOD_BEGIN|BATCH_APEX_START|FLOW_CREATE_INTERVIEW_BEGIN/.test(event.type) || /queueable|future method|post-commit|email queued/i.test(String(event.text || "")),
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
    truncationWarnings.push(`Before-trigger events truncated: showing ${beforeTriggerEvents.length} of ${beforeTriggerEventsResult.totalCount}`);
  }
  const afterTriggerEventsResult = pickEventsByType(
    parseResult,
    (event) => event.type === "CODE_UNIT_STARTED" && /trigger event After/i.test(String(event.text || "")),
    eventsPerTypeLimit
  );
  const afterTriggerEvents = afterTriggerEventsResult.events;
  if (afterTriggerEventsResult.truncated) {
    truncationWarnings.push(`After-trigger events truncated: showing ${afterTriggerEvents.length} of ${afterTriggerEventsResult.totalCount}`);
  }
  const rawLineByNumber = /* @__PURE__ */ new Map();
  for (const line of rawLines) {
    if (!rawLineByNumber.has(line.lineNumber)) {
      rawLineByNumber.set(line.lineNumber, line);
    }
  }
  const beforeSaveFlowEvents = flowEvents.filter(
    (event) => /before save/i.test(event.lineNumber != null ? rawLineByNumber.get(event.lineNumber)?.text ?? "" : "")
  );
  const afterSaveFlowEvents = flowEvents.filter(
    (event) => /after save|Case_Notification_Flow|High_Priority_Escalation_Flow/i.test(
      event.lineNumber != null ? rawLineByNumber.get(event.lineNumber)?.text ?? "" : ""
    )
  );
  const fatalErrorResult = pickEventsByType(parseResult, (event) => event.type === "FATAL_ERROR", eventsPerTypeLimit);
  const hasFatalError = fatalErrorResult.events.length > 0;
  const hasExecution = Boolean(rootCodeUnit || executionType || parseResult.normalizedTimeline.length > 0);
  const signals = {
    "phase-01-load-original-record": {
      observed: false,
      inferred: hasExecution,
      confidence: "inferred",
      events: rawLineEvents("LOAD_ORIGINAL", byText(/trigger\.old|Phase1 - trigger\.old/i)),
      warnings: parseResult.capabilities.phaseInferenceEnabled ? ["Phase inferred from transaction context because Salesforce does not emit a direct event for this load step."] : []
    },
    "phase-02-system-validation": {
      observed: validationEvents.length > 0 || hasText(/system validation phase active|layout rules|required fields|foreign key|self-referential/i),
      inferred: !validationEvents.length && hasExecution,
      confidence: validationEvents.length > 0 ? "direct" : "derived",
      events: validationEvents.length > 0 ? validationEvents : rawLineEvents("SYSTEM_VALIDATION", byText(/system validation|foreign key|self-reference/i)),
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
      events: beforeSaveFlowEvents.length > 0 ? beforeSaveFlowEvents : rawLineEvents("FLOW_BEFORE_SAVE", byText(/Before-Save|BeforeSave|Opportunity_BeforeSave_Enrichment/i)),
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
      })) : rawLineEvents("SOFT_SAVE", byText(/trigger\.new IDs|soft-save|soft save/i)),
      warnings: dmlRows.length === 0 && (afterTriggerEvents.length > 0 || hasText(/trigger\.new IDs|soft-save|soft save/i)) ? ["Soft save inferred from after-trigger execution and post-save record IDs."] : []
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
      observed: criteriaEvents.length > 0 || hasText(/Grandparent RUS cascade|Grandparent save complete|OpportunityGroup__c/i),
      inferred: criteriaEvents.length === 0 && !hasText(/Grandparent RUS cascade|Grandparent save complete|OpportunityGroup__c/i) && hasText(/Criteria-Based|criteria/i),
      confidence: criteriaEvents.length > 0 ? "derived" : hasText(/Grandparent RUS cascade|Grandparent save complete|OpportunityGroup__c/i) ? "derived" : "derived",
      events: criteriaEvents.length > 0 ? criteriaEvents : rawLineEvents("GRANDPARENT_RUS", byText(/Grandparent RUS cascade|Grandparent save complete|OpportunityGroup__c/i)),
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
      events: rawLineEvents("DML_COMMIT", byText(/EXECUTION_FINISHED|LIMIT_USAGE_FOR_NS/i)),
      warnings: parseResult.capabilities.phaseInferenceEnabled && dmlRows.length > 0 && !hasFatalError ? ["Commit inferred from successful transaction completion and absence of FATAL_ERROR before EXECUTION_FINISHED."] : []
    },
    "phase-20-post-commit-logic": {
      observed: postCommitEvents.length > 0,
      inferred: false,
      confidence: postCommitEvents.length > 0 ? "direct" : "derived",
      events: postCommitEvents,
      warnings: warnings.filter((warning) => /queueable|future|email|post-commit/i.test(asString3(warning.summary) ?? "")).slice(0, 5).map((warning) => asString3(warning.summary) ?? "Post-commit activity")
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
  const defaultFallbackLine = asNumber3(asRecord(asArray2(asRecord(asRecord(base.trace).events))[0])["lineNumber"]) ?? null;
  const { signals, truncationWarnings } = buildPhaseSignals(base, parseResult, rawLines, limits);
  const soqlCount = asArray2(database.soql).length;
  const dmlCount = asArray2(database.dml).filter((entry) => asString3(asRecord(entry).source) === "event").length;
  const outputs = EXECUTION_PHASE_DEFINITIONS.map((definition) => {
    const signal = signals[definition.id];
    const observed = signal.observed;
    const inferred = !observed && signal.inferred && parseResult.capabilities.phaseInferenceEnabled;
    const status = observed ? "observed" : inferred ? "inferred" : "not_observed";
    const confidence = observed ? "direct" : inferred ? "inferred" : definition.defaultConfidence === "direct" ? "derived" : definition.defaultConfidence;
    const evidence = firstPhaseEvidence(signal.events, defaultFallbackLine, confidence);
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
  const events = asArray2(asRecord(asRecord(base.trace).events)).map((event) => asRecord(event));
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
    lineToEvents: cloneJsonLike2(asRecord(asRecord(base.indexes).lineToEventIds))
  };
}
function buildOfflineReport(input) {
  const generatedAt = input.source.generatedAt ?? (/* @__PURE__ */ new Date()).toISOString();
  const limits = input.limits ?? {};
  const base = buildInsightsReport({
    filePath: input.source.fileName,
    fileBytes: input.source.bytes,
    generatedAt,
    parseTimeMs: input.parseResult.parseTimeMs,
    parserResult: input.parseResult.parserResult
  });
  const rawLines = coerceRawLines(input.parseResult.rawLines, input.rawLogText);
  const { outputs: phases, truncationWarnings: phaseTruncationWarnings } = buildPhaseOutputs(
    base,
    input.parseResult,
    rawLines,
    limits
  );
  const source = {
    ...cloneJsonLike2(asRecord(base.source)),
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
      phaseInferenceEnabled: input.parseResult.capabilities.phaseInferenceEnabled
    },
    namespaces: cloneJsonLike2(
      asArray2(asRecord(asRecord(base.components).namespaces)).filter((value) => typeof value === "string")
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
    limits
  };
  const entryPoint = {
    type: asString3(asRecord(asRecord(base.context).transaction).requestType) ?? null,
    name: asString3(asRecord(asRecord(base.context).transaction).rootCodeUnit) ?? null,
    recordIds: cloneJsonLike2(
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
    endNs: event.endNs,
    durationNs: event.durationNs,
    lineNumber: event.lineNumber,
    text: event.text,
    namespace: event.namespace,
    parentId: event.parentId,
    evidence: event.evidence
  }));
  const execution = {
    blocks: [],
    tree: []
  };
  const database = cloneJsonLike2(asRecord(base.database));
  const governorLimits = {
    current: cloneJsonLike2(asRecord(asRecord(base.limits).cumulative)),
    snapshots: cloneJsonLike2(asArray2(asRecord(base.limits).snapshots)),
    burnRate: cloneJsonLike2(asRecord(base.governorBurnRate))
  };
  const issues = cloneJsonLike2(asArray2(asRecord(asRecord(base.errors).items)));
  const evidenceIndex = buildEvidenceIndex(rawLines, base, phases);
  const uiHints = {
    brand: {
      productName: "Apex Log Insights"
    },
    offline: {
      localOnly: true,
      networkRequired: false
    },
    navigation: cloneJsonLike2(asRecord(base.uiNavigation)),
    truthLinks: {
      enabled: true,
      contextLinesDefault: 5
    }
  };
  const baseSnapshot = cloneJsonLike2(base);
  return {
    ...baseSnapshot,
    reportVersion: "3.0.0",
    generatedAt,
    source,
    metadata,
    entryPoint,
    execution,
    timeline,
    phases: cloneJsonLike2(phases),
    database,
    governorLimits,
    issues,
    evidenceIndex,
    uiHints
  };
}

// src/worker-entry.ts
var workerSelf = self;
var workerConfig = {};
workerSelf.onmessage = async (e) => {
  try {
    const msg = e.data ?? {};
    if (msg.type === "SET_CONFIG") {
      if (msg.limits) {
        workerConfig.limits = { ...workerConfig.limits, ...msg.limits };
      }
      return;
    }
    if (msg.type !== "PARSE_LOG") {
      workerSelf.postMessage({ type: "PARSE_RESULT", ok: false, error: `Unknown message type: ${String(msg.type)}` });
      return;
    }
    const logText = msg.logText ?? "";
    const fileName = msg.fileId ?? "debug.log";
    const parsed = await parseLog(logText, {
      sourceName: fileName,
      sourceType: "salesforce-page",
      includeRawLines: true,
      enablePhaseInference: true
    });
    const report = buildOfflineReport({
      source: {
        fileName,
        bytes: new TextEncoder().encode(logText).length,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString()
      },
      parseResult: parsed,
      rawLogText: logText,
      limits: workerConfig.limits
    });
    workerSelf.postMessage({ type: "PARSE_RESULT", ok: true, report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    workerSelf.postMessage({ type: "PARSE_RESULT", ok: false, error: message });
  }
};
