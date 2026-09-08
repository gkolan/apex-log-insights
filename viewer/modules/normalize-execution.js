// Execution-related normalization (phases, triggers, timeline, managed packages)

import { byNumberDesc } from "./shared-format.js";
import {
  toArray,
  first,
  collectPhases,
  numberOrNull,
} from "./normalize-helpers.js";

export function normalizePhaseDetails(phases) {
  return phases.map((phase) => {
    const outputs = phase?.outputs || {};
    const inputs = phase?.inputs || {};
    const events = toArray(phase?.events);
    return {
      id: phase?.id,
      executionType: first(inputs?.executionType, null),
      rootCodeUnit: first(inputs?.rootCodeUnit, null),
      observedEventCount: Number(first(outputs?.observedEventCount, events.length, 0) || 0),
      soqlCount: Number(first(outputs?.soqlCount, inputs?.soqlCount, 0) || 0),
      dmlCount: Number(first(outputs?.dmlCount, inputs?.dmlCount, 0) || 0),
      startLine: first(phase?.evidence?.startLine, null),
      endLine: first(phase?.evidence?.endLine, null),
      warnings: toArray(phase?.warnings),
    };
  });
}

export function normalizeTriggerCascade(report) {
  const source = Array.isArray(report?.triggerCascade)
    ? report.triggerCascade
    : toArray(report?.triggerCascade?.cascades);
  return source
    .map((item, index) => ({
      id: first(item?.id, `trigger-cascade-${index + 1}`),
      label: first(item?.label, item?.name, "Trigger"),
      depth: Number(first(item?.depth, 0) || 0),
      childCount: toArray(item?.children).length,
      durationMs: Number(first(item?.durationMs, 0) || 0),
      namespace: first(item?.namespace, "default"),
    }));
}

export function normalizeManagedImpact(report) {
  const source = Array.isArray(report?.managedPackageImpact)
    ? report.managedPackageImpact
    : toArray(report?.managedPackageImpact?.namespaces);
  return source
    .map((item, index) => ({
      id: first(item?.namespace, `managed-impact-${index + 1}`),
      namespace: first(item?.namespace, "package"),
      totalDurationMs: Number(first(item?.totalDurationMs, 0) || 0),
      soqlCount: Number(first(item?.soqlCount, 0) || 0),
      dmlCount: Number(first(item?.dmlCount, 0) || 0),
      pctOfTotalDuration: item?.pctOfTotalDuration === null || item?.pctOfTotalDuration === undefined
        ? null
        : Number(item.pctOfTotalDuration),
    }));
}

// Walk timeline events recursively to include nested children (present in
// deterministic reports). Returns a flat, ordered array of all events.
function flattenTimeline(events, result = [], depth = 0) {
  if (depth > 1000) return result;
  for (const event of events) {
    result.push(event);
    const children = toArray(event?.children);
    if (children.length > 0) {
      flattenTimeline(children, result, depth + 1);
    }
  }
  return result;
}

export function normalizeTimelineSummary(report) {
  const timeline = flattenTimeline(toArray(report?.timeline));
  if (timeline.length === 0) {
    return {
      totalEvents: 0,
      firstEvent: null,
      lastEvent: null,
      topTypes: [],
      namespaceCount: 0,
    };
  }

  const byType = new Map();
  const namespaces = new Set();
  for (const event of timeline) {
    const type = String(first(event?.type, "UNKNOWN") || "UNKNOWN");
    byType.set(type, (byType.get(type) || 0) + 1);
    const namespace = String(first(event?.namespace, "") || "").trim();
    if (namespace) namespaces.add(namespace);
  }

  const topTypes = [...byType.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([type, count]) => ({ type, count }));

  const firstEvent = timeline[0] || null;
  const lastEvent = timeline[timeline.length - 1] || null;

  return {
    totalEvents: timeline.length,
    firstEvent: firstEvent
      ? {
          type: first(firstEvent?.type, "UNKNOWN"),
          lineNumber: first(firstEvent?.evidence?.rawLogLineNumber, null),
        }
      : null,
    lastEvent: lastEvent
      ? {
          type: first(lastEvent?.type, "UNKNOWN"),
          lineNumber: first(lastEvent?.evidence?.rawLogLineNumber, null),
        }
      : null,
    topTypes,
    namespaceCount: namespaces.size,
  };
}

