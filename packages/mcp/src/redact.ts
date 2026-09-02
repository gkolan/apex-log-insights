/**
 * PII redaction utilities for MCP server.
 * Deep-walks report JSON objects and redacts sensitive data patterns.
 * Designed for safely sharing logs with cloud-based AI services.
 *
 * Redacts:
 * - Salesforce record IDs (15/18 char patterns)
 * - Email addresses
 * - Phone numbers (US and international)
 * - Debug message values (but preserves structure)
 * - SOQL bind values (preserves query structure and field names)
 * - Callout URLs (redacts query params but preserves host/path)
 * - Named credential names
 *
 * Preserves:
 * - Class/method names (code structure)
 * - Field names (query structure)
 * - sObject type names (domain structure)
 * - Numeric limits, counts, durations (metrics)
 * - Governor limits (metadata)
 */

/**
 * Redaction patterns — order matters (emails first, then IDs)
 */
const REDACTION_PATTERNS = {
  // Email: standard pattern with word boundaries
  email: {
    pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    replacement: "[REDACTED-EMAIL]",
  },
  // Salesforce ID: 15 or 18 char, must start with 0, must contain a letter
  sfId: {
    pattern:
      /\b(?=[A-Za-z0-9]*[A-Za-z])[0-9][A-Za-z0-9]{14}(?:[A-Za-z0-9]{3})?\b/g,
    replacement: "[REDACTED-ID]",
  },
  // Phone: US and simple international formats
  phone: {
    pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: "[REDACTED-PHONE]",
  },
};

/**
 * Redaction options controlling which patterns to apply
 */
export interface RedactionOptions {
  email?: boolean;
  sfId?: boolean;
  phone?: boolean;
}

/**
 * Default redaction options
 */
const DEFAULT_OPTIONS: Required<RedactionOptions> = {
  email: true,
  sfId: true,
  phone: true,
};

/**
 * Redact sensitive patterns in a string value
 */
function redactString(
  value: string,
  options: Required<RedactionOptions>,
): string {
  let result = value;

  // Salesforce can include authorization material in raw Named Credential and
  // callout evidence. Remove labeled values before applying general PII rules.
  result = result.replace(
    /(\b(?:Http Header Authorization|Authorization)\s*[:=]\s*)([^|,\]}]+)/gi,
    "$1[REDACTED]",
  );

  if (options.email) {
    result = result.replace(
      REDACTION_PATTERNS.email.pattern,
      REDACTION_PATTERNS.email.replacement,
    );
  }
  if (options.sfId) {
    result = result.replace(
      REDACTION_PATTERNS.sfId.pattern,
      REDACTION_PATTERNS.sfId.replacement,
    );
  }
  if (options.phone) {
    result = result.replace(
      REDACTION_PATTERNS.phone.pattern,
      REDACTION_PATTERNS.phone.replacement,
    );
  }

  return result;
}

function redactUrl(value: string, options: Required<RedactionOptions>): string {
  try {
    const parsed = new URL(value);
    if (parsed.username) parsed.username = "REDACTED";
    if (parsed.password) parsed.password = "REDACTED";
    for (const key of new Set(parsed.searchParams.keys())) {
      parsed.searchParams.set(key, "[REDACTED]");
    }
    return redactString(parsed.toString(), options);
  } catch {
    return redactString(value, options);
  }
}

/**
 * Mask quoted SOQL/SOSL literals while retaining clauses, fields, objects, and
 * bind-variable names. Apex string literals escape a quote by doubling it or,
 * in some emitted logs, with a backslash.
 */
function redactQuery(
  value: string,
  options: Required<RedactionOptions>,
): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char !== "'") {
      result += char;
      continue;
    }

    result += "'[REDACTED]'";
    for (index += 1; index < value.length; index += 1) {
      if (value[index] === "\\") {
        index += 1;
        continue;
      }
      if (value[index] !== "'") continue;
      if (value[index + 1] === "'") {
        index += 1;
        continue;
      }
      break;
    }
  }
  return redactString(result, options);
}

