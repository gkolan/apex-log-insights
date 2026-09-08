function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumRows(items) {
  if (!Array.isArray(items)) return null;
  return items.reduce(
    (total, item) => total + (finiteNumber(item?.rows) || 0),
    0,
  );
}

function issueCount(issues, severity) {
  if (!Array.isArray(issues)) return null;
  return issues.filter((issue) => {
    const value = String(issue?.severity || issue?.level || "").toLowerCase();
    return severity === "warning"
      ? value === "warn" || value === "warning"
      : value === "error" || value === "fatal";
  }).length;
}

export function summarizeReportForComparison(report, fileName = "debug.log") {
  const context = report?.context || report?.report?.context || {};
  const transaction = context?.transaction || {};
  const database = report?.database || report?.report?.database || {};
  const soql = Array.isArray(database?.soql) ? database.soql : [];
  const dml = Array.isArray(database?.dml) ? database.dml : [];
  const callouts = Array.isArray(database?.callouts) ? database.callouts : [];
  const issues = report?.issues || report?.report?.issues || [];
  const limits = report?.governorLimits?.current?.defaultNamespace || {};
  const entryPoint = report?.entryPoint || report?.report?.entryPoint || {};
  const completeness = report?.metadata?.logCompleteness || {};

  return {
    fileName,
    transaction: {
      entryPoint: entryPoint?.name || transaction?.rootCodeUnit || null,
      requestType: entryPoint?.type || transaction?.requestType || null,
      startTimestamp: transaction?.startTimestamp || null,
    },
    evidence: {
      status: completeness?.status || "unknown",
      reasons: Array.isArray(completeness?.reasons)
        ? completeness.reasons.map(String)
        : [],
    },
    metrics: {
      durationMs: finiteNumber(transaction?.durationMs),
      cpuTimeMs: finiteNumber(
        transaction?.cpuTimeMs ?? limits?.cpuTimeMs?.used,
      ),
      heapBytes: finiteNumber(
        limits?.heapSize?.used ?? limits?.heapBytes?.used,
      ),
      soqlQueries: finiteNumber(limits?.soqlQueries?.used) ?? soql.length,
      soqlRows: finiteNumber(limits?.soqlRows?.used) ?? sumRows(soql),
      dmlStatements: finiteNumber(limits?.dmlStatements?.used) ?? dml.length,
      dmlRows: finiteNumber(limits?.dmlRows?.used) ?? sumRows(dml),
      callouts: finiteNumber(limits?.callouts?.used) ?? callouts.length,
      errors: issueCount(issues, "error"),
      warnings: issueCount(issues, "warning"),
    },
  };
}

export const COMPARISON_METRICS = [
  { key: "durationMs", label: "Duration", unit: "ms" },
  { key: "cpuTimeMs", label: "CPU time", unit: "ms" },
  { key: "heapBytes", label: "Heap used", unit: "bytes" },
  { key: "soqlQueries", label: "SOQL queries", unit: "count" },
  { key: "soqlRows", label: "SOQL rows", unit: "count" },
  { key: "dmlStatements", label: "DML statements", unit: "count" },
  { key: "dmlRows", label: "DML rows", unit: "count" },
  { key: "callouts", label: "Callouts", unit: "count" },
  { key: "errors", label: "Errors", unit: "count" },
  { key: "warnings", label: "Warnings", unit: "count" },
];

export function compareReports(baselineReport, candidateReport, names = {}) {
  const baseline = summarizeReportForComparison(
    baselineReport,
    names.baseline || "baseline.log",
  );
  const candidate = summarizeReportForComparison(
    candidateReport,
    names.candidate || "candidate.log",
  );
  return {
    comparisonVersion: "1.0.0",
    generatedAtUtc: new Date().toISOString(),
    baseline,
    candidate,
    metrics: COMPARISON_METRICS.map((metric) => {
      const baselineValue = baseline.metrics[metric.key];
      const candidateValue = candidate.metrics[metric.key];
      return {
        ...metric,
        baseline: baselineValue,
        candidate: candidateValue,
        delta:
          baselineValue === null || candidateValue === null
            ? null
            : candidateValue - baselineValue,
      };
    }),
  };
}
