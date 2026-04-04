// Database-related normalization (SOQL, DML, callouts, named credentials)

import { byNumberDesc, truncate } from "./shared-format.js";
import { toArray, first } from "./normalize-helpers.js";
import { addRawLogLineNumber } from "./normalize-evidence-mapping.js";

export function normalizeSoqlPatterns(report) {
  return toArray(report?.database?.soqlPatterns)
    .slice()
    .sort(byNumberDesc((item) => first(item?.totalDurationMs, 0)))
    .map((item, index) => ({
      id: first(item?.id, `soql-pattern-${index + 1}`),
      pattern: first(item?.pattern, item?.query, "SOQL Pattern"),
      targetObject: first(item?.targetObject, "Unknown"),
      executionCount: Number(first(item?.executionCount, item?.count, 0) || 0),
      totalRows: Number(first(item?.totalRows, 0) || 0),
      totalDurationMs: Number(first(item?.totalDurationMs, 0) || 0),
      avgDurationMs: Number(first(item?.avgDurationMs, 0) || 0),
      isLoopSuspect: Boolean(item?.isLoopSuspect),
      loopEvidence: first(item?.loopEvidence, null),
      queryIds: Array.isArray(item?.queryIds) ? item.queryIds : [],
    }));
}

export function normalizeCallouts(report, rawLineMap) {
  return toArray(report?.database?.callouts)
    .sort(byNumberDesc((item) => item?.durationMs))
    .map((item, index) => ({
      id: first(item?.id, `callout-${index + 1}`),
      endpoint: first(item?.endpoint, item?.url, item?.text, "Callout"),
      host: first(item?.host, null),
      method: first(item?.method, "UNKNOWN"),
      statusCode: item?.statusCode === null || item?.statusCode === undefined ? null : Number(item.statusCode),
      statusText: first(item?.statusText, null),
      durationMs: Number(first(item?.durationMs, 0) || 0),
      evidence: addRawLogLineNumber(item?.evidence || {}, rawLineMap),
    }));
}

export function normalizeNamedCredentials(report, rawLineMap) {
  return toArray(report?.database?.namedCredentials)
    .map((item, index) => ({
      id: first(item?.id, `named-credential-${index + 1}`),
      credentialName: first(item?.credentialName, item?.name, "Named Credential"),
      endpoint: first(item?.endpoint, null),
      method: first(item?.method, null),
      statusCode: item?.statusCode === null || item?.statusCode === undefined ? null : Number(item.statusCode),
      statusText: first(item?.statusText, null),
      durationMs: Number(first(item?.durationMs, 0) || 0),
      evidence: addRawLogLineNumber(item?.evidence || {}, rawLineMap),
    }));
}

export function normalizeIntegrationOperations(report, rawLineMap) {
  // Prefer integrationOperations when present (v0.15.0+); fall back to callouts + named credentials
  const ops = toArray(report?.database?.integrationOperations);
  if (ops.length > 0) {
    return ops
      .sort(byNumberDesc((item) => item?.durationMs))
      .map((item, index) => ({
        id: first(item?.id, `integration-${index + 1}`),
        credentialName: first(item?.credentialName, null),
        endpoint: first(item?.endpoint, item?.url, "Callout"),
        host: first(item?.host, null),
        method: first(item?.method, "UNKNOWN"),
        statusCode: item?.statusCode === null || item?.statusCode === undefined ? null : Number(item.statusCode),
        statusText: first(item?.statusText, null),
        durationMs: Number(first(item?.durationMs, 0) || 0),
        evidence: addRawLogLineNumber(item?.evidence || {}, rawLineMap),
      }));
  }
  // Fallback for old reports: synthesize from callouts + named credentials
  const callouts = normalizeCallouts(report, rawLineMap).map((c) => ({
    ...c,
    credentialName: null,
    host: c.host,
  }));
  const namedCredentials = normalizeNamedCredentials(report, rawLineMap).map((nc) => ({
    id: nc.id,
    credentialName: nc.credentialName,
    endpoint: nc.endpoint,
    host: null,
    method: nc.method,
    statusCode: nc.statusCode,
    statusText: nc.statusText,
    durationMs: nc.durationMs,
    evidence: nc.evidence,
  }));
  return [...callouts, ...namedCredentials].sort(byNumberDesc((item) => item?.durationMs));
}

