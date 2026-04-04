/**
 * app-extension-only.js
 * Extension-specific code appended to viewer/app.js by scripts/export-extension.ts.
 * DO NOT load this file directly — it is only valid combined with the viewer core.
 * Edit this file for extension-only behaviour; edit viewer/app.js for shared UI changes.
 */

// === Extension-only constants ===

const EXTENSION_MAX_RECOMMENDED_BYTES = 20 * 1024 * 1024;

// === Extension-only DOM element refs ===

const extensionLoaderPanel = document.getElementById("extensionLoaderPanel");
const extensionFileInput = document.getElementById("extensionFileInput");
const extensionOpenFileBtn = document.getElementById("extensionOpenFileBtn");
const extensionLoadStatus = document.getElementById("extensionLoadStatus");
const extensionLoadDetails = document.getElementById("extensionLoadDetails");
const extensionLoadingPlaceholder = document.getElementById("extensionLoadingPlaceholder");

// === Extension-only state ===

let extensionStatusInterval = null;
let currentExtensionLoadMeta = {};

// === Extension-only helpers ===

/** Safely coerce any value to an array. */
function toArray(value) {
  return Array.isArray(value) ? value : [];
}

// === Extension UI functions ===

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return "Unknown";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function setExtensionLoadDetails(meta = {}) {
  currentExtensionLoadMeta = {
    ...currentExtensionLoadMeta,
    ...meta,
  };
  if (!extensionLoadDetails) return;
  const cards = [
    ["File", currentExtensionLoadMeta.fileName || "Waiting for input"],
    ["Source", currentExtensionLoadMeta.source || "Auto-detect or manual picker"],
    ["Format", currentExtensionLoadMeta.format || "Not checked yet"],
    ["Size", currentExtensionLoadMeta.sizeLabel || "Unknown"],
    ["Stage", currentExtensionLoadMeta.stage || "Idle"],
  ];
  setHtml(extensionLoadDetails, cards.map(([title, value]) => `
    <div class="reportCard">
      <div class="reportCardTitle">${escapeHtml(title)}</div>
      <div class="reportCardText">${escapeHtml(value)}</div>
    </div>
  `).join(""));
}

function setExtensionStatus(message) {
  if (extensionStatusInterval !== null) {
    clearInterval(extensionStatusInterval);
    extensionStatusInterval = null;
  }
  if (extensionLoadStatus) {
    extensionLoadStatus.textContent = message;
  }
}

function setExtensionBusy(message) {
  if (!extensionLoadStatus) return;
  if (extensionStatusInterval !== null) {
    clearInterval(extensionStatusInterval);
  }
  let step = 0;
  const base = String(message || "Loading");
  const render = () => {
    const dots = ".".repeat((step % 3) + 1);
    extensionLoadStatus.textContent = `${base}${dots}`;
    step += 1;
  };
  render();
  if (extensionStatusInterval) clearInterval(extensionStatusInterval);
  extensionStatusInterval = setInterval(render, 350);
}

function setExtensionEmptyState(isEmpty) {
  document.body.classList.toggle("extension-empty", isEmpty);
  document.body.classList.toggle("extension-loaded", !isEmpty);
  if (!isEmpty) {
    document.body.classList.remove("extension-shell-loading");
  }
  if (extensionLoadingPlaceholder) {
    extensionLoadingPlaceholder.hidden = !(isEmpty && document.body.classList.contains("extension-shell-loading"));
  }
}

function getExtensionSourceUrl() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    return String(params.get("sourceUrl") || "").trim();
  } catch {
    return "";
  }
}

function getExtensionStorageKey() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    return String(params.get("storageKey") || "").trim();
  } catch {
    return "";
  }
}

function setExtensionBannerFileName(fileName) {
  if (typeof topBannerFile === "undefined" || !topBannerFile) return;
  const nextFileName = String(fileName || "").trim();
  topBannerFile.textContent = nextFileName;
  topBannerFile.hidden = nextFileName.length === 0;
}

