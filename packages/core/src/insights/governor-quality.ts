// Debug level quality assessment, CPU attribution, and managed package impact analysis.
// Used by insightsReport.ts to evaluate observability and resource consumption.

import type {
  FlatEvent,
  DebugLevelEntry,
  DataQualityWarning,
  DebugLevelQuality,
  CpuAttribution,
  ManagedPackageImpact,
} from "./types.js";
import { asString, asArray, readPath } from "./utils.js";

function addKnownFinite(
  current: number | null,
  value: number | null,
): number | null {
  if (
    current === null ||
    value === null ||
    !Number.isFinite(current) ||
    !Number.isFinite(value) ||
    current < 0 ||
    value < 0
  )
    return null;
  const total = current + value;
  return Number.isFinite(total) && total >= 0 ? total : null;
}

function addKnownSafeInteger(
  current: number | null,
  value: number | null,
): number | null {
  if (
    current === null ||
    value === null ||
    !Number.isSafeInteger(current) ||
    !Number.isSafeInteger(value) ||
    current < 0 ||
    value < 0
  )
    return null;
  const total = current + value;
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

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
export function assessDebugLevelQuality(
  parserResult: unknown,
): DebugLevelQuality {
  const debugLevelsRaw = asArray(readPath(parserResult, ["debugLevels"]));

  const levelsByCategory = new Map<string, DebugLevelEntry>();
  for (const entry of debugLevelsRaw) {
    const category = (asString(readPath(entry, ["logCategory"])) ?? "").trim();
    if (!category) continue;
    const level = (asString(readPath(entry, ["logLevel"])) ?? "").trim();
    levelsByCategory.set(category.toUpperCase(), { category, level });
  }
  const levels = [...levelsByCategory.values()];

  const warnings: DataQualityWarning[] = [];
  const levelRank = new Map<string, number>([
    ["NONE", 0],
    ["ERROR", 1],
    ["WARN", 2],
    ["INFO", 3],
    ["DEBUG", 4],
    ["FINE", 5],
    ["FINER", 6],
    ["FINEST", 7],
  ]);

  const getLevelRank = (level: string): number =>
    levelRank.get(level.toUpperCase()) ?? 0;

  for (const entry of levels) {
    const cat = entry.category.toUpperCase();
    const rank = getLevelRank(entry.level);

    if (cat === "CALLOUT" && rank < 5) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation:
          "Set Callout to FINE or FINER for request/response detail",
        impact:
          "Callout URLs, HTTP methods, and response codes are not captured at INFO level",
      });
    }

    if (cat === "APEX_CODE" && rank < 5) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation:
          "Set Apex Code to FINE+ for method entry/exit and variable assignments",
        impact:
          "Method-level timing, variable values, and execution flow are limited",
      });
    }

    if (cat === "DATABASE" && rank < 5) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation:
          "Set Database to FINE+ for SOQL explain plans and DML detail",
        impact:
          "Query explain plans and row-level DML detail are not available",
      });
    }

    if (cat === "SYSTEM" && rank < 5) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation:
          "Set System to FINE+ for system method entry/exit events",
        impact: "System method timing data is incomplete",
      });
    }

    if (cat === "VALIDATION" && rank < 3) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation:
          "Set Validation to INFO+ for validation rule evaluation details",
        impact: "Validation rule formulas and outcomes are not captured",
      });
    }

    if (cat === "WORKFLOW" && rank < 3) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation:
          "Set Workflow to INFO+ for workflow rule and process builder detail",
        impact: "Workflow rule evaluation and field update details are missing",
      });
    }

    if (cat === "DATA_ACCESS" && rank === 0) {
      warnings.push({
        category: entry.category,
        currentLevel: entry.level,
        recommendation:
          "Set Data Access to INFO+ if you need sharing/FLS evaluation details",
        impact:
          "Data access and sharing-related events are completely suppressed",
      });
    }
  }

  if (!levelsByCategory.has("APEX_CODE")) {
    warnings.push({
      category: "APEX_CODE",
      currentLevel: "Not configured",
      recommendation:
        "Set Apex Code to FINE+ for method entry/exit and variable assignments",
      impact:
        "Apex Code debug-level evidence is missing, so method and variable coverage cannot be verified",
    });
  }
  if (!levelsByCategory.has("DATABASE")) {
    warnings.push({
      category: "DATABASE",
      currentLevel: "Not configured",
      recommendation:
        "Set Database to FINE+ for SOQL explain plans and DML detail",
      impact:
        "Database debug-level evidence is missing, so query and DML coverage cannot be verified",
    });
  }

  // Overall quality based on key categories
  const apexLevel = levelsByCategory.get("APEX_CODE");
  const dbLevel = levelsByCategory.get("DATABASE");
  const apexRank = apexLevel ? getLevelRank(apexLevel.level) : 0;
  const dbRank = dbLevel ? getLevelRank(dbLevel.level) : 0;

  let overallQuality: "high" | "medium" | "low" = "low";
  if (apexRank >= 7 && dbRank >= 7) {
    overallQuality = "high";
  } else if (apexRank >= 5 && dbRank >= 5) {
    overallQuality = "medium";
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
  const byType = new Map<
    string,
    { durationMs: number | null; count: number }
  >();
  const byNamespace = new Map<
    string,
    {
      selfDurationMs: number | null;
      totalDurationMs: number | null;
      spanCount: number;
    }
  >();

  for (const span of spans) {
    // By CPU type
    const cpuKey = span.cpuType || "unknown";
    const typeAggregate = byType.get(cpuKey) ?? { durationMs: 0, count: 0 };
    typeAggregate.durationMs = addKnownFinite(
      typeAggregate.durationMs,
      span.selfDurationMs,
    );
    typeAggregate.count += 1;
    byType.set(cpuKey, typeAggregate);

    // By namespace
    const ns = span.namespace || "default";
    const namespaceAggregate = byNamespace.get(ns) ?? {
      selfDurationMs: 0,
      totalDurationMs: 0,
      spanCount: 0,
    };
    namespaceAggregate.selfDurationMs = addKnownFinite(
      namespaceAggregate.selfDurationMs,
      span.selfDurationMs,
    );
    namespaceAggregate.totalDurationMs = addKnownFinite(
      namespaceAggregate.totalDurationMs,
      span.durationMs,
    );
    namespaceAggregate.spanCount += 1;
    byNamespace.set(ns, namespaceAggregate);
  }

  // Round values for readability
  for (const entry of byType.values()) {
    if (entry.durationMs !== null) {
      entry.durationMs = Math.round(entry.durationMs * 1000) / 1000;
    }
  }
  for (const entry of byNamespace.values()) {
    if (entry.selfDurationMs !== null) {
      entry.selfDurationMs = Math.round(entry.selfDurationMs * 1000) / 1000;
    }
    if (entry.totalDurationMs !== null) {
      entry.totalDurationMs = Math.round(entry.totalDurationMs * 1000) / 1000;
    }
  }

  return {
    byType: Object.fromEntries(byType),
    byNamespace: Object.fromEntries(byNamespace),
  };
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
  totalDurationMs: number | null,
): ManagedPackageImpact[] {
  const packages = new Set<string>();
  for (const namespace of namespaces) {
    if (namespace !== "default") packages.add(namespace);
  }
  if (packages.size === 0) return [];

  const byNamespace = new Map<
    string,
    {
      spanCount: number;
      totalDurationMs: number | null;
      selfDurationMs: number | null;
      soqlCount: number;
      soqlRows: number | null;
      dmlCount: number;
      dmlRows: number | null;
    }
  >();
  for (const namespace of packages) {
    byNamespace.set(namespace, {
      spanCount: 0,
      totalDurationMs: 0,
      selfDurationMs: 0,
      soqlCount: 0,
      soqlRows: 0,
      dmlCount: 0,
      dmlRows: 0,
    });
  }

  for (const span of spans) {
    const aggregate = byNamespace.get(span.namespace);
    if (!aggregate) continue;
    aggregate.spanCount += 1;
    aggregate.totalDurationMs = addKnownFinite(
      aggregate.totalDurationMs,
      span.durationMs,
    );
    aggregate.selfDurationMs = addKnownFinite(
      aggregate.selfDurationMs,
      span.selfDurationMs,
    );
  }

  for (const event of allEvents) {
    const aggregate = byNamespace.get(event.namespace);
    if (!aggregate) continue;
    if (event.type === "SOQL_EXECUTE_BEGIN") {
      aggregate.soqlCount += 1;
      aggregate.soqlRows = addKnownSafeInteger(
        aggregate.soqlRows,
        event.pairingStatus === "complete" ? event.soqlRowCountTotal : null,
      );
    } else if (event.type === "DML_BEGIN") {
      aggregate.dmlCount += 1;
      aggregate.dmlRows = addKnownSafeInteger(
        aggregate.dmlRows,
        event.pairingStatus === "complete" ? event.dmlRowCountTotal : null,
      );
    }
  }

  return Array.from(byNamespace, ([namespace, aggregate]) => {
    const totalDuration = aggregate.totalDurationMs;
    return {
      namespace,
      spanCount: aggregate.spanCount,
      totalDurationMs:
        totalDuration === null ? null : Math.round(totalDuration * 1000) / 1000,
      selfDurationMs:
        aggregate.selfDurationMs === null
          ? null
          : Math.round(aggregate.selfDurationMs * 1000) / 1000,
      soqlCount: aggregate.soqlCount,
      soqlRows: aggregate.soqlRows,
      dmlCount: aggregate.dmlCount,
      dmlRows: aggregate.dmlRows,
      pctOfTotalDuration:
        totalDuration !== null &&
        totalDurationMs !== null &&
        totalDurationMs > 0
          ? Math.round((totalDuration / totalDurationMs) * 10000) / 100
          : null,
    };
  }).sort(
    (left, right) =>
      (right.totalDurationMs ?? -1) - (left.totalDurationMs ?? -1),
  );
}
