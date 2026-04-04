// Pure PHI/PII redaction utilities — no DOM, no storage, no side effects.

/**
 * Default settings shape used by both viewer and extension.
 */
export const DEFAULT_REDACTION_SETTINGS = {
  enabled: false,
  email: true,
  sfId: true,
  phone: true,
  names: true,
  nameList: [],
};

/**
 * Mask a full name: first character + asterisks per word segment.
 * "John Smith" → "J*** S*****"
 */
export function maskName(name) {
  return String(name || "")
    .split(/\s+/)
    .map((part) => (part.length > 1 ? part[0] + "*".repeat(part.length - 1) : part))
    .join(" ");
}

/**
 * Apply all enabled redaction patterns to a single log line string.
 * Returns the (possibly redacted) string.
 *
 * Pattern application order matters: emails are replaced first so that the
 * SF-ID pattern cannot split a local-part that happens to be 15 chars long.
 */
export function redactLine(line, settings) {
  if (!settings || !settings.enabled) return line;
  let s = String(line || "");

  if (settings.email) {
    // Standard email pattern — word boundaries keep it from over-matching inside URLs
    s = s.replace(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g, "[EMAIL]");
  }
  if (settings.sfId) {
    // 15 or 18 char Salesforce record IDs:
    //   • Must start with a digit (all key prefixes like 001, 005 start with 0)
    //   • Must contain at least one letter (lookahead) to avoid matching large numbers
    //   • Total length: exactly 15 or 18 alphanumeric characters
    s = s.replace(
      /\b(?=[A-Za-z0-9]*[A-Za-z])[0-9][A-Za-z0-9]{14}(?:[A-Za-z0-9]{3})?\b/g,
      "[SF-ID]",
    );
  }
  if (settings.phone) {
    // US and simple international phone numbers
    s = s.replace(
      /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
      "[PHONE]",
    );
  }
  if (settings.names) {
    const nameList = Array.isArray(settings.nameList) ? settings.nameList : [];
    for (const rawName of nameList) {
      const name = String(rawName || "").trim();
      if (!name || name.length > 200) continue; // Skip empty or excessively long names
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const masked = maskName(name);
      try {
        s = s.replace(new RegExp(escaped, "gi"), masked);
      } catch (_) {
        // Skip invalid patterns gracefully
      }
    }
  }
  return s;
}

/**
 * Apply redaction to an array of log line strings.
 * Returns a new array — the original is not mutated.
 */
export function redactLines(lines, settings) {
  if (!settings || !settings.enabled) return lines;
  return lines.map((line) => redactLine(line, settings));
}