function looksLikeSalesforceDebugLogText(text) {
  const sample = String(text || "").split(/\r?\n/).slice(0, 200).join("\n");
  if (!sample.trim()) return false;
  const timestampedLines = sample.match(/^\d{2}:\d{2}:\d{2}\.\d{1,3}\s*\(\d+\)\|[A-Z][A-Z0-9_]*\|/gm) || [];
  const knownEvents = sample.match(/\b(CODE_UNIT_STARTED|USER_DEBUG|SOQL_EXECUTE_BEGIN|DML_BEGIN|EXECUTION_STARTED|LIMIT_USAGE_FOR_NS|CUMULATIVE_LIMIT_USAGE)\b/g) || [];
  return timestampedLines.length >= 3 || knownEvents.length >= 3;
}

async function readFileTextStream(file) {
  if (!file) return "";
  if (!file.stream) {
    const text = await file.text();
    setExtensionStatus(`Loaded ${file.name} (${Math.round(file.size / 1024)} KB).`);
    return text;
  }
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    chunks.push(decoder.decode(value, { stream: true }));
    const pct = file.size > 0 ? Math.min(99, Math.round((loaded / file.size) * 100)) : 0;
    setExtensionStatus(`Reading ${file.name}… ${pct}%`);
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

/**
 * Resolve the final OfflineReportV2 from a worker payload.
 *
 * The TypeScript worker (from src/extension/worker-entry.ts) must return
 * `payload.report` as a full OfflineReportV2.
 *
 * TypeScript is the only supported source of truth for parser/report semantics.
 * If the worker does not return the canonical report shape, the extension fails
 * loudly and must be rebuilt from `src/`.
 */
function resolveReportFromPayload(payload, fileName) {
  if (payload.report?.reportVersion === "3.0.0") {
    return payload.report;
  }
  const displayName = String(fileName || payload?.fileId || "debug-log");
  throw new Error(
    `Worker for ${displayName} did not return a TypeScript-built OfflineReportV2. Rebuild the extension from src/ using \`npm run export:extension\`.`,
  );
}

function parseLogInWorker(logText, fileName) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("./content/apex-parser-worker.js");
    worker.onmessage = (event) => {
      const payload = event.data || {};
      worker.terminate();
      if (payload.type !== "PARSE_RESULT") {
        reject(new Error("Unexpected worker response."));
        return;
      }
      if (!payload.ok) {
        reject(new Error(payload.error || "Worker parse failed."));
        return;
      }
      resolve(payload);
    };
    worker.onerror = (event) => {
      worker.terminate();
      const parts = [
        event.message,
        event.filename && `${event.filename}:${event.lineno}`,
      ].filter(Boolean);
      reject(new Error(parts.join(" — ") || "Worker crashed (no details available)."));
    };
    worker.postMessage({
      type: "PARSE_LOG",
      logText,
      fileId: fileName || "debug-log",
    });
  });
}

function hydrateExtensionReport(report, parsePayload, fileName, rawLogLines) {
  const next = report && typeof report === "object" ? report : {};
  next.analysis = {
    executionType: next?.analysis?.executionType || next?.entryPoint?.type || next?.context?.transaction?.requestType || null,
    scopeRecordIds: Array.isArray(next?.analysis?.scopeRecordIds) ? next.analysis.scopeRecordIds : [],
    warnings: Array.isArray(parsePayload?.parseResult?.logIssues) ? parsePayload.parseResult.logIssues : [],
    phaseWarnings: Array.isArray(parsePayload?.parseResult?.phaseWarnings) ? parsePayload.parseResult.phaseWarnings : [],
  };
  next.source = next.source || {};
  next.source.fileName = next.source.fileName || fileName || "debug-log";
  next.source.input = next.source.input || {};
  next.source.input.fileName = next.source.input.fileName || fileName || "debug-log";
  next.rawLog = {
    lines: (rawLogLines || []).map((text, index) => ({
      lineNumber: index + 1,
      text,
    })),
  };
  return next;
}

function resetExpandedState() {
  queriesExpanded = false;
  dmlExpanded = false;
  errorsExpanded = false;
  warningsExpanded = false;
  expandedScopeGroupKeys = new Set();
  selectedExecutionEventCategory = EXECUTION_EVENT_CATEGORY_ALL;
  if (executionTypeFilterSelect) {
    executionTypeFilterSelect.value = EXECUTION_EVENT_CATEGORY_ALL;
  }
  if (rawSearchInput) rawSearchInput.value = "";
  if (rawShowAllToggle) rawShowAllToggle.checked = false;
  if (typeof syncRawControlsFromQuery === "function") {
    syncRawControlsFromQuery("");
  }
}

