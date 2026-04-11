import { escapeHtml } from "./shared-format.js";

function evidenceHref(lineNumber) {
  const line = Number(lineNumber);
  if (!Number.isFinite(line) || line < 1) return "#evidence";
  return `#evidence?q=${encodeURIComponent(`line:${line}`)}`;
}

// Returns the verified raw log row number from an evidence object.
// "rawLogLineNumber" is set by normalize-report.js via text lookup against the
// actual raw log lines — it is always a real row index. Never falls back to
// lineNumber, because lineNumber may be an Apex source line (e.g., [97] in the
// .cls file) which is NOT a raw log row and would jump to the wrong place.
export function rawLogLineFromEvidence(value) {
  if (!value || typeof value !== "object") return null;
  const n = Number(value.rawLogLineNumber ?? NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function lineNumberFromEvidence(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object") {
    const rawLn = Number(value.rawLogLineNumber ?? NaN);
    if (Number.isFinite(rawLn) && rawLn > 0) return rawLn;
    const lineNumber = Number(value.lineNumber ?? value.startLine ?? NaN);
    return Number.isFinite(lineNumber) ? lineNumber : null;
  }
  return null;
}

export function evidenceSummary(item) {
  const evidence = item?.evidence || {};
  const line = lineNumberFromEvidence(evidence);
  const confidence = String(evidence.confidence || item?.confidence || "").trim() || null;
  return {
    line,
    confidence,
    raw: evidence.raw || null,
    startLine: lineNumberFromEvidence({ startLine: evidence.startLine ?? evidence.lineStart ?? evidence.start }),
    endLine: lineNumberFromEvidence({ startLine: evidence.endLine ?? evidence.lineEnd ?? evidence.end }),
  };
}

// Only renders buttons when we have verified raw log row numbers.
// If rawLogLineNumbers (plural) is present, renders one button per row (up to 4).
// Items with only Apex source line numbers get no button — clicking them would
// jump to an unrelated raw log row, which is worse than no link at all.
export function evidenceButton(item, label = "Open Evidence") {
  const evidence = item?.evidence || {};
  const multiRows = evidence.rawLogLineNumbers;
  if (Array.isArray(multiRows) && multiRows.length > 1) {
    const validRows = multiRows
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (validRows.length > 1) {
      return validRows
      .slice(0, 4)
      .map((n) => `<a class="lineBtn" href="${evidenceHref(n)}" data-evidence-line="${n}">${escapeHtml(label)} L${n}</a>`)
      .join(" ");
    }
    if (validRows.length === 1) {
      const n = validRows[0];
      return `<a class="lineBtn" href="${evidenceHref(n)}" data-evidence-line="${n}">${escapeHtml(label)} L${n}</a>`;
    }
  }
  const rawLine = rawLogLineFromEvidence(evidence);
  if (!rawLine) return "";
  return `<a class="lineBtn" href="${evidenceHref(rawLine)}" data-evidence-line="${rawLine}">${escapeHtml(label)} L${rawLine}</a>`;
}
