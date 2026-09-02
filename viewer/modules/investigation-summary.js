import { formatMs, num } from "./shared-format.js";

/**
 * Build a compact, deterministic transaction summary for tickets and chat.
 * Values must already represent the canonical transaction scope.
 */
export function buildInvestigationSummary(summary) {
  const completeness = String(summary?.completeness || "unknown");
  return [
    "Apex Log Insights — Investigation Summary",
    `Log: ${summary?.fileName || "Unknown"}`,
    `Entry point: ${summary?.entryPoint || "Unknown"}`,
    `Execution type: ${summary?.requestType || "Unknown"}`,
    `User: ${summary?.user || "Unknown"}`,
    `Started: ${summary?.startedAt || "Unknown"}`,
    `Runtime: ${formatMs(summary?.runtimeMs)}`,
    `CPU: ${formatMs(summary?.cpuMs)}`,
    `SOQL: ${num(summary?.soqlCount)} queries / ${num(summary?.soqlRows)} rows`,
    `DML: ${num(summary?.dmlCount)} statements / ${num(summary?.dmlRows)} rows`,
    `Issues: ${num(summary?.errorCount)} errors / ${num(summary?.warningCount)} warnings`,
    `Evidence completeness: ${completeness}`,
  ].join("\n");
}
