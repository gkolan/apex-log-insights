// Debug level quality assessment, CPU attribution, and managed package impact analysis.
// Used by insightsReport.ts to evaluate observability and resource consumption.

import type {
  FlatEvent,
  DebugLevelEntry,
  DataQualityWarning,
  DebugLevelQuality,
  CpuAttribution,
  ManagedPackageImpact,
} from './types.js';
import { asString, asArray, readPath } from './utils.js';

// ─── Debug Level Quality Assessment ─────────────────────────────────────────

/**
 * Assesses whether the debug level configuration provides sufficient detail for meaningful analysis.
 *
 * Examines log levels for key categories (Apex Code, Database, Callout, System, Validation, Workflow, Data Access).
 * Identifies categories at insufficient verbosity and provides recommendations to improve observability. Returns overall
 * quality rating (high, medium, low) and detailed warnings with remediation steps.
 *
 * @param parserResult - The parsed log result object containing debug level configuration
 * @returns DebugLevelQuality with configured levels, quality warnings, and overall quality assessment
 */
export function assessDebugLevelQuality(parserResult: unknown): DebugLevelQuality {
  const debugLevelsRaw = asArray(readPath(parserResult, ['debugLevels']));

  const levels: DebugLevelEntry[] = debugLevelsRaw.map((entry) => ({
    category: asString(readPath(entry, ['logCategory'])) ?? '',
    level: asString(readPath(entry, ['logLevel'])) ?? '',
  })).filter((e) => e.category !== '');

  const warnings: DataQualityWarning[] = [];
  const levelRank: Record<string, number> = {
    NONE: 0, ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4, FINE: 5, FINER: 6, FINEST: 7,
  };

  const getLevelRank = (level: string): number => levelRank[level.toUpperCase()] ?? 0;

  for (const entry of levels) {
    const cat = entry.category.toUpperCase();
    const rank = getLevelRank(entry.level);

    if (cat === 'CALLOUT' && rank < (levelRank.FINE ?? 5)) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation: 'Set Callout to FINE or FINER for request/response detail',
        impact: 'Callout URLs, HTTP methods, and response codes are not captured at INFO level',
      });
    }

    if (cat === 'APEX_CODE' && rank < (levelRank.FINE ?? 5)) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation: 'Set Apex Code to FINE+ for method entry/exit and variable assignments',
        impact: 'Method-level timing, variable values, and execution flow are limited',
      });
    }

    if (cat === 'DATABASE' && rank < (levelRank.FINE ?? 5)) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation: 'Set Database to FINE+ for SOQL explain plans and DML detail',
        impact: 'Query explain plans and row-level DML detail are not available',
      });
    }

    if (cat === 'SYSTEM' && rank < (levelRank.FINE ?? 5)) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation: 'Set System to FINE+ for system method entry/exit events',
        impact: 'System method timing data is incomplete',
      });
    }

    if (cat === 'VALIDATION' && rank < (levelRank.INFO ?? 3)) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation: 'Set Validation to INFO+ for validation rule evaluation details',
        impact: 'Validation rule formulas and outcomes are not captured',
      });
    }

    if (cat === 'WORKFLOW' && rank < (levelRank.INFO ?? 3)) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation: 'Set Workflow to INFO+ for workflow rule and process builder detail',
        impact: 'Workflow rule evaluation and field update details are missing',
      });
    }

    if (cat === 'DATA_ACCESS' && rank === (levelRank.NONE ?? 0)) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation: 'Set Data Access to INFO+ if you need sharing/FLS evaluation details',
        impact: 'Data access and sharing-related events are completely suppressed',
      });
    }
  }

  // Overall quality based on key categories
  const apexLevel = levels.find((l) => l.category.toUpperCase() === 'APEX_CODE');
  const dbLevel = levels.find((l) => l.category.toUpperCase() === 'DATABASE');
  const apexRank = apexLevel ? getLevelRank(apexLevel.level) : 0;
  const dbRank = dbLevel ? getLevelRank(dbLevel.level) : 0;

  let overallQuality: 'high' | 'medium' | 'low' = 'low';
  if (apexRank >= (levelRank.FINEST ?? 7) && dbRank >= (levelRank.FINEST ?? 7)) {
    overallQuality = 'high';
  } else if (apexRank >= (levelRank.FINE ?? 5) && dbRank >= (levelRank.FINE ?? 5)) {
    overallQuality = 'medium';
  }

  return { levels, warnings, overallQuality };
}

// ─── CPU Attribution ────────────────────────────────────────────────────────

