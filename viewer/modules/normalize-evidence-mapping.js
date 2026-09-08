// Raw log line mapping and evidence index building
// Builds maps from raw log text to row numbers for jump-to-line functionality

import { toArray, first } from "./normalize-helpers.js";
import { evidenceSummary } from "./shared-evidence.js";

// ─── Raw log line map ─────────────────────────────────────────────────────────
//
// Builds a Map<rawLineText, number[]> from the loaded raw log lines, storing ALL
// row numbers for each text (Salesforce logs repeat identical lines). Callers
// use the first entry as the primary jump target and may use the full list when
// they need to distinguish occurrences.
//
export function buildRawLineMap(rawLines) {
  const map = new Map();
  map.rawLineTextByNumber = new Map();
  for (const line of rawLines) {
    const num = Number(line?.number);
    if (!Number.isFinite(num) || num <= 0) continue;
    const text = String(line?.text || "").trimEnd();
    map.rawLineTextByNumber.set(num, text);
    if (!text) continue;
    if (map.has(text)) {
      map.get(text).push(num);
    } else {
      map.set(text, [num]);
    }
  }
  return map;
}

// Given an evidence object with a `raw` field (the log line text), look up the
// actual raw log row number(s) and attach them as `rawLogLineNumber` (first match)
// and `rawLogLineNumbers` (all matches, when there are duplicates). If no match,
// the evidence is returned unchanged. rawLogLineNumber is the ONLY field that
// should be used as a jump target in the raw log viewer.
export function addRawLogLineNumber(evidence, rawLineMap) {
  if (!evidence || !rawLineMap || !rawLineMap.size) return evidence;
  const rawText = String(evidence.raw || "").trimEnd();
  if (!rawText) return evidence;
  const declaredLogLine = Number(evidence.lineNumber);
  if (
    Number.isFinite(declaredLogLine) &&
    declaredLogLine > 0 &&
    rawLineMap.rawLineTextByNumber?.get(declaredLogLine) === rawText
  ) {
    return { ...evidence, rawLogLineNumber: declaredLogLine };
  }
  const rowNumbers = rawLineMap.get(rawText) ?? null;
  if (!rowNumbers || rowNumbers.length === 0) return evidence;
  const rawLogLineNumber = rowNumbers[0];
  if (rowNumbers.length > 1) {
    return { ...evidence, rawLogLineNumber, rawLogLineNumbers: rowNumbers };
  }
  return { ...evidence, rawLogLineNumber };
}

// For issues with rawLogLineTexts (recursive trigger), look up all texts and
// return the first resolved row number plus all resolved rows.
export function resolveRawLogLineNumbers(rawLogLineTexts, rawLineMap) {
  if (!rawLogLineTexts || !rawLineMap || !rawLineMap.size) return null;
  const rows = [];
  for (const text of rawLogLineTexts) {
    const trimmed = String(text || "").trimEnd();
    if (!trimmed) continue;
    const rowNums = rawLineMap.get(trimmed);
    if (rowNums && rowNums.length > 0) rows.push(rowNums[0]);
  }
  return rows.length > 0 ? rows : null;
}

// Normalize the evidence section of the report for log explorer
export function normalizeEvidence(report, rawLines, rawLineMap) {
  const indexed = rawLines.map((line) => ({
    number: Number(line?.number),
    text: String(line?.text || ""),
  }));

  const allEvidence = [];
  for (const item of toArray(report?.overview?.highlights))
    allEvidence.push(item);
  for (const item of toArray(report?.database?.soql)) allEvidence.push(item);
  for (const item of toArray(report?.database?.dml)) allEvidence.push(item);
  for (const item of toArray(report?.errors?.items)) allEvidence.push(item);
  for (const item of toArray(
    report?.evidenceIndex?.items || report?.evidenceIndex,
  ))
    allEvidence.push(item);

  const lookup = allEvidence
    .map((item) => {
      const summary = evidenceSummary(item);
      // Enrich with a verified raw log row number via text lookup so Jump-to-line
      // buttons point at the actual raw log row, not the Apex source line.
      const enrichedEvidence = addRawLogLineNumber(
        item?.evidence || {},
        rawLineMap,
      );
      const rawLogLineNumber = enrichedEvidence?.rawLogLineNumber ?? null;
      return {
        label: first(
          item?.title,
          item?.summary,
          item?.queryName,
          item?.query,
          item?.type,
          "Evidence",
        ),
        ...summary,
        rawLogLineNumber,
      };
    })
    // Only emit items where we have a verified raw log row — using Apex source
    // lines as jump targets leads users to the wrong location (BUG-003).
    .filter((item) => item.rawLogLineNumber != null);

  const indexEntries = [
    ...toArray(report?.evidenceIndex?.issues).map((item) => ({
      label: first(item?.summary, item?.label, item?.type, "Issue"),
      kind: "Issue",
      line: first(item?.lineNumber, null),
      startLine: first(item?.lineNumber, null),
      endLine: first(item?.lineNumber, null),
      confidence: first(item?.confidence, null),
    })),
    ...toArray(report?.evidenceIndex?.phases).map((item) => ({
      label: first(item?.id, "Phase"),
      kind: "Phase",
      line: first(item?.startLine, item?.endLine, null),
      startLine: first(item?.startLine, null),
      endLine: first(item?.endLine, null),
      confidence: first(item?.confidence, null),
    })),
  ].filter((item) => item.line || item.startLine);

  return {
    rawLines: indexed,
    lookup,
    index: indexEntries,
  };
}
