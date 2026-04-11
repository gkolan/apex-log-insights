// Salesforce ID prefix resolution and sObject type inference.
// Used by record graph extraction and other modules.

import type {
  ParsedVariableAssignment,
  DatabaseSoqlEntry,
  UnknownRecord,
} from './types.js';
import { SALESFORCE_ID_RE } from './types.js';
import { isRecord, asString } from './utils.js';

// ─── Salesforce ID Prefix Resolution ─────────────────────────────────────────
//
// Standard key prefixes (3 chars) map to well-known sObject types.
// Custom objects get dynamic prefixes, so we also build a runtime map
// from SOQL target objects + variable assignment data.

const STANDARD_KEY_PREFIXES: Record<string, string> = {
  '001': 'Account',
  '003': 'Contact',
  '005': 'User',
  '006': 'Opportunity',
  '00k': 'OpportunityLineItem',
  '00Q': 'Lead',
  '00T': 'Task',
  '00U': 'Event',
  '500': 'Case',
  '01t': 'Product2',
  '01u': 'PricebookEntry',
  '01s': 'Pricebook2',
  '800': 'Contract',
  '810': 'ContractLineItem',
  '707': 'AsyncApexJob',
  '01p': 'ApexClass',
  '01q': 'ApexTrigger',
  'a0C': 'SBQQ__Quote__c',
  'a0j': 'SBQQ__QuoteLine__c',
  'a0n': 'SBQQ__Subscription__c',
  '0Hn': 'SBQQ__QuoteLineGroup__c',
  '07L': 'ApexLog',
};

export function getKeyPrefix(id: string): string {
  if (!id || id.length < 3) return '';
  return id.substring(0, 3);
}

/**
 * Infers the Salesforce SObject type from a variable name using naming conventions.
 *
 * Examines common Apex naming patterns (e.g., 'accList' → 'Account', 'oppLineItem' → 'OpportunityLineItem')
 * to infer the sObject context. Uses heuristic pattern matching on variable names. Returns null if no pattern matches.
 *
 * @param name - Variable name to analyze
 * @returns Inferred sObject type (e.g., 'Account', 'Opportunity'), or null if inference fails
 */
export function inferSObjectFromVarName(name: string): string | null {
  // Common naming patterns in Apex: mapProductSalesMetrics → Product_Sales_Metric__c
  // This is heuristic — we try to extract the sObject portion.
  const lower = name.toLowerCase();

  // Direct patterns
  if (lower.includes('opportunitylineitem') || lower.includes('opplineitem') || lower.includes('oli')) return 'OpportunityLineItem';
  if (lower.includes('opportunity') || lower.includes('opp')) return 'Opportunity';
  if (lower.includes('account') || lower.includes('acct')) return 'Account';
  if (lower.includes('contact')) return 'Contact';
  if (lower.includes('product2') || lower.includes('product')) return 'Product2';
  if (lower.includes('contract')) return 'Contract';
  if (lower.includes('quote') && lower.includes('line')) return 'SBQQ__QuoteLine__c';
  if (lower.includes('quote')) return 'SBQQ__Quote__c';
  if (lower.includes('subscription')) return 'SBQQ__Subscription__c';
  if (lower.includes('case')) return 'Case';
  if (lower.includes('lead')) return 'Lead';
  if (lower.includes('user')) return 'User';

  return null;
}

export function resolveSObjectType(id: string, prefixMap: Map<string, string>): string | null {
  const prefix = getKeyPrefix(id);
  return prefixMap.get(prefix) ?? null;
}

/**
 * Builds a map of 3-character Salesforce ID key prefixes to SObject types from variable assignments in the log.
 *
 * Seeds the map with standard key prefixes (001 → Account, 003 → Contact, etc.), then learns custom prefixes
 * from variable assignments and SOQL query contexts. Maps Salesforce record IDs to their sObject types for
 * use in record graph extraction and data flow analysis.
 *
 * @param databaseSoql - Array of parsed SOQL entries for inferring prefix/sObject relationships
 * @param variableAssignments - Array of parsed variable assignments to extract ID and type hints
 * @returns Map from 3-character key prefix to sObject type string
 */
export function buildDynamicPrefixMap(
  databaseSoql: DatabaseSoqlEntry[],
  variableAssignments: ParsedVariableAssignment[],
): Map<string, string> {
  const prefixMap = new Map<string, string>();

  // Seed from standard prefixes
  for (const [prefix, sObj] of Object.entries(STANDARD_KEY_PREFIXES)) {
    prefixMap.set(prefix, sObj);
  }

  // Learn custom prefixes from variable assignments
  // When a variable has an 'Id' field and we know the sObject context from
  // the variable name or from SOQL targetObject, we can associate the prefix.
  for (const va of variableAssignments) {
    if (!isRecord(va.parsedValue)) continue;

    // Direct record: { Id: "aQMbc...", SomeField__c: ... }
    const directId = asString((va.parsedValue as UnknownRecord).Id);
    if (directId && directId.length >= 15) {
      const prefix = getKeyPrefix(directId);
      if (!prefixMap.has(prefix)) {
        // Infer sObject from variable name pattern
        const inferred = inferSObjectFromVarName(va.variableName);
        if (inferred) prefixMap.set(prefix, inferred);
      }
    }

    // Map of records: { "aQMbc...": { Id: "...", ... }, ... }
    for (const [key, val] of Object.entries(va.parsedValue as UnknownRecord)) {
      if (typeof key === 'string' && key.length >= 15 && SALESFORCE_ID_RE.test(key)) {
        const prefix = getKeyPrefix(key);
        if (!prefixMap.has(prefix) && isRecord(val)) {
          const inferred = inferSObjectFromVarName(va.variableName);
          if (inferred) prefixMap.set(prefix, inferred);
        }
      }
    }
  }

  // Learn from SOQL queries — rows returned with known ID fields
  for (const q of databaseSoql) {
    if (!q.targetObject) continue;
    // If we find IDs in the query text (bind variables), we can associate prefixes
    const bindIds = String(q.query || '').match(SALESFORCE_ID_RE);
    if (bindIds) {
      for (const bid of bindIds) {
        const prefix = getKeyPrefix(bid);
        if (!prefixMap.has(prefix)) {
          // These IDs are being queried against this object, but they might be
          // foreign keys — don't blindly associate. Only if the query is
          // "WHERE Id IN :..."
          if (/WHERE\s+Id\s+IN/i.test(String(q.query || ''))) {
            prefixMap.set(prefix, q.targetObject);
          }
        }
      }
    }
  }

  return prefixMap;
}
