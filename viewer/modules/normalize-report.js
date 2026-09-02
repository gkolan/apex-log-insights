import { collectPhases } from "./normalize-helpers.js";
import { buildRawLineMap, normalizeEvidence } from "./normalize-evidence-mapping.js";
import { normalizeData } from "./normalize-database.js";
import { normalizeExecution } from "./normalize-execution.js";
import { normalizeSummary, normalizeDiagnostics } from "./normalize-summary-diagnostics.js";

export function normalizeReport(loaded) {
  try {
    const report = loaded.report;
    const rawLineMap = buildRawLineMap(loaded.rawLines);
    return {
      summary: normalizeSummary(report, loaded.rawLines, rawLineMap),
      execution: normalizeExecution(report),
      data: normalizeData(report, rawLineMap),
      diagnostics: normalizeDiagnostics(report, rawLineMap),
      evidence: normalizeEvidence(report, loaded.rawLines, rawLineMap),
      capabilities: {
        hasRawLines: loaded.rawLines.length > 0,
        hasPhases: collectPhases(report).length > 0,
        hasBurnRate: Boolean(report?.governorBurnRate),
        hasHeap: Boolean(report?.heapAnalysis),
        hasDebugQuality: Boolean(report?.debugLevelQuality),
      },
    };
  } catch (err) {
    console.error("Report normalization failed:", err);
    return {
      summary: {},
      execution: { chain: [], tree: [], phases: [], hotspots: [], triggerNames: [], triggerCascade: [], managedImpact: [], phaseDetails: [] },
      data: {},
      diagnostics: { issues: [], executionContext: {} },
      evidence: {},
      capabilities: { hasRawLines: false, hasPhases: false, hasBurnRate: false, hasHeap: false, hasDebugQuality: false },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
