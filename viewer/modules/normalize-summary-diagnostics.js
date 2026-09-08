// Summary, diagnostics, and analysis normalization

import { formatSeverity } from "./shared-format.js";
import { toArray, first, normalizeIssueSeverity, collectIssueState, collectPhases } from "./normalize-helpers.js";
import { addRawLogLineNumber, resolveRawLogLineNumbers } from "./normalize-evidence-mapping.js";

export function normalizeDebugWarnings(report) {
  return toArray(report?.debugLevelQuality?.warnings)
    .map((item, index) => ({
      id: `debug-warning-${index + 1}`,
      category: first(item?.category, "Unknown"),
      currentLevel: first(item?.currentLevel, item?.level, "-"),
      recommendation: first(item?.recommendation, item?.recommendedLevel, "-"),
      impact: first(item?.impact, ""),
    }));
}

export function normalizeHeapSummary(report) {
  const heap = report?.heapAnalysis;
  if (!heap) return null;
  const hotspots = toArray(heap?.hotspotsByLine)
    .map((item) => ({
      line: first(item?.rawLogLineNumber, item?.lineNumber, item?.line, null),
      allocations: Number(first(item?.allocationCount, item?.count, 0) || 0),
      totalBytes: first(item?.totalBytes, null),
      averageBytes: first(item?.avgBytes, null),
      namespace: first(item?.namespace, null),
    }));
  return {
    peakCumulativeBytes: first(heap?.peakCumulativeBytes, null),
    allocationCount: Number(first(heap?.allocationCount, 0) || 0),
    deallocationCount: Number(first(heap?.deallocationCount, 0) || 0),
    totalAllocatedBytes: first(heap?.totalAllocatedBytes, null),
    totalDeallocatedBytes: first(heap?.totalDeallocatedBytes, null),
    netAllocatedBytes: first(heap?.netAllocatedBytes, null),
    watermarkSamples: toArray(heap?.watermarkSamples).map((sample, index) => ({
      id: `heap-sample-${index + 1}`,
      timestampNs: first(sample?.timestampNs, null),
      cumulativeBytes: first(sample?.cumulativeBytes, null),
    })),
    byPhase: toArray(heap?.byPhase).map((phase, index) => ({
      id: first(phase?.phaseId, `heap-phase-${index + 1}`),
      label: first(phase?.phaseLabel, phase?.phaseId, `Phase ${index + 1}`),
      allocatedBytes: first(phase?.allocatedBytes, null),
      allocationCount: Number(first(phase?.allocationCount, 0) || 0),
    })),
    hotspots,
  };
}

export function normalizeCpuBreakdown(report) {
  const cpu = report?.cpuAttribution;
  if (!cpu) {
    return {
      byType: [],
      byNamespace: [],
    };
  }

  const byType = Object.entries(cpu?.byType || {})
    .map(([key, value]) => ({
      id: `cpu-type-${key}`,
      label: key,
      durationMs: Number(first(value?.durationMs, 0) || 0),
      count: Number(first(value?.count, 0) || 0),
    }))
    .sort((left, right) => right.durationMs - left.durationMs);

  const byNamespace = Object.entries(cpu?.byNamespace || {})
    .map(([key, value]) => ({
      id: `cpu-namespace-${key}`,
      namespace: key,
      selfDurationMs: Number(first(value?.selfDurationMs, 0) || 0),
      totalDurationMs: Number(first(value?.totalDurationMs, 0) || 0),
      spanCount: Number(first(value?.spanCount, 0) || 0),
    }))
    .sort((left, right) => right.totalDurationMs - left.totalDurationMs);

  return {
    byType,
    byNamespace,
  };
}

export function normalizeSystemModeTimeline(report) {
  return toArray(report?.systemModeTransitions?.items || report?.systemModeTransitions)
    .map((item, index) => ({
      id: first(item?.id, `system-mode-${index + 1}`),
      lineNumber: first(item?.rawLogLineNumber, null),
      state: item?.isSystemMode ? "system" : "user",
      direction: item?.entering ? "enter" : "exit",
    }));
}

function countIssuesBySeverity(items, severity, fallbackSeverity) {
  return items.filter((item) => normalizeIssueSeverity(item, fallbackSeverity) === severity).length;
}

export function deriveSummaryStatus(report) {
  const issueState = collectIssueState(report);
  const explicitStatus = report?.overview?.status;
  if (explicitStatus) {
    return {
      outcome: String(first(explicitStatus?.outcome, "ok")),
      errorCount: Number(first(
        explicitStatus?.errorCount,
        countIssuesBySeverity(
          issueState.items,
          "error",
          issueState.fallbackSeverity,
        ),
        0,
      )),
      warningCount: Number(first(
        explicitStatus?.warningCount,
        countIssuesBySeverity(issueState.items, "warn", issueState.fallbackSeverity),
        0,
      )),
    };
  }

  const errorCount = Math.max(
    countIssuesBySeverity(issueState.items, "error", issueState.fallbackSeverity),
  );
  const warningCount = countIssuesBySeverity(issueState.items, "warn", issueState.fallbackSeverity);
  let outcome = "ok";
  if (errorCount > 0) outcome = "error";
  else if (warningCount > 0) outcome = "warn";
  return { outcome, errorCount, warningCount };
}

