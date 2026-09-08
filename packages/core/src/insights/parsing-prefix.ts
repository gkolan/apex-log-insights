// Salesforce ID prefix resolution and sObject type inference.
// Used by record graph extraction and other modules.

import type {
  ParsedVariableAssignment,
  DatabaseSoqlEntry,
  UnknownRecord,
} from "./types.js";
import { isSalesforceId } from "./types.js";
import { isRecord, asString } from "./utils.js";

// ─── Salesforce ID Prefix Resolution ─────────────────────────────────────────
//
// Standard key prefixes (3 chars) map to well-known sObject types.
// Custom objects get dynamic prefixes, so we also build a runtime map
// from SOQL target objects + variable assignment data.

const STANDARD_KEY_PREFIXES: Record<string, string> = {
  "001": "Account",
  "003": "Contact",
  "005": "User",
  "006": "Opportunity",
  "00k": "OpportunityLineItem",
  "00Q": "Lead",
  "00T": "Task",
  "00U": "Event",
  "500": "Case",
  "01t": "Product2",
  "01u": "PricebookEntry",
  "01s": "Pricebook2",
  "800": "Contract",
  "810": "ContractLineItem",
  "707": "AsyncApexJob",
  "01p": "ApexClass",
  "01q": "ApexTrigger",
  a0C: "SBQQ__Quote__c",
  a0j: "SBQQ__QuoteLine__c",
  a0n: "SBQQ__Subscription__c",
  "0Hn": "SBQQ__QuoteLineGroup__c",
  "07L": "ApexLog",
};

export function getKeyPrefix(id: string): string {
  if (!id || id.length < 3) return "";
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
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
  const has = (...candidates: string[]): boolean =>
    candidates.some((candidate) => words.includes(candidate));

  // Direct patterns
  if (
    has(
      "opportunitylineitem",
      "opportunitylineitems",
      "opplineitem",
      "opplineitems",
      "oli",
      "olis",
    ) ||
    (has("opportunity", "opp") &&
      (has("lineitem", "lineitems") ||
        (has("line", "lines") && has("item", "items"))))
  )
    return "OpportunityLineItem";
  if (has("opportunity", "opportunities", "opp", "opps")) return "Opportunity";
  if (has("account", "accounts", "acct", "accts")) return "Account";
  if (has("contact", "contacts")) return "Contact";
  if (has("product2", "product", "products")) return "Product2";
  if (has("contract", "contracts")) return "Contract";
  if (
    has("quoteline", "quotelines") ||
    (has("quote", "quotes") && has("line", "lines"))
  )
    return "SBQQ__QuoteLine__c";
  if (has("quote", "quotes")) return "SBQQ__Quote__c";
  if (has("subscription", "subscriptions")) return "SBQQ__Subscription__c";
  if (has("case", "cases")) return "Case";
  if (has("lead", "leads")) return "Lead";
  if (has("user", "users")) return "User";

  return null;
}

function addPrefixCandidate(
  candidates: Map<string, Set<string>>,
  id: string,
  sObjectType: string,
): void {
  const prefix = getKeyPrefix(id);
  const types = candidates.get(prefix) ?? new Set<string>();
  types.add(sObjectType);
  candidates.set(prefix, types);
}

