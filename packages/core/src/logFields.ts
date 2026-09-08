/**
 * Split a pipe-delimited log record without allocating one array entry for
 * every delimiter in an untrusted payload. The final field contains the exact
 * unsplit remainder, including any additional pipes.
 */
export function splitLogFields(
  value: string,
  maxFields: number = 64,
): string[] {
  const limit = Math.max(1, Math.floor(maxFields));
  const fields: string[] = [];
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

/** Parse a complete nonnegative safe integer token with optional 3-digit comma grouping. */
export function parseSafeIntegerToken(
  value: string | null | undefined,
): number | null {
  const token = value?.trim() ?? "";
  if (!/^\d+$/.test(token) && !/^\d{1,3}(?:,\d{3})+$/.test(token)) {
    return null;
  }
  const parsed = Number(token.replaceAll(",", ""));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