export function normalizeHighlights(report, rawLineMap) {
  return toArray(report?.overview?.highlights)
    .map((item, index) => ({
      id: `highlight-${index + 1}`,
      title: first(item?.title, item?.kind, "Highlight"),
      summary: first(item?.summary, item?.message, ""),
      kind: first(item?.kind, "info"),
      evidence: addRawLogLineNumber({
        endLine: first(item?.evidence?.lineEnd, null),
        timestampNs: first(item?.evidence?.timestampNs, null),
        raw: first(item?.evidence?.raw, null),
        confidence: "direct",
      }, rawLineMap),
    }));
}

export function normalizeTopMetrics(report, rawLines) {
  const metrics = report?.overview?.topMetrics || {};
  return {
    durationMs: first(metrics?.totalDurationMs, report?.context?.transaction?.durationMs, null),
    cpuTimeMs: first(metrics?.cpuTimeMs, report?.governorLimits?.current?.defaultNamespace?.cpuTimeMs?.used, null),
    soqlCount: first(metrics?.soql?.count, toArray(report?.database?.soql).length, 0),
    dmlCount: first(metrics?.dml?.statements, toArray(report?.database?.dml).length, 0),
    soqlRows: first(metrics?.soql?.rows, 0),
    dmlRows: first(metrics?.dml?.rows, 0),
    queueables: first(metrics?.queueablesEnqueued?.count, 0),
    futures: first(metrics?.futureCalls?.count, 0),
    lines: rawLines.length || null,
  };
}

export function normalizeSummary(report, rawLines, rawLineMap) {
  const transaction = report?.context?.transaction || {};
  const entryPoint = report?.entryPoint || {};
  const topMetrics = normalizeTopMetrics(report, rawLines);
  return {
    status: deriveSummaryStatus(report),
    title: first(entryPoint?.name, transaction?.rootCodeUnit, "Apex Transaction"),
    requestType: first(transaction?.requestType, entryPoint?.type, "Unknown Request"),
    durationMs: first(transaction?.durationMs, topMetrics.durationMs, null),
    user: first(report?.context?.user?.username, report?.context?.user?.userId, null),
    namespaces: toArray(report?.context?.org?.namespaceContext),
    highlights: normalizeHighlights(report, rawLineMap),
    topMetrics,
    quickLinks: [
      { view: "execution", label: "Execution Story" },
      { view: "data", label: "Data and Limits" },
      { view: "diagnostics", label: "Diagnostics" },
      { view: "evidence", label: "Log Explorer" },
    ],
  };
}

export function normalizeStructuralWarnings(report, rawLineMap) {
  const mixed = report?.mixedDmlAnalysis;
  const recursive = report?.recursiveTriggerAnalysis;
  const items = [];

  if (mixed?.detected) {
    const evidenceSource = Array.isArray(mixed?.evidence) ? mixed.evidence[0] : null;
    items.push({
      id: 'structural-mixed-dml',
      type: 'Mixed DML',
      summary: `Setup objects: ${toArray(mixed?.setupObjects).join(', ') || '-'} · Non-setup objects: ${toArray(mixed?.nonSetupObjects).join(', ') || '-'}`,
      detail: 'Salesforce blocks setup and non-setup DML in the same transaction context.',
      evidence: addRawLogLineNumber({
        timestampNs: first(evidenceSource?.timestampNs, null),
        raw: first(evidenceSource?.logLine, evidenceSource?.raw, null),
      }, rawLineMap),
    });
  }

  if (recursive?.detected) {
    for (const item of toArray(recursive?.recursiveTriggers)) {
      const rawLogLineTexts = toArray(item?.rawLogLineTexts);
      const resolvedRows = resolveRawLogLineNumbers(rawLogLineTexts, rawLineMap);
      const evidence = resolvedRows?.length
        ? { rawLogLineNumber: resolvedRows[0], rawLogLineNumbers: resolvedRows }
        : {};
      items.push({
        id: first(item?.triggerName, `recursive-${items.length + 1}`),
        type: 'Recursive Trigger',
        summary: `${first(item?.triggerName, 'Trigger')} fired ${Number(first(item?.count, 0) || 0)} times`,
        detail: 'Nested re-entry was detected for the same trigger in the execution timeline.',
        evidence,
      });
    }
  }

  return items;
}

