// Mixed DML, recursive trigger, and system mode transition detection.

import type {
  FlatEvent,
  DatabaseDmlEntry,
  MixedDmlDetection,
  RecursiveTriggerDetection,
  SystemModeTransition,
} from './types.js';

// ─── Setup objects that cannot be mixed with non-setup objects ───────────────

const SETUP_SOBJECTS = new Set([
  'user',
  'userrole',
  'profile',
  'permissionset',
  'permissionsetassignment',
  'groupmember',
  'queuesobject',
  'objectpermissions',
  'fieldpermissions',
  'setupentityaccess',
  'permissionsetlicenseassign',
  'userpermissionaccess',
  'packagelicense',
  'userpackagelicense',
]);

function isSetupSObject(sObject: string): boolean {
  // Only match standard setup sObjects — custom objects (ending in __c) are never setup objects
  const normalized = sObject.toLowerCase().trim();
  if (normalized.endsWith('__c')) return false;
  return SETUP_SOBJECTS.has(normalized);
}

/**
 * Detects when DML operations mix setup and non-setup SObject types within the same transaction (a governor limit violation).
 *
 * Salesforce prohibits mixing DML on setup objects (User, Profile, PermissionSet, etc.) with DML on regular objects in the same transaction.
 * This function identifies both setup and non-setup object DML entries and returns evidence of the violation if both are present.
 *
 * @param databaseDml - Array of parsed DML entries
 * @returns MixedDmlDetection with detected flag, lists of setup/non-setup objects, and evidence entries
 */
export function detectMixedDml(databaseDml: DatabaseDmlEntry[]): MixedDmlDetection {
  const eventDml = databaseDml.filter((d): d is typeof d & { sObject: string } => d.source === 'event' && d.sObject !== null);
  const setupEntries = eventDml.filter((d) => isSetupSObject(d.sObject));
  const nonSetupEntries = eventDml.filter((d) => !isSetupSObject(d.sObject));

  if (setupEntries.length === 0 || nonSetupEntries.length === 0) {
    return { detected: false, setupObjects: [], nonSetupObjects: [], evidence: [] };
  }

  return {
    detected: true,
    setupObjects: [...new Set(setupEntries.map((d) => d.sObject))],
    nonSetupObjects: [...new Set(nonSetupEntries.map((d) => d.sObject))],
    evidence: [...setupEntries, ...nonSetupEntries]
      .slice(0, 6)
      .map((d) => ({
        lineNumber: d.evidence.lineNumber,
        timestampNs: d.evidence.timestampNs,
        sObject: d.sObject,
      })),
  };
}

// ─── Recursive trigger detection ─────────────────────────────────────────────

function extractTriggerName(label: string): string {
  const sfdc = label.match(/__sfdc_trigger\/[^/]+\/([^/\s]+)/);
  if (sfdc?.[1]) return sfdc[1];
  const triggerEvent = label.match(/^([^\s]+)\s+on\s+\S+\s+trigger/i);
  if (triggerEvent?.[1]) return triggerEvent[1];
  return label.split(' ')[0] ?? label;
}

/**
 * Detects recursive trigger execution patterns where a trigger re-fires on the same SObject.
 *
 * Identifies true recursive cases (a trigger span nested inside another trigger span with the same name) as opposed to
 * normal multi-event trigger firing (BeforeInsert + AfterInsert for the same DML operation, which are sequential peers).
 * Returns a detection result with identified recursive triggers and their evidence.
 *
 * @param spans - Array of timing spans representing code units and methods
 * @returns RecursiveTriggerDetection with detected flag and list of recursive trigger instances
 */
