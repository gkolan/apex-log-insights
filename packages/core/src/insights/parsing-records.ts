// Record graph extraction from variable assignments.
// Used by execution.ts and insightsReport.ts.

import type {
  FlatEvent,
  UnknownRecord,
  ParsedVariableAssignment,
  RecordFieldValue,
  RecordInfo,
  RecordGraphEntry,
} from './types.js';
import { SALESFORCE_ID_RE } from './types.js';
import { isRecord, asString } from './utils.js';
import { getKeyPrefix, resolveSObjectType } from './parsing-prefix.js';

// ─── Record Graph Extraction ─────────────────────────────────────────────────
//
// Walks all variable assignments and extracts structured record data:
// IDs, field values, and relationships (__r fields).

export interface RecordGraphResult {
  entries: RecordGraphEntry[];
  meta: {
    totalSObjectTypes: number;
    totalRecords: number;
    truncatedTypes: Array<{ sObjectType: string; total: number; shown: number }>;
    limitPerType: number;
  };
}

/**
 * Extracts the graph of Salesforce records referenced and modified during the transaction.
 *
 * Walks all variable assignments to find record objects (by ID, in lists, or in maps), extracts field values and relationships (__r fields),
 * and groups records by sObject type. Tracks provenance (variable name, timestamp, line number) and relationship navigation.
 * Truncates results per sObject type for readability.
 *
 * @param allEvents - Array of all parsed events from the log (used for event/variable pairing)
 * @param variableAssignments - Array of parsed variable assignments containing record data
 * @param prefixMap - Map of ID key prefixes to sObject types
 * @param limitPerType - Maximum records to return per sObject type (default 100)
 * @returns RecordGraphResult with grouped records and metadata about truncation
 */
export function extractRecordGraph(
  allEvents: FlatEvent[],
  variableAssignments: ParsedVariableAssignment[],
  prefixMap: Map<string, string>,
  limitPerType: number = 100,
): RecordGraphResult {
  const recordsById = new Map<string, RecordInfo>();

  // Build per-name event queues so each assignment consumes the correct event
  // in log order, preventing duplicate variable names from collapsing onto the
  // first occurrence.
  const vaEventQueues = new Map<string, FlatEvent[]>();
  for (const event of allEvents) {
    if (event.type !== 'VARIABLE_ASSIGNMENT') continue;
    const sep = event.text.indexOf('|');
    const name = sep !== -1 ? event.text.slice(0, sep) : event.text;
    if (!vaEventQueues.has(name)) vaEventQueues.set(name, []);
    vaEventQueues.get(name)!.push(event);
  }

  for (const va of variableAssignments) {
    if (!va.parsedValue || typeof va.parsedValue !== 'object') continue;

    const queue = vaEventQueues.get(va.variableName) ?? [];
    const eventForVa = queue.shift();
    const timestampNs = eventForVa?.timestampNs ?? null;
    const lineNumber = eventForVa?.lineNumber ?? null;

    if (Array.isArray(va.parsedValue)) {
      // List of IDs or list of records
      for (const item of va.parsedValue) {
        if (typeof item === 'string' && item.length >= 15) {
          if (SALESFORCE_ID_RE.test(item)) {
            if (!recordsById.has(item)) {
              recordsById.set(item, {
                id: item,
                sObjectType: resolveSObjectType(item, prefixMap),
                keyPrefix: getKeyPrefix(item),
                fields: [],
                relationships: [],
                provenance: {
                  variableName: va.variableName,
                  timestampNs,
                  lineNumber,
                  source: 'variable_assignment',
                },
              });
            }
          }
        } else if (isRecord(item)) {
          extractRecordFromObject(item as UnknownRecord, va.variableName, timestampNs, lineNumber, prefixMap, recordsById);
        }
      }
    } else if (isRecord(va.parsedValue)) {
      const obj = va.parsedValue as UnknownRecord;

      // Check if this is a direct record (has 'Id' field)
      const directId = asString(obj.Id);
      if (directId && directId.length >= 15) {
        extractRecordFromObject(obj, va.variableName, timestampNs, lineNumber, prefixMap, recordsById);
      } else {
        // Map keyed by ID: { "aQMbc...": { ... }, "aQMbc...": { ... } }
        for (const [key, val] of Object.entries(obj)) {
          if (typeof key === 'string' && key.length >= 15) {
            if (SALESFORCE_ID_RE.test(key) && isRecord(val)) {
              // Inject the map key as Id when the value object lacks its own Id field
              const valRecord = val as UnknownRecord;
              const recordObj: UnknownRecord = asString(valRecord.Id)
                ? valRecord
                : { Id: key, ...valRecord };
              extractRecordFromObject(recordObj, va.variableName, timestampNs, lineNumber, prefixMap, recordsById);
            }
          }
        }
      }
    }
  }

  // Group by sObjectType
  const bySObject = new Map<string, RecordInfo[]>();
  for (const record of recordsById.values()) {
    const key = record.sObjectType || `Unknown (${record.keyPrefix})`;
    if (!bySObject.has(key)) bySObject.set(key, []);
    bySObject.get(key)!.push(record);
  }

  const truncatedTypes: Array<{ sObjectType: string; total: number; shown: number }> = [];
  let totalRecords = 0;

  const entries = Array.from(bySObject.entries())
    .map(([sObjectType, records]) => {
      totalRecords += records.length;
      const shown = records.slice(0, limitPerType);
      if (records.length > limitPerType) {
        truncatedTypes.push({ sObjectType, total: records.length, shown: shown.length });
      }
      return {
        sObjectType,
        keyPrefix: records[0]?.keyPrefix ?? '???',
        recordCount: records.length,
        records: shown,
        truncated: records.length > limitPerType,
      };
    })
    .sort((a, b) => b.recordCount - a.recordCount);

  return {
    entries,
    meta: {
      totalSObjectTypes: bySObject.size,
      totalRecords,
      truncatedTypes,
      limitPerType,
    },
  };
}