export function normalizeDiagnostics(report, rawLineMap) {
  const issueState = collectIssueState(report);
  const debugWarnings = normalizeDebugWarnings(report);
  const debugEvents = toArray(report?.trace?.debugEvents)
    .map((item, index) => ({
      id: first(item?.id, `debug-${index + 1}`),
      namespace: first(item?.namespace, 'default'),
      message: first(item?.message, item?.text, ''),
      evidence: addRawLogLineNumber({
        timestampNs: first(item?.timestampNs, item?.evidence?.timestampNs, null),
        raw: first(typeof item?.evidence === 'string' ? item.evidence : null, item?.raw, null),
      }, rawLineMap),
    }))
    .filter((item) => {
      const evidence = item?.evidence || {};
      const one = Number(evidence?.rawLogLineNumber);
      if (Number.isFinite(one) && one > 0) return true;
      const many = Array.isArray(evidence?.rawLogLineNumbers)
        ? evidence.rawLogLineNumbers
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0)
        : [];
      return many.length > 0 || Boolean(String(evidence?.raw || "").trim());
    });
  const issues = issueState.items
    .map((item, index) => {
      // For recursive trigger: also resolve rawLogLineTexts to get row numbers
      const rawLogLineTexts = toArray(item?.evidence?.rawLogLineTexts);
      const resolvedRows = resolveRawLogLineNumbers(rawLogLineTexts, rawLineMap);

      const baseEvidence = addRawLogLineNumber(item?.evidence || {}, rawLineMap);

      // If the raw text lookup resolved rows, attach the first as rawLogLineNumber
      // (addRawLogLineNumber already does this via evidence.raw; resolvedRows gives us all)
      const evidenceWithRows = resolvedRows && !baseEvidence.rawLogLineNumber
        ? { ...baseEvidence, rawLogLineNumber: resolvedRows[0], rawLogLineNumbers: resolvedRows }
        : resolvedRows
          ? { ...baseEvidence, rawLogLineNumbers: resolvedRows }
          : baseEvidence;

      return {
        id: first(item?.id, `issue-${index + 1}`),
        summary: first(item?.summary, item?.message, item?.description, "Issue"),
        detail: first(item?.description, item?.text, null),
        severity: formatSeverity(normalizeIssueSeverity(item, issueState.fallbackSeverity)),
        type: first(item?.type, "Issue"),
        evidence: evidenceWithRows,
        confidence: first(item?.confidence, item?.evidence?.confidence, null),
      };
    });

  // Re-filter: when raw log lines are available, only keep issues where evidence
  // has a verified raw log row number. This prevents Apex source line numbers
  // from masquerading as jump targets. When no raw lines are available we cannot
  // resolve rows, so keep all issues to avoid silently dropping diagnostics.
  const hasRawLines = rawLineMap.size > 0;
  const trustedIssues = hasRawLines
    ? issues.filter((issue) => {
        const ev = issue.evidence;
        if (!ev) return true; // no evidence to verify — keep the issue
        return ev.rawLogLineNumber != null
          || (Array.isArray(ev.rawLogLineNumbers) && ev.rawLogLineNumbers.length > 0)
          || ev.lineNumber == null; // no source lineNumber to resolve — keep
      })
    : issues;

  const parserWarnings = [];
  for (const phase of collectPhases(report)) {
    for (const warning of toArray(phase?.warnings)) {
      parserWarnings.push({
        phase: first(phase?.name, phase?.id, "Unknown phase"),
        text: warning,
      });
    }
  }

  return {
    issues: trustedIssues,
    issueCountTotal: issueState.totalCount,
    issuesTruncated: issueState.truncated,
    issueLimit: issueState.limit,
    structuralWarnings: normalizeStructuralWarnings(report, rawLineMap),
    executionContext: normalizeExecutionContext(report),
    debugQuality: report?.debugLevelQuality || null,
    debugWarnings,
    debugWarningCountTotal: debugWarnings.length,
    systemMode: toArray(report?.systemModeTransitions?.items || report?.systemModeTransitions),
    systemModeTimeline: normalizeSystemModeTimeline(report),
    cpuBreakdown: normalizeCpuBreakdown(report),
    heap: report?.heapAnalysis || null,
    heapSummary: normalizeHeapSummary(report),
    debugEvents,
    debugEventCountTotal: debugEvents.length,
    parserWarnings,
    parserWarningCountTotal: parserWarnings.length,
  };
}

function normalizeExecutionContext(report) {
  const ctx = report?.context?.executionContext;
  if (!ctx) return null;
  return {
    type: first(ctx?.type, "unknown"),
    label: first(ctx?.label, ctx?.type, "Unknown"),
    confidence: first(ctx?.confidence, "inferred"),
    signals: toArray(ctx?.signals),
    phaseModel: first(ctx?.phaseModel, "trigger"),
  };
}