/** Preserve untrusted JSON keys without invoking Object.prototype setters. */
function defineOwn(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/**
 * List of fields whose values should be fully redacted (user-controlled content)
 */
const REDACT_FULLY_FIELDS = new Set([
  "message", // Debug message content
  "debugString", // User debug output
  "userMessage",
  "exceptionMessage",
  "stackTrace",
  "namedCredential", // Credential names
  "credentialName",
  "namedCredentialName",
  "httpHeaderAuthorization",
  "authorization",
  "rawValue",
  "parsedValue",
  "value",
  "text",
  "body",
  "requestBody",
  "responseBody",
  "payload",
  "requestPayload",
  "responsePayload",
  "headers",
  "requestHeaders",
  "responseHeaders",
  "errorText",
  "statusText",
]);

/** Canonical and legacy fields that contain complete raw-log fragments. */
const RAW_EVIDENCE_FIELDS = new Set([
  "raw",
  "endRaw",
  "rawLine",
  "logLine",
  "exitLogLine",
  "responseLogLine",
  "rawLogLineTexts",
  "samples",
]);

const URL_FIELDS = new Set(["endpoint", "url", "requestUrl", "responseUrl"]);
const QUERY_FIELDS = new Set(["query", "queryText", "soql", "sosl"]);

type RedactionMode = "patterns" | "all_strings";
type RedactionTask =
  | {
      kind: "value";
      value: unknown;
      mode: RedactionMode;
      assign: (value: unknown) => void;
    }
  | { kind: "leave"; value: object; mode: RedactionMode };

/** Deep-walk report data without depending on the JavaScript call stack. */
function redactObjectDeep(
  input: unknown,
  options: Required<RedactionOptions>,
): unknown {
  let result: unknown;
  const visited = {
    patterns: new WeakMap<object, unknown>(),
    all_strings: new WeakMap<object, unknown>(),
  };
  const active = {
    patterns: new WeakSet<object>(),
    all_strings: new WeakSet<object>(),
  };
  const tasks: RedactionTask[] = [
    {
      kind: "value",
      value: input,
      mode: "patterns",
      assign: (value) => (result = value),
    },
  ];

  while (tasks.length > 0) {
    const task = tasks.pop()!;
    if (task.kind === "leave") {
      active[task.mode].delete(task.value);
      continue;
    }

    const { value, mode } = task;
    if (typeof value === "string") {
      task.assign(
        mode === "all_strings" ? "[REDACTED]" : redactString(value, options),
      );
      continue;
    }
    if (value === null || typeof value !== "object") {
      task.assign(value);
      continue;
    }
    if (active[mode].has(value)) {
      task.assign(null);
      continue;
    }
    const prior = visited[mode].get(value);
    if (prior !== undefined) {
      task.assign(prior);
      continue;
    }

    const target: unknown[] | Record<string, unknown> = Array.isArray(value)
      ? new Array(value.length)
      : {};
    visited[mode].set(value, target);
    active[mode].add(value);
    task.assign(target);
    tasks.push({ kind: "leave", value, mode });

    const keys = Array.isArray(value)
      ? Array.from({ length: value.length }, (_, index) => String(index))
      : Object.keys(value);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]!;
      let child: unknown;
      try {
        child = (value as Record<string, unknown>)[key];
      } catch {
        continue;
      }
      const assign = (next: unknown) => {
        if (Array.isArray(target)) target[Number(key)] = next;
        else defineOwn(target, key, next);
      };

      if (mode === "all_strings") {
        tasks.push({ kind: "value", value: child, mode, assign });
        continue;
      }
      if (REDACT_FULLY_FIELDS.has(key) || RAW_EVIDENCE_FIELDS.has(key)) {
        tasks.push({
          kind: "value",
          value: child,
          mode: "all_strings",
          assign,
        });
      } else if (key === "evidence" && typeof child === "string") {
        assign("[REDACTED]");
      } else if (URL_FIELDS.has(key) && typeof child === "string") {
        assign(redactUrl(child, options));
      } else if (QUERY_FIELDS.has(key) && typeof child === "string") {
        assign(redactQuery(child, options));
      } else {
        tasks.push({ kind: "value", value: child, mode, assign });
      }
    }
  }

  return result;
}

/**
 * Redact a report JSON object (or any JSON structure) for safe sharing with AI services.
 *
 * @param report — The insights report or any JSON object to redact
 * @param options — Redaction options (default: all redactions enabled)
 * @returns A new object with PII redacted (original is not mutated)
 */
export function redactReport(
  report: unknown,
  options?: RedactionOptions,
): unknown {
  const opts: Required<RedactionOptions> = {
    email: options?.email ?? DEFAULT_OPTIONS.email,
    sfId: options?.sfId ?? DEFAULT_OPTIONS.sfId,
    phone: options?.phone ?? DEFAULT_OPTIONS.phone,
  };

  return redactObjectDeep(report, opts);
}
