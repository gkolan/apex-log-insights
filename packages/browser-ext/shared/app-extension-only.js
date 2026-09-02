/**
 * app-extension-only.js
 * Extension-specific code appended to viewer/app.js by scripts/export-extension.ts.
 * DO NOT load this file directly — it is only valid combined with the viewer core.
 * Edit this file for extension-only behaviour; edit viewer/app.js for shared UI changes.
 */

// === Extension-only constants ===

const EXTENSION_MAX_RECOMMENDED_BYTES = 20 * 1024 * 1024;
const EXTENSION_MAX_LOG_BYTES = 25 * 1024 * 1024;

// === Extension-only DOM element refs ===

const extensionLoaderPanel = document.getElementById("extensionLoaderPanel");
const extensionFileInput = document.getElementById("extensionFileInput");
const extensionOpenFileBtn = document.getElementById("extensionOpenFileBtn");
const extensionLoadStatus = document.getElementById("extensionLoadStatus");
const extensionLoadDetails = document.getElementById("extensionLoadDetails");
const extensionLoadingPlaceholder = document.getElementById(
  "extensionLoadingPlaceholder",
);

// === Extension-only state ===

let extensionStatusInterval = null;
let currentExtensionLoadMeta = {};
let extensionAutoLoadFailed = false;

// === Extension-only helpers ===

/** Safely coerce any value to an array. */
function extensionArray(value) {
  return Array.isArray(value) ? value : [];
}

// === Extension UI functions ===

function formatExtensionFileSize(bytes) {
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
    [
      "Source",
      currentExtensionLoadMeta.source || "Auto-detect or manual picker",
    ],
    ["Format", currentExtensionLoadMeta.format || "Not checked yet"],
    ["Size", currentExtensionLoadMeta.sizeLabel || "Unknown"],
    ["Stage", currentExtensionLoadMeta.stage || "Idle"],
  ];
  setHtml(
    extensionLoadDetails,
    cards
      .map(
        ([title, value]) => `
    <div class="reportCard">
      <div class="reportCardTitle">${escapeHtml(title)}</div>
      <div class="reportCardText">${escapeHtml(value)}</div>
    </div>
  `,
      )
      .join(""),
  );
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
    extensionLoadingPlaceholder.hidden = !(
      isEmpty && document.body.classList.contains("extension-shell-loading")
    );
  }
}

function normalizeExtensionLogUrl(value) {
  try {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const source = new URL(raw);
    if (!new Set(["https:", "http:", "file:"]).has(source.protocol)) {
      return "";
    }
    if (
      source.username ||
      source.password ||
      !/\.log$/i.test(source.pathname)
    ) {
      return "";
    }
    return source.toString();
  } catch {
    return "";
  }
}

function getExtensionSourceUrl() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    return normalizeExtensionLogUrl(params.get("sourceUrl"));
  } catch {
    return "";
  }
}

function getExtensionStorageKey() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    const key = String(params.get("storageKey") || "").trim();
    return /^(?:apex-log-\d+-[a-z0-9]{6}|apex-new-tab-state-\d+-[a-z0-9]{8})$/.test(
      key,
    )
      ? key
      : "";
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
  const sample = String(text || "")
    .split(/\r\n|\r|\n/)
    .slice(0, 200)
    .join("\n");
  if (!sample.trim()) return false;
  const timestampedLines =
    sample.match(
      /^\d{2}:\d{2}:\d{2}\.\d{1,3}\s*\(\d+\)\|[A-Z][A-Z0-9_]*\|/gm,
    ) || [];
  const knownEvents =
    sample.match(
      /\b(CODE_UNIT_STARTED|USER_DEBUG|SOQL_EXECUTE_BEGIN|DML_BEGIN|EXECUTION_STARTED|LIMIT_USAGE_FOR_NS|CUMULATIVE_LIMIT_USAGE)\b/g,
    ) || [];
  return timestampedLines.length >= 3 || knownEvents.length >= 3;
}