export function normalizeChainItem(item, index) {
  const timing = item?.timing || {};
  const evidence = item?.evidence || {};
  return {
    id: first(item?.id, `execution-${index + 1}`),
    label: first(item?.label, item?.name, item?.eventType, "Execution Block"),
    category: first(item?.category, item?.type, item?.cpuType, "Block"),
    durationMs: numberOrNull(
      first(item?.durationMs, timing?.durationMs, item?.duration),
    ),
    evidence,
  };
}

function normalizeExecutionTree(blocks) {
  const byParent = new Map();
  for (const block of blocks) {
    const parentId = block?.parentId ?? null;
    const children = byParent.get(parentId) || [];
    children.push(block);
    byParent.set(parentId, children);
  }
  const result = [];
  const seen = new Set();
  function visit(block, depth) {
    if (!block || depth > 100 || seen.has(block)) return;
    seen.add(block);
    result.push({ ...normalizeChainItem(block, result.length), depth });
    for (const child of byParent.get(block?.id) || []) visit(child, depth + 1);
  }
  for (const root of byParent.get(null) || []) visit(root, 0);
  for (const block of blocks) visit(block, 0);
  return result;
}

export function normalizeExecution(report) {
  const blocks = toArray(report?.execution?.blocks);
  const executionPhases = toArray(report?.executionPhases);
  const rootBlocks = blocks
    .filter((block) => block?.parentId === null || block?.parentId === undefined)
    .map(normalizeChainItem);
  const chain =
    rootBlocks.length > 0
      ? rootBlocks
      : executionPhases
          .slice()
          .sort(
            (left, right) =>
              Number(left?.phaseIndex || 0) - Number(right?.phaseIndex || 0),
          )
          .map(normalizeChainItem);
  const phases = collectPhases(report);
  const hotspots = (
    toArray(report?.performance?.hotspots).length > 0
      ? toArray(report.performance.hotspots)
      : toArray(report?.overview?.phaseSummary)
  )
    .slice()
    .sort(byNumberDesc((item) => first(item?.durationMs, item?.duration, 0)))
    .map((item, index) => ({
      id: first(item?.id, `hotspot-${index + 1}`),
      label: first(item?.label, item?.name, "Code Unit"),
      durationMs: Number(first(item?.durationMs, item?.duration, 0) || 0),
      soqlCount: Number(first(item?.soqlCount, 0) || 0),
      dmlCount: Number(first(item?.dmlCount, 0) || 0),
      warningCount: Number(first(item?.warningCount, 0) || 0),
      evidence: item?.evidence || {},
    }));

  const packages = toArray(report?.overview?.whatRan?.managedPackages).map((item) => ({
    namespace: first(item?.namespace, item?.package, "package"),
    packageName: first(item?.package, item?.namespace, "package"),
  }));
  const phaseDetails = normalizePhaseDetails(phases);
  const tree = normalizeExecutionTree(blocks);

  return {
    chain,
    chainTotalCount: chain.length,
    tree,
    treeTotalCount: tree.length,
    phases: phases.map((phase) => ({
      id: phase?.id,
      name: first(phase?.name, phase?.label, phase?.id, "Phase"),
      status: first(phase?.status, "not_observed"),
      confidence: first(phase?.confidence, phase?.evidence?.confidence, null),
      warnings: toArray(phase?.warnings),
      evidence: phase?.evidence || {},
    })),
    phaseDetails,
    hotspots,
    hotspotTotalCount: Number.isFinite(
      Number(report?.performance?.hotspotsMeta?.totalCount),
    )
      ? Number(report.performance.hotspotsMeta.totalCount)
      : hotspots.length,
    hotspotsTruncated: Boolean(report?.performance?.hotspotsMeta?.truncated),
    packages,
    triggerNames: toArray(report?.overview?.whatRan?.triggerNames),
    triggerCascade: normalizeTriggerCascade(report),
    triggerCascadeTotalCount: Number.isFinite(
      Number(report?.triggerCascadeMeta?.totalCount),
    )
      ? Number(report.triggerCascadeMeta.totalCount)
      : toArray(report?.triggerCascade).length,
    triggerCascadeTruncated: Boolean(report?.triggerCascadeMeta?.truncated),
    managedImpact: normalizeManagedImpact(report),
    timelineSummary: normalizeTimelineSummary(report),
  };
}