async function displayReport(report, options = {}) {
  const rawLogLines = Array.isArray(options.rawLogLines) ? options.rawLogLines : [];
  const parsePayload = options.parsePayload || null;
  const fileName = options.fileName || report?.source?.fileName || report?.source?.input?.fileName || "debug-log";
  const fileSizeBytes = Number(options.fileSizeBytes || 0) || (rawLogLines.length
    ? new TextEncoder().encode(rawLogLines.join("\n")).length
    : 0);
  const hydrated = hydrateExtensionReport(report, parsePayload, fileName, rawLogLines);
  currentReportUrl = fileName;
  currentRawLogLines = rawLogLines;
  currentReportData = hydrated;
  resetExpandedState();

  // Cover topbar + main with the loading overlay so the browser never paints
  // a half-rendered state (topbar populated, panels still blank).
  // Two rAF cycles give the browser time to actually paint the overlay before
  // the synchronous render() call blocks the main thread.
  document.body.classList.add("initializing");
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  render(hydrated, currentRawLogLines);
  renderRawLogSearchResults("");
  setExtensionEmptyState(false);
  document.body.classList.remove("initializing");

  setExtensionLoadDetails({
    fileName,
    format: fileName.toLowerCase().endsWith(".json") ? "JSON report" : "Salesforce debug log",
    sizeLabel: formatBytes(fileSizeBytes),
    stage: "Report ready",
  });
  const sizeLabel = fileSizeBytes > 0
    ? ` (${(fileSizeBytes / (1024 * 1024)).toFixed(1)} MB)`
    : "";
  const advisory = fileSizeBytes > EXTENSION_MAX_RECOMMENDED_BYTES
    ? " Parsed above 20 MB; worker mode kept the UI responsive."
    : "";
  setExtensionStatus(`Loaded ${fileName}${sizeLabel}.${advisory}`);
}