export function normalizeBurnRateRows(report) {
  const source = Array.isArray(report?.governorBurnRate)
    ? report.governorBurnRate
    : toArray(report?.governorBurnRate?.burnRates);
  const keyMap = {
    soqlQueries: "soqlQueries",
    soqlRows: "soqlRows",
    dmlStatements: "dmlStatements",
    dmlRows: "dmlRows",
    cpuTime: "cpuTimeMs",
    cpuTimeMs: "cpuTimeMs",
    heapSize: "heapBytes",
    heapBytes: "heapBytes",
    callouts: "callouts",
    emailInvocations: "emailInvocations",
    futureCalls: "futureCalls",
    queueables: "queueables",
    queueableJobsAddedToQueue: "queueables",
  };

  const fromSource = source.map((item) => {
    const rawKey = String(first(item?.limitKey, item?.limitName, "") || "").trim();
    const limitKey = first(keyMap[rawKey], rawKey, "unknown");
    const pct = item?.pctUsed === null || item?.pctUsed === undefined
      ? null
      : Number(item.pctUsed);
    return {
      id: limitKey,
      limitKey,
      label: limitKey,
      used: item?.used === null || item?.used === undefined ? null : Number(item.used),
      max: item?.max === null || item?.max === undefined ? null : Number(item.max),
      pctUsed: pct,
      status: first(item?.status, pct !== null ? (pct >= 95 ? "critical" : pct >= 80 ? "warn" : "ok") : "unknown"),
      burnRatePerSec: item?.burnRatePerSec === null || item?.burnRatePerSec === undefined ? null : Number(item.burnRatePerSec),
      projectedHeadroom: item?.projectedHeadroom === null || item?.projectedHeadroom === undefined ? null : Number(item.projectedHeadroom),
    };
  });

  if (fromSource.length > 0) return fromSource;

  return Object.entries(normalizeLimits(report)).map(([limitKey, value]) => {
    const used = Number(value?.used ?? 0);
    const max = Number(value?.max ?? value?.limit ?? 0);
    const pctUsed = max > 0 ? Math.round((used / max) * 100) : null;
    return {
      id: limitKey,
      limitKey,
      label: limitKey,
      used: Number.isFinite(used) ? used : null,
      max: max > 0 ? max : null,
      pctUsed,
      status: pctUsed === null ? "unknown" : pctUsed >= 95 ? "critical" : pctUsed >= 80 ? "warn" : "ok",
      burnRatePerSec: null,
      projectedHeadroom: null,
    };
  });
}

export function normalizePhaseHeadroom(report) {
  return toArray(report?.governorBurnRate?.phaseHeadroom)
    .map((item, index) => ({
      id: first(item?.phaseId, `phase-headroom-${index + 1}`),
      label: first(item?.phaseLabel, item?.phaseId, `Phase ${index + 1}`),
      warning: first(item?.warning, null),
      phasesRemaining: Number(first(item?.phasesRemaining, 0) || 0),
      soqlPctAfter: item?.soqlPctAfter === null || item?.soqlPctAfter === undefined ? null : Number(item.soqlPctAfter),
      dmlPctAfter: item?.dmlPctAfter === null || item?.dmlPctAfter === undefined ? null : Number(item.dmlPctAfter),
      cpuPctAfter: item?.cpuPctAfter === null || item?.cpuPctAfter === undefined ? null : Number(item.cpuPctAfter),
      heapPctAfter: item?.heapPctAfter === null || item?.heapPctAfter === undefined ? null : Number(item.heapPctAfter),
    }));
}

