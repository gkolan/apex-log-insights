// Trigger cascade builder.
//
// Maps the tree of triggers invoked during execution, tracking which DML
// operations fired which subsequent triggers and to what depth.

import type {
  FlatEvent,
  DatabaseDmlEntry,
  TriggerCascadeNode,
} from './types.js';

export interface TriggerCascadeResult {
  cascades: TriggerCascadeNode[];
  meta: {
    totalRootTriggers: number;
    maxDepth: number;
    truncatedNodes: Array<{ parentId: string; totalChildren: number; shown: number }>;
  };
}

/**
 * Builds a cascade tree showing trigger invocation chains from DML events and the root code unit.
 *
 * Analyzes trigger CODE_UNIT_STARTED events and DML operations to construct a tree where each DML operation can have
 * child triggers that were fired by that DML. Includes depth limiting, truncation tracking, and max-depth reporting for visualization.
 *
 * @param allEvents - Array of all parsed events from the log
 * @param databaseDml - Array of parsed DML entries with timestamps
 * @param childLimit - Maximum number of child triggers to show per DML (default 20, rest tracked as truncated)
 * @returns TriggerCascadeResult with cascade tree, metadata, and truncation information
 */
export function buildTriggerCascade(
  allEvents: FlatEvent[],
  databaseDml: DatabaseDmlEntry[],
  childLimit: number = 20,
): TriggerCascadeResult {
  const triggerEvents = allEvents.filter(
    (event) => event.type === 'CODE_UNIT_STARTED' && (
      String(event.text || '').includes('trigger event') ||
      String(event.text || '').startsWith('__sfdc_trigger/')
    ),
  );

  if (triggerEvents.length === 0) return { cascades: [], meta: { totalRootTriggers: 0, maxDepth: 0, truncatedNodes: [] } };

  const parentByIdx = new Map<number, number | null>(
    allEvents.map((event) => [event.idx, event.parentIdx]),
  );
  const triggerIdxSet = new Set(triggerEvents.map((event) => event.idx));
  const truncatedNodes: Array<{ parentId: string; totalChildren: number; shown: number }> = [];
  let maxDepthReached = 0;

  const isTriggerDescendantOf = (candidateIdx: number, ancestorIdx: number): boolean => {
    let cursor = parentByIdx.get(candidateIdx) ?? null;
    const seen = new Set<number>();
    while (cursor !== null) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      if (cursor === ancestorIdx) return true;
      cursor = parentByIdx.get(cursor) ?? null;
    }
    return false;
  };

  const dmlByWindow = databaseDml
    .filter((d) => d.source === 'event' && d.evidence.timestampNs !== null)
    .sort((a, b) => (a.evidence.timestampNs ?? 0) - (b.evidence.timestampNs ?? 0));

  const buildNode = (
    triggerEvent: FlatEvent,
    depth: number,
    visitedTriggerIdx: Set<number>,
  ): TriggerCascadeNode => {
    maxDepthReached = Math.max(maxDepthReached, depth);
    const startNs = triggerEvent.timestampNs;
    const endNs = triggerEvent.endTimestampNs ?? triggerEvent.timestampNs;
    const nextVisited = new Set(visitedTriggerIdx);
    nextVisited.add(triggerEvent.idx);

    const dmlInTrigger = dmlByWindow.filter((d) => {
      const ts = d.evidence.timestampNs ?? 0;
      return ts >= startNs && ts <= endNs;
    });

    const children: TriggerCascadeNode[] = [];

    for (const dml of dmlInTrigger) {
      const dmlNode: TriggerCascadeNode = {
        id: dml.id,
        label: `${dml.operation ?? 'DML'} on ${dml.sObject ?? 'unknown'}`,
        type: 'dml',
        sObject: dml.sObject,
        operation: dml.operation,
        namespace: dml.namespace,
        durationMs: dml.durationMs,
        children: [],
        depth: depth + 1,
      };

      const dmlTs = dml.evidence.timestampNs ?? 0;
      const maxTs = Math.min(endNs, dmlTs + 100_000_000);
      const allTriggered = triggerEvents
        .filter((candidate) => {
          if (nextVisited.has(candidate.idx)) return false;
          if (candidate.timestampNs <= dmlTs || candidate.timestampNs > maxTs) return false;
          return isTriggerDescendantOf(candidate.idx, triggerEvent.idx);
        })
        .sort((a, b) => a.timestampNs - b.timestampNs);

      const triggeredByDml = allTriggered.slice(0, childLimit);

      if (allTriggered.length > childLimit) {
        truncatedNodes.push({
          parentId: dml.id,
          totalChildren: allTriggered.length,
          shown: childLimit,
        });
      }

      for (const childTrigger of triggeredByDml) {
        if (depth < 5) {
          dmlNode.children.push(buildNode(childTrigger, depth + 2, nextVisited));
        }
      }

      children.push(dmlNode);
    }

    return {
      id: `trigger-${triggerEvent.idx + 1}`,
      label: triggerEvent.text || 'Trigger',
      type: 'trigger',
      sObject: null,
      operation: null,
      namespace: triggerEvent.namespace,
      durationMs: triggerEvent.durationTotalNs !== null
        ? Math.round((triggerEvent.durationTotalNs / 1_000_000) * 1000) / 1000
        : null,
      children,
      depth,
    };
  };

  const rootTriggers = triggerEvents.filter(
    (event) => !Array.from(triggerIdxSet).some(
      (ancestorIdx) => ancestorIdx !== event.idx && isTriggerDescendantOf(event.idx, ancestorIdx),
    ),
  );

  const cascades = rootTriggers
    .sort((a, b) => a.timestampNs - b.timestampNs)
    .map((event) => {
      if (!event) return null;
      return buildNode(event, 0, new Set<number>());
    })
    .filter((node): node is TriggerCascadeNode => node !== null);

  return {
    cascades,
    meta: {
      totalRootTriggers: rootTriggers.length,
      maxDepth: maxDepthReached,
      truncatedNodes,
    },
  };
}
