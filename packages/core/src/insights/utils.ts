// Core utility functions used across multiple insights modules.
// Imported by parsing.ts, governor.ts, execution.ts, database.ts,
// and insightsReport.ts.

import type { FlatEvent, UnknownRecord } from './types.js';

// browser-safe: no node:path needed
export function basename(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function readPath(obj: unknown, keys: string[]): unknown {
  if (!isRecord(obj)) return undefined;
  for (const key of keys) {
    if (key in obj && obj[key] != null) return obj[key];
  }
  return undefined;
}

export function cloneJsonLike<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function parseLogId(fileName: string): string | null {
  const m = fileName.match(/(07L[a-zA-Z0-9]{12,})/);
  return m?.[1] ?? null;
}

export function normalizeClock(value: string | undefined): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{2}:\d{2}:\d{2})\.(\d{1,3})$/);
  if (!m) return null;
  const ms = m[2]!.padEnd(3, '0').slice(0, 3);
  return `${m[1]!}.${ms}`;
}

export function eventClockFromLogLine(logLine: string): string | null {
  if (!logLine) return null;
  const timePart = logLine.split(' ')[0];
  return normalizeClock(timePart);
}

export function parseUserInfoFromLogLine(logLine: string): {
  userId: string | null;
  username: string | null;
  timezone: string | null;
} {
  const parts = String(logLine || '').split('|');
  if (parts.length < 7) {
    return { userId: null, username: null, timezone: null };
  }
  const userId = parts[3]?.trim() || null;
  const username = parts[4]?.trim() || null;
  const timezone = parts[6]?.trim() || null;
  return { userId, username, timezone };
}

export function countByKey(events: FlatEvent[], key: (event: FlatEvent) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const event of events) {
    const value = key(event).trim() || 'unknown';
    out[value] = (out[value] ?? 0) + 1;
  }
  return out;
}

export function toLimit(used: number | undefined, max: number | undefined): {
  used: number | null;
  max: number | null;
  pct: number | null;
  status: 'ok' | 'warn' | 'critical' | 'unknown';
} {
  if (used === undefined || max === undefined || max <= 0) {
    return { used: used ?? null, max: max ?? null, pct: null, status: 'unknown' };
  }

  const pct = Math.round((used / max) * 10000) / 100;
  const status = pct >= 95 ? 'critical' : pct >= 80 ? 'warn' : 'ok';
  return { used, max, pct, status };
}

export function flattenEvents(root: unknown): FlatEvent[] {
  const out: FlatEvent[] = [];

  const walk = (node: unknown, parentIdx: number | null) => {
    const children = asArray(readPath(node, ['children']));
    for (const child of children) {
      const timestampNs = asNumber(readPath(child, ['timestamp'])) ?? 0;
      const endTimestampNs = asNumber(readPath(child, ['exitStamp'])) ?? null;
      const durationSelfNs = asNumber(readPath(readPath(child, ['duration']), ['self'])) ?? null;
      const durationTotalNs = asNumber(readPath(readPath(child, ['duration']), ['total'])) ?? null;

      const entry: FlatEvent = {
        idx: out.length,
        parentIdx,
        type: asString(readPath(child, ['type'])) ?? 'UNKNOWN',
        timestampNs,
        endTimestampNs,
        durationSelfNs,
        durationTotalNs,
        namespace: asString(readPath(child, ['namespace'])) ?? 'default',
        category: asString(readPath(child, ['category'])) ?? '',
        debugCategory: asString(readPath(child, ['debugCategory'])) ?? '',
        cpuType: asString(readPath(child, ['cpuType'])) ?? '',
        lineNumber: asNumber(readPath(child, ['lineNumber'])) ?? null,
        text: asString(readPath(child, ['text'])) ?? '',
        logLine: asString(readPath(child, ['logLine'])) ?? '',
        isParent: readPath(child, ['isParent']) === true,
        aggregations: asNumber(readPath(child, ['aggregations'])) ?? null,
        soqlCountTotal: asNumber(readPath(readPath(child, ['soqlCount']), ['total'])) ?? null,
        soqlRowCountTotal: asNumber(readPath(readPath(child, ['soqlRowCount']), ['total'])) ?? null,
        soslCountTotal: asNumber(readPath(readPath(child, ['soslCount']), ['total'])) ?? null,
        soslRowCountTotal: asNumber(readPath(readPath(child, ['soslRowCount']), ['total'])) ?? null,
        dmlCountTotal: asNumber(readPath(readPath(child, ['dmlCount']), ['total'])) ?? null,
        dmlRowCountTotal: asNumber(readPath(readPath(child, ['dmlRowCount']), ['total'])) ?? null,
      };

      out.push(entry);
      walk(child, entry.idx);
    }
  };

  walk(root, null);
  return out;
}