export function normalizeValidationBlocks(report) {
  return toArray(report?.trace?.validationBlocks)
    .map((block, index) => {
      const rules = toArray(block?.rules);
      const failedRules = rules.filter((rule) => {
        const outcome = String(first(rule?.outcome, "") || "").toUpperCase();
        return outcome && outcome !== "PASS";
      });
      return {
        id: first(block?.eventId, block?.id, `validation-${index + 1}`),
        label: first(block?.label, block?.name, `Validation Block ${index + 1}`),
        totalRules: rules.length,
        failedRules: failedRules.map((rule, ruleIndex) => ({
          id: first(rule?.id, `rule-${ruleIndex + 1}`),
          name: first(rule?.ruleName, rule?.name, "Validation Rule"),
          outcome: first(rule?.outcome, "UNKNOWN"),
        })),
        evidence: block?.evidence || {},
      };
    });
}

export function normalizeLimits(report) {
  return report?.governorLimits?.current?.defaultNamespace || {};
}

export function normalizeData(report, rawLineMap) {
  const soqlRaw = toArray(report?.database?.soql)
    .sort(byNumberDesc((item) => item?.durationMs));
  // Build soql id→pattern id map after patterns are computed (see below)
  // We compute soqlPatterns first, then annotate soqlRaw with patternId
  const soqlPatterns = normalizeSoqlPatterns(report);
  // Build reverse map: soql item id → pattern id for grouped mode linking
  const soqlIdToPatternId = new Map();
  for (const pat of soqlPatterns) {
    for (const qid of pat.queryIds) soqlIdToPatternId.set(qid, pat.id);
  }
  const soql = soqlRaw.map((item, index) => {
    const rawId = first(item?.id, `soql-${index + 1}`);
    return {
      id: rawId,
      label: truncate(first(item?.queryName, item?.query, item?.summary, "Query"), 110),
      fullQuery: first(item?.query, item?.queryName, item?.summary, ""),
      rows: Number(first(item?.rows, 0) || 0),
      durationMs: Number(first(item?.durationMs, 0) || 0),
      explain: item?.explain || null,
      evidence: addRawLogLineNumber(item?.evidence || {}, rawLineMap),
      patternId: soqlIdToPatternId.get(rawId) ?? soqlIdToPatternId.get(item?.id) ?? null,
    };
  });

  const dml = toArray(report?.database?.dml)
    .sort(byNumberDesc((item) => item?.durationMs))
    .map((item, index) => ({
      id: first(item?.id, `dml-${index + 1}`),
      operation: first(item?.operation, item?.dmlOp, "DML"),
      sObject: first(item?.sObject, item?.object, "Unknown"),
      rows: Number(first(item?.rows, 0) || 0),
      durationMs: Number(first(item?.durationMs, 0) || 0),
      evidence: addRawLogLineNumber(item?.evidence || {}, rawLineMap),
    }));

  const savepoints = toArray(report?.savepoints);
  const limitHealth = normalizeBurnRateRows(report);
  const phaseHeadroom = normalizePhaseHeadroom(report);
  const validationBlocks = normalizeValidationBlocks(report);
  const callouts = normalizeCallouts(report, rawLineMap);
  const namedCredentials = normalizeNamedCredentials(report, rawLineMap);
  const integrationOperations = normalizeIntegrationOperations(report, rawLineMap);
  return {
    soql,
    soqlTotalCount: soql.length,
    dml,
    dmlTotalCount: dml.length,
    callouts,
    calloutTotalCount: callouts.length,
    namedCredentials,
    namedCredentialTotalCount: namedCredentials.length,
    integrationOperations,
    integrationOperationTotalCount: integrationOperations.length,
    limits: normalizeLimits(report),
    limitHealth,
    phaseHeadroom,
    phaseHeadroomTotalCount: phaseHeadroom.length,
    validationBlocks,
    validationBlockTotalCount: validationBlocks.length,
    soqlPatterns,
    soqlPatternTotalCount: soqlPatterns.length,
    savepoints,
    savepointTotalCount: savepoints.length,
    burnRate: report?.governorBurnRate || null,
  };
}
