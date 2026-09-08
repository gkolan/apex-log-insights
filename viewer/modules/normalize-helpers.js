// Helper utility functions for report normalization
// These are used across all normalization layers

export function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function first(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

export function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeIssueSeverity(item, fallback = "info") {
  const raw = String(item?.severity || "").toLowerCase();
  if (raw === "error") return "error";
  if (raw === "warn" || raw === "warning") return "warn";
  return fallback;
}

export function collectIssueState(report) {
  const errors = report?.errors || {};
  const items = toArray(errors?.items);
  return {
    items,
    fallbackSeverity: "info",
    totalCount: Number.isFinite(Number(errors?.count))
      ? Number(errors.count)
      : items.length,
    truncated: Boolean(errors?.truncated),
    limit: Number.isFinite(Number(errors?.limit)) ? Number(errors.limit) : null,
  };
}

export function collectPhases(report) {
  return toArray(report?.phases);
}

export function hasResolvedRawLine(evidence) {
  const one = Number(evidence?.rawLogLineNumber);
  if (Number.isFinite(one) && one > 0) return true;
  const many = Array.isArray(evidence?.rawLogLineNumbers)
    ? evidence.rawLogLineNumbers
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0)
    : [];
  return many.length > 0;
}

export function hasRawEvidenceCandidate(item) {
  const evidence = item?.evidence || {};
  if (hasResolvedRawLine(evidence)) return true;
  return Boolean(String(evidence?.raw || "").trim());
}
