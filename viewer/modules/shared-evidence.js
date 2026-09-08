function evidenceHref(lineNumber) {
  const line = Number(lineNumber);
  if (!Number.isFinite(line) || line < 1) return "#evidence";
  return `#evidence?q=${encodeURIComponent(`log:${line}`)}`;
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

export function evidenceSummary(item) {
  const evidence = item?.evidence || {};
  const line = rawLogLineFromEvidence(evidence);
  const confidence =
    String(evidence.confidence || item?.confidence || "").trim() || null;
  return {
    line,
    confidence,
    raw: evidence.raw || null,
    sourceLine: Number.isFinite(Number(evidence.sourceLineNumber))
      ? Number(evidence.sourceLineNumber)
      : null,
    startLine: line,
    endLine: line,
  };
}

export function sourceLineCell(item) {
  const sourceLine = Number(item?.evidence?.sourceLineNumber);
  return Number.isFinite(sourceLine) && sourceLine > 0
    ? `<span class="sourceLineNumber" title="Line in the Apex class or trigger; this number does not navigate the raw log.">${sourceLine}</span>`
    : "-";
}

export function logLineCell(item) {
  const evidence = item?.evidence || {};
  const rows = Array.isArray(evidence.rawLogLineNumbers)
    ? evidence.rawLogLineNumbers
    : [rawLogLineFromEvidence(evidence)];
  const validRows = Array.from(
    new Set(
      rows.map(Number).filter((line) => Number.isFinite(line) && line > 0),
    ),
  ).slice(0, 4);
  if (validRows.length === 0) return "-";
  return validRows
    .map(
      (line) =>
        `<a class="lineBtn" href="${evidenceHref(line)}" data-evidence-line="${line}" title="Open raw debug-log line ${line}">${line}</a>`,
    )
    .join(", ");
}

// Only renders buttons when we have verified raw log row numbers.
// If rawLogLineNumbers (plural) is present, renders one button per row (up to 4).
// Items with only Apex source line numbers get no button — clicking them would
// jump to an unrelated raw log row, which is worse than no link at all.
export function evidenceButton(item, _label = "Open Evidence") {
  const evidence = item?.evidence || {};
  const sourceLine = Number(evidence.sourceLineNumber);
  const sourceBadge =
    Number.isFinite(sourceLine) && sourceLine > 0
      ? `<span class="sourceLineBadge" title="Line in the Apex class or trigger source code; this does not navigate the raw log.">Apex source line ${sourceLine}</span>`
      : "";
  const multiRows = evidence.rawLogLineNumbers;
  if (Array.isArray(multiRows) && multiRows.length > 1) {
    const validRows = multiRows
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (validRows.length > 1) {
      return `<span class="lineReferences">${validRows
        .slice(0, 4)
        .map(
          (n) =>
            `<a class="lineBtn" href="${evidenceHref(n)}" data-evidence-line="${n}" title="Open raw debug-log line ${n}">Log line ${n}</a>`,
        )
        .join(" ")}${sourceBadge}</span>`;
    }
    if (validRows.length === 1) {
      const n = validRows[0];
      return `<span class="lineReferences"><a class="lineBtn" href="${evidenceHref(n)}" data-evidence-line="${n}" title="Open raw debug-log line ${n}">Log line ${n}</a>${sourceBadge}</span>`;
    }
  }
  const rawLine = rawLogLineFromEvidence(evidence);
  if (!rawLine) return sourceBadge;
  return `<span class="lineReferences"><a class="lineBtn" href="${evidenceHref(rawLine)}" data-evidence-line="${rawLine}" title="Open raw debug-log line ${rawLine}">Log line ${rawLine}</a>${sourceBadge}</span>`;
}