async function readFileTextStream(file) {
  if (!file) return "";
  if (!file.stream) {
    const text = await file.text();
    setExtensionStatus(
      `Loaded ${file.name} (${Math.round(file.size / 1024)} KB).`,
    );
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
    const pct =
      file.size > 0 ? Math.min(99, Math.round((loaded / file.size) * 100)) : 0;
    setExtensionStatus(`Reading ${file.name}… ${pct}%`);
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

async function readBoundedResponseText(response, maxBytes) {
  const declaredBytes = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    throw new Error("The fetched file exceeds the 25 MiB input limit.");
  }

  if (!response.body?.getReader) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxBytes) {
      throw new Error("The fetched file exceeds the 25 MiB input limit.");
    }
    return new TextDecoder().decode(bytes);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let loaded = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > maxBytes) {
        await reader.cancel();
        throw new Error("The fetched file exceeds the 25 MiB input limit.");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
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
    let settled = false;
    const worker = new Worker("./content/apex-parser-worker.js");
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(
        new Error(
          "Parse timed out after 120 seconds. The log may be too large or malformed.",
        ),
      );
    }, 120_000);
    worker.onmessage = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
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
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      const parts = [
        event.message,
        event.filename && `${event.filename}:${event.lineno}`,
      ].filter(Boolean);
      reject(
        new Error(
          parts.join(" — ") || "Worker crashed (no details available).",
        ),
      );
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
    executionType:
      next?.analysis?.executionType ||
      next?.entryPoint?.type ||
      next?.context?.transaction?.requestType ||
      null,
    scopeRecordIds: Array.isArray(next?.analysis?.scopeRecordIds)
      ? next.analysis.scopeRecordIds
      : [],
    warnings: Array.isArray(parsePayload?.parseResult?.logIssues)
      ? parsePayload.parseResult.logIssues
      : [],
    phaseWarnings: Array.isArray(parsePayload?.parseResult?.phaseWarnings)
      ? parsePayload.parseResult.phaseWarnings
      : [],
  };
  next.source = next.source || {};
  next.source.fileName = next.source.fileName || fileName || "debug-log";
  next.source.input = next.source.input || {};
  next.source.input.fileName =
    next.source.input.fileName || fileName || "debug-log";
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
  if (report?.reportVersion !== "3.0.0") {
    throw new Error(
      `Unsupported report schema version: ${report?.reportVersion || "missing"}. Expected 3.0.0.`,
    );
  }
  const rawLogLines = Array.isArray(options.rawLogLines)
    ? options.rawLogLines
    : [];
  const parsePayload = options.parsePayload || null;
  const fileName =
    options.fileName ||
    report?.source?.fileName ||
    report?.source?.input?.fileName ||
    "debug-log";
  const fileSizeBytes =
    Number(options.fileSizeBytes || 0) ||
    (rawLogLines.length
      ? new TextEncoder().encode(rawLogLines.join("\n")).length
      : 0);
  const hydrated = hydrateExtensionReport(
    report,
    parsePayload,
    fileName,
    rawLogLines,
  );
  resetExpandedState();

  // Cover topbar + main with the loading overlay so the browser never paints
  // a half-rendered state (topbar populated, panels still blank).
  // Two rAF cycles give the browser time to actually paint the overlay before
  // the synchronous render() call blocks the main thread.
  document.body.classList.add("initializing");
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );

  showOfflineReport({
    report: hydrated,
    rawLines: rawLogLines,
    sourceLabel: fileName,
  });
  setExtensionEmptyState(false);
  document.body.classList.remove("initializing");

  setExtensionLoadDetails({
    fileName,
    format: fileName.toLowerCase().endsWith(".json")
      ? "JSON report"
      : "Salesforce debug log",
    sizeLabel: formatExtensionFileSize(fileSizeBytes),
    stage: "Report ready",
  });
  const sizeLabel =
    fileSizeBytes > 0
      ? ` (${(fileSizeBytes / (1024 * 1024)).toFixed(1)} MB)`
      : "";
  const advisory =
    fileSizeBytes > EXTENSION_MAX_RECOMMENDED_BYTES
      ? " Parsed above 20 MB; worker mode kept the UI responsive."
      : "";
  setExtensionStatus(`Loaded ${fileName}${sizeLabel}.${advisory}`);
}