/**
 * Attributes CPU time consumption to individual code units, methods, and namespaces.
 *
 * Aggregates self and total duration from spans, grouped by CPU type and by namespace. Provides breakdown showing
 * which parts of code consume CPU and identifies managed package vs custom code performance impact.
 *
 * @param spans - Array of timing spans with CPU type and duration metrics
 * @returns CpuAttribution with breakdown by CPU type and by namespace
 */
export function buildCpuAttribution(
  spans: Array<{
    id: string;
    eventType: string;
    namespace: string;
    cpuType: string | null;
    durationMs: number | null;
    selfDurationMs: number | null;
  }>,
): CpuAttribution {
  const byType: Record<string, { durationMs: number; count: number }> = {};
  const byNamespace: Record<string, { selfDurationMs: number; totalDurationMs: number; spanCount: number }> = {};

  for (const span of spans) {
    // By CPU type
    const cpuKey = span.cpuType || 'unknown';
    if (!byType[cpuKey]) byType[cpuKey] = { durationMs: 0, count: 0 };
    byType[cpuKey].durationMs += span.selfDurationMs ?? 0;
    byType[cpuKey].count += 1;

    // By namespace
    const ns = span.namespace || 'default';
    if (!byNamespace[ns]) byNamespace[ns] = { selfDurationMs: 0, totalDurationMs: 0, spanCount: 0 };
    byNamespace[ns].selfDurationMs += span.selfDurationMs ?? 0;
    byNamespace[ns].totalDurationMs += span.durationMs ?? 0;
    byNamespace[ns].spanCount += 1;
  }

  // Round values for readability
  for (const entry of Object.values(byType)) {
    entry.durationMs = Math.round(entry.durationMs * 1000) / 1000;
  }
  for (const entry of Object.values(byNamespace)) {
    entry.selfDurationMs = Math.round(entry.selfDurationMs * 1000) / 1000;
    entry.totalDurationMs = Math.round(entry.totalDurationMs * 1000) / 1000;
  }

  return { byType, byNamespace };
}

// ─── Managed Package Impact Summary ─────────────────────────────────────────

/**
 * Analyses the performance impact of managed package code vs custom code.
 *
 * For each managed package namespace, aggregates span count, total and self duration, SOQL/DML operation counts,
 * row counts, and percentage of total execution time. Returns array sorted by total duration (highest first).
 *
 * @param namespaces - Array of unique namespace strings from the execution
 * @param spans - Array of timing spans with namespace and duration metrics
 * @param allEvents - Array of all parsed events for operation counting
 * @param totalDurationMs - Total execution duration in milliseconds (for percentage calculation)
 * @returns Array of ManagedPackageImpact objects sorted by total duration
 */
export function buildManagedPackageImpact(
  namespaces: string[],
  spans: Array<{
    id: string;
    namespace: string;
    durationMs: number | null;
    selfDurationMs: number | null;
  }>,
  allEvents: FlatEvent[],
  totalDurationMs: number,
): ManagedPackageImpact[] {
  const packages = namespaces.filter((ns) => ns !== 'default');
  if (packages.length === 0) return [];

  return packages.map((ns) => {
    const pkgSpans = spans.filter((s) => s.namespace === ns);
    const pkgEvents = allEvents.filter((e) => e.namespace === ns);

    const totalDuration = pkgSpans.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
    const selfDuration = pkgSpans.reduce((sum, s) => sum + (s.selfDurationMs ?? 0), 0);

    const soqlEvents = pkgEvents.filter((e) => e.type === 'SOQL_EXECUTE_BEGIN');
    const dmlEvents = pkgEvents.filter((e) => e.type === 'DML_BEGIN');

    const soqlRows = soqlEvents.reduce((sum, e) => sum + (e.soqlRowCountTotal ?? 0), 0);
    const dmlRows = dmlEvents.reduce((sum, e) => sum + (e.dmlRowCountTotal ?? 0), 0);

    return {
      namespace: ns,
      spanCount: pkgSpans.length,
      totalDurationMs: Math.round(totalDuration * 1000) / 1000,
      selfDurationMs: Math.round(selfDuration * 1000) / 1000,
      soqlCount: soqlEvents.length,
      soqlRows,
      dmlCount: dmlEvents.length,
      dmlRows,
      pctOfTotalDuration: totalDurationMs > 0
        ? Math.round((totalDuration / totalDurationMs) * 10000) / 100
        : null,
    };
  }).sort((a, b) => b.totalDurationMs - a.totalDurationMs);
}