function subqueryRanges(query: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const stack: Array<{ start: number; isSubquery: boolean }> = [];
  let quote: "'" | '"' | null = null;
  let quoteStart = -1;
  let lineComment = false;
  let lineCommentStart = -1;
  let blockComment = false;
  let blockCommentStart = -1;

  for (let index = 0; index < query.length; index += 1) {
    const char = query[index]!;
    const next = query[index + 1];
    if (lineComment) {
      if (char === "\n" || char === "\r") {
        ranges.push({ start: lineCommentStart, end: index });
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        ranges.push({ start: blockCommentStart, end: index + 1 });
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) {
        if (next === quote) index += 1;
        else {
          ranges.push({ start: quoteStart, end: index });
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      quoteStart = index;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      lineCommentStart = index;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      blockCommentStart = index;
      index += 1;
      continue;
    }
    if (char === "(") {
      let tokenStart = index + 1;
      while (/\s/.test(query[tokenStart] ?? "")) tokenStart += 1;
      stack.push({
        start: index,
        isSubquery:
          query.slice(tokenStart, tokenStart + 6).toUpperCase() === "SELECT" &&
          !/[A-Z0-9_]/i.test(query[tokenStart + 6] ?? ""),
      });
    } else if (char === ")") {
      const frame = stack.pop();
      if (frame?.isSubquery) ranges.push({ start: frame.start, end: index });
    }
  }
  for (const frame of stack) {
    if (frame.isSubquery)
      ranges.push({ start: frame.start, end: query.length });
  }
  if (quote) ranges.push({ start: quoteStart, end: query.length });
  if (lineComment) ranges.push({ start: lineCommentStart, end: query.length });
  if (blockComment)
    ranges.push({ start: blockCommentStart, end: query.length });
  ranges.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function extractLiteralIdPredicateIds(query: string): string[] {
  const ids = new Set<string>();
  const excluded = subqueryRanges(query);
  const isExcluded = (index: number): boolean => {
    let low = 0;
    let high = excluded.length - 1;
    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2);
      const range = excluded[middle]!;
      if (index <= range.start) high = middle - 1;
      else if (index >= range.end) low = middle + 1;
      else return true;
    }
    return false;
  };
  const field = String.raw`(?:\b[A-Za-z_][A-Za-z0-9_]*\s*\.\s*)?\bId\b`;
  const idToken = String.raw`[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?`;
  const equalsPattern = new RegExp(
    String.raw`${field}\s*=\s*(['"])(${idToken})\1`,
    "gi",
  );
  const inPattern = new RegExp(String.raw`${field}\s+IN\s*\(([^)]*)\)`, "gi");
  const quotedIdPattern = new RegExp(String.raw`(['"])(${idToken})\1`, "g");

  for (const match of query.matchAll(equalsPattern)) {
    if (!isExcluded(match.index) && isSalesforceId(match[2])) ids.add(match[2]);
  }
  for (const match of query.matchAll(inPattern)) {
    if (isExcluded(match.index)) continue;
    for (const idMatch of (match[1] ?? "").matchAll(quotedIdPattern)) {
      if (isSalesforceId(idMatch[2])) ids.add(idMatch[2]);
    }
  }
  return [...ids];
}

export function resolveSObjectType(
  id: string,
  prefixMap: Map<string, string>,
): string | null {
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

  // Exact literal Id predicates are stronger than variable-name heuristics.
  // Conflicting explicit evidence leaves a dynamic prefix unresolved.
  const queryCandidates = new Map<string, Set<string>>();
  for (const query of databaseSoql) {
    if (!query.targetObject) continue;
    for (const id of extractLiteralIdPredicateIds(String(query.query || ""))) {
      addPrefixCandidate(queryCandidates, id, query.targetObject);
    }
  }
  const ambiguousQueryPrefixes = new Set<string>();
  for (const [prefix, types] of queryCandidates) {
    if (prefixMap.has(prefix)) continue;
    if (types.size === 1) prefixMap.set(prefix, types.values().next().value!);
    else ambiguousQueryPrefixes.add(prefix);
  }

  // Learn custom prefixes from variable assignments
  // When a variable has an 'Id' field and we know the sObject context from
  // the variable name or from SOQL targetObject, we can associate the prefix.
  const variableCandidates = new Map<string, Set<string>>();
  for (const va of variableAssignments) {
    if (!isRecord(va.parsedValue)) continue;
    const inferred = inferSObjectFromVarName(va.variableName);
    if (!inferred) continue;

    // Direct record: { Id: "aQMbc...", SomeField__c: ... }
    const directId = asString((va.parsedValue as UnknownRecord).Id);
    if (isSalesforceId(directId)) {
      addPrefixCandidate(variableCandidates, directId, inferred);
    }

    // Map of records: { "aQMbc...": { Id: "...", ... }, ... }
    for (const [key, val] of Object.entries(va.parsedValue as UnknownRecord)) {
      if (isSalesforceId(key)) {
        if (isRecord(val))
          addPrefixCandidate(variableCandidates, key, inferred);
      }
    }
  }
  for (const [prefix, types] of variableCandidates) {
    if (
      !prefixMap.has(prefix) &&
      !ambiguousQueryPrefixes.has(prefix) &&
      types.size === 1
    ) {
      prefixMap.set(prefix, types.values().next().value!);
    }
  }

  return prefixMap;
}