function extractRecordFromObject(
  obj: UnknownRecord,
  variableName: string,
  timestampNs: number | null,
  lineNumber: number | null,
  prefixMap: Map<string, string>,
  recordsById: Map<string, RecordInfo>,
  visited: Set<unknown> = new Set(),
): void {
  if (visited.has(obj)) return;
  visited.add(obj);
  const id = asString(obj.Id);
  if (!id || id.length < 15) return;

  // Skip if already tracked with richer data
  const existing = recordsById.get(id);
  if (existing && existing.fields.length > 0) return;

  const fields: RecordFieldValue[] = [];
  const relationships: RecordInfo['relationships'] = [];

  for (const [field, value] of Object.entries(obj)) {
    if (field === 'Id') continue;

    // Relationship navigation (__r suffix)
    if (field.endsWith('__r') && isRecord(value)) {
      const relObj = value as UnknownRecord;
      const relId = asString(relObj.Id);
      if (relId) {
        relationships.push({
          field,
          relatedId: relId,
          relatedSObject: resolveSObjectType(relId, prefixMap),
        });
        // Recurse into the related record
        extractRecordFromObject(relObj, `${variableName}.${field}`, timestampNs, lineNumber, prefixMap, recordsById, visited);
      }
      // Also extract scalar fields from the related object
      for (const [relField, relValue] of Object.entries(relObj)) {
        if (relField !== 'Id' && !relField.endsWith('__r') && !isRecord(relValue)) {
          fields.push({ field: `${field}.${relField}`, value: relValue });
        }
      }
      continue;
    }

    // Foreign key fields (__c ending with an ID value)
    if (typeof value === 'string' && value.length >= 15) {
      if (SALESFORCE_ID_RE.test(value)) {
        const relSObject = resolveSObjectType(value, prefixMap);
        relationships.push({
          field,
          relatedId: value,
          relatedSObject: relSObject,
        });
      }
    }

    // Scalar field values
    if (!isRecord(value) && !Array.isArray(value)) {
      fields.push({ field, value });
    }
  }

  recordsById.set(id, {
    id,
    sObjectType: resolveSObjectType(id, prefixMap),
    keyPrefix: getKeyPrefix(id),
    fields,
    relationships,
    provenance: {
      variableName,
      timestampNs,
      lineNumber,
      source: 'variable_assignment',
    },
  });
}