async function loadJsonFile(file) {
  setExtensionLoadDetails({
    fileName: file.name,
    source: "Local file",
    format: "JSON report",
    sizeLabel: formatExtensionFileSize(file.size),
    stage: "Reading JSON report",
  });
  setExtensionBusy(`Reading ${file.name}`);
  const text = await readFileTextStream(file);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (parseError) {
    throw new Error(
      `Invalid JSON in ${file.name}: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
    );
  }
  const embeddedLines = Array.isArray(parsed?.rawLog?.lines)
    ? parsed.rawLog.lines.map((entry) =>
        String(entry?.text ?? entry?.raw ?? ""),
      )
    : [];
  await displayReport(parsed, {
    fileName: file.name,
    fileSizeBytes: file.size,
    rawLogLines: embeddedLines,
    parsePayload: null,
  });
}

async function loadLogFile(file) {
  if (file.size > EXTENSION_MAX_LOG_BYTES) {
    throw new Error("This log exceeds the 25 MiB input limit.");
  }
  setExtensionLoadDetails({
    fileName: file.name,
    source: "Local file",
    format: "Salesforce debug log",
    sizeLabel: formatExtensionFileSize(file.size),
    stage: "Reading raw log",
  });
  setExtensionBusy(`Preparing ${file.name} for worker parse`);
  const text = await readFileTextStream(file);
  if (!looksLikeSalesforceDebugLogText(text)) {
    setExtensionLoadDetails({
      format: "Not a Salesforce debug log",
      stage: "Rejected",
    });
    throw new Error(
      "This `.log` file does not look like a Salesforce debug log.",
    );
  }
  const rawLogLines = text.split(/\r\n|\r|\n/);
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
    if (file.size > EXTENSION_MAX_LOG_BYTES) {
      throw new Error("This file exceeds the 25 MiB input limit.");
    }
    if (lower.endsWith(".json")) {
      await loadJsonFile(file);
      return;
    }
    await loadLogFile(file);
  } catch (error) {
    setExtensionStatus(
      `Load failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (extensionFileInput) extensionFileInput.value = "";
  }
}

async function fetchAndDisplayFromUrl(sourceUrl) {
  const normalizedSourceUrl = normalizeExtensionLogUrl(sourceUrl);
  if (!normalizedSourceUrl) {
    throw new Error("The source URL is not an allowed .log handoff.");
  }
  sourceUrl = normalizedSourceUrl;
  persistSourceHref(sourceUrl);
  const encodedSourceName =
    new URL(sourceUrl).pathname.split("/").filter(Boolean).pop() || "debug.log";
  let sourceName = encodedSourceName;
  try {
    sourceName = decodeURIComponent(encodedSourceName);
  } catch {
    // Retain the encoded path segment when malformed percent escapes are present.
  }
  setExtensionBannerFileName(sourceName);
  setExtensionLoadDetails({
    fileName: sourceName,
    source: "Browser .log page",
    format: "Salesforce debug log",
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
  if (headerBytes > EXTENSION_MAX_LOG_BYTES) {
    throw new Error("The fetched file exceeds the 25 MiB input limit.");
  }
  if (headerBytes > 0) {
    setExtensionLoadDetails({
      sizeLabel: formatExtensionFileSize(headerBytes),
    });
  }
  const text = await readBoundedResponseText(response, EXTENSION_MAX_LOG_BYTES);
  const measuredBytes = new TextEncoder().encode(text).length;
  setExtensionLoadDetails({
    sizeLabel: formatExtensionFileSize(measuredBytes),
    stage: "Validating Salesforce log format",
  });
  if (!looksLikeSalesforceDebugLogText(text)) {
    setExtensionLoadDetails({
      format: "Not a Salesforce debug log",
      stage: "Rejected",
    });
    throw new Error(
      "The opened `.log` page does not look like a Salesforce debug log.",
    );
  }
  const fileName = sourceName || "debug.log";
  const rawLogLines = text.split(/\r\n|\r|\n/);
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
    extensionAutoLoadFailed = true;
    setExtensionStatus(
      `Auto-load failed: ${error instanceof Error ? error.message : String(error)}`,
    );
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
    // Keep the payload in storage so refresh works (re-reads the same key).
    // The launcher retains no more than the five most recently opened logs.
    const expiresAt = Number(payload.expiresAt || 0);
    if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() > expiresAt) {
      throw new Error("Stored payload expired. Re-open from the original tab.");
    }
    if (
      payload.kind === "new-tab-report-state-v1" ||
      (payload.report && Array.isArray(payload.rawLogLines))
    ) {
      const restoredReport =
        payload.report && typeof payload.report === "object"
          ? payload.report
          : null;
      if (!restoredReport) {
        throw new Error("Stored report payload was missing.");
      }
      const rawLogLines = payload.rawLogLines.map((line) => String(line ?? ""));
      const fileName = String(
        payload.fileName || restoredReport?.source?.fileName || "debug.log",
      );
      const byteSize = Number(
        payload.fileSizeBytes ||
          (rawLogLines.length
            ? new TextEncoder().encode(rawLogLines.join("\n")).length
            : 0),
      );
      setExtensionLoadDetails({
        fileName,
        source: "Saved analyzer state",
        sizeLabel: formatExtensionFileSize(byteSize),
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
    // Persist the source URL so refresh can re-fetch and sidebar can scan.
    const sourceHref = String(payload.sourceHref || "").trim();
    persistSourceHref(sourceHref);
    const logText = String(payload.logText || "");
    const byteSize = Number(
      payload.fileSizeBytes || new TextEncoder().encode(logText).length,
    );
    if (byteSize > EXTENSION_MAX_LOG_BYTES) {
      throw new Error("The captured log exceeds the 25 MiB input limit.");
    }
    setExtensionBannerFileName(String(payload.fileName || "debug.log"));
    setExtensionLoadDetails({
      fileName: String(payload.fileName || "debug.log"),
      source: "Captured page content",
      sizeLabel: formatExtensionFileSize(byteSize),
      format: "Validating",
      stage: "Validating Salesforce log format",
    });
    if (!looksLikeSalesforceDebugLogText(logText)) {
      setExtensionLoadDetails({
        format: "Not a Salesforce debug log",
        stage: "Rejected",
      });
      throw new Error(
        "The captured page content does not look like a Salesforce debug log.",
      );
    }
    const fileName = String(payload.fileName || "debug.log");
    const rawLogLines = logText.split(/\r\n|\r|\n/);
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
    // Populate sidebar from pre-scanned sibling files (if content-launcher included them)
    extensionPopulateSidebarFromPayload(payload);
    return true;
  } catch (error) {
    extensionAutoLoadFailed = true;
    setExtensionStatus(
      `Captured-page load failed: ${error instanceof Error ? error.message : String(error)}`,
    );
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
    : extensionArray(report?.governorBurnRate?.burnRates);
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
  const current =
    getReportGovernorLimits(report).current?.defaultNamespace || {};
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
  return extensionArray(report?.phases).filter(
    (p) => includeNotObserved || p?.status !== "not_observed",
  );
}

/** Returns structured savepoints from the report (preferred over raw log scan). */
function getSavepoints(report) {
  return extensionArray(report?.savepoints);
}

/** Returns CPU attribution object from the report. */
function getCpuAttribution(report) {
  return (
    report?.cpuAttribution || { byType: [], byNamespace: [], topHotspots: [] }
  );
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
    : extensionArray(report?.triggerCascade?.cascades);
  return cascades.filter((c) => {
    const explicit = Number(c?.chainLength || 0);
    if (explicit > 1) return true;
    const childCount = extensionArray(c?.children).length;
    return childCount > 0;
  });
}

/** Returns per-namespace managed package impact rows. */
function getManagedPackageImpact(report) {
  return Array.isArray(report?.managedPackageImpact)
    ? report.managedPackageImpact
    : extensionArray(report?.managedPackageImpact?.namespaces);
}

/**
 * Derives a plain-English verdict from existing report data.
 * Returns { level: 'ok'|'info'|'warn'|'critical'|'error', text: string }
 */
function buildVerdict(report) {
  const burnRates = getGovernorBurnRate(report);
  const issues = getReportIssues(report);
  const patterns = getSoqlPatternSuspects(report);
  const failedValidations = extensionArray(report?.trace?.validationBlocks).flatMap(
    (vb) =>
      extensionArray(vb?.rules).filter((r) => {
        const o = String(r?.outcome || "").toUpperCase();
        return o && o !== "PASS";
      }),
  );

  const criticalLimits = [...burnRates.values()].filter(
    (r) => r?.status === "critical",
  );
  const warnLimits = [...burnRates.values()].filter(
    (r) => r?.status === "warn",
  );
  const errors = issues.filter((i) => !isWarningItem(i));

  // Priority: errors > critical limits > N+1 > failed validations > warn limits > ok
  if (errors.length > 0) {
    return {
      level: "error",
      text: `${errors.length} unhandled exception${errors.length !== 1 ? "s" : ""} detected.`,
    };
  }
  if (criticalLimits.length > 0) {
    const names = criticalLimits
      .map((l) => governorLimitLabel(l.limitKey))
      .join(", ");
    return { level: "critical", text: `Governor limit critical: ${names}` };
  }
  if (patterns.length > 0) {
    return {
      level: "warn",
      text: `${patterns.length} possible N+1 SOQL pattern${patterns.length !== 1 ? "s" : ""} detected.`,
    };
  }
  if (failedValidations.length > 0) {
    return {
      level: "warn",
      text: `${failedValidations.length} validation rule${failedValidations.length !== 1 ? "s" : ""} failed.`,
    };
  }
  if (warnLimits.length > 0) {
    const names = warnLimits
      .map((l) => governorLimitLabel(l.limitKey))
      .join(", ");
    return { level: "info", text: `Governor limits elevated: ${names}` };
  }
  return {
    level: "ok",
    text: "Transaction looks healthy. No governor limit concerns detected.",
  };
}

// ─── End Display Improvement Accessors ──────────────────────────────────────

// === Extension Init Section ===
// Replaces viewer/app.js VIEWER_INIT_START…VIEWER_INIT_END section.
// Includes: extension idle state setup, all shared event listeners,
// extension-specific file picker listener, and extension's init override.

async function tryRestoreCachedReport() {
  // Try session storage first, then local storage (Firefox compat)
  const stores = [chrome?.storage?.session, chrome?.storage?.local].filter(
    Boolean,
  );
  for (const store of stores) {
    try {
      const stored = await store.get("apex-source-href");
      const sourceHref = String(stored?.["apex-source-href"] || "").trim();
      if (!sourceHref) continue;
      // Re-fetch and re-parse from the original log URL — full data, no quota issues.
      return await fetchAndDisplayFromUrl(sourceHref);
    } catch {
      // try next store
    }
  }
  return false;
}

async function initializeExtensionState() {
  // Arriving here means no auto-source loaded (or auto-load failed).
  // Clean up any shell-loading state so the idle UI is fully visible.
  document.body.classList.remove("extension-shell-loading");
  document.body.classList.remove("initializing");
  if (chrome?.storage?.session) {
    chrome.storage.session.remove("apex-source-href").catch(() => {});
  }
  if (chrome?.storage?.local) {
    chrome.storage.local.remove("apex-source-href").catch(() => {});
  }
  setExtensionEmptyState(true);
  setExtensionStatus("Ready. Select a local `.log` or `.json` file to begin.");
}

function showExtensionLoadFailureState() {
  document.body.classList.remove("extension-shell-loading");
  document.body.classList.remove("initializing");
  setExtensionEmptyState(true);
}

async function initializeExtensionTheme() {
  const storageKey = "apex-log-insights-theme";
  try {
    const stored = await chrome?.storage?.local?.get(storageKey);
    const preference = stored?.[storageKey];
    if (preference === "light" || preference === "dark") {
      window.localStorage.setItem(storageKey, preference);
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Use the viewer's system preference when extension storage is unavailable.
  }
  initializeThemeControls?.();
  const persistExtensionTheme = () => {
    const theme = document.documentElement.dataset.theme;
    if (theme === "light" || theme === "dark") {
      chrome?.storage?.local?.set({ [storageKey]: theme }).catch(() => {});
    }
  };
  themeLightBtn?.addEventListener("click", persistExtensionTheme);
  themeDarkBtn?.addEventListener("click", persistExtensionTheme);
  chrome?.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !changes[storageKey]) return;
    const preference = changes[storageKey].newValue;
    if (preference === "light" || preference === "dark") {
      window.localStorage.setItem(storageKey, preference);
      applyTheme(preference);
    } else {
      window.localStorage.removeItem(storageKey);
      applyTheme(resolveInitialTheme());
    }
  });
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
    if (userDebugOnly && rawErrorsToggle?.checked)
      rawErrorsToggle.checked = false;
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
      if (rawUserDebugOnlyToggle?.checked)
        rawUserDebugOnlyToggle.checked = false;
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
      if (rawUserDebugOnlyToggle?.checked)
        rawUserDebugOnlyToggle.checked = false;
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

if (extensionLoaderPanel) {
  extensionLoaderPanel.addEventListener("dragover", (event) => {
    event.preventDefault();
    extensionLoaderPanel.classList.add("is-drop-target");
  });
  extensionLoaderPanel.addEventListener("dragleave", () => {
    extensionLoaderPanel.classList.remove("is-drop-target");
  });
  extensionLoaderPanel.addEventListener("drop", (event) => {
    event.preventDefault();
    extensionLoaderPanel.classList.remove("is-drop-target");
    const [file] = Array.from(event.dataTransfer?.files || []);
    void handleExtensionFile(file);
  });
}

toggleAllQueriesBtn.addEventListener("click", () => {
  queriesExpanded = !queriesExpanded;
  if (currentReportData) {
    render(currentReportData, currentRawLogLines);
    renderRawLogSearchResults(rawSearchInput.value);
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
    setExpandButtonLabel(
      toggleAllWarningsBtn,
      warningsExpanded,
      allWarningsCount,
    );
    if (currentReportData) {
      render(currentReportData, currentRawLogLines);
      renderRawLogSearchResults(rawSearchInput.value);
    }
  });
}

if (toggleResourceUsageBtn && resourceUsageBody) {
  toggleResourceUsageBtn.addEventListener("click", () => {
    setSectionCollapsed(
      toggleResourceUsageBtn,
      resourceUsageBody,
      !resourceUsageBody.hidden,
    );
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
  const lineQuery = encodedLineQuery
    ? decodeURIComponent(encodedLineQuery)
    : "";
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
[
  triageSummaryTabLink,
  executionStoryTabLink,
  dataLimitsTabLink,
  diagnosticsTabLink,
  logExplorerTabLink,
].forEach((link) => {
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

// ─── Extension Sidebar ──────────────────────────────────────────────────────

/** Source href of the loaded log — used to build file:// URLs for sidebar clicks. */
let extensionLoadedSourceHref = "";

/**
 * Derive the parent directory file:// URL from a source file URL.
 */
function getParentFileUrl(fileUrl) {
  if (!fileUrl || !fileUrl.startsWith("file://")) return "";
  const i = fileUrl.lastIndexOf("/");
  return i >= 7 ? fileUrl.substring(0, i + 1) : "";
}

/**
 * Populate the sidebar from the pre-scanned sibling file list stored
 * by the content-launcher. The content script scans the parent directory
 * tree BEFORE navigating to app.html, because only content scripts
 * running on file:// pages can fetch file:// directory listings.
 * (MV3 service workers cannot fetch file:// URLs.)
 */
function extensionPopulateSidebarFromPayload(payload) {
  const siblings = Array.isArray(payload?.siblingLogFiles)
    ? payload.siblingLogFiles
    : [];
  if (siblings.length <= 1) {
    populateSidebar([], "");
    return;
  }

  const currentFileName = String(payload?.fileName || "").trim();

  // Persist so sidebar survives page refresh (session + local for Firefox compat)
  const sidebarData = { "apex-sidebar-files": siblings };
  if (chrome?.storage?.session) {
    chrome.storage.session.set(sidebarData).catch(() => {});
  }
  if (chrome?.storage?.local) {
    chrome.storage.local.set(sidebarData).catch(() => {});
  }

  extensionRenderSidebar(siblings, currentFileName);
}

/** Restore sidebar from storage (on refresh). Returns true if restored. */
async function extensionRestoreSidebar() {
  // Try session storage first, then local storage (Firefox compat)
  const stores = [chrome?.storage?.session, chrome?.storage?.local].filter(
    Boolean,
  );
  for (const store of stores) {
    try {
      const stored = await store.get([
        "apex-sidebar-files",
        "apex-sidebar-active",
      ]);
      const files = stored?.["apex-sidebar-files"];
      if (Array.isArray(files) && files.length > 1) {
        extensionRenderSidebar(
          files,
          String(stored?.["apex-sidebar-active"] || ""),
        );
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

function extensionRenderSidebar(siblings, activeFileName) {
  const parentDir = getParentFileUrl(extensionLoadedSourceHref);

  // Annotate entries with file:// URLs for click handling
  const files = siblings.map((f) => ({
    ...f,
    fileUrl: parentDir
      ? parentDir + encodeURIComponent(f.name).replace(/%2F/g, "/")
      : "",
  }));

  populateSidebar(files, activeFileName);
}

/**
 * Open a sidebar file in a new tab via its file:// URL.
 * The content script on the new page will auto-detect it as a .log file.
 */
function extensionOpenSidebarFile(fileName, entry) {
  // Update session storage so the new tab highlights the correct file
  if (chrome?.storage?.session) {
    chrome.storage.session
      .set({ "apex-sidebar-active": fileName })
      .catch(() => {});
  }
  const parentDir = getParentFileUrl(extensionLoadedSourceHref);
  const fileUrl =
    entry?.fileUrl ||
    parentDir + encodeURIComponent(fileName).replace(/%2F/g, "/");
  if (!fileUrl) return;
  if (chrome?.tabs?.create) {
    chrome.tabs.create({ url: fileUrl });
  } else {
    window.open(fileUrl, "_blank");
  }
}

/** Check if sidebar feature is enabled in settings. */
async function isSidebarEnabled() {
  if (!chrome?.storage?.local) return false;
  try {
    const stored = await chrome.storage.local.get("apex-sidebar-settings");
    return Boolean(stored?.["apex-sidebar-settings"]?.enabled);
  } catch {
    return false;
  }
}

/** Persist the source href to all available storage backends. */
function persistSourceHref(href) {
  if (!href) return;
  extensionLoadedSourceHref = href;
  const data = { "apex-source-href": href };
  if (chrome?.storage?.session) {
    chrome.storage.session.set(data).catch(() => {});
  }
  // Also persist to local storage as fallback (Firefox may lack session storage polyfill)
  if (chrome?.storage?.local) {
    chrome.storage.local.set(data).catch(() => {});
  }
}

/** Resolve the source file:// URL from all available sources. */
async function resolveSourceHref() {
  if (
    extensionLoadedSourceHref &&
    extensionLoadedSourceHref.startsWith("file://")
  ) {
    return extensionLoadedSourceHref;
  }
  // Try URL params
  const sourceUrl = getExtensionSourceUrl();
  if (sourceUrl && sourceUrl.startsWith("file://")) {
    extensionLoadedSourceHref = sourceUrl;
    return sourceUrl;
  }
  // Try session storage
  if (chrome?.storage?.session) {
    try {
      const s = await chrome.storage.session.get("apex-source-href");
      const href = String(s?.["apex-source-href"] || "").trim();
      if (href.startsWith("file://")) {
        extensionLoadedSourceHref = href;
        return href;
      }
    } catch {
      /* ignore */
    }
  }
  // Try local storage (fallback for Firefox)
  if (chrome?.storage?.local) {
    try {
      const s = await chrome.storage.local.get("apex-source-href");
      const href = String(s?.["apex-source-href"] || "").trim();
      if (href.startsWith("file://")) {
        extensionLoadedSourceHref = href;
        return href;
      }
    } catch {
      /* ignore */
    }
  }
  return "";
}

/** Scan the parent directory via background script and populate sidebar. */
async function extensionScanAndPopulateSidebar() {
  const sourceHref = await resolveSourceHref();
  if (!sourceHref) return;
  const parentDir = getParentFileUrl(sourceHref);
  if (!parentDir) return;
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "SCAN_DIRECTORY", url: parentDir },
        resolve,
      );
    });
    if (
      response?.ok &&
      Array.isArray(response.files)
    ) {
      const currentFileName = currentReportData?.source?.fileName || "";
      extensionPopulateSidebarFromPayload({
        siblingLogFiles: response.files,
        fileName: currentFileName,
      });
    }
  } catch {
    setExtensionStatus("Could not refresh the sibling log list.");
  }
}

function initExtensionSidebar() {
  initSidebar({
    onFileClick: (fileName, entry) => {
      extensionOpenSidebarFile(fileName, entry);
    },
    onRefresh: () => {
      extensionScanAndPopulateSidebar();
    },
  });

  // React to setting changes from popup in real-time
  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes["apex-sidebar-settings"]) return;
      const enabled = Boolean(
        changes["apex-sidebar-settings"].newValue?.enabled,
      );
      const sidebarEl = document.getElementById("fileSidebar");
      const toggleBtn = document.getElementById("sidebarToggleBtn");
      if (enabled) {
        extensionScanAndPopulateSidebar();
      } else {
        // Hide sidebar and toggle immediately
        if (sidebarEl) {
          sidebarEl.hidden = true;
          sidebarEl.classList.remove("open");
        }
        if (toggleBtn) {
          toggleBtn.hidden = true;
          toggleBtn.classList.remove("shifted");
        }
        const overlay = document.getElementById("sidebarOverlay");
        if (overlay) overlay.hidden = true;
        // Clear session cache
        if (chrome?.storage?.session) {
          chrome.storage.session
            .remove(["apex-sidebar-files", "apex-sidebar-active"])
            .catch(() => {});
        }
      }
    });
  }
}

async function init() {
  await initializeExtensionTheme();
  await initializeLogExplorerSettings?.();
  initExtensionSidebar();
  const hasAutoSource = Boolean(
    getExtensionSourceUrl() || getExtensionStorageKey(),
  );
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
  const loadedFromCache =
    !loadedFromStorage && !loadedFromSourceUrl
      ? await tryRestoreCachedReport()
      : false;
  if (!loadedFromStorage && !loadedFromSourceUrl && !loadedFromCache) {
    if (extensionAutoLoadFailed) showExtensionLoadFailureState();
    else await initializeExtensionState();
  }
  syncRawCopyButtons();
  setSectionCollapsed(toggleResourceUsageBtn, resourceUsageBody, true);
  setViewModeFromHash();
  // Restore sidebar: try session cache first, then live scan if enabled
  extensionRestoreSidebar().then(async (restored) => {
    if (!restored && (await isSidebarEnabled())) {
      extensionScanAndPopulateSidebar();
    }
  });
}

init();