export function detectRecursiveTriggers(
  spans: Array<{
    id: string;
    parentId?: string | null;
    eventType: string;
    label: string;
    evidence?: { lineNumber: number | null; raw?: string | null };
  }>,
): RecursiveTriggerDetection {
  const triggerSpans = spans.filter(
    (s) =>
      s.eventType === 'CODE_UNIT_STARTED' &&
      (String(s.label || '').includes('trigger event') || String(s.label || '').startsWith('__sfdc_trigger/')),
  );

  // Group by trigger name
  const byName = new Map<string, typeof triggerSpans>();
  for (const span of triggerSpans) {
    const key = extractTriggerName(String(span.label || '').trim()).toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(span);
  }

  // Build a parent map for ancestry traversal — only needed when parentId is available
  const parentOf = new Map<string, string | null>(
    spans.map((s) => [s.id, s.parentId ?? null]),
  );

  // Returns true if ancestorId is a proper ancestor of descendantId in the span tree.
  // Includes a cycle guard to handle malformed parent chains.
  function isAncestor(ancestorId: string, descendantId: string): boolean {
    let current: string | null = parentOf.get(descendantId) ?? null;
    const seen = new Set<string>();
    while (current !== null) {
      if (seen.has(current)) break; // cycle guard
      seen.add(current);
      if (current === ancestorId) return true;
      current = parentOf.get(current) ?? null;
    }
    return false;
  }

  const recursive: RecursiveTriggerDetection['recursiveTriggers'] = [];

  for (const [, group] of byName) {
    if (group.length <= 1) continue;

    // True recursive: at least one trigger span is nested inside another trigger
    // span with the same name. Sequential multi-event triggers (BeforeDelete +
    // AfterDelete + BeforeInsert + AfterInsert for separate DML operations in the
    // same transaction) are NOT recursive — they are peers in the span tree, not
    // ancestor/descendant pairs.
    let hasNesting = false;
    outer:
    for (let i = 0; i < group.length; i++) {
      for (let j = 0; j < group.length; j++) {
        if (i === j) continue;
        if (isAncestor(group[i]!.id, group[j]!.id)) {
          hasNesting = true;
          break outer;
        }
      }
    }

    if (!hasNesting) continue; // normal multi-event firing — not a bug

    const lineNumbers = group
      .map((s) => Number(s?.evidence?.lineNumber))
      .filter((n) => Number.isFinite(n) && n >= 1)
      .filter((n, i, arr) => arr.indexOf(n) === i)
      .sort((a, b) => a - b);

    const rawLogLineTexts = group
      .map((s) => s?.evidence?.raw ?? null)
      .filter((r): r is string => r !== null && r.length > 0)
      .filter((r, i, arr) => arr.indexOf(r) === i);

    recursive.push({
      triggerName: extractTriggerName(String(group[0]!.label || '').trim()),
      count: group.length,
      lineNumbers,
      rawLogLineTexts,
    });
  }

  recursive.sort((a, b) => b.count - a.count);

  return { detected: recursive.length > 0, recursiveTriggers: recursive };
}

// ─── System Mode Transitions ────────────────────────────────────────────────

/**
 * Extracts system/user mode transitions from log events, tracking when execution switches between system and user context.
 *
 * Parses SYSTEM_MODE_ENTER and SYSTEM_MODE_EXIT events to build a timeline of mode transitions. Each transition includes
 * the timestamp, line number, and the enclosing span context.
 *
 * @param allEvents - Array of all parsed events from the log
 * @param spanIdByEventIdx - Map from event index to enclosing span ID
 * @returns Array of SystemModeTransition records in log order
 */
export function extractSystemModeTransitions(
  allEvents: FlatEvent[],
  spanIdByEventIdx: Map<number, string>,
): SystemModeTransition[] {
  const transitions: SystemModeTransition[] = [];

  for (const event of allEvents) {
    if (event.type !== 'SYSTEM_MODE_ENTER' && event.type !== 'SYSTEM_MODE_EXIT') continue;

    const isEntering = event.type === 'SYSTEM_MODE_ENTER';
    const modeValue = String(event.text || '').trim().toLowerCase();
    const isSystemMode = modeValue === 'true';

    const enclosingSpanId = event.parentIdx !== null
      ? spanIdByEventIdx.get(event.parentIdx) ?? null
      : null;

    transitions.push({
      timestampNs: event.timestampNs,
      lineNumber: event.lineNumber,
      entering: isEntering,
      isSystemMode,
      enclosingSpanId,
    });
  }

  return transitions;
}
