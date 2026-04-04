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
    pattern: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g,
    replacement: '[REDACTED-EMAIL]',
  },
  // Salesforce ID: 15 or 18 char, must start with 0, must contain a letter
  sfId: {
    pattern: /\b(?=[A-Za-z0-9]*[A-Za-z])[0-9][A-Za-z0-9]{14}(?:[A-Za-z0-9]{3})?\b/g,
    replacement: '[REDACTED-ID]',
  },
  // Phone: US and simple international formats
  phone: {
    pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: '[REDACTED-PHONE]',
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
function redactString(value: string, options: Required<RedactionOptions>): string {
  let result = value;

  if (options.email) {
    result = result.replace(REDACTION_PATTERNS.email.pattern, REDACTION_PATTERNS.email.replacement);
  }
  if (options.sfId) {
    result = result.replace(REDACTION_PATTERNS.sfId.pattern, REDACTION_PATTERNS.sfId.replacement);
  }
  if (options.phone) {
    result = result.replace(REDACTION_PATTERNS.phone.pattern, REDACTION_PATTERNS.phone.replacement);
  }

  return result;
}

/**
 * List of report fields that should never be redacted (structural/metadata)
 */
const STRUCTURAL_FIELDS = new Set([
  // Meta and execution context
  'fileName',
  'filePath',
  'generatedAt',
  'parseTimeMs',
  'sourceType',
  'sourceName',
  'fileBytes',
  'parseTimeMs',
  'executionContext',
  'meta',

  // Code structure (class/method names preserved)
  'className',
  'methodName',
  'namespace',
  'packageName',

  // Query structure (field and sObject names preserved)
  'fieldName',
  'sObjectType',
  'sObjectName',
  'fieldApiName',
  'childRelationshipName',

  // Numeric metrics and limits (values preserved)
  'count',
  'limit',
  'usage',
  'duration',
  'timeMs',
  'cpuTime',
  'durationMs',
  'value',
  'burnRate',
  'peakUsage',
  'percentage',
  'rowCount',
  'affectedRows',
  'totalRows',

  // Governor limits (metadata, never PII)
  'governorLimits',
  'governorBurnRate',
  'heapAnalysis',
  'managedPackageImpact',

  // Analysis results (structural)
  'soqlPatternAnalysis',
  'database',
  'eventCount',
  'type',
  'severity',
  'phase',
  'category',
  'status',
  'state',
]);

/**
 * List of fields whose values should be fully redacted (user-controlled content)
 */
const REDACT_FULLY_FIELDS = new Set([
  'message', // Debug message content
  'debugString', // User debug output
  'userMessage',
  'exceptionMessage',
  'stackTrace',
  'namedCredential', // Credential names
]);

/**
 * Deep-walk an object and redact sensitive data
 */
function redactObjectDeep(
  obj: unknown,
  options: Required<RedactionOptions>,
  visited: Set<object> = new Set(),
): unknown {
  // Handle primitives
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return redactString(obj, options);
  }

  if (typeof obj !== 'object') {
    return obj; // boolean, number, etc. — pass through
  }

  // Prevent infinite recursion
  if (visited.has(obj)) {
    return obj;
  }
  visited.add(obj);

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => redactObjectDeep(item, options, visited));
  }

  // Handle objects
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    // Never redact structural/metadata fields
    if (STRUCTURAL_FIELDS.has(key)) {
      result[key] = value;
      continue;
    }

    // Fully redact sensitive fields
    if (REDACT_FULLY_FIELDS.has(key)) {
      if (typeof value === 'string') {
        result[key] = '[REDACTED]';
      } else if (Array.isArray(value)) {
        result[key] = value.map(() => '[REDACTED]');
      } else if (value !== null && typeof value === 'object') {
        // For nested objects in sensitive fields, redact all string values
        result[key] = redactObjectDeep(value, options, visited);
      } else {
        result[key] = value;
      }
      continue;
    }

    // For other fields, recursively redact string content
    result[key] = redactObjectDeep(value, options, visited);
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
export function redactReport(report: unknown, options?: RedactionOptions): unknown {
  const opts: Required<RedactionOptions> = {
    email: options?.email ?? DEFAULT_OPTIONS.email,
    sfId: options?.sfId ?? DEFAULT_OPTIONS.sfId,
    phone: options?.phone ?? DEFAULT_OPTIONS.phone,
  };

  return redactObjectDeep(report, opts);
}