export function parseDmlText(text: string): { operation: string | null; sobject: string | null } {
  const op = text.match(/Op:(\w+)/i)?.[1] ?? null;
  const sobject = text.match(/Type:([^|\s]+)/i)?.[1] ?? null;
  return { operation: op, sobject };
}

export function parseCalloutRequestText(text: string): {
  endpoint: string | null;
  host: string | null;
  method: string | null;
} {
  const normalized = text || '';
  const endpoint = normalized.match(/Endpoint\s*=\s*([^,\]]+)/i)?.[1]?.trim()
    ?? normalized.match(/\bhttps?:\/\/[^\s,\]]+/i)?.[0]?.trim()
    ?? null;
  const method = normalized.match(/Method\s*=\s*([A-Z]+)/i)?.[1]?.toUpperCase()
    ?? normalized.match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i)?.[1]?.toUpperCase()
    ?? null;

  let host: string | null = null;
  if (endpoint) {
    try {
      host = new URL(endpoint).host || null;
    } catch {
      host = null;
    }
  }

  return { endpoint, host, method };
}

export function parseCalloutResponseText(text: string): { statusCode: number | null; statusText: string | null } {
  const t = String(text || '');
  // "System.HttpResponse[Status=OK, StatusCode=200]" or "Status=200 OK"
  const codeMatch = t.match(/StatusCode[=:\s]+(\d{3})/i) ?? t.match(/\b([1-5]\d{2})\b/);
  const statusCode = codeMatch ? parseInt(codeMatch[1]!, 10) : null;
  const statusMatch = t.match(/Status\s*=\s*([^,\]]+)/i);
  const statusText = statusMatch ? statusMatch[1]!.trim() : null;
  return { statusCode, statusText };
}

export function queueableClassFromText(text: string): string | null {
  if (!text) return null;
  if (!/queueable/i.test(text)) return null;

  const beforeParen = text.split('(')[0]?.trim() ?? '';
  if (beforeParen) return beforeParen;
  return text.trim() || null;
}

export function isErrorEventType(type: string): boolean {
  if (type === 'EXCEPTION_THROWN' || type === 'FATAL_ERROR' || type === 'VALIDATION_ERROR') return true;
  if (type.endsWith('_VIOLATION')) return true;
  return type.includes('ERROR') || type.includes('EXCEPTION');
}

export function isSpanCandidate(event: FlatEvent): boolean {
  if (!event.isParent) return false;
  if ((event.durationTotalNs ?? 0) <= 0) return false;

  return (
    event.type.startsWith('CODE_UNIT_') ||
    event.type.startsWith('METHOD_') ||
    event.type.startsWith('CONSTRUCTOR_') ||
    event.type.startsWith('SYSTEM_METHOD_') ||
    event.type.startsWith('SYSTEM_CONSTRUCTOR_') ||
    event.type.startsWith('VF_') ||
    event.type.startsWith('FLOW_') ||
    event.type.startsWith('WF_') ||
    event.type.startsWith('SOQL_') ||
    event.type.startsWith('SOSL_') ||
    event.type.startsWith('DML_') ||
    event.type.startsWith('NBA_') ||
    event.type === 'CALLOUT_REQUEST' ||
    event.type === 'NAMED_CREDENTIAL_REQUEST'
  );
}

export function buildSpanLabel(event: FlatEvent): string {
  if (event.type === 'SOQL_EXECUTE_BEGIN') return event.text || 'SOQL';
  if (event.type === 'DML_BEGIN') return event.text || 'DML';
  if (event.type === 'FLOW_START_INTERVIEW_BEGIN') return event.text || 'Flow interview';
  if (event.type === 'FLOW_ELEMENT_BEGIN') return event.text || 'Flow element';
  if (event.type === 'CODE_UNIT_STARTED') return event.text || 'Code Unit';
  return event.text || event.type;
}

export function parseValidationCodeUnitLabel(label: string): { sobject: string | null; context: string | null } {
  const parts = String(label || '').split(':');
  if (parts.length < 2) return { sobject: null, context: null };
  return {
    sobject: parts[1] || null,
    context: parts[2] || null,
  };
}
