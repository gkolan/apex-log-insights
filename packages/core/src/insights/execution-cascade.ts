// Trigger cascade builder.

import type {
  DatabaseDmlEntry,
  FlatEvent,
  TriggerCascadeNode,
} from "./types.js";

export interface TriggerCascadeResult {
  cascades: TriggerCascadeNode[];
  meta: {
    totalRootTriggers: number;
    maxDepth: number;
    truncatedNodes: Array<{
      parentId: string;
      totalChildren: number;
      shown: number;
    }>;
  };
}

const TRIGGER_CHILD_WINDOW_NS = 100_000_000;
const MAX_CASCADE_DEPTH = 5;

function isTriggerEvent(event: FlatEvent): boolean {
  return (
    event.type === "CODE_UNIT_STARTED" &&
    (event.text.includes("trigger event") ||
      event.text.startsWith("__sfdc_trigger/"))
  );
}

/**
 * Builds a cascade tree using parser parentage as the ownership boundary.
 * Timestamp proximity only associates a direct child trigger with the latest
 * DML in its owning trigger; nested work is not duplicated under ancestors.
 */
export function buildTriggerCascade(
  allEvents: FlatEvent[],
  databaseDml: DatabaseDmlEntry[],
  childLimit: number = 20,
): TriggerCascadeResult {
  const triggerEvents = allEvents.filter(isTriggerEvent);
  if (triggerEvents.length === 0) {
    return {
      cascades: [],
      meta: { totalRootTriggers: 0, maxDepth: 0, truncatedNodes: [] },
    };
  }

  const eventByIdx = new Map(allEvents.map((event) => [event.idx, event]));
  const triggerIdxSet = new Set(triggerEvents.map((event) => event.idx));
  const nearestTriggerAncestor = new Map<number, number | null>();

  const findNearestTriggerAncestor = (event: FlatEvent): number | null => {
    if (nearestTriggerAncestor.has(event.idx)) {
      return nearestTriggerAncestor.get(event.idx) ?? null;
    }

    const traversed: number[] = [];
    const seen = new Set<number>();
    let parentIdx = event.parentIdx;
    let owner: number | null = null;
    while (parentIdx !== null && !seen.has(parentIdx)) {
      seen.add(parentIdx);
      if (triggerIdxSet.has(parentIdx)) {
        owner = parentIdx;
        break;
      }
      if (nearestTriggerAncestor.has(parentIdx)) {
        owner = nearestTriggerAncestor.get(parentIdx) ?? null;
        break;
      }
      traversed.push(parentIdx);
      parentIdx = eventByIdx.get(parentIdx)?.parentIdx ?? null;
    }
    nearestTriggerAncestor.set(event.idx, owner);
    for (const idx of traversed) nearestTriggerAncestor.set(idx, owner);
    return owner;
  };

  for (const event of allEvents) findNearestTriggerAncestor(event);

  const childTriggersByOwner = new Map<number, FlatEvent[]>();
  for (const trigger of triggerEvents) {
    const owner = findNearestTriggerAncestor(trigger);
    if (owner === null) continue;
    const children = childTriggersByOwner.get(owner) ?? [];
    children.push(trigger);
    childTriggersByOwner.set(owner, children);
  }

  const eventDml = databaseDml.filter((entry) => entry.source === "event");
  const dmlEvents = allEvents.filter((event) => event.type === "DML_BEGIN");
  const dmlByOwner = new Map<number, DatabaseDmlEntry[]>();
  for (let i = 0; i < Math.min(eventDml.length, dmlEvents.length); i += 1) {
    const owner = findNearestTriggerAncestor(dmlEvents[i]!);
    if (owner === null) continue;
    const entries = dmlByOwner.get(owner) ?? [];
    entries.push(eventDml[i]!);
    dmlByOwner.set(owner, entries);
  }

  const truncatedNodes: TriggerCascadeResult["meta"]["truncatedNodes"] = [];
  let maxDepthReached = 0;

  const buildNode = (
    triggerEvent: FlatEvent,
    depth: number,
    visited: Set<number>,
  ): TriggerCascadeNode => {
    maxDepthReached = Math.max(maxDepthReached, depth);
    const nextVisited = new Set(visited).add(triggerEvent.idx);
    const ownedDml = [...(dmlByOwner.get(triggerEvent.idx) ?? [])].sort(
      (a, b) =>
        (a.evidence.timestampNs ?? Number.MAX_SAFE_INTEGER) -
        (b.evidence.timestampNs ?? Number.MAX_SAFE_INTEGER),
    );
    const directChildren = [
      ...(childTriggersByOwner.get(triggerEvent.idx) ?? []),
    ].sort((a, b) => a.timestampNs - b.timestampNs);

    const childrenByDmlId = new Map<string, FlatEvent[]>();
    let latestDmlIndex = -1;
    for (const child of directChildren) {
      if (nextVisited.has(child.idx)) continue;
      while (
        latestDmlIndex + 1 < ownedDml.length &&
        (ownedDml[latestDmlIndex + 1]!.evidence.timestampNs ??
          Number.MAX_SAFE_INTEGER) < child.timestampNs
      ) {
        latestDmlIndex += 1;
      }
      const dml = ownedDml[latestDmlIndex];
      const dmlTimestamp = dml?.evidence.timestampNs ?? null;
      if (
        !dml ||
        dmlTimestamp === null ||
        child.timestampNs > dmlTimestamp + TRIGGER_CHILD_WINDOW_NS
      ) {
        continue;
      }
      const children = childrenByDmlId.get(dml.id) ?? [];
      children.push(child);
      childrenByDmlId.set(dml.id, children);
    }

    const children = ownedDml.map((dml) => {
      const allTriggered = childrenByDmlId.get(dml.id) ?? [];
      const shownTriggers = allTriggered.slice(0, childLimit);
      if (allTriggered.length > childLimit) {
        truncatedNodes.push({
          parentId: dml.id,
          totalChildren: allTriggered.length,
          shown: childLimit,
        });
      }
      return {
        id: dml.id,
        label: `${dml.operation ?? "DML"} on ${dml.sObject ?? "unknown"}`,
        type: "dml" as const,
        sObject: dml.sObject,
        operation: dml.operation,
        namespace: dml.namespace,
        durationMs: dml.durationMs,
        children:
          depth < MAX_CASCADE_DEPTH
            ? shownTriggers.map((child) =>
                buildNode(child, depth + 2, nextVisited),
              )
            : [],
        depth: depth + 1,
      };
    });

    return {
      id: `trigger-${triggerEvent.idx + 1}`,
      label: triggerEvent.text || "Trigger",
      type: "trigger",
      sObject: null,
      operation: null,
      namespace: triggerEvent.namespace,
      durationMs:
        triggerEvent.durationTotalNs !== null
          ? Math.round((triggerEvent.durationTotalNs / 1_000_000) * 1000) / 1000
          : null,
      children,
      depth,
    };
  };

  const rootTriggers = triggerEvents.filter(
    (event) => findNearestTriggerAncestor(event) === null,
  );
  const cascades = rootTriggers
    .sort((a, b) => a.timestampNs - b.timestampNs)
    .map((event) => buildNode(event, 0, new Set<number>()));

  return {
    cascades,
    meta: {
      totalRootTriggers: rootTriggers.length,
      maxDepth: maxDepthReached,
      truncatedNodes,
    },
  };
}