async function loadJsonFile(file) {
  setExtensionLoadDetails({
    fileName: file.name,
    source: "Local file",
    format: "JSON report",
    sizeLabel: formatBytes(file.size),
    stage: "Reading JSON report",
  });
  setExtensionBusy(`Reading ${file.name}`);
  const text = await readFileTextStream(file);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (parseError) {
    throw new Error(`Invalid JSON in ${file.name}: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
  }
  const embeddedLines = Array.isArray(parsed?.rawLog?.lines)
    ? parsed.rawLog.lines.map((entry) => String(entry?.text ?? entry?.raw ?? ""))
    : [];
  await displayReport(parsed, {
    fileName: file.name,
    fileSizeBytes: file.size,
    rawLogLines: embeddedLines,
    parsePayload: null,
  });
}

async function loadLogFile(file) {
  setExtensionLoadDetails({
    fileName: file.name,
    source: "Local file",
    format: "Salesforce debug log",
    sizeLabel: formatBytes(file.size),
    stage: "Reading raw log",
  });
  setExtensionBusy(`Preparing ${file.name} for worker parse`);
  const text = await readFileTextStream(file);
  if (!looksLikeSalesforceDebugLogText(text)) {
    setExtensionLoadDetails({
      format: "Not a Salesforce debug log",
      stage: "Rejected",
    });
    throw new Error("This `.log` file does not look like a Salesforce debug log.");
  }
  const rawLogLines = text.split(/\r?\n/);
  setExtensionLoadDetails({ stage: "Parsing raw log in worker" });
  setExtensionBusy(`Parsing ${file.name} in worker`);
  const payload = await parseLogInWorker(text, file.name);
  const report = resolveReportFromPayload(payload, file.name);
  await displayReport(report, {
    fileName: file.name,
    fileSizeBytes: file.size,
    rawLogLines,
    parsePayload: payload,
  });
}

async function handleExtensionFile(file) {
  if (!file) return;
  const lower = String(file.name || "").toLowerCase();
  try {
    if (lower.endsWith(".json")) {
      await loadJsonFile(file);
      return;
    }
    await loadLogFile(file);
  } catch (error) {
    setExtensionStatus(`Load failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (extensionFileInput) extensionFileInput.value = "";
  }
}

async function fetchAndDisplayFromUrl(sourceUrl) {
  const lower = sourceUrl.toLowerCase();
  const sourceName = sourceUrl.split("/").filter(Boolean).pop() || "debug.log";
  setExtensionBannerFileName(sourceName);
  setExtensionLoadDetails({
    fileName: sourceName,
    source: "Browser .log page",
    format: lower.endsWith(".json") ? "JSON report" : "Salesforce debug log",
    sizeLabel: "Resolving",
    stage: "Fetching source file",
  });
  setExtensionBusy("Fetching source log");
  const response = await fetch(sourceUrl, {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch source log (${response.status})`);
  }
  const headerBytes = Number(response.headers.get("content-length") || 0);
  if (headerBytes > 0) {
    setExtensionLoadDetails({ sizeLabel: formatBytes(headerBytes) });
  }
  if (lower.endsWith(".json")) {
    let parsed;
    try {
      parsed = await response.json();
    } catch (parseError) {
      throw new Error(`Invalid JSON from ${sourceUrl}: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }
    const fileName = sourceName || "report.json";
    const embeddedLines = Array.isArray(parsed?.rawLog?.lines)
      ? parsed.rawLog.lines.map((entry) => String(entry?.text ?? entry?.raw ?? ""))
      : [];
    await displayReport(parsed, {
      fileName,
      rawLogLines: embeddedLines,
      parsePayload: null,
    });
    return true;
  }
  const text = await response.text();
  const measuredBytes = new TextEncoder().encode(text).length;
  setExtensionLoadDetails({
    sizeLabel: formatBytes(measuredBytes),
    stage: "Validating Salesforce log format",
  });
  if (!looksLikeSalesforceDebugLogText(text)) {
    setExtensionLoadDetails({
      format: "Not a Salesforce debug log",
      stage: "Rejected",
    });
    throw new Error("The opened `.log` page does not look like a Salesforce debug log.");
  }
  const fileName = sourceName || "debug.log";
  const rawLogLines = text.split(/\r?\n/);
  setExtensionLoadDetails({
    format: "Salesforce debug log",
    stage: "Parsing raw log in worker",
  });
  setExtensionBusy("Parsing fetched log in worker");
  const payload = await parseLogInWorker(text, fileName);
  const report = resolveReportFromPayload(payload, fileName);
  await displayReport(report, {
    fileName,
    rawLogLines,
    parsePayload: payload,
  });
  return true;
}

async function loadSourceUrl() {
  const sourceUrl = getExtensionSourceUrl();
  if (!sourceUrl) return false;
  try {
    return await fetchAndDisplayFromUrl(sourceUrl);
  } catch (error) {
    setExtensionStatus(`Auto-load failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function loadStoredSource() {
  const storageKey = getExtensionStorageKey();
  if (!storageKey || !chrome?.storage?.local) return false;
  try {
    setExtensionLoadDetails({
      source: "Captured page content",
      stage: "Reading captured log",
    });
    setExtensionBusy("Reading log from page");
    const stored = await chrome.storage.local.get(storageKey);
    const payload = stored?.[storageKey];
    if (!payload) {
      throw new Error("Stored log payload was missing.");
    }
    await chrome.storage.local.remove(storageKey);
    const expiresAt = Number(payload.expiresAt || 0);
    if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() > expiresAt) {
      throw new Error("Stored payload expired. Re-open from the original tab.");
    }
    if (payload.kind === "new-tab-report-state-v1" || (payload.report && Array.isArray(payload.rawLogLines))) {
      const restoredReport = payload.report && typeof payload.report === "object" ? payload.report : null;
      if (!restoredReport) {
        throw new Error("Stored report payload was missing.");
      }
      const rawLogLines = payload.rawLogLines.map((line) => String(line ?? ""));
      const fileName = String(payload.fileName || restoredReport?.source?.fileName || "debug.log");
      const byteSize = Number(payload.fileSizeBytes || (rawLogLines.length
        ? new TextEncoder().encode(rawLogLines.join("\n")).length
        : 0));
      setExtensionLoadDetails({
        fileName,
        source: "Saved analyzer state",
        sizeLabel: formatBytes(byteSize),
        format: "OfflineReportV2 snapshot",
        stage: "Restoring report context",
      });
      setExtensionBusy("Restoring report context");
      await displayReport(restoredReport, {
        fileName,
        fileSizeBytes: byteSize,
        rawLogLines,
        parsePayload: null,
      });
      return true;
    }
    if (!payload?.logText) {
      throw new Error("Stored log payload was missing.");
    }
    // Persist the source URL so refresh can re-fetch the original log file.
    const sourceHref = String(payload.sourceHref || "").trim();
    if (sourceHref && chrome?.storage?.session) {
      chrome.storage.session.set({ "apex-source-href": sourceHref }).catch(() => {});
    }
    const logText = String(payload.logText || "");
    const byteSize = Number(payload.fileSizeBytes || new TextEncoder().encode(logText).length);
    setExtensionBannerFileName(String(payload.fileName || "debug.log"));
    setExtensionLoadDetails({
      fileName: String(payload.fileName || "debug.log"),
      source: "Captured page content",
      sizeLabel: formatBytes(byteSize),
      format: "Validating",
      stage: "Validating Salesforce log format",
    });
    if (!looksLikeSalesforceDebugLogText(logText)) {
      setExtensionLoadDetails({
        format: "Not a Salesforce debug log",
        stage: "Rejected",
      });
      throw new Error("The captured page content does not look like a Salesforce debug log.");
    }
    const fileName = String(payload.fileName || "debug.log");
    const rawLogLines = logText.split(/\r?\n/);
    setExtensionLoadDetails({
      fileName,
      format: "Salesforce debug log",
      stage: "Parsing raw log in worker",
    });
    setExtensionBusy("Parsing captured log in worker");
    const workerPayload = await parseLogInWorker(logText, fileName);
    const report = resolveReportFromPayload(workerPayload, fileName);
    await displayReport(report, {
      fileName,
      rawLogLines,
      parsePayload: workerPayload,
    });
    return true;
  } catch (error) {
    setExtensionStatus(`Captured-page load failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

// ─── Display Improvement Accessors (plan/09) ────────────────────────────────

/**
 * Returns a Map keyed by limitKey → { status, pctUsed, burnRatePerSec }.
 * Falls back to computing pct from raw governor limits when burnRate data
 * is absent (e.g. legacy reports).
 */
function getGovernorBurnRate(report) {
  const burnRateSource = Array.isArray(report?.governorBurnRate)
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
  const byKey = new Map(
    burnRateSource
      .map((r) => {
        const rawKey = String(r?.limitKey || r?.limitName || "").trim();
        const limitKey = keyMap[rawKey] || rawKey;
        if (!limitKey) return null;
        return [
          limitKey,
          {
            ...r,
            limitKey,
          },
        ];
      })
      .filter(Boolean),
  );
  // Fallback: compute from raw limits for any key not already present
  const current = getReportGovernorLimits(report).current?.defaultNamespace || {};
  for (const [key, val] of Object.entries(current)) {
    if (byKey.has(key)) continue;
    const used = Number(val?.used ?? 0);
    const max = Number(val?.max ?? val?.limit ?? 0);
    if (max <= 0) continue;
    const pct = Math.round((used / max) * 100);
    byKey.set(key, {
      limitKey: key,
      used,
      max,
      pctUsed: pct,
      status: pct >= 80 ? "critical" : pct >= 50 ? "warn" : "ok",
    });
  }
  return byKey;
}


/** Returns execution phases. By default filters out 'not_observed' phases. */
function getExecutionPhases(report, includeNotObserved = false) {
  return toArray(report?.phases)
    .filter((p) => includeNotObserved || p?.status !== "not_observed");
}

/** Returns structured savepoints from the report (preferred over raw log scan). */
function getSavepoints(report) {
  return toArray(report?.savepoints);
}

/** Returns CPU attribution object from the report. */
function getCpuAttribution(report) {
  return report?.cpuAttribution || { byType: [], byNamespace: [], topHotspots: [] };
}

/** Returns peak heap bytes mid-transaction, or null if unavailable. */
function getHeapPeakBytes(report) {
  return report?.heapAnalysis?.peakCumulativeBytes ?? null;
}

/** Returns the debug level quality object, or null. */
function getDebugLevelQuality(report) {
  return report?.debugLevelQuality || null;
}

/** Returns trigger cascades that have chainLength > 1 (recursive / cascading). */
function getTriggerCascades(report) {
  const cascades = Array.isArray(report?.triggerCascade)
    ? report.triggerCascade
    : toArray(report?.triggerCascade?.cascades);
  return cascades.filter((c) => {
    const explicit = Number(c?.chainLength || 0);
    if (explicit > 1) return true;
    const childCount = toArray(c?.children).length;
    return childCount > 0;
  });
}

/** Returns per-namespace managed package impact rows. */
function getManagedPackageImpact(report) {
  return Array.isArray(report?.managedPackageImpact)
    ? report.managedPackageImpact
    : toArray(report?.managedPackageImpact?.namespaces);
}

/**
 * Derives a plain-English verdict from existing report data.
 * Returns { level: 'ok'|'info'|'warn'|'critical'|'error', text: string }
 */
function buildVerdict(report) {
  const burnRates = getGovernorBurnRate(report);
  const issues = getReportIssues(report);
  const patterns = getSoqlPatternSuspects(report);
  const failedValidations = toArray(report?.trace?.validationBlocks)
    .flatMap((vb) => toArray(vb?.rules).filter((r) => {
      const o = String(r?.outcome || "").toUpperCase();
      return o && o !== "PASS";
    }));

  const criticalLimits = [...burnRates.values()].filter((r) => r?.status === "critical");
  const warnLimits = [...burnRates.values()].filter((r) => r?.status === "warn");
  const errors = issues.filter((i) => !isWarningItem(i));

  // Priority: errors > critical limits > N+1 > failed validations > warn limits > ok
  if (errors.length > 0) {
    return { level: "error", text: `${errors.length} unhandled exception${errors.length !== 1 ? "s" : ""} detected.` };
  }
  if (criticalLimits.length > 0) {
    const names = criticalLimits.map((l) => governorLimitLabel(l.limitKey)).join(", ");
    return { level: "critical", text: `Governor limit critical: ${names}` };
  }
  if (patterns.length > 0) {
    return { level: "warn", text: `${patterns.length} possible N+1 SOQL pattern${patterns.length !== 1 ? "s" : ""} detected.` };
  }
  if (failedValidations.length > 0) {
    return { level: "warn", text: `${failedValidations.length} validation rule${failedValidations.length !== 1 ? "s" : ""} failed.` };
  }
  if (warnLimits.length > 0) {
    const names = warnLimits.map((l) => governorLimitLabel(l.limitKey)).join(", ");
    return { level: "info", text: `Governor limits elevated: ${names}` };
  }
  return { level: "ok", text: "Transaction looks healthy. No governor limit concerns detected." };
}


// ─── End Display Improvement Accessors ──────────────────────────────────────

// === Extension Init Section ===
// Replaces viewer/app.js VIEWER_INIT_START…VIEWER_INIT_END section.
// Includes: extension idle state setup, all shared event listeners,
// extension-specific file picker listener, and extension's init override.

async function tryRestoreCachedReport() {
  if (!chrome?.storage?.session) return false;
  try {
    const stored = await chrome.storage.session.get("apex-source-href");
    const sourceHref = String(stored?.["apex-source-href"] || "").trim();
    if (!sourceHref) return false;
    // Re-fetch and re-parse from the original log URL — full data, no quota issues.
    return await fetchAndDisplayFromUrl(sourceHref);
  } catch {
    return false;
  }
}

async function initializeExtensionState() {
  // Arriving here means no auto-source loaded (or auto-load failed).
  // Clean up any shell-loading state so the idle UI is fully visible.
  document.body.classList.remove("extension-shell-loading");
  document.body.classList.remove("initializing");
  if (chrome?.storage?.session) {
    chrome.storage.session.remove("apex-source-href").catch(() => {});
  }
  setExtensionEmptyState(true);
  setExtensionStatus("Ready. Select a local `.log` or `.json` file to begin.");
}

rawSearchBtn.addEventListener("click", () => {
  renderRawLogSearchResults(rawSearchInput.value);
});

if (rawClearBtn) {
  rawClearBtn.addEventListener("click", () => {
    rawSearchInput.value = "";
    renderRawLogSearchResults("");
  });
}

rawSearchInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  renderRawLogSearchResults(rawSearchInput.value);
});

rawSearchInput.addEventListener("input", () => {
  syncRawControlsFromQuery(rawSearchInput.value);
  syncRawSearchButtonLabel();
});

rawContextSelect.addEventListener("change", () => {
  renderRawLogSearchResults(rawSearchInput.value);
});

if (rawUserDebugOnlyToggle) {
  rawUserDebugOnlyToggle.addEventListener("change", () => {
    const userDebugOnly = isUserDebugOnlyMode();
    if (userDebugOnly && rawErrorsToggle?.checked) rawErrorsToggle.checked = false;
    if (userDebugOnly) {
      rawSearchInput.value = "";
      if (rawContextSelect) {
        rawContextSelect.value = "0";
        rawContextSelect.disabled = true;
      }
    } else {
      if (rawContextSelect) rawContextSelect.disabled = false;
    }
    saveLogExplorerSettings({
      contextRows: getSelectedContextRows(),
      userDebugOnly,
      errorsOnly: isErrorsOnlyMode(),
    });
    renderRawLogSearchResults(rawSearchInput.value);
  });
}

if (rawErrorsToggle) {
  rawErrorsToggle.addEventListener("change", () => {
    const errorsOnly = isErrorsOnlyMode();
    if (errorsOnly) {
      if (rawUserDebugOnlyToggle?.checked) rawUserDebugOnlyToggle.checked = false;
      if (rawShowAllToggle?.checked) rawShowAllToggle.checked = false;
      rawSearchInput.value = "";
    }
    saveLogExplorerSettings({
      contextRows: getSelectedContextRows(),
      userDebugOnly: isUserDebugOnlyMode(),
      errorsOnly,
    });
    renderRawLogSearchResults(rawSearchInput.value);
  });
}

if (rawShowAllToggle) {
  rawShowAllToggle.addEventListener("change", () => {
    if (rawShowAllToggle.checked) {
      if (rawContextSelect) rawContextSelect.value = "0";
      if (rawUserDebugOnlyToggle?.checked) rawUserDebugOnlyToggle.checked = false;
      if (rawErrorsToggle?.checked) rawErrorsToggle.checked = false;
      saveLogExplorerSettings({
        contextRows: 0,
        userDebugOnly: false,
        errorsOnly: false,
      });
      rawSearchInput.value = "";
      renderRawLogSearchResults("");
      return;
    }
    renderRawLogSearchResults(rawSearchInput.value);
  });
}

if (rawCopyHighlightedBtn) {
  rawCopyHighlightedBtn.addEventListener("click", () => {
    copyRenderedRawLines(
      ".rawLineMatch",
      "No highlighted lines to copy.",
      "highlighted",
      rawCopyHighlightedBtn,
    );
  });
}

if (rawCopyVisibleBtn) {
  rawCopyVisibleBtn.addEventListener("click", () => {
    copyRenderedRawLines(
      ".rawLine",
      "No visible lines to copy.",
      "visible",
      rawCopyVisibleBtn,
    );
  });
}

if (extensionOpenFileBtn && extensionFileInput) {
  extensionOpenFileBtn.addEventListener("click", () => {
    extensionFileInput.click();
  });
  extensionFileInput.addEventListener("change", () => {
    const [file] = Array.from(extensionFileInput.files || []);
    handleExtensionFile(file);
  });
}

toggleAllQueriesBtn.addEventListener("click", () => {
  queriesExpanded = !queriesExpanded;
  problematicQueriesTable.hidden = queriesExpanded;
  allQueriesWrap.hidden = !queriesExpanded;
  toggleAllQueriesBtn.hidden = allQueriesCount <= uiConfig.limits.soql;
  setExpandButtonLabel(toggleAllQueriesBtn, queriesExpanded, allQueriesCount);
  if (queriesSubheading) {
    const visibleLongestQueryCount = Math.min(allQueriesCount, uiConfig.limits.soql);
    queriesSubheading.textContent = queriesExpanded
      ? uiConfig.labels.soqlExpandedSubheading
      : fillCountTemplate(uiConfig.labels.soqlTopTemplate, visibleLongestQueryCount);
  }
});

if (toggleAllDmlBtn) {
  toggleAllDmlBtn.addEventListener("click", () => {
    dmlExpanded = !dmlExpanded;
    toggleAllDmlBtn.hidden = allDmlCount <= uiConfig.limits.dml;
    setExpandButtonLabel(toggleAllDmlBtn, dmlExpanded, allDmlCount);
    if (currentReportData) {
      render(currentReportData, currentRawLogLines);
      renderRawLogSearchResults(rawSearchInput.value);
    }
  });
}

if (toggleAllErrorsBtn) {
  toggleAllErrorsBtn.addEventListener("click", () => {
    errorsExpanded = !errorsExpanded;
    toggleAllErrorsBtn.hidden = allErrorsCount <= uiConfig.limits.errors;
    setExpandButtonLabel(toggleAllErrorsBtn, errorsExpanded, allErrorsCount);
    if (currentReportData) {
      render(currentReportData, currentRawLogLines);
      renderRawLogSearchResults(rawSearchInput.value);
    }
  });
}

if (toggleAllWarningsBtn) {
  toggleAllWarningsBtn.addEventListener("click", () => {
    warningsExpanded = !warningsExpanded;
    toggleAllWarningsBtn.hidden = allWarningsCount <= uiConfig.limits.warnings;
    setExpandButtonLabel(toggleAllWarningsBtn, warningsExpanded, allWarningsCount);
    if (currentReportData) {
      render(currentReportData, currentRawLogLines);
      renderRawLogSearchResults(rawSearchInput.value);
    }
  });
}

if (toggleResourceUsageBtn && resourceUsageBody) {
  toggleResourceUsageBtn.addEventListener("click", () => {
    setSectionCollapsed(toggleResourceUsageBtn, resourceUsageBody, !resourceUsageBody.hidden);
  });
}


document.addEventListener("click", (e) => {
  const link = e.target.closest(".jumpRawFromQuery");
  if (!link) return;
  if (!isPlainPrimaryClick(e)) return;
  if (maybeOpenConfiguredNewTab(link)) {
    e.preventDefault();
    return;
  }
  e.preventDefault();
  const encodedLineQuery = String(link.dataset.lineQuery || "").trim();
  const lineQuery = encodedLineQuery ? decodeURIComponent(encodedLineQuery) : "";
  if (lineQuery) {
    openRawLogQuery(lineQuery);
    return;
  }
  const line = Number(link.dataset.line);
  if (Number.isFinite(line)) {
    openRawLogQuery(`line:${line}`);
  }
});

document.addEventListener("click", async (e) => {
  const cell = e.target.closest(".copyCell");
  if (!cell) return;
  const copyColumn = String(cell.dataset.copyColumn || "");
  if (!COPY_ENABLED_COLUMNS.has(copyColumn)) return;
  const encoded = cell.dataset.copyValue || "";
  const value = decodeURIComponent(encoded);
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    cell.dataset.icon = "done";
    cell.classList.add("copied");
    setTimeout(() => {
      cell.dataset.icon = "copy";
      cell.classList.remove("copied");
    }, 1200);
  } catch {
    // no-op
  }
});

window.addEventListener("hashchange", setViewModeFromHash);
// Back/forward navigation updates the hash without a click, so also listen for popstate.
window.addEventListener("popstate", setViewModeFromHash);
topbarHomeLink?.addEventListener("click", goToTriageSummary);

// Use history.pushState instead of window.location.hash to avoid the browser's
// native scroll-to-anchor behavior, which fights position:sticky on the nav bar.
[triageSummaryTabLink, executionStoryTabLink, dataLimitsTabLink, diagnosticsTabLink, logExplorerTabLink].forEach((link) => {
  link?.addEventListener("click", (event) => {
    event.preventDefault();
    const href = String(link.getAttribute("href") || "");
    if (!href) return;
    if (window.location.hash !== href) {
      history.pushState(null, "", href);
    }
    setViewModeFromHash();
  });
});

async function init() {
  initializeThemeControls?.();
  await initializeLogExplorerSettings?.();
  const hasAutoSource = Boolean(getExtensionSourceUrl() || getExtensionStorageKey());
  if (hasAutoSource) {
    document.body.classList.add("extension-shell-loading");
    setExtensionEmptyState(true);
  }
  setExtensionLoadDetails({
    source: "Auto-detect or manual picker",
    stage: "Waiting for input",
  });
  await loadUIConfig();
  const loadedFromStorage = await loadStoredSource();
  const loadedFromSourceUrl = loadedFromStorage ? true : await loadSourceUrl();
  const loadedFromCache = (!loadedFromStorage && !loadedFromSourceUrl) ? await tryRestoreCachedReport() : false;
  if (!loadedFromStorage && !loadedFromSourceUrl && !loadedFromCache) {
    await initializeExtensionState();
  }
  syncRawCopyButtons();
  setSectionCollapsed(toggleResourceUsageBtn, resourceUsageBody, true);
  setViewModeFromHash();
}

init();
