import { maskName, redactLine, redactLines } from "./modules/redact-pii.js";
import { copyText, createFragment } from "./modules/shared-dom.js";
import { buildInvestigationSummary } from "./modules/investigation-summary.js";
import {
  rawLogLineFromEvidence,
  evidenceButton,
} from "./modules/shared-evidence.js";
import { escapeHtml } from "./modules/shared-format.js";
import { initSidebar, populateSidebar } from "./modules/sidebar.js";
import { compareReports } from "./modules/compare-reports.js";

const APP_VERSION = "1.2.0";
const DEFAULT_UI_CONFIG = {
  limits: {
    soql: 5,
    dml: 5,
    errors: 3,
    warnings: 3,
  },
  labels: {
    soqlTopTemplate:
      "Top {count} Longest-Running Queries (excluding managed packages)",
    soqlExpandedSubheading:
      "Chronological order (as executed, excluding managed packages)",
    dmlSubheading:
      "Each operation shows the number of affected records (excluding managed packages)",
    issueTopTemplate: "Showing first {count} encountered",
    issueExpandedSubheading: "Showing all",
  },
  buttons: {
    showMoreTemplate: "{count} total →",
    showFewer: "Show fewer",
  },
  mock: {
    enableIssueMocks: false,
    issueMockCount: 10,
  },
};

// ─── PHI/PII Redaction ────────────────────────────────────────────────────────

const DEFAULT_REDACTION_SETTINGS = {
  enabled: false,
  email: true,
  sfId: true,
  phone: true,
  names: true,
  nameList: [],
};

const LOG_EXPLORER_SETTINGS_KEY = "apex-log-explorer-settings";
const RAW_CONTEXT_OPTIONS = [0, 2, 5, 10, 25, 50, 100];
const DEFAULT_RAW_PREVIEW_LINES = 200;
const DEFAULT_LOG_EXPLORER_SETTINGS = {
  contextRows: 0,
  userDebugOnly: false,
  errorsOnly: false,
  openLinksInNewTab: false,
};
const USER_DEBUG_LABEL = "User debug";

async function loadRedactionSettings() {
  try {
    if (typeof chrome !== "undefined" && chrome?.storage?.local) {
      const stored = await chrome.storage.local.get("apex-redaction-settings");
      const s = stored?.["apex-redaction-settings"];
      return s && typeof s === "object"
        ? { ...DEFAULT_REDACTION_SETTINGS, ...s }
        : { ...DEFAULT_REDACTION_SETTINGS };
    }
    const raw = localStorage.getItem("apex-redaction-settings");
    if (raw) return { ...DEFAULT_REDACTION_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // storage unavailable — use defaults
  }
  return { ...DEFAULT_REDACTION_SETTINGS };
}

async function saveRedactionSettings(settings) {
  try {
    if (typeof chrome !== "undefined" && chrome?.storage?.local) {
      await chrome.storage.local.set({ "apex-redaction-settings": settings });
      return;
    }
    localStorage.setItem("apex-redaction-settings", JSON.stringify(settings));
  } catch {
    // storage unavailable — silently ignore
  }
}

function sanitizeContextRows(value) {
  const n = Number(value);
  return RAW_CONTEXT_OPTIONS.includes(n)
    ? n
    : DEFAULT_LOG_EXPLORER_SETTINGS.contextRows;
}

function getSelectedContextRows() {
  return sanitizeContextRows(rawContextSelect?.value);
}

function isUserDebugLine(line) {
  return String(line || "").includes("|USER_DEBUG|");
}

function isUserDebugOnlyMode() {
  return Boolean(rawUserDebugOnlyToggle?.checked);
}

function isErrorsOnlyMode() {
  return Boolean(rawErrorsToggle?.checked);
}

function isErrorLine(lineText) {
  const line = String(lineText || "");
  if (line.includes("|EXCEPTION_THROWN|")) return true;
  if (line.includes("|FATAL_ERROR|")) return true;
  if (line.includes("|VF_FATAL_ERROR|")) return true;
  return false;
}

async function loadLogExplorerSettings() {
  try {
    if (typeof chrome !== "undefined" && chrome?.storage?.local) {
      const stored = await chrome.storage.local.get(LOG_EXPLORER_SETTINGS_KEY);
      const s = stored?.[LOG_EXPLORER_SETTINGS_KEY];
      if (s && typeof s === "object") {
        return {
          contextRows: sanitizeContextRows(s.contextRows),
          userDebugOnly: Boolean(s.userDebugOnly),
          errorsOnly: Boolean(s.errorsOnly),
          openLinksInNewTab: Boolean(s.openLinksInNewTab),
        };
      }
    }
    const raw = localStorage.getItem(LOG_EXPLORER_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        contextRows: sanitizeContextRows(parsed?.contextRows),
        userDebugOnly: Boolean(parsed?.userDebugOnly),
        errorsOnly: Boolean(parsed?.errorsOnly),
        openLinksInNewTab: Boolean(parsed?.openLinksInNewTab),
      };
    }
  } catch {
    // storage unavailable — use defaults
  }
  return { ...DEFAULT_LOG_EXPLORER_SETTINGS };
}

async function saveLogExplorerSettings(settings) {
  const next = {
    contextRows: sanitizeContextRows(settings?.contextRows),
    userDebugOnly: Boolean(settings?.userDebugOnly),
    errorsOnly: Boolean(settings?.errorsOnly),
    openLinksInNewTab: Boolean(settings?.openLinksInNewTab),
  };
  try {
    if (typeof chrome !== "undefined" && chrome?.storage?.local) {
      await chrome.storage.local.set({ [LOG_EXPLORER_SETTINGS_KEY]: next });
      return;
    }
    localStorage.setItem(LOG_EXPLORER_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — silently ignore
  }
}

async function initializeLogExplorerSettings() {
  const settings = await loadLogExplorerSettings();
  if (rawContextSelect) rawContextSelect.value = String(settings.contextRows);
  if (rawUserDebugOnlyToggle)
    rawUserDebugOnlyToggle.checked = settings.userDebugOnly;
  if (rawErrorsToggle) rawErrorsToggle.checked = settings.errorsOnly;
  linksOpenInNewTabPreference = Boolean(settings.openLinksInNewTab);
}

if (typeof chrome !== "undefined" && chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const changed = changes?.[LOG_EXPLORER_SETTINGS_KEY];
    if (!changed) return;
    const next = changed.newValue;
    if (next && typeof next === "object") {
      linksOpenInNewTabPreference = Boolean(next.openLinksInNewTab);
      return;
    }
    linksOpenInNewTabPreference = false;
  });
}

// ─── End PHI/PII Redaction ────────────────────────────────────────────────────

const STANDARD_SCOPE_PREFIX_LABELS = {
  "001": "Account",
  "003": "Contact",
  "005": "User",
  "006": "Opportunity",
  "00k": "OpportunityLineItem",
  "00Q": "Lead",
  "00T": "Task",
  "00U": "Event",
  500: "Case",
  "01t": "Product2",
  "01u": "PricebookEntry",
  "01s": "Pricebook2",
  800: "Contract",
  810: "ContractLineItem",
  707: "AsyncApexJob",
  "01p": "ApexClass",
  "01q": "ApexTrigger",
  a0C: "SBQQ__Quote__c",
  a0j: "SBQQ__QuoteLine__c",
  a0n: "SBQQ__Subscription__c",
  "0Hn": "SBQQ__QuoteLineGroup__c",
  "07L": "ApexLog",
};
let uiConfig = {
  limits: { ...DEFAULT_UI_CONFIG.limits },
  labels: { ...DEFAULT_UI_CONFIG.labels },
  buttons: { ...DEFAULT_UI_CONFIG.buttons },
  mock: { ...DEFAULT_UI_CONFIG.mock },
};
let linksOpenInNewTabPreference = false;

const LOADING_SCREEN_SEQUENCE = [
  "Analyzing execution…",
  "Tracing system activity…",
  "Evaluating limits and performance…",
  "Building triage summary…",
  "Generating report…",
];
const DEFAULT_RAW_STATUS_HINT =
  "Hint: Refine with error text + lines:1200-1600";

const resourceUsageBody = document.getElementById("resourceUsageBody");
const toggleResourceUsageBtn = document.getElementById(
  "toggleResourceUsageBtn",
);
const governorLimitsGrid = document.getElementById("governorLimitsGrid");
const problematicQueriesTable = document.getElementById(
  "problematicQueriesTable",
);
const toggleAllQueriesBtn = document.getElementById("toggleAllQueriesBtn");
const allQueriesWrap = document.getElementById("allQueriesWrap");
const allQueriesTable = document.getElementById("allQueriesTable");
const queriesHeading = document.getElementById("queriesHeading");
const queriesSubheading = document.getElementById("queriesSubheading");
const dmlSubheading = document.getElementById("dmlSubheading");
const toggleAllDmlBtn = document.getElementById("toggleAllDmlBtn");
const dmlTable = document.getElementById("dmlTable");
const rawSearchInput = document.getElementById("rawSearchInput");
const rawSearchBtn = document.getElementById("rawSearchBtn");
const rawClearBtn = document.getElementById("rawClearBtn");
const rawContextSelect = document.getElementById("rawContextSelect");
const rawShowAllToggle = document.getElementById("rawShowAllToggle");
const rawUserDebugOnlyToggle = document.getElementById(
  "rawUserDebugOnlyToggle",
);
const rawErrorsToggle = document.getElementById("rawErrorsToggle");
let rawHadNonEmptyQuery = false;
const rawCopyHighlightedBtn = document.getElementById("rawCopyHighlightedBtn");
const rawCopyVisibleBtn = document.getElementById("rawCopyVisibleBtn");
const rawSearchStatus = document.getElementById("rawSearchStatus");
const rawUsageHint = document.getElementById("rawUsageHint");
const redactionSettingsBtn = document.getElementById("redactionSettingsBtn");
const redactionPanel = document.getElementById("redactionPanel");
const redactEnabledChk = document.getElementById("redactEnabled");
const redactOptionsDiv = document.getElementById("redactOptions");
const redactEmailChk = document.getElementById("redactEmail");
const redactSfIdChk = document.getElementById("redactSfId");
const redactPhoneChk = document.getElementById("redactPhone");
const redactNamesChk = document.getElementById("redactNames");
const redactNameListArea = document.getElementById("redactNameList");
const redactSaveViewerBtn = document.getElementById("redactSaveViewerBtn");
const redactViewerStatus = document.getElementById("redactViewerStatus");
const rawLogText = document.getElementById("rawLogText");
const triageHighlightsPanel = document.getElementById("triageHighlightsPanel");
const triageHighlightsList = document.getElementById("triageHighlightsList");
const triageSnapshotGrid = document.getElementById("triageSnapshotGrid");
const resourceUsagePanel = document.getElementById("resourceUsagePanel");
const dataInsightsPanel = document.getElementById("dataInsightsPanel");
const dataLimitsSummaryGrid = document.getElementById("dataLimitsSummaryGrid");
const savepointList = document.getElementById("savepointList");
const dmlPanel = document.getElementById("dmlPanel");
const problematicQueriesPanel = document.getElementById(
  "problematicQueriesPanel",
);
const n1WarningContainer = document.getElementById("n1WarningContainer");
const diagnosticsPanel = document.getElementById("diagnosticsPanel");
const overviewViewPanel = document.getElementById("overviewViewPanel");
const structuralWarningsPanel = document.getElementById(
  "structuralWarningsPanel",
);
const structuralWarningsList = document.getElementById(
  "structuralWarningsList",
);
const diagnosticsQualityGrid = document.getElementById(
  "diagnosticsQualityGrid",
);
const parserWarningsList = document.getElementById("parserWarningsList");
const executionInsightsPanel = document.getElementById(
  "executionInsightsPanel",
);
const executionMetaGrid = document.getElementById("executionMetaGrid");
const executionStoryTable = document.getElementById("executionStoryTable");
const executionStorySubheading = document.getElementById(
  "executionStorySubheading",
);
const executionTypeFilterSelect = document.getElementById(
  "executionTypeFilterSelect",
);
const rawLogPanel = document.getElementById("rawLogPanel");
const rawLogBody = document.getElementById("rawLogBody");
const triageSummaryTabLink = document.getElementById("triageSummaryTabLink");
const executionStoryTabLink = document.getElementById("executionStoryTabLink");
const dataLimitsTabLink = document.getElementById("dataLimitsTabLink");
const diagnosticsTabLink = document.getElementById("diagnosticsTabLink");
const logExplorerTabLink = document.getElementById("logExplorerTabLink");
const comparisonBaselineInput = document.getElementById(
  "comparisonBaselineInput",
);
const comparisonCandidateInput = document.getElementById(
  "comparisonCandidateInput",
);
const comparisonRunBtn = document.getElementById("comparisonRunBtn");
const comparisonExportBtn = document.getElementById("comparisonExportBtn");
const comparisonStatus = document.getElementById("comparisonStatus");
const comparisonResults = document.getElementById("comparisonResults");
let currentComparison = null;
const schemaBanner = document.getElementById("schemaBanner");
const schemaBannerText = document.getElementById("schemaBannerText");
const schemaBannerDismiss = document.getElementById("schemaBannerDismiss");
const topbarHomeLink = document.getElementById("topbarHomeLink");
const topbarClassName = document.getElementById("topbarClassName");
const topbarSubtitle = document.getElementById("topbarSubtitle");
const topBannerUser = document.getElementById("topBannerUser");
const topBannerStats = document.getElementById("topBannerStats");
const topBannerFile = document.getElementById("topBannerFile");
const themeLightBtn = document.getElementById("themeLightBtn");
const themeDarkBtn = document.getElementById("themeDarkBtn");
const loadingScreenLabel = document.querySelector(".loading-screen-label");
let currentReportUrl = "";
let currentRawLogLines = [];
let currentReportData = null;
let loadingScreenTimer = null;
let loadingScreenRunId = 0;
let expandedScopeGroupKeys = new Set();
let scopeGroupUserHasToggled = false;
let scopeGroupStateReportKey = "";
let expandedRawLineNumbers = new Set();

// Cache for the raw-text → 1-based line-number reverse index.
// Rebuilt only when currentRawLogLines changes, not on every render().
let rawLineByTextCache = new Map();
let rawLineByTextSource = null; // reference equality check
const THEME_STORAGE_KEY = "apex-log-insights-theme";
const PRETTY_MAX_CHARS = 120000;
const PRETTY_MAX_RANGE_LINES = 5000;
const PRETTY_MAX_JSON_DEPTH = 128;
const PRETTY_MAX_JSON_PARSE_STEPS = 2000000;
const PRETTY_INPUT_MAX = 200_000; // 200 KB input cap for JSON pretty-printing
const PRETTY_CACHE_MAX = 2000; // LRU eviction ceiling for prettyPayloadCache
const prettyPayloadCache = new Map();

function setLoadingScreenText(text) {
  if (!loadingScreenLabel) return;
  loadingScreenLabel.textContent = String(text || "");
}

function stopLoadingScreenSequence() {
  loadingScreenRunId += 1;
  if (loadingScreenTimer !== null) {
    clearTimeout(loadingScreenTimer);
    loadingScreenTimer = null;
  }
}

function startLoadingScreenSequence() {
  stopLoadingScreenSequence();
  const runId = loadingScreenRunId;
  let stepIndex = 0;

  const typeStep = (message, charIndex) => {
    if (
      runId !== loadingScreenRunId ||
      !document.body.classList.contains("initializing")
    )
      return;
    setLoadingScreenText(message.slice(0, charIndex));
    if (charIndex < message.length) {
      loadingScreenTimer = setTimeout(
        () => typeStep(message, charIndex + 1),
        34,
      );
      return;
    }
    loadingScreenTimer = setTimeout(() => {
      stepIndex = (stepIndex + 1) % LOADING_SCREEN_SEQUENCE.length;
      typeStep(LOADING_SCREEN_SEQUENCE[stepIndex], 1);
    }, 850);
  };

  typeStep(LOADING_SCREEN_SEQUENCE[stepIndex], 1);
}

const loadingStateObserver = new MutationObserver(() => {
  if (document.body.classList.contains("initializing")) {
    startLoadingScreenSequence();
    return;
  }
  stopLoadingScreenSequence();
});

loadingStateObserver.observe(document.body, {
  attributes: true,
  attributeFilter: ["class"],
});
if (document.body.classList.contains("initializing")) {
  startLoadingScreenSequence();
}

function getStoredTheme() {
  try {
    const stored = String(window.localStorage.getItem(THEME_STORAGE_KEY) || "")
      .trim()
      .toLowerCase();
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Ignore storage access issues and fall back to system preference.
  }
  return "";
}

function resolveInitialTheme() {
  const stored = getStoredTheme();
  if (stored) return stored;
  try {
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches
    ) {
      return "light";
    }
  } catch {
    // Ignore matchMedia issues and fall back to dark mode.
  }
  return "dark";
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  themeLightBtn?.classList.toggle("is-active", nextTheme === "light");
  themeDarkBtn?.classList.toggle("is-active", nextTheme === "dark");
  themeLightBtn?.setAttribute(
    "aria-pressed",
    nextTheme === "light" ? "true" : "false",
  );
  themeDarkBtn?.setAttribute(
    "aria-pressed",
    nextTheme === "dark" ? "true" : "false",
  );
  return nextTheme;
}

function persistTheme(theme) {
  const nextTheme = applyTheme(theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch {
    // Ignore storage access issues.
  }
}

function initializeThemeControls() {
  applyTheme(resolveInitialTheme());
  themeLightBtn?.addEventListener("click", () => persistTheme("light"));
  themeDarkBtn?.addEventListener("click", () => persistTheme("dark"));
}

function getRawLineByText(rawLogLines) {
  if (rawLogLines === rawLineByTextSource) return rawLineByTextCache;
  const map = new Map();
  for (let i = 0; i < rawLogLines.length; i += 1) {
    let raw = normalizeRawLogEntry(rawLogLines[i]);
    if (!raw) continue;

    // parserCore.ts converts short DML rows into key-value pairs so the generic parser can parse them.
    // We must apply the identical transformation here so `rawLineByTextCache` matches evidence.raw!
    const shortDml = raw.match(
      /^(\d{2}:\d{2}:\d{2}\.\d+\s+\(\d+\)\|DML_BEGIN\|\[[^\]]+\])\|(Insert|Update|Upsert|Delete|Undelete|Merge)\|([^|]+)\|(\d+)$/,
    );
    if (shortDml) {
      const [, prefix, operation, sObject, rows] = shortDml;
      raw = `${prefix}|Op:${operation}|Type:${sObject}|Rows:${rows}`;
    }

    // Store all occurrences so evidence navigation can find the right duplicate
    if (!map.has(raw)) {
      map.set(raw, [i + 1]);
    } else {
      map.get(raw).push(i + 1);
    }
  }
  rawLineByTextCache = map;
  rawLineByTextSource = rawLogLines;
  return map;
}
let queriesExpanded = false;
let allQueriesCount = 0;
let dmlExpanded = false;
let allDmlCount = 0;
let parserWarningsExpanded = false;
window.toggleParserWarningsExpanded = () => {
  parserWarningsExpanded = !parserWarningsExpanded;
  if (typeof render === "function" && typeof currentReportData !== "undefined")
    render(
      currentReportData,
      typeof rawLineByTextSource !== "undefined" ? rawLineByTextSource : [],
    );
};
const EXECUTION_EVENT_CATEGORY_ALL = "all";
const EXECUTION_EVENT_CATEGORY_ORDER = [
  EXECUTION_EVENT_CATEGORY_ALL,
  "flow",
  "validation",
  "apex",
  "soql",
  "dml",
  "workflow",
  "exception",
  "debug",
  "other",
];
const EXECUTION_EVENT_CATEGORY_LABELS = {
  [EXECUTION_EVENT_CATEGORY_ALL]: "All events",
  flow: "Flow Events",
  validation: "Validation Events",
  apex: "Apex Events",
  soql: "SOQL Events",
  dml: "DML Events",
  workflow: "Workflow & Process Events",
  exception: "Exception Events",
  debug: "Debug Events",
  other: "Other Events",
};
const FLOW_EVENT_TYPES = new Set([
  // Interview lifecycle
  "FLOW_CREATE_INTERVIEW_BEGIN",
  "FLOW_CREATE_INTERVIEW_END",
  "FLOW_START_INTERVIEWS_BEGIN",
  "FLOW_START_INTERVIEWS_END",
  "FLOW_START_INTERVIEWS_ERROR",
  "FLOW_START_INTERVIEW_BEGIN",
  "FLOW_START_INTERVIEW_END",
  "FLOW_INTERVIEW_PAUSED",
  "FLOW_INTERVIEW_RESUMED",
  "FLOW_INTERVIEW_FINISHED",
  "FLOW_START_SCHEDULED_RECORDS",
  // Element execution and outcomes
  "FLOW_ELEMENT_BEGIN",
  "FLOW_ELEMENT_END",
  "FLOW_ELEMENT_DEFERRED",
  "FLOW_ELEMENT_ERROR",
  "FLOW_ELEMENT_FAULT",
  // Bulk element execution
  "FLOW_BULK_ELEMENT_BEGIN",
  "FLOW_BULK_ELEMENT_END",
  "FLOW_BULK_ELEMENT_DETAIL",
  // FINER diagnostics / tracing detail
  "FLOW_ACTIONCALL_DETAIL",
  "FLOW_ASSIGNMENT_DETAIL",
  "FLOW_LOOP_DETAIL",
  "FLOW_RULE_DETAIL",
  "FLOW_SUBFLOW_DETAIL",
  "FLOW_VALUE_ASSIGNMENT",
  // Wait/pause lifecycle detail
  "FLOW_WAIT_EVENT_RESUMING_DETAIL",
  "FLOW_WAIT_EVENT_WAITING_DETAIL",
  "FLOW_WAIT_RESUMING_DETAIL",
  "FLOW_WAIT_WAITING_DETAIL",
]);
let selectedExecutionEventCategory = EXECUTION_EVENT_CATEGORY_ALL;
const COPY_ENABLED_COLUMNS = new Set([
  "query_name",
  "dml_object",
  "dml_class_method",
  "issue_message",
  "execution_object_name",
  "execution_name",
]);

function displayValue(value) {
  return value === null || value === undefined ? "-" : String(value);
}

function secondsFromMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${(n / 1000).toFixed(3)} s`;
}

function durationMsFromTransactionTimes(startTimestamp, endTimestamp) {
  const parse = (value) => {
    const m = String(value || "")
      .trim()
      .match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    const s = Number(m[3]);
    const ms = Number(m[4]);
    if (![h, min, s, ms].every(Number.isFinite)) return null;
    return ((h * 60 + min) * 60 + s) * 1000 + ms;
  };
  const start = parse(startTimestamp);
  const end = parse(endTimestamp);
  if (start === null || end === null) return null;
  if (end >= start) return end - start;
  // Crossed midnight
  return 24 * 60 * 60 * 1000 - start + end;
}

function fillCountTemplate(template, count) {
  return String(template || "").replace(/\{count\}/g, String(count));
}

function syncRawSearchButtonLabel() {
  if (!rawSearchBtn || !rawSearchInput) return;
  rawSearchBtn.textContent = "Search";
}

function getRenderedRawLines(selector) {
  if (!rawLogText) return [];
  return Array.from(rawLogText.querySelectorAll(selector))
    .map((row) => row.querySelector(".rawLineText")?.textContent ?? "")
    .filter((line) => line !== null && line !== undefined);
}

function syncRawCopyButtons() {
  const highlighted = getRenderedRawLines(".rawLineMatch");
  const visible = getRenderedRawLines(".rawLine");
  const allLinesMode = Boolean(rawShowAllToggle?.checked);
  const filterMode = isUserDebugOnlyMode() || isErrorsOnlyMode();
  if (rawCopyHighlightedBtn)
    rawCopyHighlightedBtn.hidden = highlighted.length === 0;
  if (rawCopyVisibleBtn)
    rawCopyVisibleBtn.hidden =
      visible.length === 0 || allLinesMode || filterMode;
  if (rawClearBtn) rawClearBtn.hidden = highlighted.length === 0;
}

function normalizeRawSearchQuery(value) {
  let query = String(value || "").trim();
  if (!query) return "";

  // Normalize smart quotes and strip only wrapping quotes from pasted examples.
  query = query.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  let previous = "";
  while (query && query !== previous) {
    previous = query;
    if (
      (query.startsWith('"') && query.endsWith('"')) ||
      (query.startsWith("'") && query.endsWith("'"))
    ) {
      query = query.slice(1, -1).trim();
    }
  }

  // Ignore accidental leading plus signs from copied hint snippets.
  if (query.startsWith("+")) {
    query = query.slice(1).trim();
  }

  // Ignore accidental trailing sentence punctuation on line/range syntax.
  query = query
    .replace(/^(\s*lines?\s*:\s*\d+\s*-\s*\d+)\s*[.,;:!?]+\s*$/i, "$1")
    .replace(/^(\s*lines?\s*:\s*\d+)\s*[.,;:!?]+\s*$/i, "$1")
    .replace(/(\blines?\s*:\s*\d+\s*-\s*\d+)\s*[.,;:!?]+\s*$/i, "$1")
    .trim();

  return query;
}

function setCopyButtonBusy(button, busy) {
  if (!button) return;
  button.classList.toggle("isBusy", Boolean(busy));
  button.disabled = Boolean(busy);
  if (busy) {
    button.setAttribute("aria-busy", "true");
  } else {
    button.removeAttribute("aria-busy");
  }
}

async function copyRenderedRawLines(
  selector,
  emptyMessage,
  copiedLabel,
  button,
) {
  let lines = getRenderedRawLines(selector);
  if (lines.length === 0) {
    setRawStatus(emptyMessage);
    return;
  }
  try {
    setCopyButtonBusy(button, true);
    const redactionSettings = await loadRedactionSettings();
    let didRedact = redactionSettings.enabled;
    if (didRedact) {
      lines = redactLines(lines, redactionSettings);
    }
    await copyText(lines.join("\n"));
    const suffix = didRedact ? " (PHI/PII redacted)" : "";
    const noun = lines.length === 1 ? "line" : "lines";
    setRawStatus(`Copied ${lines.length} ${copiedLabel} ${noun}${suffix}.`);
  } catch {
    setRawStatus("Clipboard copy failed.");
  } finally {
    setCopyButtonBusy(button, false);
    syncRawCopyButtons();
  }
}

function setRawClearButtonVisibility(_hasHighlights) {
  // Clear visibility is managed by syncRawCopyButtons based on highlighted lines.
}

function isAllLinesQuery(query) {
  const q = String(query || "").trim();
  return /^lines?\s*:\s*all$/i.test(q) || /^all$/i.test(q);
}

function isSingleLineQuery(query) {
  return /^lines?\s*:\s*\d+\s*$/i.test(String(query || "").trim());
}

function isRangeLineQuery(query) {
  return /^lines?\s*:\s*\d+\s*-\s*\d+\s*$/i.test(String(query || "").trim());
}

function shouldForceClearButtonForQuery(query) {
  return (
    isAllLinesQuery(query) ||
    isSingleLineQuery(query) ||
    isRangeLineQuery(query)
  );
}

function pickSuggestionRange(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) return null;
  const index = Math.floor(Math.random() * ranges.length);
  return ranges[index] || ranges[0] || null;
}

function getAdaptiveRefineRange(totalLines) {
  const total = Number(totalLines || 0);
  if (!Number.isFinite(total) || total <= 0) {
    return { start: 1200, end: 1600 };
  }
  if (total >= 1600) {
    return { start: 1200, end: 1600 };
  }
  if (total <= 20) {
    return { start: 1, end: Math.max(1, total) };
  }
  const start = Math.max(1, Math.floor(total * 0.2));
  const end = Math.max(start + 1, Math.min(total, Math.floor(total * 0.8)));
  return { start, end };
}

function buildAdaptiveRefineHint(totalLines) {
  const { start, end } = getAdaptiveRefineRange(totalLines);
  if (start === end) return `Hint: Refine with error text + lines:${start}`;
  return `Hint: Refine with error text + lines:${start}-${end}`;
}

function buildScopedHint(term, ranges) {
  const cleaned = String(term || "").trim();
  if (!cleaned) return buildAdaptiveRefineHint(currentRawLogLines.length);
  const picked = pickSuggestionRange(ranges);
  if (!picked) return `Refine: ${cleaned} + lines:100-200`;
  return `Refine: ${cleaned} + lines:${picked.start}-${picked.end}`;
}

function buildRawHintForQuery(query, contextRows) {
  const q = String(query || "").trim();
  if (!q) return buildAdaptiveRefineHint(currentRawLogLines.length);
  const isSingleLine = isSingleLineQuery(q);
  const isLineRange = isRangeLineQuery(q);
  const isLineList = /^lines?\s*:\s*(\d+(?:\s*,\s*\d+)+)\s*$/i.test(q);
  if (isSingleLine || isLineRange || isLineList) {
    const c = Number(contextRows || 0);
    if (c > 0) {
      return `Hint: Line hits use Lines ± for context (currently ${c}).`;
    }
    return "Hint: Set Lines ± to 10 or 25 for context.";
  }
  if (parseScopedTextRangeQuery(q)) {
    return "Hint: Remove + lines:start-end to search this term across the full log";
  }
  return buildAdaptiveRefineHint(currentRawLogLines.length);
}

function normalizeRawHint(hint) {
  const text = String(hint || "").trim();
  if (!text) return DEFAULT_RAW_STATUS_HINT;
  return text.replace(/^Tip:/i, "Hint:").replace(/^Try Filter:/i, "Refine:");
}

function setRawStatus(message, hint) {
  if (!rawSearchStatus) return;
  rawSearchStatus.textContent = String(message || "");
  const resolvedHint =
    hint ??
    buildRawHintForQuery(rawSearchInput?.value || "", getSelectedContextRows());
  if (rawUsageHint) {
    rawUsageHint.textContent = normalizeRawHint(resolvedHint);
  }
}

function parseScopedTextRangeQuery(query) {
  const text = String(query || "").trim();
  if (!text.includes("+")) return null;
  const parts = text
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;
  let term = "";
  let rangeStart = null;
  let rangeEnd = null;
  for (const part of parts) {
    const rangeMatch = part.match(/^lines?\s*:\s*(\d+)\s*-\s*(\d+)$/i);
    if (rangeMatch) {
      rangeStart = Number(rangeMatch[1]);
      rangeEnd = Number(rangeMatch[2]);
      continue;
    }
    if (!term) {
      term = part;
      continue;
    }
    return null;
  }
  if (!term || !Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd))
    return null;
  return {
    term,
    start: Math.min(rangeStart, rangeEnd),
    end: Math.max(rangeStart, rangeEnd),
  };
}

function syncRawControlsFromQuery(query) {
  const q = String(query || "").trim();
  const hasQuery = q.length > 0;
  const enteringQuery = hasQuery && !rawHadNonEmptyQuery;
  const isExplicitLineQuery =
    isSingleLineQuery(q) ||
    isRangeLineQuery(q) ||
    /^lines?\s*:\s*(\d+(?:\s*,\s*\d+)+)\s*$/i.test(q);
  rawHadNonEmptyQuery = hasQuery;
  if (hasQuery) {
    // Only sync the All Lines toggle when there is an explicit query string.
    const allMode = isAllLinesQuery(q);
    if (rawShowAllToggle) rawShowAllToggle.checked = allMode;
    if (rawContextSelect) {
      if (allMode) {
        rawContextSelect.value = "0";
        rawContextSelect.disabled = true;
      } else {
        const udOnly = isUserDebugOnlyMode();
        const errOnly = isErrorsOnlyMode();
        rawContextSelect.disabled = udOnly || errOnly;
        if (enteringQuery) {
          if (isExplicitLineQuery) {
            rawContextSelect.value = "0";
          } else {
            rawContextSelect.value = udOnly || errOnly ? "0" : "2";
          }
        }
      }
    }
  } else {
    // Empty query: leave the All Lines toggle alone (managed by its own handler).
    // Let the user change context rows freely unless a filter prevents it.
    if (rawContextSelect) {
      const isFiltered =
        isUserDebugOnlyMode() ||
        isErrorsOnlyMode() ||
        Boolean(rawShowAllToggle?.checked);
      rawContextSelect.disabled = isFiltered;
    }
  }
}

async function loadUIConfig() {
  try {
    const res = await fetch("./config.json", { cache: "no-store" });
    if (!res.ok) return;
    const parsed = await res.json();
    uiConfig = {
      limits: { ...DEFAULT_UI_CONFIG.limits, ...(parsed?.limits || {}) },
      labels: { ...DEFAULT_UI_CONFIG.labels, ...(parsed?.labels || {}) },
      buttons: { ...DEFAULT_UI_CONFIG.buttons, ...(parsed?.buttons || {}) },
      mock: { ...DEFAULT_UI_CONFIG.mock, ...(parsed?.mock || {}) },
    };
  } catch {
    // Use built-in defaults when config file is missing or invalid.
  }
}

function setExpandButtonLabel(button, expanded, count) {
  if (!button) return;
  if (expanded) {
    button.textContent = uiConfig.buttons.showFewer;
    return;
  }
  button.textContent = fillCountTemplate(
    uiConfig.buttons.showMoreTemplate,
    count,
  );
}

function setSectionCollapsed(button, body, collapsed) {
  if (!button || !body) return;
  body.hidden = collapsed;
  button.textContent = collapsed ? "Show details →" : "Show fewer";
}

function getReportContext(report) {
  const context = report?.context || {};
  return {
    org: context?.org || {},
    user: context?.user || {},
    transaction: context?.transaction || {},
  };
}

function getReportEntryPoint(report) {
  const entry = report?.entryPoint || {};
  const context = getReportContext(report);
  return {
    type: entry?.type || context.transaction?.requestType || null,
    name: entry?.name || context.transaction?.rootCodeUnit || null,
    recordIds: Array.isArray(entry?.recordIds)
      ? entry.recordIds
      : Array.isArray(context.transaction?.recordIds)
        ? context.transaction.recordIds
        : [],
    evidence: entry?.evidence || null,
  };
}

function getReportExecution(report) {
  const execution = report?.execution || {};
  return {
    blocks: Array.isArray(execution?.blocks) ? execution.blocks : [],
    tree: Array.isArray(execution?.tree) ? execution.tree : [],
    trace: report?.trace || {},
  };
}

function getReportDatabase(report) {
  const database = report?.database || {};
  return {
    soql: Array.isArray(database?.soql) ? database.soql : [],
    sosl: Array.isArray(database?.sosl) ? database.sosl : [],
    dml: Array.isArray(database?.dml) ? database.dml : [],
  };
}

function getReportIssues(report) {
  const base = Array.isArray(report?.issues) ? report.issues : [];
  const analysisWarnings = [
    ...(Array.isArray(report?.analysis?.warnings)
      ? report.analysis.warnings
      : []),
    ...(Array.isArray(report?.analysis?.phaseWarnings)
      ? report.analysis.phaseWarnings
      : []),
  ].map((item, index) => ({
    id: item?.id || `analysis-warning-${index + 1}`,
    type: "warning",
    summary:
      item?.title || item?.phase || item?.summary || item?.message || "Warning",
    description: item?.message || item?.text || "",
    evidence: {
      raw: item?.raw || null,
      confidence: "derived",
    },
  }));
  return [...base, ...analysisWarnings];
}

function getReportGovernorLimits(report) {
  const canonical = report?.governorLimits || {};
  const current = canonical?.current || {};
  const snapshots = Array.isArray(canonical?.snapshots)
    ? canonical.snapshots
    : [];
  return {
    current,
    snapshots,
  };
}

function table(columns, rows) {
  if (!rows || rows.length === 0) return "<p>No data.</p>";
  const head = `<tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
  const body = rows
    .map(
      (r) => `<tr>${r.map((cell) => `<td>${cell ?? "-"}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function setHtml(target, html) {
  if (!target) return;
  target.replaceChildren(createFragment(String(html ?? "")));
}

function buildRawLogHref(query, baseHash = "#raw-log") {
  const normalized = String(query || "").trim();
  if (!normalized) return baseHash;
  return `${baseHash}?q=${encodeURIComponent(normalized)}`;
}

function getRawLogQueryFromHash(hashValue) {
  const hash = String(hashValue || "");
  const queryIndex = hash.indexOf("?");
  if (queryIndex < 0) return "";
  const params = new URLSearchParams(hash.slice(queryIndex + 1));
  return String(params.get("q") || "").trim();
}

function isPlainPrimaryClick(event) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function shouldForceNewTabForLinks() {
  return Boolean(linksOpenInNewTabPreference);
}

function hasRecoverableSourceInUrl() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    return Boolean(
      String(params.get("sourceUrl") || "").trim() ||
      String(params.get("storageKey") || "").trim(),
    );
  } catch {
    return false;
  }
}

function canPersistExtensionStateForNewTab() {
  if (typeof chrome === "undefined" || !chrome?.storage?.local) return false;
  if (window.location.protocol !== "chrome-extension:") return false;
  if (hasRecoverableSourceInUrl()) return false;
  if (!currentReportData || typeof currentReportData !== "object") return false;
  return Array.isArray(currentRawLogLines) && currentRawLogLines.length > 0;
}

function buildNewTabStateStorageKey() {
  const random = Math.random().toString(36).slice(2, 10);
  return `apex-new-tab-state-${Date.now()}-${random}`;
}

function resolveLinkTarget(href) {
  return new URL(String(href || ""), window.location.href).toString();
}

async function createNewTabHandoffUrl(href) {
  if (!canPersistExtensionStateForNewTab()) return null;
  const storageKey = buildNewTabStateStorageKey();
  const rawLogLines = currentRawLogLines.map((line) => String(line ?? ""));
  const fileSizeBytes =
    rawLogLines.length > 0
      ? new TextEncoder().encode(rawLogLines.join("\n")).length
      : 0;
  const payload = {
    kind: "new-tab-report-state-v1",
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000,
    fileName: String(currentReportUrl || ""),
    fileSizeBytes,
    report: currentReportData,
    rawLogLines,
  };
  await chrome.storage.local.set({ [storageKey]: payload });
  const target = new URL(resolveLinkTarget(href));
  const next = new URL(window.location.href);
  next.searchParams.delete("sourceUrl");
  next.searchParams.set("storageKey", storageKey);
  next.hash = target.hash || "#triage";
  return next.toString();
}

function maybeOpenConfiguredNewTab(link) {
  if (!shouldForceNewTabForLinks()) return false;
  const href = String(link?.getAttribute("href") || "").trim();
  if (!href) return false;
  const fallbackUrl = resolveLinkTarget(href);
  const popup = window.open(fallbackUrl, "_blank", "noopener");
  if (!popup) return false;
  void createNewTabHandoffUrl(href)
    .then((handoffUrl) => {
      if (handoffUrl && handoffUrl !== fallbackUrl) {
        popup.location.replace(handoffUrl);
      }
    })
    .catch(() => {});
  return true;
}

function pluralizeLabel(count, singular, plural = `${singular}s`) {
  const amount = Number.isFinite(Number(count)) ? Number(count) : 0;
  return `${amount} ${amount === 1 ? singular : plural}`;
}

function renderMetricLines(items, options = {}) {
  const list = Array.isArray(items)
    ? items.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!list.length) return "";
  const inline = Boolean(options.inline);
  if (inline) {
    return `<div class="reportStatInline">${list.map((item) => `<span class="reportStatInlineItem">${escapeHtml(item)}</span>`).join("")}</div>`;
  }
  return `<div class="reportStatStack${options.compact ? " reportStatStack--compact" : ""}">${list.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`;
}

function renderMetricPairs(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return "";
  return `
    <div class="reportMetricSubpanel">
      <div class="reportMetricPairs">
        ${pairs
          .map(
            ([left, right]) => `
          <span>${escapeHtml(String(left || ""))}</span>
          <span>${escapeHtml(String(right || ""))}</span>
        `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function titleCaseLimitToken(token) {
  const lower = String(token || "").toLowerCase();
  if (lower === "soql") return "SOQL";
  if (lower === "sosl") return "SOSL";
  if (lower === "dml") return "DML";
  if (lower === "ms") return "MS";
  if (lower === "cpu") return "CPU";
  if (lower === "id") return "ID";
  if (lower === "ids") return "IDs";
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function limitLabelFromKey(name) {
  const text = String(name || "");
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(titleCaseLimitToken);
  return words.join(" ");
}

function governorLimitLabel(key) {
  if (String(key) === "cpuTimeMs") return escapeHtml("CPU Time (sec)");
  return escapeHtml(limitLabelFromKey(key));
}

function governorLimitValue(key, used, max) {
  if (String(key) === "cpuTimeMs") {
    const usedText = escapeHtml(secondsFromMs(used));
    const maxText = escapeHtml(secondsFromMs(max));
    if (usedText === "-" && maxText === "-") return "- / -";
    return `${usedText} / ${maxText}`;
  }
  return `${escapeHtml(displayValue(used))} / ${escapeHtml(displayValue(max))}`;
}

function latestSnapshotByNamespace(report) {
  const snapshots = getReportGovernorLimits(report).snapshots || [];
  const latest = new Map();
  for (const snap of snapshots) {
    const ns = String(snap?.namespace || "").trim();
    if (!ns) continue;
    const prev = latest.get(ns);
    const prevTs = Number(prev?.timestampNs || 0);
    const curTs = Number(snap?.timestampNs || 0);
    if (!prev || curTs >= prevTs) latest.set(ns, snap);
  }
  return latest;
}

function normalizedSnapshotLimits(snapshotLimits) {
  const map = {
    soqlQueries: "soqlQueries",
    queryRows: "soqlRows",
    soslQueries: "soslQueries",
    dmlStatements: "dmlStatements",
    publishImmediateDml: "publishImmediateDml",
    dmlRows: "dmlRows",
    cpuTime: "cpuTimeMs",
    heapSize: "heapBytes",
    callouts: "callouts",
    emailInvocations: "emailInvocations",
    futureCalls: "futureCalls",
    queueableJobsAddedToQueue: "queueables",
    mobileApexPushCalls: "mobileApexPushCalls",
  };
  const out = {};
  for (const [srcKey, dstKey] of Object.entries(map)) {
    const v = snapshotLimits?.[srcKey];
    if (!v) continue;
    out[dstKey] = { used: v.used, max: v.max ?? v.limit };
  }
  return out;
}

function latestDefaultSnapshotLimits(report) {
  const latestByNs = latestSnapshotByNamespace(report);
  const snap = latestByNs.get("default");
  return snap?.limits ? normalizedSnapshotLimits(snap.limits) : {};
}

function limitBarClass(used, max) {
  const u = Number(used || 0);
  const m = Number(max || 0);
  if (m <= 0) return "bar-ok";
  const pct = (u / m) * 100;
  if (pct >= 80) return "bar-critical";
  if (pct >= 50) return "bar-warning";
  if (pct >= 20) return "bar-moderate";
  return "bar-ok";
}

function limitBarPercent(key, used, max) {
  const u = String(key) === "cpuTimeMs" ? Number(used || 0) : Number(used || 0);
  const m = String(key) === "cpuTimeMs" ? Number(max || 0) : Number(max || 0);
  if (m <= 0) return 0;
  return Math.min(100, Math.max(0, (u / m) * 100));
}

function renderGovernorLimits(target, report) {
  const governorLimits = getReportGovernorLimits(report);
  const context = getReportContext(report);
  const defaultLimits = governorLimits?.current?.defaultNamespace || {};
  const defaultSnapshotLimits = latestDefaultSnapshotLimits(report);
  const nsContext = (context?.org?.namespaceContext || []).filter(
    (ns) => ns && ns !== "default",
  );
  const snapshotsByNs = latestSnapshotByNamespace(report);

  const mergedDefault = {};
  for (const [key, value] of Object.entries(defaultSnapshotLimits)) {
    mergedDefault[key] = value;
  }
  for (const [key, value] of Object.entries(defaultLimits)) {
    const previous = mergedDefault[key] || {};
    mergedDefault[key] = {
      used: value?.used ?? previous.used,
      max: value?.max ?? value?.limit ?? previous.max,
    };
  }

  const defaultEntries = Object.entries(mergedDefault).map(([key, value]) => ({
    key,
    used: value?.used,
    max: value?.max,
  }));

  const managedGroups = [];
  for (const ns of nsContext) {
    const snap = snapshotsByNs.get(ns);
    if (!snap?.limits) continue;
    const normalized = normalizedSnapshotLimits(snap.limits);
    const entries = Object.entries(normalized)
      .map(([key, value]) => ({ key, used: value?.used, max: value?.max }))
      .filter((entry) => Number(entry.used || 0) >= 1);
    if (entries.length === 0) continue;
    managedGroups.push({ namespace: ns, entries });
  }

  const shownManagedNamespaces = new Set(managedGroups.map((g) => g.namespace));
  const hiddenManagedNamespaces = nsContext.filter(
    (ns) => !shownManagedNamespaces.has(ns),
  );

  const hasAny = defaultEntries.length > 0 || managedGroups.length > 0;
  if (!hasAny) {
    setHtml(target, "<p>No data.</p>");
    return;
  }

  const defaultCards = defaultEntries
    .map((entry) => {
      const pct = limitBarPercent(entry.key, entry.used, entry.max);
      const barClass = limitBarClass(entry.used, entry.max);
      const used = Number(entry.used || 0);
      const max = Number(entry.max || 0);
      const actualPct = max > 0 ? (used / max) * 100 : null;
      const pctDisplay = actualPct !== null ? `${Math.round(actualPct)}%` : "";
      const overage = max > 0 && used > max ? used - max : 0;
      return `
      <div class="kv limitCard">
        <span class="k">${governorLimitLabel(entry.key)}</span>
        <span class="v">${governorLimitValue(entry.key, entry.used, entry.max)}</span>
        ${max > 0 ? `<div class="limitBar"><div class="limitBarFill ${barClass}" style="width:${pct}%"></div></div><span class="limitPercent">${pctDisplay}${overage > 0 ? ` · exceeded by ${displayValue(overage)}` : ""}</span>` : ""}
      </div>`;
    })
    .join("");

  const managedRows = managedGroups
    .map((group) => {
      const metrics = group.entries
        .map(
          (entry) =>
            `<span class="govMetric">${governorLimitLabel(entry.key)}: ${governorLimitValue(entry.key, entry.used, entry.max)}</span>`,
        )
        .join(" ");
      return `<div class="govNsRow"><span class="govNsName">${escapeHtml(group.namespace)}</span><span class="govNsMetrics">${metrics}</span></div>`;
    })
    .join("");

  const hiddenText =
    hiddenManagedNamespaces.length > 0
      ? `<p class="limitNamespaceNote">Hidden (0 usage): ${hiddenManagedNamespaces.map(escapeHtml).join(", ")}</p>`
      : "";

  target.classList.remove("grid");
  target.classList.add("resourceUsageStack");
  setHtml(
    target,
    `
    <div class="kv govCard">
      <span class="k">Transaction (default namespace)</span>
      <div class="limitCards">${defaultCards}</div>
    </div>
    <div class="kv govCard">
      <span class="k">Managed Packages</span>
      <div class="govNsList">${managedRows || '<span class="v">No managed namespace usage.</span>'}</div>
      ${hiddenText}
    </div>
  `,
  );
}

function classifyBlock(label) {
  const text = String(label || "");
  if (text.startsWith("Validation:")) return "Validation";
  if (text.startsWith("Flow:")) return "Flow";
  if (text.startsWith("Workflow:")) return "Workflow";
  if (text.toLowerCase().includes("trigger event")) return "Trigger";
  return "Apex Class";
}

function isSalesforceId(value) {
  return /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(String(value || ""));
}

function parseValidationLabel(label) {
  const text = String(label || "");
  const match = text.match(/^Validation:([^:]+):?(.*)$/i);
  if (!match) return { objectName: null, context: null, recordId: null };
  const objectName = (match[1] || "").trim() || null;
  const context = (match[2] || "").trim() || null;
  const recordId = context && isSalesforceId(context) ? context : null;
  return { objectName, context, recordId };
}

function normalizeObjectApiName(name) {
  const text = String(name || "").trim();
  if (!text) return text;
  if (text.endsWith("__c") || text.endsWith("__e") || text.endsWith("__mdt"))
    return text;
  // Parser labels sometimes strip "__c" from custom objects.
  if (text.includes("_")) return `${text}__c`;
  return text;
}

function splitTriggerOperation(phase, operation) {
  const p = String(phase || "").trim();
  const o = String(operation || "").trim();
  return `${p} ${o}`.trim();
}

function compactLabel(label) {
  const text = String(label || "");
  const triggerMatch = text.match(
    /^(.+?) on (.+?) trigger event (Before|After)(Insert|Update|Delete|Undelete)$/i,
  );
  if (triggerMatch) {
    const [, triggerName, objectName, phase, op] = triggerMatch;
    const objectApi = normalizeObjectApiName(objectName);
    const triggerOperation = splitTriggerOperation(phase, op);
    return `${objectApi} Trigger · Trigger Operation ${triggerOperation} · ${triggerName}`;
  }
  if (text.startsWith("Validation:")) {
    const validation = parseValidationLabel(text);
    if (!validation.objectName) return text;
    const objectApi = normalizeObjectApiName(validation.objectName);
    if (
      validation.context &&
      !validation.recordId &&
      !/^new$/i.test(validation.context)
    ) {
      return `${objectApi} Validation · ${validation.context}`;
    }
    return `${objectApi} Validation`;
  }
  if (text.startsWith("Flow:")) {
    const flowName = text.replace(/^Flow:/, "").trim();
    return flowName ? `${flowName} Flow` : "Flow";
  }
  if (text.startsWith("Workflow:"))
    return text.replace("Workflow:", "Workflow · ");
  return text;
}

function parseFlowLabel(label) {
  const text = String(label || "");
  if (!text.startsWith("Flow:")) return { objectName: null };
  const objectName = text.replace(/^Flow:/, "").trim() || null;
  return { objectName };
}

function parseWorkflowLabel(label) {
  const text = String(label || "");
  if (!text.startsWith("Workflow:")) return { objectName: null };
  const objectName = text.replace(/^Workflow:/, "").trim() || null;
  return { objectName };
}

function inferFlowOperationType(flowName) {
  const text = String(flowName || "");
  if (!text) return "-";
  if (/before save/i.test(text)) return "Before Save";
  if (/after save/i.test(text)) return "After Save";
  if (/screen/i.test(text)) return "Screen Flow";
  if (/auto.?launched/i.test(text)) return "Autolaunched";
  if (/scheduled/i.test(text)) return "Scheduled";
  if (/platform event/i.test(text)) return "Platform Event";
  return "-";
}

function flowNameFromBlock(flowBlock) {
  const fromStart = (flowBlock?.steps || []).find(
    (step) => String(step?.type || "") === "FLOW_START_INTERVIEW_BEGIN",
  );
  const fromStartRaw = String(fromStart?.raw || "");
  if (fromStartRaw) {
    const parts = fromStartRaw.split("|");
    const rawName = String(parts[3] || parts[2] || "").trim();
    if (rawName) return rawName;
  }
  if (fromStart?.text) {
    const text = String(fromStart.text).trim();
    const textParts = text.split("|");
    const fallbackName = String(textParts[textParts.length - 1] || "").trim();
    if (fallbackName && !/^FLOW_START_INTERVIEW_BEGIN$/i.test(fallbackName))
      return fallbackName;
  }

  const fromInterviews = (flowBlock?.steps || []).find((step) =>
    String(step?.type || "").startsWith("FLOW_START_INTERVIEWS"),
  );
  const startText = String(fromInterviews?.text || "");
  const match = startText.match(/FLOW_START_INTERVIEWS\s*:\s*(.+)$/i);
  if (match?.[1]) return match[1].trim();
  return (
    String(flowBlock?.label || "")
      .replace(/^Flow:/, "")
      .trim() || "-"
  );
}

function resolveFlowBlockForDisplay(report, block) {
  const execution = getReportExecution(report);
  const flowBlocks = execution?.trace?.flowBlocks || [];
  const spans = execution?.blocks || [];
  const direct = flowBlocks.find((fb) => fb?.eventId === block?.id) || null;
  const directCount = Number(direct?.totals?.eventCount || 0);
  if (direct && directCount > 0) return { flowBlock: direct, source: "direct" };

  const siblingCandidates = spans
    .filter(
      (s) =>
        s?.id !== block?.id &&
        s?.parentId === block?.parentId &&
        s?.label === block?.label,
    )
    .map((s) => {
      const siblingFlowBlock =
        flowBlocks.find((fb) => fb?.eventId === s?.id) || null;
      const eventCount = Number(siblingFlowBlock?.totals?.eventCount || 0);
      return { span: s, flowBlock: siblingFlowBlock, eventCount };
    })
    .filter((entry) => entry.flowBlock && entry.eventCount > 0)
    .sort((a, b) => {
      const aDelta = Math.abs((a.span?.startNs || 0) - (block?.startNs || 0));
      const bDelta = Math.abs((b.span?.startNs || 0) - (block?.startNs || 0));
      return aDelta - bDelta;
    });

  if (siblingCandidates.length > 0) {
    return { flowBlock: siblingCandidates[0].flowBlock, source: "related" };
  }
  return { flowBlock: direct, source: "direct" };
}

function inWindow(ts, start, end) {
  return ts !== null && ts !== undefined && ts >= start && ts <= end;
}

function methodNameFromLabel(label) {
  const text = String(label || "");
  const beforeParen = text.split("(")[0] || text;
  const dot = beforeParen.lastIndexOf(".");
  if (dot < 0) return beforeParen.trim() || null;
  return beforeParen.slice(dot + 1).trim() || null;
}

function codeUnitLabelFromEvent(event) {
  const fromLabel = String(event?.label || "").trim();
  if (fromLabel) return fromLabel;
  const fromText = String(event?.text || "").trim();
  if (fromText) return fromText;
  const raw = String(event?.raw || "").trim();
  if (!raw) return "";
  const parts = raw.split("|");
  return String(parts[2] || "").trim();
}

function classMethodFromMethodLabel(label) {
  const text = String(label || "");
  const beforeParen = text.split("(")[0] || text;
  const dot = beforeParen.lastIndexOf(".");
  if (dot <= 0) return { className: beforeParen || "-", methodName: "-" };
  return {
    className: beforeParen.slice(0, dot),
    methodName: beforeParen.slice(dot + 1),
  };
}

function objectNameParts(details) {
  const raw = String(details?.objectDetails || "-").trim();
  let typeLabel = String(details?.kind || "Apex Class").trim() || "Apex Class";
  let objectApiName = "-";
  const parsed = raw.match(/^([^.]+)\.\s*(.+)$/);
  if (parsed) {
    typeLabel = parsed[1].trim() || typeLabel;
    objectApiName = parsed[2].trim() || objectApiName;
  } else if (raw && raw !== "-") {
    objectApiName = raw;
  }
  return { typeLabel, objectApiName };
}

function logLineLink(rawLineNumber) {
  const line = Number(rawLineNumber);
  if (!Number.isFinite(line) || line <= 0) return "-";
  return `<a href="${buildRawLogHref(`log:${line}`)}" class="jumpRawFromQuery" data-line="${line}" title="Open raw debug-log line ${line}">${line}</a>`;
}

function renderSourceLineNumber(sourceLineNumber) {
  const source = Number(sourceLineNumber);
  if (!Number.isFinite(source) || source <= 0) return "-";
  return `<span class="sourceLineNumber" title="Line in the Apex class or trigger; this number does not navigate the raw log.">${source}</span>`;
}

function formatDurationMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "-";
  if (n < 1000) return `${n.toFixed(n >= 100 ? 0 : 1)} ms`;
  return `${(n / 1000).toFixed(3)} s`;
}

function compactSingleLine(text, maxLen = 120) {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "-";
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 3)}...`;
}

function isHiddenInternalExecutionRow(row) {
  const eventType = String(row?.eventType || "").trim();
  const name = String(row?.name || "").trim();

  // Hide bookend events that just echo their own type — zero informational value.
  // EXECUTION_STARTED/FINISHED are transaction wrappers.
  // CODE_UNIT_FINISHED duplicates CODE_UNIT_STARTED.
  // SOQL_EXECUTE_END/SOSL_EXECUTE_END just show row counts already visible in the raw line.
  // DML_END just says "DML_END".
  const BOOKEND_EVENTS = new Set([
    "EXECUTION_STARTED",
    "EXECUTION_FINISHED",
    "CODE_UNIT_FINISHED",
    "SOQL_EXECUTE_END",
    "SOSL_EXECUTE_END",
    "DML_END",
  ]);
  if (BOOKEND_EVENTS.has(eventType)) return true;

  const patterns = [
    /^Database\.QueryLocatorIterator\.(next|hasNext)\(\)$/i,
    /^Database\.[A-Za-z0-9_$.]*Iterator\.(next|hasNext)\(\)$/i,
    /^System\./i,
  ];
  if (!name) return false;
  if (!["METHOD_ENTRY", "SYSTEM_METHOD_ENTRY"].includes(eventType))
    return false;
  return patterns.some((pattern) => pattern.test(name));
}

function toScreamingSnakeCase(str) {
  return (
    String(str || "")
      .trim()
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/[\s/.-]+/g, "_")
      .replace(/[^A-Z0-9_]/gi, "")
      .toUpperCase() || "EVENT"
  );
}

const SALESFORCE_INTERNAL_EVENT_TYPES = new Set([
  "SYSTEM_METHOD_ENTRY",
  "SYSTEM_CONSTRUCTOR_ENTRY",
  "SYSTEM_METHOD_EXIT",
  "SYSTEM_CONSTRUCTOR_EXIT",
]);
const EXECUTION_STORY_EXPLICIT_EVENT_TYPES = new Set([
  "EXECUTION_STARTED",
  "EXECUTION_FINISHED",
  "CODE_UNIT_STARTED",
  "CODE_UNIT_FINISHED",
  "VALIDATION_RULE",
  "VALIDATION_PASS",
  "VALIDATION_ERROR",
  "EXCEPTION_THROWN",
  "FATAL_ERROR",
  "VF_FATAL_ERROR",
  "USER_DEBUG",
]);

function isSalesforceInternal(eventType) {
  const type = String(eventType || "")
    .trim()
    .toUpperCase();
  if (!type) return false;
  if (SALESFORCE_INTERNAL_EVENT_TYPES.has(type)) return true;
  if (type === "USER_DEBUG") return true;
  if (type.includes("LIMIT_USAGE")) return true;
  return false;
}

function getExecutionEventCategory(eventType) {
  const type = String(eventType || "")
    .trim()
    .toUpperCase();
  if (!type) return "other";
  // Keep all Flow runtime events in one bucket, including Workflow-launched flow action wrappers.
  if (
    FLOW_EVENT_TYPES.has(type) ||
    type.startsWith("FLOW_") ||
    type.startsWith("WF_FLOW_ACTION_")
  )
    return "flow";
  if (type.startsWith("VALIDATION_") || type === "VALIDATION_RULE")
    return "validation";
  if (type.startsWith("SOQL_")) return "soql";
  if (type.startsWith("DML_")) return "dml";
  if (
    type.startsWith("WORKFLOW_") ||
    type.startsWith("WF_") ||
    type.startsWith("PROCESS_")
  )
    return "workflow";
  if (
    type === "EXCEPTION_THROWN" ||
    type === "FATAL_ERROR" ||
    type === "VF_FATAL_ERROR"
  )
    return "exception";
  if (type === "USER_DEBUG") return "debug";
  if (
    type.startsWith("CODE_UNIT_") ||
    type.startsWith("TRIGGER_") ||
    type.startsWith("METHOD_") ||
    type.startsWith("CONSTRUCTOR_") ||
    type.startsWith("QUEUEABLE_") ||
    type.startsWith("FUTURE_") ||
    type.startsWith("BATCH_") ||
    type.startsWith("CUMULATIVE_") ||
    type.startsWith("EXECUTION_") ||
    type.includes("APEX")
  ) {
    return "apex";
  }
  return "other";
}

function getExecutionEventCategoryLabel(categoryKey) {
  return (
    EXECUTION_EVENT_CATEGORY_LABELS[categoryKey] ||
    EXECUTION_EVENT_CATEGORY_LABELS.other
  );
}

function getSalesforcePhaseGroup(eventType) {
  return getExecutionEventCategoryLabel(getExecutionEventCategory(eventType));
}

function isExecutionStoryEventType(eventType) {
  const type = String(eventType || "")
    .trim()
    .toUpperCase();
  if (!type) return false;
  if (EXECUTION_STORY_EXPLICIT_EVENT_TYPES.has(type)) return true;
  if (
    FLOW_EVENT_TYPES.has(type) ||
    type.startsWith("FLOW_") ||
    type.startsWith("WF_FLOW_ACTION_")
  )
    return true;
  if (type.startsWith("VALIDATION_")) return true;
  if (
    type.startsWith("SOQL_") ||
    type.startsWith("SOSL_") ||
    type.startsWith("DML_")
  )
    return true;
  if (
    type.startsWith("WORKFLOW_") ||
    type.startsWith("WF_") ||
    type.startsWith("PROCESS_")
  )
    return true;
  if (type.startsWith("METHOD_") || type.startsWith("CONSTRUCTOR_"))
    return true;
  if (
    type.startsWith("QUEUEABLE_") ||
    type.startsWith("FUTURE_") ||
    type.startsWith("BATCH_")
  )
    return true;
  if (
    type.startsWith("SYSTEM_METHOD_") ||
    type.startsWith("SYSTEM_CONSTRUCTOR_")
  )
    return true;
  if (type.startsWith("TRIGGER_")) return true;
  if (type.startsWith("CUMULATIVE_") || type.startsWith("LIMIT_USAGE"))
    return true;
  return false;
}

function syncExecutionTypeFilterUi(categoryKeys) {
  if (!executionTypeFilterSelect) return;
  const available = new Set(Array.from(categoryKeys || []).filter(Boolean));
  if (
    available.size > 0 &&
    selectedExecutionEventCategory !== EXECUTION_EVENT_CATEGORY_ALL &&
    !available.has(selectedExecutionEventCategory)
  ) {
    selectedExecutionEventCategory = EXECUTION_EVENT_CATEGORY_ALL;
  }
  const options = EXECUTION_EVENT_CATEGORY_ORDER.filter(
    (key) => key === EXECUTION_EVENT_CATEGORY_ALL || available.has(key),
  );
  setHtml(
    executionTypeFilterSelect,
    options
      .map(
        (key) =>
          `<option value="${escapeHtml(key)}">${escapeHtml(getExecutionEventCategoryLabel(key))}</option>`,
      )
      .join(""),
  );
  executionTypeFilterSelect.value = options.includes(
    selectedExecutionEventCategory,
  )
    ? selectedExecutionEventCategory
    : EXECUTION_EVENT_CATEGORY_ALL;
  if (
    !options.includes(executionTypeFilterSelect.value) &&
    options.length > 0
  ) {
    executionTypeFilterSelect.value = options[0];
  }
}

function durationMsFromEventRecord(event) {
  const ms = Number(event?.durationMs);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Render a card grid into the target element.
 * SECURITY: card.icon, card.value, card.meta, and card.detailHtml are treated as
 * pre-built HTML. Callers MUST escape any user-derived text with escapeHtml() before
 * setting these fields. Only card.title and card.href are escaped by this function.
 */
function renderCardGrid(target, cards, emptyMessage, options = {}) {
  if (!target) return;
  target.classList.toggle(
    "reportCardGrid--clustered",
    Boolean(options.clustered),
  );
  const rows = (cards || []).filter(Boolean);
  if (rows.length === 0) {
    setHtml(
      target,
      `<div class="reportCardsEmpty">${escapeHtml(emptyMessage || "No data.")}</div>`,
    );
    return;
  }
  if (options.clustered) {
    setHtml(
      target,
      `
      <div class="reportMetricCluster">
        ${rows
          .map((card) => {
            const tag = card.href ? "a" : "article";
            const tagAttrs = card.href
              ? ` href="${escapeHtml(card.href)}"`
              : "";
            const classes = `reportMetricCard${card.span === "full" ? " reportMetricCard--full" : " reportMetricCard--half"}${card.cardClass ? ` ${escapeHtml(card.cardClass)}` : ""}${card.href ? " reportMetricCard--linked" : ""}`;
            return `
          <${tag} class="${classes}"${tagAttrs}>
            <div class="reportMetricCardHeader">
              ${card.icon ? `<span class="reportMetricIcon" aria-hidden="true">${card.icon}</span>` : ""}
              <div class="reportCardTitle">${escapeHtml(card.title || "-")}</div>
            </div>
            ${card.value ? `<div class="reportStatValue">${card.value}</div>` : ""}
            ${card.meta ? `<div class="reportCardMeta">${card.meta}</div>` : ""}
            ${card.detailHtml ? `<div class="reportMetricCardDetail">${card.detailHtml}</div>` : ""}
          </${tag}>
        `;
          })
          .join("")}
      </div>
    `,
    );
    target.querySelectorAll(".scopeGroupToggle").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const groupKey = String(button.dataset.scopeGroupKey || "");
        if (!groupKey) return;
        toggleScopeGroup(groupKey);
      });
    });
    target.querySelectorAll(".scopeGroupIdLink").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const searchQuery = String(link.dataset.searchQuery || "").trim();
        if (!searchQuery) return;
        openRawLogQuery(searchQuery);
      });
    });
    return;
  }
  setHtml(
    target,
    rows
      .map(
        (card) => `
    <article class="reportCard">
      <div class="reportCardTitle">${escapeHtml(card.title || "-")}</div>
      <div class="reportStatValue">${card.value || "-"}</div>
      ${card.meta ? `<div class="reportCardMeta">${card.meta}</div>` : ""}
    </article>
  `,
      )
      .join(""),
  );
}

/**
 * Render a rich list into the target element.
 * SECURITY: item.title, item.meta, and item.body are treated as pre-built HTML.
 * Callers MUST escape any user-derived text with escapeHtml() before setting these fields.
 */
function renderRichList(target, items, emptyMessage, options = {}) {
  if (!target) return;
  const rows = (items || []).filter(Boolean);
  if (rows.length === 0) {
    setHtml(
      target,
      `<div class="reportCardsEmpty">${escapeHtml(emptyMessage || "No data.")}</div>`,
    );
    return;
  }
  if (options.grouped) {
    setHtml(
      target,
      `
      <article class="reportCard reportCard--grouped">
        ${rows
          .map(
            (item) => `
          <section class="reportCardSection">
            <div class="reportCardTitle">${item.title || "-"}</div>
            ${item.meta ? `<div class="reportCardMeta">${item.meta}</div>` : ""}
            ${item.body ? `<div class="reportCardText">${item.body}</div>` : ""}
          </section>
        `,
          )
          .join("")}
      </article>
    `,
    );
    return;
  }
  setHtml(
    target,
    rows
      .map(
        (item) => `
    <article class="reportCard">
      <div class="reportCardTitle">${item.title || "-"}</div>
      ${item.meta ? `<div class="reportCardMeta">${item.meta}</div>` : ""}
      ${item.body ? `<div class="reportCardText">${item.body}</div>` : ""}
    </article>
  `,
      )
      .join(""),
  );
}

function getScopePrefix(id) {
  const text = String(id || "").trim();
  return text.length >= 3 ? text.slice(0, 3) : "";
}

function formatScopeGroupLabel(label) {
  const text = String(label || "").trim();
  if (!text) return text;
  if (text === "Other Objects") return text;
  if (text.startsWith("Unknown ")) return text;

  const customMatch = text.match(/^(.*?)(__[A-Za-z0-9_]+)$/);
  const base = customMatch ? customMatch[1] : text;
  const suffix = customMatch ? customMatch[2] : "";

  if (!base.includes("_")) return base + suffix;

  const formatted = base
    .split("_")
    .filter(Boolean)
    .map((part) => {
      if (/^[A-Z0-9]{1,4}$/.test(part)) return part;
      if (/^[A-Z0-9]+$/.test(part))
        return part.charAt(0) + part.slice(1).toLowerCase();
      if (/^[a-z0-9]+$/.test(part))
        return part.charAt(0).toUpperCase() + part.slice(1);
      return part;
    })
    .join("_");

  return formatted + suffix;
}

function buildScopeIdGroups(report, scopeIds) {
  const recordGraph = Array.isArray(report?.recordGraph)
    ? report.recordGraph
    : [];
  const labelByPrefix = new Map();
  for (const entry of recordGraph) {
    const prefix = String(entry?.keyPrefix || "").trim();
    const sObjectType = String(entry?.sObjectType || "").trim();
    if (!prefix) continue;
    if (sObjectType) {
      labelByPrefix.set(prefix, sObjectType);
      continue;
    }
    const fallback = STANDARD_SCOPE_PREFIX_LABELS[prefix];
    if (fallback) labelByPrefix.set(prefix, fallback);
  }

  const groups = new Map();
  for (const id of scopeIds) {
    const prefix = getScopePrefix(id);
    const rawLabel =
      labelByPrefix.get(prefix) ||
      STANDARD_SCOPE_PREFIX_LABELS[prefix] ||
      `Unknown (${prefix || "n/a"})`;
    const label = formatScopeGroupLabel(rawLabel);
    const key = `${label}|${prefix || "n/a"}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label,
        prefix,
        isUnknown: label.startsWith("Unknown "),
        ids: [],
      });
    }
    groups.get(key).ids.push(id);
  }

  const sorted = Array.from(groups.values()).sort((a, b) => {
    if (a.isUnknown !== b.isUnknown) return a.isUnknown ? 1 : -1;
    if (b.ids.length !== a.ids.length) return b.ids.length - a.ids.length;
    return a.label.localeCompare(b.label);
  });

  const primary = sorted.filter((group) => !group.isUnknown);
  const overflow = sorted.filter((group) => group.isUnknown);

  if (primary.length === 0) {
    primary.push(...sorted.slice(0, 5));
    overflow.length = 0;
    overflow.push(...sorted.slice(5));
  }

  if (overflow.length > 0) {
    const overflowIds = overflow.flatMap((group) => group.ids);
    primary.push({
      key: "Other Objects|overflow",
      label: "Other Objects",
      prefix: "overflow",
      isUnknown: false,
      ids: overflowIds,
      childGroups: overflow,
    });
  }

  return primary;
}

function getScopeGroupReportKey(report) {
  const source = report?.source || {};
  const input = source?.input || {};
  const fileName = String(
    input?.fileName || source?.fileName || currentReportUrl || "",
  ).trim();
  const generatedAt = String(
    source?.generatedAt || input?.generatedAt || report?.generatedAt || "",
  ).trim();
  const bytes = Number(source?.bytes || input?.bytes || 0);
  return `${fileName}|${generatedAt}|${Number.isFinite(bytes) ? bytes : 0}`;
}

function renderScopeIdGroups(groups) {
  if (!groups.length)
    return '<div class="scopeGroupEmpty">No scope IDs available</div>';
  return `
    <div class="scopeGroupList">
      ${groups
        .map((group) => {
          const expanded = expandedScopeGroupKeys.has(group.key);
          const renderChildLabel = (childGroup) => {
            if (!childGroup?.isUnknown) {
              return `${escapeHtml(childGroup.label)} <span class="scopeGroupChildCount">(${childGroup.ids.length})</span>`;
            }
            const prefix =
              String(childGroup.prefix || "").toUpperCase() || "N/A";
            return `${escapeHtml(prefix)} <span class="scopeGroupChildCount">${childGroup.ids.length}</span>`;
          };
          const renderIdParagraph = (ids) => `
          <div class="scopeGroupIdParagraph">
            ${ids.map((id, index) => `${index > 0 ? '<span class="scopeGroupComma">, </span>' : ""}<a class="scopeGroupIdLink" href="${buildRawLogHref(id, "#evidence")}" data-search-query="${escapeHtml(id)}">${escapeHtml(id)}</a>`).join("")}
          </div>
        `;
          return `
          <div class="scopeGroupRow">
            <button type="button" class="scopeGroupToggle" data-scope-group-key="${escapeHtml(group.key)}" aria-expanded="${expanded ? "true" : "false"}">
              <span class="scopeGroupChevron" aria-hidden="true">${expanded ? "−" : "+"}</span>
              <span class="scopeGroupLabel">${escapeHtml(group.label)}</span>
              <span class="scopeGroupCount">${group.ids.length}</span>
            </button>
            ${
              expanded
                ? `
              <div class="scopeGroupIds">
                ${
                  Array.isArray(group.childGroups) &&
                  group.childGroups.length > 0
                    ? group.childGroups
                        .map(
                          (childGroup) => `
                    <div class="scopeGroupChild">
                      <div class="scopeGroupChildLabel${childGroup.isUnknown ? " scopeGroupChildLabel--unknown" : ""}">${renderChildLabel(childGroup)}</div>
                      ${renderIdParagraph(childGroup.ids)}
                    </div>
                  `,
                        )
                        .join("")
                    : renderIdParagraph(group.ids)
                }
              </div>
            `
                : ""
            }
          </div>
        `;
        })
        .join("")}
    </div>
  `;
}

function toggleScopeGroup(groupKey) {
  if (!groupKey) return;
  scopeGroupUserHasToggled = true;
  if (expandedScopeGroupKeys.has(groupKey)) {
    expandedScopeGroupKeys.delete(groupKey);
  } else {
    expandedScopeGroupKeys.add(groupKey);
  }
  if (currentReportData) {
    render(currentReportData, currentRawLogLines);
    renderRawLogSearchResults(rawSearchInput?.value || "");
  }
}

function isWarningItem(item) {
  const type = String(item?.type || "").toLowerCase();
  const summary = String(item?.summary || "").toLowerCase();
  const severity = String(item?.severity || "").toLowerCase();
  return (
    type.includes("warning") ||
    summary.includes("warning") ||
    severity.includes("warn")
  );
}

function prettifyIssueType(type) {
  const raw = String(type || "").trim();
  if (!raw) return "Issue";
  return raw
    .replace(/_WARNING$/i, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace(/\bSoql\b/g, "SOQL")
    .replace(/\bDml\b/g, "DML")
    .replace(/\bApi\b/g, "API");
}

function issueHeading(item) {
  const type = String(item?.type || "").toUpperCase();
  if (type === "RECURSIVE_TRIGGER") return "Recursive Trigger";
  if (type === "NO_OP_DML_WARNING") return "DML Update";
  return prettifyIssueType(type || item?.type || "Issue");
}

function issueIcon(item) {
  const type = String(item?.type || "").toUpperCase();
  const baseSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="reportIssueIcon">`;

  if (type.includes("QUERY")) {
    // Lucide Database
    return `${baseSVG}<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>`;
  }
  if (type.includes("DML") || type.includes("UPDATE")) {
    // Lucide Save
    return `${baseSVG}<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
  }
  if (
    type.includes("TRIGGER") ||
    type.includes("RECURSION") ||
    type.includes("RECURSIVE")
  ) {
    // Lucide RotateCcw
    return `${baseSVG}<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
  }

  // Lucide Info
  return `${baseSVG}<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
}

function issueRecommendedAction(item) {
  const type = String(item?.type || "").toUpperCase();
  if (type === "RECURSIVE_TRIGGER") {
    return "Add a recursion guard in the trigger handler to prevent unintended re-entry in the same transaction.";
  }
  if (type === "NO_OP_DML_WARNING") {
    return "Check whether the update list is empty, filtered incorrectly, or writing unchanged values.";
  }
  if (type === "EMPTY_RESULT_MAP_WARNING") {
    return "Verify the upstream query, filter inputs, and guard clauses before relying on this map.";
  }
  if (type === "SOQL_QUERY_WARNING") {
    return "Check whether the filter fields are indexed — a 0-row result on a slow query suggests Salesforce scanned rows before finding none.";
  }
  if (type.includes("SLOW_QUERY")) {
    return "Review query selectivity, filters, and indexing. Slow queries consume CPU that counts toward the 10-second transaction limit.";
  }
  if (type.includes("EMPTY_QUERY")) {
    return "Validate the bind inputs and decision path that led to this query before relying on its results.";
  }
  if (type === "NO_EXPLAIN_PLAN_WARNING") {
    return "Check the query's bind variables — if the upstream query returned nothing, the binds may be empty and the query may never match records.";
  }
  return "Review the linked log lines before changing code so the fix matches the actual runtime behavior.";
}

function issueEvidenceLines(item, rawLineForEvidence) {
  const fromArray = Array.isArray(item?.evidence?.rawLogLineNumbers)
    ? item.evidence.rawLogLineNumbers
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n >= 1)
    : [];
  const fromSingleRaw = Number(item?.evidence?.rawLogLineNumber);
  const fromRaw = rawLineForEvidence(item?.evidence?.raw);
  const values = Array.from(
    new Set([
      ...fromArray,
      ...(Number.isFinite(fromSingleRaw) && fromSingleRaw >= 1
        ? [fromSingleRaw]
        : []),
      ...(fromRaw !== null ? [fromRaw] : []),
    ]),
  ).sort((a, b) => a - b);
  return values;
}

function renderIssueFindingBody(item, evidenceDetails = "") {
  const summary = escapeHtml(String(item?.summary || item?.type || "Issue"));
  const description = escapeHtml(String(item?.description || ""));
  const action = escapeHtml(issueRecommendedAction(item));
  return `
    <div class="findingSummary">${summary}</div>
    ${description ? `<div class="findingImpact">${description}</div>` : ""}
    ${evidenceDetails}
    <div class="findingAction"><span class="findingActionLabel">Note:</span> ${action}</div>
  `;
}

function groupFailureContexts(report) {
  const failures = Array.isArray(report?.failureContexts)
    ? report.failureContexts
    : [];
  return Array.from(
    failures
      .reduce((groups, failure) => {
        const key = `${String(failure?.type || "Failure")}\u0000${String(failure?.message || "")}`;
        const existing = groups.get(key);
        if (existing) existing.occurrences += 1;
        else groups.set(key, { failure, occurrences: 1 });
        return groups;
      }, new Map())
      .values(),
  );
}

function failureContextMatchesIssue(group, item) {
  const failure = group?.failure || {};
  const failureMessage = String(failure?.message || "")
    .trim()
    .toLowerCase();
  const issueText =
    `${String(item?.summary || "")} ${String(item?.description || "")}`
      .trim()
      .toLowerCase();
  if (
    failureMessage &&
    issueText &&
    (issueText.includes(failureMessage) || failureMessage.includes(issueText))
  ) {
    return true;
  }
  const failureLine = Number(failure?.lineNumber);
  return (
    Number.isFinite(failureLine) &&
    issueEvidenceLines(item, () => null).includes(failureLine)
  );
}

function renderFailureContextDetails(group) {
  const failure = group?.failure || {};
  const occurrences = Number(group?.occurrences || 1);
  const events = Array.isArray(failure?.precedingEvents)
    ? failure.precedingEvents
    : [];
  const trail = events
    .slice(-6)
    .map((event) => {
      const label = escapeHtml(String(event?.text || event?.type || "Event"));
      const line = Number(event?.lineNumber);
      return Number.isFinite(line)
        ? `<a class="reportEvidenceLink jumpRawFromQuery" href="${buildRawLogHref(`log:${line}`)}" data-line="${line}">${label}</a>`
        : `<span>${label}</span>`;
    })
    .join('<span aria-hidden="true"> → </span>');
  return `${
    occurrences > 1
      ? `<div class="findingEvidence"><span class="findingActionLabel">Observed:</span> ${escapeHtml(String(occurrences))} matching exception events</div>`
      : ""
  }${
    trail
      ? `<div class="findingEvidence"><span class="findingActionLabel">Before failure:</span> ${trail}</div>`
      : ""
  }`;
}

function isAggregateEmptyResultMapWarning(item) {
  const type = String(item?.type || "").toUpperCase();
  const summary = String(item?.summary || "");
  return (
    type === "EMPTY_RESULT_MAP_WARNING" &&
    /\bresult map\(s\) were empty\b/i.test(summary)
  );
}

function isSpecificEmptyResultMapWarning(item) {
  const type = String(item?.type || "").toUpperCase();
  const summary = String(item?.summary || "");
  return (
    type === "EMPTY_RESULT_MAP_WARNING" &&
    /(?:^Map<[^>]+>\s+\S+\s+is empty$)|(?:^<Map>\s+\S+\s+is empty$)/i.test(
      summary,
    )
  );
}

function synthesizeEmptyMapWarningsFromRawLog(rawLogLines, existingIssues) {
  if (!Array.isArray(rawLogLines) || rawLogLines.length === 0) return [];
  const hasSpecific = (existingIssues || []).some((item) =>
    isSpecificEmptyResultMapWarning(item),
  );
  const hasAggregate = (existingIssues || []).some((item) =>
    isAggregateEmptyResultMapWarning(item),
  );
  if (hasSpecific || !hasAggregate) return [];

  const mapTypeByName = new Map();
  for (const line of rawLogLines) {
    const scopeMatch = String(line || "").match(
      /\|VARIABLE_SCOPE_BEGIN\|\[\d+\]\|([^|]+)\|(Map<[^|>]+(?:>[^|]*)?>)\|/,
    );
    if (!scopeMatch) continue;
    const variableName = (scopeMatch[1] || "").trim();
    const variableType = (scopeMatch[2] || "").trim();
    if (!variableName || !variableType) continue;
    mapTypeByName.set(variableName, variableType);
  }

  const seenNames = new Set();
  const out = [];
  for (let i = 0; i < rawLogLines.length; i += 1) {
    const raw = String(rawLogLines[i] || "");
    const assignMatch = raw.match(
      /\|VARIABLE_ASSIGNMENT\|\[\d+\]\|([^|]+)\|\{\}\|/,
    );
    if (!assignMatch) continue;
    const variableName = (assignMatch[1] || "").trim();
    const variableType = mapTypeByName.get(variableName) || "";
    const looksLikeMap =
      /^map/i.test(variableName) || /^Map</.test(variableType);
    if (!looksLikeMap || seenNames.has(variableName)) continue;
    seenNames.add(variableName);
    out.push({
      type: "EMPTY_RESULT_MAP_WARNING",
      summary: `${variableType || "<Map>"} ${variableName} is empty`,
      description: `${variableType || "<Map>"} "${variableName}" was assigned an empty collection.`,
      severity: "warn",
      namespace: "default",
      evidence: {
        timestampNs: null,
        raw,
      },
    });
  }
  return out;
}

const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M 4 16 C 2.9 16 2 15.1 2 14 V 4 C 2 2.9 2.9 2 4 2 H 14 C 15.1 2 16 2.9 16 4"/></svg>`;
const COPY_ICON_DONE = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

function promoteCopyCellsToTd(container) {
  if (!container) return;
  const wrapped = container.querySelectorAll("td .copyCell[data-copy-column]");
  wrapped.forEach((wrapper) => {
    const td = wrapper.closest("td");
    if (!td) return;
    td.classList.add("copyCell", "copyCellHost");
    td.dataset.copyColumn = wrapper.dataset.copyColumn || "";
    td.dataset.copyValue = wrapper.dataset.copyValue || "";
    td.dataset.icon = wrapper.dataset.icon || "copy";
    wrapper.classList.remove("copyCell");
    wrapper.classList.add("copyCellContent");
    wrapper.removeAttribute("data-copy-column");
    wrapper.removeAttribute("data-copy-value");
    wrapper.removeAttribute("data-icon");
  });
  container
    .querySelectorAll("td.copyCell[data-copy-column]")
    .forEach((cell) => {
      if (cell.querySelector(".copyCellButton")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "copyCellButton";
      button.innerHTML = COPY_ICON;
      button.setAttribute("aria-live", "polite");
      const label = String(cell.dataset.copyColumn || "value").replaceAll(
        "_",
        " ",
      );
      button.title = `Copy ${label}`;
      button.setAttribute("aria-label", `Copy ${label}`);
      let resetTimer = null;
      const resetButton = () => {
        button.innerHTML = COPY_ICON;
        button.classList.remove("copied");
        button.title = `Copy ${label}`;
        button.setAttribute("aria-label", `Copy ${label}`);
      };
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        window.clearTimeout(resetTimer);
        try {
          await copyText(decodeURIComponent(cell.dataset.copyValue || ""));
          button.innerHTML = COPY_ICON_DONE;
          button.classList.add("copied");
          button.title = `Copied ${label}`;
          button.setAttribute("aria-label", `Copied ${label}`);
        } catch {
          button.classList.remove("copied");
          button.title = `Retry copying ${label}`;
          button.setAttribute("aria-label", `Retry copying ${label}`);
        }
        resetTimer = window.setTimeout(resetButton, 1500);
      });
      cell.prepend(button);
    });
}

function parseUserInfoFromRawLog(lines) {
  const row = (lines || []).find((line) =>
    String(line || "").includes("|USER_INFO|"),
  );
  if (!row) {
    return { userId: null, username: null, timezone: null };
  }
  const parts = String(row).split("|");
  return {
    userId: (parts[3] || "").trim() || null,
    username: (parts[4] || "").trim() || null,
    timezone: (parts[6] || "").trim() || null,
  };
}

function normalizeRawLogEntry(value) {
  return String(value ?? "")
    .replace(/\r$/, "")
    .trimEnd();
}

function looksLikeJsonLiteral(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return (
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("[") && text.endsWith("]"))
  );
}

function isUserDebugEventType(eventType) {
  const type = String(eventType || "").trim();
  return (
    type === "USER_DEBUG" ||
    type === "DATAWEAVE_USER_DEBUG" ||
    type.startsWith("USER_DEBUG_")
  );
}

function findBalancedJsonSpanEnd(source, startIndex) {
  const startChar = source[startIndex];
  const endChar = startChar === "{" ? "}" : "]";
  if (startChar !== "{" && startChar !== "[") return -1;
  const stack = [endChar];
  let inString = false;
  let escaped = false;

  for (let i = startIndex + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      stack.push("}");
      continue;
    }
    if (ch === "[") {
      stack.push("]");
      continue;
    }
    if (ch === "}" || ch === "]") {
      const expected = stack.pop();
      if (expected !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

function findJsonSpans(text, maxSpans = 3) {
  const source = String(text || "");
  const spans = [];
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch !== "{" && ch !== "[") continue;
    const end = findBalancedJsonSpanEnd(source, i);
    if (end < 0) continue;
    const candidate = source.slice(i, end + 1).trim();
    if (looksLikeJsonLiteral(candidate) && !/^\[\d+\]$/.test(candidate)) {
      spans.push(candidate);
      if (spans.length >= maxSpans) break;
      i = end;
    }
  }
  return spans;
}

function extractEscapedJsonLiterals(text, maxLiterals = 3) {
  const source = String(text || "");
  const literals = [];
  const re = /"((?:\\.|[^"\\])*)"/g;
  let match = re.exec(source);
  while (match && literals.length < maxLiterals) {
    const quoted = `"${match[1] || ""}"`;
    try {
      const unescaped = JSON.parse(quoted);
      const candidate = String(unescaped || "").trim();
      if (looksLikeJsonLiteral(candidate) && !/^\[\d+\]$/.test(candidate)) {
        literals.push(candidate);
      }
    } catch {
      // Ignore invalid escaped fragments.
    }
    match = re.exec(source);
  }
  return literals;
}

function parseJsonWithDiagnostics(text) {
  const source = String(text || "");
  let index = 0;
  const duplicateWarnings = [];
  const numericWarnings = [];
  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
  let parseSteps = 0;

  const fail = (message) => ({
    ok: false,
    error: { message, index },
    duplicateWarnings,
    numericWarnings,
  });
  const isDigit = (ch) => ch >= "0" && ch <= "9";
  const tick = () => {
    parseSteps += 1;
    if (parseSteps > PRETTY_MAX_JSON_PARSE_STEPS) {
      return fail(
        `Parse step limit exceeded (${PRETTY_MAX_JSON_PARSE_STEPS.toLocaleString()}).`,
      );
    }
    return null;
  };
  const skipWs = () => {
    while (index < source.length && /\s/.test(source[index])) index += 1;
  };

  const parseString = () => {
    if (source[index] !== '"')
      return fail('Expected string opening quote (").');
    index += 1;
    let out = "";
    while (index < source.length) {
      const stepError = tick();
      if (stepError) return stepError;
      const ch = source[index];
      if (ch === '"') {
        index += 1;
        return { ok: true, value: out };
      }
      if (ch === "\\") {
        index += 1;
        if (index >= source.length)
          return fail("Unterminated escape sequence.");
        const esc = source[index];
        if ('"\\/bfnrt'.includes(esc)) {
          out += " ";
          index += 1;
          continue;
        }
        if (esc === "u") {
          const hex = source.slice(index + 1, index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex))
            return fail("Invalid unicode escape sequence.");
          out += " ";
          index += 5;
          continue;
        }
        return fail(`Invalid escape sequence "\\${esc}".`);
      }
      out += ch;
      index += 1;
    }
    return fail("Unterminated string literal.");
  };

  const parseNumberToken = (path) => {
    const start = index;
    if (source[index] === "-") index += 1;
    if (source[index] === "0") {
      index += 1;
    } else if (isDigit(source[index])) {
      while (isDigit(source[index])) index += 1;
    } else {
      return fail("Invalid number.");
    }
    if (source[index] === ".") {
      index += 1;
      if (!isDigit(source[index])) return fail("Invalid decimal number.");
      while (isDigit(source[index])) index += 1;
    }
    if (source[index] === "e" || source[index] === "E") {
      index += 1;
      if (source[index] === "+" || source[index] === "-") index += 1;
      if (!isDigit(source[index])) return fail("Invalid exponent.");
      while (isDigit(source[index])) index += 1;
    }
    const token = source.slice(start, index);
    if (/^-?\d+$/.test(token)) {
      try {
        const n = BigInt(token);
        if (n > MAX_SAFE || n < -MAX_SAFE) {
          numericWarnings.push(
            `${path} has an integer outside JS safe precision range.`,
          );
        }
      } catch {
        // Ignore parsing issues for diagnostics-only pass.
      }
    }
    return { ok: true };
  };

  const parseLiteral = (literal) => {
    if (source.slice(index, index + literal.length) !== literal)
      return fail(`Expected "${literal}".`);
    index += literal.length;
    return { ok: true };
  };

  const parseArray = (path) => {
    if (source[index] !== "[") return fail('Expected "[".');
    index += 1;
    skipWs();
    if (source[index] === "]") {
      index += 1;
      return { ok: true };
    }
    let itemIndex = 0;
    while (index < source.length) {
      const stepError = tick();
      if (stepError) return stepError;
      const childPath = `${path}[${itemIndex}]`;
      const child = parseValue(childPath);
      if (!child.ok) return child;
      skipWs();
      if (source[index] === ",") {
        index += 1;
        skipWs();
        itemIndex += 1;
        continue;
      }
      if (source[index] === "]") {
        index += 1;
        return { ok: true };
      }
      return fail('Expected "," or "]" in array.');
    }
    return fail("Unterminated array.");
  };

  const parseObject = (path) => {
    if (source[index] !== "{") return fail('Expected "{".');
    index += 1;
    skipWs();
    if (source[index] === "}") {
      index += 1;
      return { ok: true };
    }
    const seen = new Set();
    while (index < source.length) {
      const stepError = tick();
      if (stepError) return stepError;
      const key = parseString();
      if (!key.ok) return key;
      const keyName = String(key.value);
      const childPath = path === "$" ? `$.${keyName}` : `${path}.${keyName}`;
      if (seen.has(keyName) && duplicateWarnings.length < 12) {
        duplicateWarnings.push(`Duplicate key "${keyName}" at ${path}.`);
      }
      seen.add(keyName);
      if (seen.size > PRETTY_MAX_JSON_DEPTH) {
        return fail(`Object key depth exceeded (${PRETTY_MAX_JSON_DEPTH}).`);
      }
      skipWs();
      if (source[index] !== ":") return fail('Expected ":" after object key.');
      index += 1;
      skipWs();
      const child = parseValue(childPath);
      if (!child.ok) return child;
      skipWs();
      if (source[index] === ",") {
        index += 1;
        skipWs();
        continue;
      }
      if (source[index] === "}") {
        index += 1;
        return { ok: true };
      }
      return fail('Expected "," or "}" in object.');
    }
    return fail("Unterminated object.");
  };

  const parseValue = (path) => {
    const stepError = tick();
    if (stepError) return stepError;
    skipWs();
    const ch = source[index];
    if (ch === "{") return parseObject(path);
    if (ch === "[") return parseArray(path);
    if (ch === '"') return parseString();
    if (ch === "-" || isDigit(ch)) return parseNumberToken(path);
    if (ch === "t") return parseLiteral("true");
    if (ch === "f") return parseLiteral("false");
    if (ch === "n") return parseLiteral("null");
    return fail("Unexpected token.");
  };

  skipWs();
  const root = parseValue("$");
  if (!root.ok) return root;
  skipWs();
  if (index !== source.length) return fail("Trailing tokens after JSON value.");
  return { ok: true, duplicateWarnings, numericWarnings };
}

function extractJsonCandidatesFromRawLine(rawLine) {
  const line = String(rawLine || "").trim();
  const parts = line.split("|");
  const eventType = String(parts[1] || "").trim();
  const candidates = [];

  if (
    eventType === "VARIABLE_ASSIGNMENT" ||
    eventType === "VARIABLE_SCOPE_BEGIN"
  ) {
    if (parts.length < 5) return [];
    const lastPart = String(parts[parts.length - 1] || "").trim();
    const hasHash = /^0x[0-9a-fA-F]+$/.test(lastPart);
    const value = (hasHash ? parts.slice(4, -1) : parts.slice(4))
      .join("|")
      .trim();
    if (looksLikeJsonLiteral(value)) {
      candidates.push({ literal: value, source: "variable", eventType });
    } else {
      for (const span of findJsonSpans(value, 2)) {
        candidates.push({
          literal: span,
          source: "variable-embedded",
          eventType,
        });
      }
    }
    return candidates;
  }

  if (isUserDebugEventType(eventType) && parts.length >= 5) {
    const message = parts.slice(4).join("|").trim();
    if (looksLikeJsonLiteral(message)) {
      candidates.push({ literal: message, source: "user-debug", eventType });
    } else {
      const spans = findJsonSpans(message, 3);
      for (const span of spans)
        candidates.push({
          literal: span,
          source: "user-debug-embedded",
          eventType,
        });
      const escapedSpans = extractEscapedJsonLiterals(message, 3);
      for (const span of escapedSpans)
        candidates.push({
          literal: span,
          source: "user-debug-escaped-json",
          eventType,
        });
    }
    return candidates;
  }

  return [];
}

function analyzeJsonCandidate(candidate) {
  const literal = String(candidate?.literal || "").trim();
  if (!literal)
    return {
      ok: false,
      status: "error",
      reason: "No JSON literal detected.",
      text: null,
      warnings: [],
    };
  const warnings = [];
  if (/[\u202A-\u202E\u2066-\u2069\u200B-\u200F]/.test(literal)) {
    warnings.push(
      "Contains invisible/bidirectional Unicode control characters.",
    );
  }
  const scan = parseJsonWithDiagnostics(literal);
  if (!scan.ok) {
    const index = Number(scan.error?.index ?? -1);
    const pointer = index >= 0 ? ` at char ${index + 1}` : "";
    return {
      ok: false,
      status: "error",
      reason: `JSON parse error${pointer}: ${scan.error?.message || "Invalid JSON."}`,
      text: literal,
      warnings,
    };
  }
  warnings.push(...scan.duplicateWarnings, ...scan.numericWarnings);
  if (literal.length > PRETTY_INPUT_MAX) {
    return {
      ok: false,
      status: "too-large",
      reason: `JSON too large to pretty-print (${(literal.length / 1024).toFixed(0)} KB). Display truncated.`,
      text: literal.slice(0, PRETTY_MAX_CHARS),
      warnings,
    };
  }
  let pretty;
  try {
    pretty = JSON.stringify(JSON.parse(literal), null, 2);
  } catch {
    return {
      ok: false,
      status: "error",
      reason: "JSON.parse failed despite syntactic scan.",
      text: literal,
      warnings,
    };
  }
  if (pretty.length > PRETTY_MAX_CHARS) {
    return {
      ok: true,
      status: "truncated",
      reason: `Pretty output exceeded ${PRETTY_MAX_CHARS.toLocaleString()} characters.`,
      text: `${pretty.slice(0, PRETTY_MAX_CHARS)}\n\n... [truncated]`,
      warnings,
    };
  }
  return {
    ok: true,
    status: "formatted",
    reason: null,
    text: pretty,
    warnings,
  };
}

function formatJsonPretty(rawLine) {
  const candidates = extractJsonCandidatesFromRawLine(rawLine);
  if (candidates.length === 0) {
    return {
      status: "error",
      reason: "No JSON literal detected.",
      text: null,
      warnings: [],
    };
  }
  const analyses = candidates.map((candidate) =>
    analyzeJsonCandidate(candidate),
  );
  const successes = analyses.filter((analysis) => analysis.ok);
  if (successes.length > 0) {
    const combinedWarnings = successes
      .flatMap((item) => item.warnings || [])
      .slice(0, 12);
    const formattedDocs = successes
      .map((item, idx) =>
        successes.length > 1
          ? `# JSON ${idx + 1}\n${item.text || ""}`
          : item.text || "",
      )
      .filter(Boolean);
    const combinedText = formattedDocs.join("\n\n---\n\n");
    const status = successes.some((item) => item.status === "truncated")
      ? "truncated"
      : "formatted";
    return {
      status,
      reason:
        successes.length > 1
          ? `Detected ${successes.length} JSON payloads in one line.`
          : successes[0]?.reason || null,
      text: combinedText,
      warnings: combinedWarnings,
    };
  }
  const combinedWarnings = analyses.flatMap((item) => item.warnings || []);
  return {
    status: "error",
    reason: analyses[0]?.reason || "Unable to parse JSON literal.",
    text: analyses[0]?.text || null,
    warnings: combinedWarnings,
  };
}

function extractSoqlFromRawLine(rawLine) {
  const parts = String(rawLine || "").split("|");
  const eventType = String(parts[1] || "").trim();
  if (eventType !== "SOQL_EXECUTE_BEGIN") return null;
  const query = String(parts.slice(4).join("|") || "").trim();
  return /^select\b/i.test(query) ? query : null;
}

function extractSoslFromRawLine(rawLine) {
  const parts = String(rawLine || "").split("|");
  const eventType = String(parts[1] || "").trim();
  if (eventType !== "SOSL_EXECUTE_BEGIN") return null;
  const query = String(parts.slice(4).join("|") || "").trim();
  return /^find\b/i.test(query) ? query : null;
}

function extractSoqlExplainFromRawLine(rawLine) {
  const parts = String(rawLine || "").split("|");
  if (String(parts[1] || "").trim() !== "SOQL_EXECUTE_EXPLAIN") return null;
  return String(parts.slice(4).join("|") || "").trim() || null;
}

function extractSoqlResultFromRawLine(rawLine) {
  const parts = String(rawLine || "").split("|");
  if (String(parts[1] || "").trim() !== "SOQL_EXECUTE_END") return null;
  return parts
    .slice(3)
    .map((p) => String(p || "").trim())
    .filter(Boolean);
}

function extractSoslResultFromRawLine(rawLine) {
  const parts = String(rawLine || "").split("|");
  if (String(parts[1] || "").trim() !== "SOSL_EXECUTE_END") return null;
  return parts
    .slice(3)
    .map((p) => String(p || "").trim())
    .filter(Boolean);
}

function extractDmlFromRawLine(rawLine) {
  const parts = String(rawLine || "").split("|");
  const eventType = String(parts[1] || "").trim();
  if (eventType !== "DML_BEGIN" && eventType !== "DML_END") return null;
  return {
    eventType,
    operation: String(parts[3] || "").trim() || null,
    sObject: String(parts[4] || "").trim() || null,
    rows: String(parts[5] || "").trim() || null,
    fields: parts
      .slice(3)
      .map((p) => String(p || "").trim())
      .filter(Boolean),
  };
}

function extractIntegrationFromRawLine(rawLine) {
  const parts = String(rawLine || "").split("|");
  const eventType = String(parts[1] || "").trim();
  const integrationEvents = new Set([
    "CALLOUT_REQUEST",
    "CALLOUT_RESPONSE",
    "CALLOUT_REQUEST_PREPARE",
    "CALLOUT_REQUEST_FINALIZE",
    "NAMED_CREDENTIAL_REQUEST",
    "NAMED_CREDENTIAL_RESPONSE",
    "NAMED_CREDENTIAL_RESPONSE_DETAIL",
    "EXTERNAL_SERVICE_REQUEST",
    "EXTERNAL_SERVICE_RESPONSE",
  ]);
  if (!integrationEvents.has(eventType)) return null;
  const body = String(parts.slice(3).join("|") || "").trim();
  return {
    eventType,
    body,
    fields: parts
      .slice(3)
      .map((p) => String(p || "").trim())
      .filter(Boolean),
  };
}

function extractExceptionFromRawLine(rawLine) {
  const parts = String(rawLine || "").split("|");
  const eventType = String(parts[1] || "").trim();
  if (
    eventType !== "EXCEPTION_THROWN" &&
    eventType !== "FATAL_ERROR" &&
    !eventType.startsWith("VALIDATION_")
  )
    return null;
  return {
    eventType,
    fields: parts
      .slice(3)
      .map((p) => String(p || "").trim())
      .filter(Boolean),
  };
}

// Apex toString() format: USER_DEBUG messages using '=' as key-value separator.
// Handles both map format  {key=SObjectType:{field=value, ...}, ...}
// and list/set format    (SObjectType:{field=value, ...}, SObjectType:{...}, ...)
function extractApexSpanFromLine(rawLine) {
  const parts = String(rawLine || "").split("|");
  const eventType = String(parts[1] || "").trim();
  const allowedTypes = ["FLOW_VALUE_ASSIGNMENT", "VARIABLE_ASSIGNMENT"];
  if (!isUserDebugEventType(eventType) && !allowedTypes.includes(eventType))
    return null;
  if (parts.length < 5) return null;
  const message = parts.slice(4).join("|").trim();

  const typedWrapper = message.match(/[A-Za-z_][A-Za-z0-9_]*\s*:\s*[[{(]/);
  let start = -1;
  if (typedWrapper && typedWrapper.index !== undefined) {
    start = typedWrapper.index + typedWrapper[0].length - 1;
  } else {
    const braceIdx = message.indexOf("{");
    const parenIdx = message.indexOf("(");
    const bracketIdx = message.indexOf("[");
    start =
      [braceIdx, parenIdx, bracketIdx]
        .filter((idx) => idx >= 0)
        .sort((a, b) => a - b)[0] ?? -1;
  }
  if (start < 0) return null;

  // Walk forward with mixed-bracket depth tracking.
  const pairOpen = new Set(["{", "[", "("]);
  const pairClose = new Map([
    ["}", "{"],
    ["]", "["],
    [")", "("],
  ]);
  const stack = [];
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < message.length; i += 1) {
    const ch = message[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (pairOpen.has(ch)) {
      stack.push(ch);
      continue;
    }
    if (pairClose.has(ch)) {
      const expected = pairClose.get(ch);
      const top = stack[stack.length - 1];
      if (top !== expected) return null;
      stack.pop();
      if (stack.length === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  const span = message.slice(start, end + 1);
  const inner = span.slice(1, -1).trim();
  const looksKeyValue = /\w+\s*=\s*[^,)\]}]+/.test(span);
  const hasQuotedJsonKey = /"\s*:/.test(inner);
  const hasEquals = inner.includes("=");
  const hasColon = inner.includes(":");
  const hasComma = inner.includes(",");
  const hasIdLikeToken = /\b[A-Za-z0-9]{15,18}\b/.test(inner);
  const looksApexCollection =
    !hasQuotedJsonKey &&
    !hasEquals &&
    !hasColon &&
    (hasComma || hasIdLikeToken);
  const looksTypedWrapper = /[A-Za-z_]\w*\s*:\s*[[{(]/.test(message);
  if (!looksKeyValue && !looksApexCollection && !looksTypedWrapper) return null;
  return span;
}

function canFormatApex(rawLine) {
  return extractApexSpanFromLine(rawLine) !== null;
}

// Format an Apex toString() span with indentation.
// Handles both {key=value, ...} map format and (Type:{...}, ...) list format.
// Splits at "," at the current depth level and adds a newline + indent.
function formatApexObjectPretty(text) {
  const t = String(text || "").trim();
  const first = t[0];
  if (first !== "{" && first !== "(" && first !== "[") return t;
  let result = "";
  let indent = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "{" || ch === "(" || ch === "[") {
      indent++;
      result += ch + "\n" + "  ".repeat(indent);
    } else if (ch === "}" || ch === ")" || ch === "]") {
      indent--;
      result += "\n" + "  ".repeat(Math.max(0, indent)) + ch;
    } else if (ch === "," && indent > 0) {
      result += ",\n" + "  ".repeat(indent);
      // consume following spaces
      while (i + 1 < t.length && t[i + 1] === " ") i++;
    } else {
      result += ch;
    }
  }
  return result;
}

function formatApexPretty(rawLine) {
  const span = extractApexSpanFromLine(rawLine);
  if (!span) return null;
  return formatApexObjectPretty(span);
}

// Detect USER_DEBUG messages containing a log-line RANGE like "line:115-189" or "lines:115-189".
// Single-line refs ("line:1857") and comma-lists ("lines:212,456") are intentionally excluded.
function extractLogLineRangeFromLine(rawLine) {
  const parts = String(rawLine || "").split("|");
  if (!isUserDebugEventType(String(parts[1] || "").trim())) return null;
  if (parts.length < 5) return null;
  const message = parts.slice(4).join("|");
  const m = message.match(/\blines?:(\d+)-(\d+)\b/);
  if (!m) return null;
  const from = Number(m[1]);
  const to = Number(m[2]);
  return from > 0 && to >= from ? { from, to } : null;
}

function rawPrettyKindForLine(rawLine) {
  if (extractLogLineRangeFromLine(rawLine)) return "range";
  if (canFormatApex(rawLine)) return "apex";
  if (extractJsonCandidatesFromRawLine(rawLine).length > 0) return "json";
  if (extractSoqlFromRawLine(rawLine)) return "soql";
  if (extractSoslFromRawLine(rawLine)) return "sosl";
  if (extractSoqlExplainFromRawLine(rawLine)) return "soql-explain";
  if (extractIntegrationFromRawLine(rawLine)) return "integration";
  if (extractExceptionFromRawLine(rawLine)) return "exception";
  return null;
}

// Split a string at commas that are at paren-depth 0 (skips commas inside subqueries).
function splitTopLevelCommas(str) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")") depth--;
    else if (str[i] === "," && depth === 0) {
      parts.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(str.slice(start).trim());
  return parts.filter(Boolean);
}

// Find the index of the top-level FROM keyword (not inside parentheses).
function findTopLevelFrom(str) {
  let depth = 0;
  const upper = str.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")") depth--;
    else if (
      depth === 0 &&
      upper.slice(i, i + 4) === "FROM" &&
      /\s/.test(upper[i + 4] || " ") &&
      (i === 0 || /\s/.test(str[i - 1]))
    ) {
      return i;
    }
  }
  return -1;
}

// Recursively format a SOQL subquery "(SELECT ... FROM ...)" with the given field-level indent.
function formatSoqlSubquery(subquery, fieldIndent) {
  const inner = subquery.slice(1, subquery.lastIndexOf(")")).trim();
  const formatted = formatSoqlCore(inner, fieldIndent);
  return fieldIndent + "(" + formatted + "\n" + fieldIndent + ")";
}

// Core SOQL formatter. indent = prefix used for FROM/WHERE/etc.; fields are at indent+"  ".
function formatSoqlCore(normalized, indent) {
  const upper = normalized.toUpperCase();
  if (!upper.startsWith("SELECT ")) return indent + normalized;
  const afterSelect = normalized.slice(7); // skip "SELECT "
  const fromIdx = findTopLevelFrom(afterSelect);
  if (fromIdx < 0) return "SELECT " + afterSelect;

  const fieldStr = afterSelect.slice(0, fromIdx).trimEnd();
  let tail = afterSelect.slice(fromIdx + 5).trimStart(); // skip "FROM "

  const fieldIndent = indent + "  ";
  const fields = splitTopLevelCommas(fieldStr);
  const formattedFields = fields
    .map((f) => {
      const trimmed = f.trim();
      return /^\(SELECT\s/i.test(trimmed)
        ? formatSoqlSubquery(trimmed, fieldIndent)
        : fieldIndent + trimmed;
    })
    .join(",\n");

  tail = tail.replace(
    /\s+(WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|OFFSET|FOR UPDATE|USING SCOPE|TYPEOF|WITH SECURITY_ENFORCED|WITH USER_MODE|WITH SYSTEM_MODE)\b/gi,
    "\n" + indent + "$1",
  );
  tail = tail.replace(/\s+(AND|OR)\s+/gi, "\n" + fieldIndent + "$1 ");

  return `SELECT\n${formattedFields}\n${indent}FROM ${tail}`;
}

function formatSoqlPretty(rawLine) {
  const source = extractSoqlFromRawLine(rawLine);
  if (!source) return null;
  const normalized = source.replace(/\s+/g, " ").trim();
  return formatSoqlCore(normalized, "").trim();
}

function formatSoslPretty(rawLine) {
  const source = extractSoslFromRawLine(rawLine);
  if (!source) return null;
  const normalized = source.replace(/\s+/g, " ").trim();
  return normalized
    .replace(/\s+(RETURNING|WITH|LIMIT|OFFSET|IN\s+ALL\s+FIELDS)\b/gi, "\n$1")
    .replace(/\s*,\s*/g, ",\n  ")
    .trim();
}

function formatSoqlExplainPretty(rawLine) {
  const source = extractSoqlExplainFromRawLine(rawLine);
  if (!source) return null;
  const normalized = source.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const pieces = normalized
    .split(/\s*;\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (pieces.length <= 1) return normalized;
  return pieces.join("\n");
}

function formatSoqlResultPretty(rawLine) {
  const fields = extractSoqlResultFromRawLine(rawLine);
  if (!fields || fields.length === 0) return null;
  return fields.join("\n");
}

function formatSoslResultPretty(rawLine) {
  const fields = extractSoslResultFromRawLine(rawLine);
  if (!fields || fields.length === 0) return null;
  return fields.join("\n");
}

function formatDmlPretty(rawLine) {
  const dml = extractDmlFromRawLine(rawLine);
  if (!dml) return null;
  const lines = [`Event: ${dml.eventType}`];
  if (dml.operation) lines.push(`Operation: ${dml.operation}`);
  if (dml.sObject) lines.push(`Object: ${dml.sObject}`);
  if (dml.rows) lines.push(`Rows: ${dml.rows}`);
  if (dml.fields.length > 3) {
    for (const field of dml.fields.slice(3)) lines.push(`Detail: ${field}`);
  }
  return lines.join("\n");
}

function formatIntegrationPretty(rawLine) {
  const integration = extractIntegrationFromRawLine(rawLine);
  if (!integration) return null;
  const text = integration.body;
  const methodMatch = text.match(
    /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/i,
  );
  const urlMatch = text.match(/https?:\/\/[^\s|]+/i);
  const statusMatch = text.match(
    /\b(?:status(?:Code)?|http)\s*[:=]?\s*(\d{3})\b/i,
  );
  const lines = [`Event: ${integration.eventType}`];
  if (methodMatch) lines.push(`Method: ${methodMatch[1].toUpperCase()}`);
  if (urlMatch) lines.push(`Endpoint: ${urlMatch[0]}`);
  if (statusMatch) lines.push(`Status: ${statusMatch[1]}`);
  if (!methodMatch && !urlMatch && !statusMatch) {
    for (const field of integration.fields) lines.push(`Detail: ${field}`);
  }
  return lines.join("\n");
}

function formatExceptionPretty(rawLine) {
  const ex = extractExceptionFromRawLine(rawLine);
  if (!ex) return null;
  const lines = [`Event: ${ex.eventType}`];
  for (const field of ex.fields) lines.push(`Detail: ${field}`);
  return lines.join("\n");
}

function getPrettyPayloadForRawLine(rawLine) {
  const key = String(rawLine || "");
  if (prettyPayloadCache.has(key)) {
    // LRU: move to end on hit
    const v = prettyPayloadCache.get(key);
    prettyPayloadCache.delete(key);
    prettyPayloadCache.set(key, v);
    return v;
  }

  const kind = rawPrettyKindForLine(rawLine);
  if (!kind) {
    prettyPayloadCache.set(key, null);
    return null;
  }

  let payload = null;
  if (kind === "json") {
    const json = formatJsonPretty(rawLine);
    payload = {
      kind,
      status: json.status || "error",
      reason: json.reason || null,
      warnings: Array.isArray(json.warnings) ? json.warnings.slice(0, 8) : [],
      text: json.text || null,
    };
  } else if (kind === "soql") {
    const text = formatSoqlPretty(rawLine);
    payload = {
      kind,
      status: text ? "formatted" : "error",
      reason: text ? null : "SOQL parse unavailable.",
      warnings: [],
      text,
    };
  } else if (kind === "sosl") {
    const text = formatSoslPretty(rawLine);
    payload = {
      kind,
      status: text ? "formatted" : "error",
      reason: text ? null : "SOSL parse unavailable.",
      warnings: [],
      text,
    };
  } else if (kind === "sosl-result") {
    const text = formatSoslResultPretty(rawLine);
    payload = {
      kind,
      status: text ? "formatted" : "error",
      reason: text ? null : "SOSL result details unavailable.",
      warnings: [],
      text,
    };
  } else if (kind === "soql-explain") {
    const text = formatSoqlExplainPretty(rawLine);
    payload = {
      kind,
      status: text ? "formatted" : "error",
      reason: text ? null : "SOQL explain details unavailable.",
      warnings: [],
      text,
    };
  } else if (kind === "soql-result") {
    const text = formatSoqlResultPretty(rawLine);
    payload = {
      kind,
      status: text ? "formatted" : "error",
      reason: text ? null : "SOQL result details unavailable.",
      warnings: [],
      text,
    };
  } else if (kind === "dml") {
    const text = formatDmlPretty(rawLine);
    payload = {
      kind,
      status: text ? "formatted" : "error",
      reason: text ? null : "DML details unavailable.",
      warnings: [],
      text,
    };
  } else if (kind === "integration") {
    const text = formatIntegrationPretty(rawLine);
    payload = {
      kind,
      status: text ? "formatted" : "error",
      reason: text ? null : "Integration details unavailable.",
      warnings: [],
      text,
    };
  } else if (kind === "exception") {
    const text = formatExceptionPretty(rawLine);
    payload = {
      kind,
      status: text ? "formatted" : "error",
      reason: text ? null : "Exception details unavailable.",
      warnings: [],
      text,
    };
  } else if (kind === "apex") {
    const text = formatApexPretty(rawLine);
    payload = {
      kind,
      status: text ? "formatted" : "error",
      reason: text ? null : "Apex object parse unavailable.",
      warnings: [],
      text,
    };
  } else if (kind === "range") {
    payload = {
      kind,
      status: "formatted",
      reason: null,
      warnings: [],
      text: null,
    };
  }

  // Hide the format button entirely if the parsed payload is functionally empty
  if (payload && payload.text && typeof payload.text === "string") {
    // Strip whitespace and newlines for the check
    const squashed = payload.text.replace(/\s+/g, "");
    if (
      squashed === "{}" ||
      squashed === "[]" ||
      squashed === "()" ||
      squashed === ""
    ) {
      payload = null;
    }
  }

  prettyPayloadCache.set(key, payload);
  // LRU eviction: discard oldest entry when cap exceeded
  if (prettyPayloadCache.size > PRETTY_CACHE_MAX) {
    prettyPayloadCache.delete(prettyPayloadCache.keys().next().value);
  }
  return payload;
}

// ─── Pretty block button SVG icons ───────────────────────────────────────────
// Stroke-based icons matching the homepage section icon style (14×14, currentColor).

const PRETTY_ICON_CODE = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
const PRETTY_ICON_CLOSE = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const PRETTY_ICON_COPY = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M 4 16 C 2.9 16 2 15.1 2 14 V 4 C 2 2.9 2.9 2 4 2 H 14 C 15.1 2 16 2.9 16 4"/></svg>`;

function rawLineHtml(lineNumber, lineText, cls) {
  let finalCls = cls;
  if (lineText.includes("|DML_BEGIN|")) {
    finalCls += " rawLineDml";
  } else if (lineText.includes("|SOQL_EXECUTE_BEGIN|")) {
    finalCls += " rawLineSoql";
  } else if (
    lineText.includes("|METHOD_ENTRY|") ||
    lineText.includes("|CONSTRUCTOR_ENTRY|")
  ) {
    finalCls += " rawLineApex";
  }

  const payload = getPrettyPayloadForRawLine(lineText);
  const kind = payload?.kind || null;
  const prettyLabel =
    kind === "json"
      ? "Pretty JSON"
      : kind === "soql"
        ? "Pretty SOQL"
        : kind === "sosl"
          ? "Pretty SOSL"
          : kind === "sosl-result"
            ? "SOSL Result Summary"
            : kind === "soql-explain"
              ? "Pretty SOQL Explain"
              : kind === "soql-result"
                ? "SOQL Result Summary"
                : kind === "dml"
                  ? "DML Summary"
                  : kind === "integration"
                    ? "Integration Summary"
                    : kind === "exception"
                      ? "Exception Summary"
                      : kind === "apex"
                        ? "Pretty Apex"
                        : kind === "range"
                          ? "Show log line range"
                          : "";
  let rangeAttr = "";
  if (kind === "range") {
    const range = extractLogLineRangeFromLine(lineText);
    if (range) rangeAttr = ` data-pretty-range="${range.from}-${range.to}"`;
  }

  const isExpanded = expandedRawLineNumbers.has(lineNumber);
  let prefillHtml = "";
  if (isExpanded) {
    let formatted = null;
    if (kind === "range") {
      const range = extractLogLineRangeFromLine(lineText);
      const from = range ? Math.max(1, range.from) : 0;
      const to = range ? Math.min(currentRawLogLines.length, range.to) : 0;
      if (from > 0 && to >= from) {
        const lines = [];
        const hardEnd = Math.min(to, from + PRETTY_MAX_RANGE_LINES - 1);
        for (let i = from; i <= hardEnd; i += 1)
          lines.push(`${i}: ${currentRawLogLines[i - 1] || ""}`);
        if (hardEnd < to) {
          lines.push("");
          lines.push(
            `... [truncated range: showing ${PRETTY_MAX_RANGE_LINES.toLocaleString()} of ${(to - from + 1).toLocaleString()} lines]`,
          );
        }
        formatted = lines.join("\n");
      }
    } else {
      formatted = payload?.text || null;
    }
    const out = [];
    if (Array.isArray(payload?.warnings) && payload.warnings.length > 0) {
      out.push(
        `Warnings:\n${payload.warnings.map((item) => `- ${item}`).join("\n")}`,
      );
    }
    if (payload?.reason) out.push(payload.reason);
    if (formatted) out.push(formatted);
    prefillHtml = escapeHtml(out.filter(Boolean).join("\n\n"));
  }

  const prettyControls = kind
    ? `<button class="rawPrettyBtn" type="button" data-pretty-kind="${kind}" data-pretty-status="${escapeHtml(payload?.status || "formatted")}" data-pretty-line="${lineNumber}"${rangeAttr} data-pretty-label="${prettyLabel}" title="${isExpanded ? `Close ${prettyLabel}` : prettyLabel}" aria-label="${isExpanded ? `Close ${prettyLabel}` : prettyLabel}" aria-expanded="${isExpanded ? "true" : "false"}"><span class="rawPrettyIcon">${isExpanded ? PRETTY_ICON_CLOSE : PRETTY_ICON_CODE}</span></button><div class="rawPrettyCard"${isExpanded ? "" : " hidden"}><button class="rawPrettyCopyBtn" type="button" title="Copy pretty output (applies PHI/PII redaction settings)" aria-label="Copy pretty output with PHI and PII redaction">${PRETTY_ICON_COPY}</button><pre class="rawPrettyBlock">${prefillHtml}</pre></div>`
    : "";
  return `<div class="${finalCls}" data-raw-line-number="${lineNumber}"><span class="rawLineNo" title="Raw debug-log line ${lineNumber}">${lineNumber}</span><span class="rawLineText">${escapeHtml(lineText)}</span>${prettyControls}</div>`;
}

function setPrettyToggleState(button, expanded) {
  if (!button) return;
  const baseLabel = String(button.dataset.prettyLabel || "Pretty");
  const icon = button.querySelector(".rawPrettyIcon");
  if (icon) setHtml(icon, expanded ? PRETTY_ICON_CLOSE : PRETTY_ICON_CODE);
  const title = expanded ? `Close ${baseLabel}` : baseLabel;
  button.setAttribute("title", title);
  button.setAttribute("aria-label", title);
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
}

// Public wrapper — always syncs copy buttons and search button label exactly once
// after rendering, regardless of which exit path the core function takes.
function renderRawLogSearchResults(query) {
  _renderRawLogSearchCore(query);
  syncRawCopyButtons();
  syncRawSearchButtonLabel();
}

function _renderRawLogSearchCore(query) {
  const q = normalizeRawSearchQuery(query);
  if (rawSearchInput && rawSearchInput.value !== q) {
    rawSearchInput.value = q;
  }
  const userDebugOnly = isUserDebugOnlyMode();
  const errorsOnly = isErrorsOnlyMode();
  // Capture toggle state BEFORE syncRawControlsFromQuery, which resets the
  // toggle for empty queries. This allows the All Lines checkbox to control
  // all-lines mode with a blank search box.
  const showAllFromToggle = Boolean(rawShowAllToggle?.checked);
  const forceClear = shouldForceClearButtonForQuery(q);
  syncRawControlsFromQuery(q);
  if (!currentRawLogLines.length) {
    setRawStatus(
      "Raw log file not found for this report.",
      "Hint: Load a .log file, then run search.",
    );
    setHtml(rawLogText, "");
    setRawClearButtonVisibility(false);
    return;
  }

  const renderRawLineRange = (
    startLine,
    endLine,
    statusBuilder,
    exactMatches = new Set(),
  ) => {
    const start = Math.max(1, Math.min(currentRawLogLines.length, startLine));
    const end = Math.max(start, Math.min(currentRawLogLines.length, endLine));
    const rows = [];
    for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
      const lineText = String(currentRawLogLines[lineNumber - 1] || "");
      if (userDebugOnly && !isUserDebugLine(lineText)) continue;
      if (errorsOnly && !isErrorLine(lineText)) continue;
      const isExact = exactMatches.has(lineNumber);
      const isErr = errorsOnly && isErrorLine(lineText);
      const cls = isExact
        ? "rawLine rawLineMatch"
        : isErr
          ? "rawLine rawLineError"
          : "rawLine";
      rows.push(rawLineHtml(lineNumber, lineText, cls));
    }
    if (rows.length === 0) {
      setRawStatus(
        userDebugOnly
          ? `No ${USER_DEBUG_LABEL.toLowerCase()} lines in this range.`
          : errorsOnly
            ? "No error lines in this range."
            : "No lines in this range.",
      );
      setHtml(rawLogText, "<p>No matches.</p>");
      setRawClearButtonVisibility(forceClear);
      return;
    }
    setRawStatus(
      typeof statusBuilder === "function"
        ? statusBuilder(start, end)
        : String(statusBuilder || ""),
    );
    setHtml(rawLogText, rows.join(""));
    setRawClearButtonVisibility(forceClear);
  };

  if (!q) {
    const rows = [];
    const maxRows =
      userDebugOnly || errorsOnly || showAllFromToggle
        ? Number.POSITIVE_INFINITY
        : DEFAULT_RAW_PREVIEW_LINES;
    for (let i = 0; i < currentRawLogLines.length; i += 1) {
      const lineText = String(currentRawLogLines[i] || "");
      if (userDebugOnly && !isUserDebugLine(lineText)) continue;
      if (errorsOnly && !isErrorLine(lineText)) continue;
      const lineNumber = i + 1;
      const cls = errorsOnly ? "rawLine rawLineError" : "rawLine";
      rows.push(rawLineHtml(lineNumber, lineText, cls));
      if (rows.length >= maxRows) break;
    }
    setRawStatus(
      userDebugOnly
        ? `Showing ${rows.length} ${USER_DEBUG_LABEL.toLowerCase()} lines.`
        : errorsOnly
          ? `Showing ${rows.length} error lines.`
          : showAllFromToggle
            ? `Showing all ${rows.length} lines.`
            : `Showing first ${rows.length} of ${currentRawLogLines.length} log lines. Search to narrow the log or select All lines to render the full file.`,
    );
    setHtml(
      rawLogText,
      rows.length > 0
        ? rows.join("")
        : userDebugOnly
          ? `<p>No ${USER_DEBUG_LABEL.toLowerCase()} lines found.</p>`
          : errorsOnly
            ? "<p>No error lines found.</p>"
            : "<p>No lines.</p>",
    );
    setRawClearButtonVisibility(false);
    return;
  }

  const allSyntax = isAllLinesQuery(q);
  if (allSyntax) {
    renderRawLineRange(1, currentRawLogLines.length, () =>
      userDebugOnly
        ? `Showing all ${USER_DEBUG_LABEL.toLowerCase()} lines.`
        : errorsOnly
          ? "Showing all error lines."
          : `Showing all ${currentRawLogLines.length} lines.`,
    );
    return;
  }

  const scopedRangeQuery = parseScopedTextRangeQuery(q);
  if (scopedRangeQuery) {
    const start = Math.max(
      1,
      Math.min(currentRawLogLines.length, scopedRangeQuery.start),
    );
    const end = Math.max(
      start,
      Math.min(currentRawLogLines.length, scopedRangeQuery.end),
    );
    const termLower = scopedRangeQuery.term.toLowerCase();
    let matchCount = 0;
    const rows = [];
    for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
      const lineText = String(currentRawLogLines[lineNumber - 1] || "");
      if (userDebugOnly && !isUserDebugLine(lineText)) continue;
      if (errorsOnly && !isErrorLine(lineText)) continue;
      const isMatch = lineText.toLowerCase().includes(termLower);
      if (isMatch) matchCount += 1;
      const isErr = errorsOnly && isErrorLine(lineText);
      const cls = isMatch
        ? "rawLine rawLineMatch"
        : isErr
          ? "rawLine rawLineError"
          : "rawLine rawLineContext";
      rows.push(rawLineHtml(lineNumber, lineText, cls));
    }
    if (rows.length === 0) {
      setRawStatus(
        userDebugOnly
          ? `No ${USER_DEBUG_LABEL.toLowerCase()} lines in lines ${start}-${end}.`
          : errorsOnly
            ? `No error lines in lines ${start}-${end}.`
            : `No lines in lines ${start}-${end}.`,
      );
      setHtml(rawLogText, "<p>No matches.</p>");
      setRawClearButtonVisibility(true);
      return;
    }
    setRawStatus(
      `Matches: ${matchCount} for "${scopedRangeQuery.term}" within lines ${start}-${end}.`,
      buildScopedHint(scopedRangeQuery.term, [{ start, end }]),
    );
    setHtml(rawLogText, rows.join(""));
    setRawClearButtonVisibility(true);
    return;
  }

  const contextRows = getSelectedContextRows();

  const singleLineSyntax = q.match(/^(?:log|lines?)\s*:\s*(\d+)\s*$/i);
  if (singleLineSyntax) {
    const line = Number(singleLineSyntax[1]);
    const start = Math.max(1, line - contextRows);
    const end = Math.min(currentRawLogLines.length, line + contextRows);
    renderRawLineRange(
      start,
      end,
      () =>
        contextRows > 0
          ? `Showing log line ${line} with +/-${contextRows} log lines.`
          : `Showing log line ${line}.`,
      new Set([line]),
    );
    return;
  }

  const rangeSyntax = q.match(/^lines?\s*:\s*(\d+)\s*-\s*(\d+)$/i);
  if (rangeSyntax) {
    const requestedStart = Number(rangeSyntax[1]);
    const requestedEnd = Number(rangeSyntax[2]);
    const startObj = Math.min(requestedStart, requestedEnd);
    const endObj = Math.max(requestedStart, requestedEnd);
    const start = Math.max(1, startObj - contextRows);
    const end = Math.min(currentRawLogLines.length, endObj + contextRows);

    // Exact matches inside the user's requested range
    const exactMatches = new Set();
    for (let i = startObj; i <= endObj; i += 1) exactMatches.add(i);

    renderRawLineRange(
      start,
      end,
      () =>
        contextRows > 0
          ? `Showing lines ${startObj}-${endObj} with +/-${contextRows} lines.`
          : `Showing lines ${startObj}-${endObj}.`,
      exactMatches,
    );
    return;
  }

  const lineListSyntax = q.match(/^lines?\s*:\s*(\d+(?:\s*,\s*\d+)+)\s*$/i);
  if (lineListSyntax) {
    const requested = lineListSyntax[1]
      .split(",")
      .map((token) => Number(token.trim()))
      .filter((n) => Number.isFinite(n) && n >= 1)
      .map((n) => Math.min(currentRawLogLines.length, n));
    const uniqueLines = Array.from(new Set(requested)).sort((a, b) => a - b);

    if (uniqueLines.length === 0) {
      setRawStatus(`No lines found for "${q}".`);
      setHtml(rawLogText, "<p>No matches.</p>");
      setRawClearButtonVisibility(forceClear);
      return;
    }

    const exactMatches = new Set(uniqueLines);
    const ranges = uniqueLines
      .map((line) => ({
        start: Math.max(1, line - contextRows),
        end: Math.min(currentRawLogLines.length, line + contextRows),
      }))
      .sort((a, b) => a.start - b.start);

    const merged = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (!last || range.start > last.end + 1) {
        merged.push({ ...range });
      } else {
        last.end = Math.max(last.end, range.end);
      }
    }

    const rows = [];
    for (let i = 0; i < merged.length; i += 1) {
      const range = merged[i];
      for (
        let lineNumber = range.start;
        lineNumber <= range.end;
        lineNumber += 1
      ) {
        const lineText = String(currentRawLogLines[lineNumber - 1] || "");
        if (userDebugOnly && !isUserDebugLine(lineText)) continue;
        if (errorsOnly && !isErrorLine(lineText)) continue;
        const isExact = exactMatches.has(lineNumber);
        const isErr = errorsOnly && isErrorLine(lineText);
        const cls = isExact
          ? isErr
            ? "rawLine rawLineMatch rawLineError"
            : "rawLine rawLineMatch"
          : isErr
            ? "rawLine rawLineError"
            : "rawLine rawLineContext";
        rows.push(rawLineHtml(lineNumber, lineText, cls));
      }
      if (i < merged.length - 1) {
        rows.push(`<div class="rawSearchGap">...</div>`);
      }
    }

    if (rows.length === 0) {
      setRawStatus(
        userDebugOnly
          ? `No ${USER_DEBUG_LABEL.toLowerCase()} lines matched this query.`
          : errorsOnly
            ? "No error lines matched this query."
            : "No matches.",
      );
      setHtml(rawLogText, "<p>No matches.</p>");
      setRawClearButtonVisibility(forceClear);
      return;
    }
    const debugLabel = userDebugOnly
      ? `${USER_DEBUG_LABEL} `
      : errorsOnly
        ? "error "
        : "";
    setRawStatus(
      contextRows > 0
        ? `Showing ${debugLabel}lines ${uniqueLines.join(", ")} with +/-${contextRows} lines.`
        : `Showing ${debugLabel}lines ${uniqueLines.join(", ")}.`,
    );
    setHtml(rawLogText, rows.join(""));
    setRawClearButtonVisibility(forceClear);
    return;
  }
  const qLower = q.toLowerCase();
  const lineSyntax = q.match(/^(?:log|line)\s*:\s*(\d+)$/i);
  const qIsInt = /^\d+$/.test(q);
  const qLine = lineSyntax ? Number(lineSyntax[1]) : qIsInt ? Number(q) : null;
  const exactLineOnly = Boolean(lineSyntax);
  const matches = [];
  for (let i = 0; i < currentRawLogLines.length; i += 1) {
    const lineNumber = i + 1;
    const lineText = String(currentRawLogLines[i] || "");
    if (userDebugOnly && !isUserDebugLine(lineText)) continue;
    if (errorsOnly && !isErrorLine(lineText)) continue;
    const textMatch = exactLineOnly
      ? false
      : lineText.toLowerCase().includes(qLower);
    const lineMatch =
      qLine !== null ? lineNumber === qLine : String(lineNumber).includes(q);
    if (textMatch || lineMatch) {
      matches.push({ lineNumber, lineText });
    }
  }

  if (matches.length === 0) {
    setRawStatus(`Matches: 0 for "${q}"`, buildScopedHint(q));
    setHtml(rawLogText, "<p>No matches.</p>");
    setRawClearButtonVisibility(forceClear);
    return;
  }

  const matchLines = new Set(matches.map((m) => m.lineNumber));
  const ranges = matches
    .map((m) => ({
      start: Math.max(1, m.lineNumber - contextRows),
      end: Math.min(currentRawLogLines.length, m.lineNumber + contextRows),
    }))
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end + 1) {
      merged.push({ ...range });
    } else {
      last.end = Math.max(last.end, range.end);
    }
  }

  const rows = [];
  for (let i = 0; i < merged.length; i += 1) {
    const range = merged[i];
    for (
      let lineNumber = range.start;
      lineNumber <= range.end;
      lineNumber += 1
    ) {
      const lineText = String(currentRawLogLines[lineNumber - 1] || "");
      if (userDebugOnly && !isUserDebugLine(lineText)) continue;
      const isMatch = matchLines.has(lineNumber);
      const isErr = errorsOnly && isErrorLine(lineText);
      let cls;
      if (isMatch)
        cls = isErr
          ? "rawLine rawLineMatch rawLineError"
          : "rawLine rawLineMatch";
      else if (isErr) cls = "rawLine rawLineError";
      else cls = "rawLine rawLineContext";
      rows.push(rawLineHtml(lineNumber, lineText, cls));
    }
    if (i < merged.length - 1) {
      rows.push(`<div class="rawSearchGap">...</div>`);
    }
  }

  if (rows.length === 0) {
    setRawStatus(
      userDebugOnly
        ? `No ${USER_DEBUG_LABEL.toLowerCase()} lines matched this query.`
        : errorsOnly
          ? "No error lines matched this query."
          : `No matches for "${q}".`,
    );
    setHtml(rawLogText, "<p>No matches.</p>");
    setRawClearButtonVisibility(forceClear);
    return;
  }
  const debugLabel = userDebugOnly
    ? `${USER_DEBUG_LABEL} `
    : errorsOnly
      ? "error "
      : "";
  setRawStatus(
    `Matches: ${matches.length} ${debugLabel}for "${q}" with +/-${contextRows} lines`,
    buildScopedHint(q, merged),
  );
  setHtml(rawLogText, rows.join(""));
  setRawClearButtonVisibility(true);
}

function setViewModeFromHash() {
  const hash = String(window.location.hash || "");
  const hashBase = hash.split("?")[0];
  const mode = (() => {
    switch (hashBase) {
      case "#execution":
      case "#execution-story":
        return "execution-story";
      case "#evidence":
      case "#raw-log":
        return "evidence";
      case "#data":
        return "data";
      case "#diagnostics":
        return "diagnostics";
      case "#triage":
      case "#report":
      case "":
      default:
        return "triage";
    }
  })();
  const rawMode = mode === "evidence";
  const executionStoryMode = mode === "execution-story";
  const triageMode = mode === "triage";
  const dataMode = mode === "data";
  const diagnosticsMode = mode === "diagnostics";
  const reportMode = triageMode || dataMode || diagnosticsMode;
  document.body.classList.toggle("report-mode", reportMode);
  document.body.classList.toggle("execution-story-mode", executionStoryMode);
  document.body.classList.toggle("raw-log-mode", rawMode);
  document.body.classList.toggle("triage-mode", triageMode);
  document.body.classList.toggle("data-mode", dataMode);
  document.body.classList.toggle("diagnostics-mode", diagnosticsMode);
  triageSummaryTabLink?.classList.toggle("activeTab", triageMode);
  executionStoryTabLink?.classList.toggle("activeTab", executionStoryMode);
  dataLimitsTabLink?.classList.toggle("activeTab", dataMode);
  diagnosticsTabLink?.classList.toggle("activeTab", diagnosticsMode);
  logExplorerTabLink?.classList.toggle("activeTab", rawMode);
  if (rawLogPanel) rawLogPanel.hidden = !rawMode;
  if (rawMode) {
    const hashQuery = getRawLogQueryFromHash(hash);
    if (hashQuery) {
      // When arriving via a line link from another view (e.g. Execution Story → line:N),
      // clear all filter toggles so the jump lands on the clean log, not a filtered subset.
      // Without this, an active User Debug / Errors / All Lines filter persists into the jump.
      if (rawUserDebugOnlyToggle) rawUserDebugOnlyToggle.checked = false;
      if (rawErrorsToggle) rawErrorsToggle.checked = false;
      if (rawShowAllToggle) rawShowAllToggle.checked = false;
      if (rawSearchInput) rawSearchInput.value = hashQuery;
      renderRawLogSearchResults(hashQuery);
    } else {
      renderRawLogSearchResults(rawSearchInput?.value || "");
    }
    if (rawLogBody) rawLogBody.hidden = false;
    window.scrollTo(0, 0);
    return;
  }
  if (executionStoryMode) {
    window.scrollTo(0, 0);
    return;
  }
  window.scrollTo(0, 0);
}

function openRawLogQuery(query) {
  const nextQuery = String(query || "");
  const nextHash = buildRawLogHref(nextQuery, "#evidence");
  if (rawSearchInput) rawSearchInput.value = nextQuery;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
  setViewModeFromHash();
  renderRawLogSearchResults(nextQuery);
}

function goToTriageSummary(event) {
  event?.preventDefault?.();
  if (window.location.hash !== "#triage") {
    window.location.hash = "#triage";
  }
  setViewModeFromHash();
}

function renderOverviewPanel(target, report) {
  const context = getReportContext(report);
  const entryPoint = getReportEntryPoint(report);
  const database = getReportDatabase(report);
  const issues = getReportIssues(report);
  const errors = issues.filter((item) => !isWarningItem(item));
  const warnings = issues.filter((item) => isWarningItem(item));

  const derivedDurationMs = durationMsFromTransactionTimes(
    context?.transaction?.startTimestamp,
    context?.transaction?.endTimestamp,
  );
  // Use || (not ??) so that 0 from identical wall-clock timestamps falls through
  // to the report's computed durationMs (which uses ns counters).
  const durationMs =
    derivedDurationMs ||
    (Number.isFinite(Number(context?.transaction?.durationMs)) &&
    Number(context?.transaction?.durationMs) > 0
      ? Number(context?.transaction?.durationMs)
      : null);
  const transactionLimits =
    getReportGovernorLimits(report)?.current?.defaultNamespace || {};
  const recordedLimitValue = (key) => {
    const value = Number(transactionLimits?.[key]?.used);
    return Number.isFinite(value) ? value : null;
  };
  const cpuMs =
    Number(context?.transaction?.cpuTimeMs) ||
    recordedLimitValue("cpuTimeMs") ||
    null;

  const entryName = entryPoint?.name || "-";
  const entryType = String(
    entryPoint?.type || context?.transaction?.requestType || "Unknown",
  )
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  const parsedUser = parseUserInfoFromRawLog(currentRawLogLines);
  const user =
    context?.user?.username ||
    context?.user?.userId ||
    parsedUser.username ||
    parsedUser.userId ||
    "-";
  const startedAt =
    String(context?.transaction?.startTimestamp || "")
      .replace("T", " ")
      .trim() || "-";

  const soql = database.soql;
  const dml = database.dml;
  const soqlCount = recordedLimitValue("soqlQueries") ?? soql.length;
  const totalSoqlRows =
    recordedLimitValue("soqlRows") ??
    soql.reduce((sum, q) => sum + Number(q.rows || 0), 0);
  const dmlCount = recordedLimitValue("dmlStatements") ?? dml.length;
  const totalDmlRows =
    recordedLimitValue("dmlRows") ??
    dml.reduce((sum, d) => sum + Number(d.rows || 0), 0);
  const timingEvidenceWarning =
    durationMs !== null && cpuMs !== null && cpuMs > durationMs
      ? `<div class="resultNotice warningNotice"><strong>Timing evidence needs review.</strong> Recorded CPU (${escapeHtml(secondsFromMs(cpuMs))}) exceeds the reconstructed elapsed duration (${escapeHtml(secondsFromMs(durationMs))}). The values may describe different scopes or incomplete timing evidence.</div>`
      : "";
  const topSoql = soql
    .slice()
    .sort((a, b) => Number(b.durationMs || 0) - Number(a.durationMs || 0))
    .slice(0, 10);
  const topDml = dml.slice(0, 10);

  const soqlTableMarkup =
    topSoql.length === 0
      ? ""
      : `
    <div class="rawLogHeader" style="margin-top:24px;">
      <div>
        <h2>SOQL Queries</h2>
        <p class="subheading sectionSubheading">Top ${topSoql.length} longest-running${soql.length > 10 ? ` of ${soql.length}` : ""} recorded query events</p>
      </div>
    </div>
    <div class="tableWrap">
      <table class="queryTable">
        <thead><tr><th>Query</th><th>Rows</th><th>Duration</th></tr></thead>
        <tbody>
          ${topSoql
            .map(
              (q) => `
            <tr>
              <td class="mono smallCopy">${escapeHtml(
                String(q.query || "-")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 150),
              )}</td>
              <td>${displayValue(q.rows)}</td>
              <td>${escapeHtml(secondsFromMs(q.durationMs))}</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  const dmlTableMarkup =
    topDml.length === 0
      ? ""
      : `
    <div class="rawLogHeader" style="margin-top:24px;">
      <div>
        <h2>DML Operations</h2>
        <p class="subheading sectionSubheading">${dml.length} recorded operations</p>
      </div>
    </div>
    <div class="tableWrap">
      <table>
        <thead><tr><th>Operation</th><th>Object</th><th>Rows</th><th>Duration</th></tr></thead>
        <tbody>
          ${topDml
            .map(
              (d) => `
            <tr>
              <td>${escapeHtml(d.operation || "-")}</td>
              <td>${escapeHtml(d.sObject || "-")}</td>
              <td>${displayValue(d.rows)}</td>
              <td>${escapeHtml(secondsFromMs(d.durationMs))}</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  setHtml(
    target,
    `
    <div class="rawLogHeader">
      <div>
        <h2>Overview</h2>
        <p class="subheading sectionSubheading">Transaction summary — suitable for sharing in bug reports</p>
      </div>
      <div class="actionRow">
        <button id="copyOverviewSummaryBtn" class="secondaryBtn" type="button">Copy investigation summary</button>
        <span id="copyOverviewSummaryStatus" class="smallCopy" role="status" aria-live="polite"></span>
      </div>
    </div>
    <div class="overviewSummaryGrid">
      <div class="detailCard">
        <strong>Transaction Identity</strong>
        <p class="smallCopy" style="margin-top:8px;">Entry point</p>
        <div class="mono">${escapeHtml(entryName)}</div>
        <p class="smallCopy">Type</p>
        <div>${escapeHtml(entryType)}</div>
        <p class="smallCopy">User</p>
        <div>${escapeHtml(user)}</div>
        <p class="smallCopy">Started</p>
        <div>${escapeHtml(startedAt)}</div>
      </div>
      <div class="detailCard">
        <strong>Key Metrics</strong>
        <p class="smallCopy" style="margin-top:8px;">Runtime</p>
        <div>${durationMs !== null ? escapeHtml(secondsFromMs(durationMs)) : "-"}</div>
        <p class="smallCopy">CPU</p>
        <div>${cpuMs !== null ? escapeHtml(secondsFromMs(cpuMs)) : "-"}</div>
        <p class="smallCopy">SOQL</p>
        <div>${soqlCount} queries / ${totalSoqlRows} rows</div>
        <p class="smallCopy">DML</p>
        <div>${dmlCount} statements / ${totalDmlRows} rows</div>
        <p class="smallCopy">Issues</p>
        <div>${errors.length} errors, ${warnings.length} warnings</div>
      </div>
    </div>
    ${timingEvidenceWarning}
    <div class="rawLogHeader" style="margin-top:24px;">
      <div>
        <h2>Governor Limits</h2>
        <p class="subheading sectionSubheading">Limit consumption for this transaction</p>
      </div>
    </div>
    <div id="overviewLimitsGrid"></div>
    ${soqlTableMarkup}
    ${dmlTableMarkup}
  `,
  );

  const limitsGrid = target.querySelector("#overviewLimitsGrid");
  if (limitsGrid) {
    renderGovernorLimits(limitsGrid, report);
  }
  const copySummaryButton = target.querySelector("#copyOverviewSummaryBtn");
  const copySummaryStatus = target.querySelector("#copyOverviewSummaryStatus");
  copySummaryButton?.addEventListener("click", async () => {
    const summary = buildInvestigationSummary({
      fileName:
        report?.source?.fileName ||
        report?.source?.input?.fileName ||
        currentReportUrl ||
        "Unknown",
      entryPoint: entryName,
      requestType: entryType,
      user,
      startedAt,
      runtimeMs: durationMs,
      cpuMs,
      soqlCount,
      soqlRows: totalSoqlRows,
      dmlCount,
      dmlRows: totalDmlRows,
      errorCount: errors.length,
      warningCount: warnings.length,
      completeness: report?.metadata?.logCompleteness?.status || "unknown",
    });
    try {
      await copyText(summary);
      if (copySummaryStatus) copySummaryStatus.textContent = "Copied.";
    } catch {
      if (copySummaryStatus) {
        copySummaryStatus.textContent = "Copy failed. Try again.";
      }
    }
  });
}

function render(report, rawLogLines = []) {
  if (report !== currentReportData) {
    prettyPayloadCache.clear();
  }
  currentReportData = report;
  const context = getReportContext(report);
  const entryPoint = getReportEntryPoint(report);
  const execution = getReportExecution(report);
  const database = getReportDatabase(report);
  const governorLimits = getReportGovernorLimits(report);
  const reportIssues = getReportIssues(report);
  const parsedUserInfo = parseUserInfoFromRawLog(rawLogLines);
  const userId = context?.user?.userId ?? parsedUserInfo.userId;
  const username = context?.user?.username ?? parsedUserInfo.username;
  const timezone = context?.user?.timezone ?? parsedUserInfo.timezone;

  const rawLineByText = getRawLineByText(rawLogLines);
  const rawLineForEvidence = (evidenceRaw, declaredLogLine) => {
    const key = normalizeRawLogEntry(evidenceRaw);
    if (!key) return null;
    const declared = Number(declaredLogLine);
    if (
      Number.isFinite(declared) &&
      declared >= 1 &&
      normalizeRawLogEntry(rawLogLines[declared - 1]) === key
    ) {
      return declared;
    }
    const lines = rawLineByText.get(key);
    if (!lines || lines.length === 0) return null;
    return lines[0];
  };

  // Auto-expand the first raw log payload line if nothing has been expanded yet
  if (expandedRawLineNumbers.size === 0) {
    for (let i = 0; i < Math.min(1000, rawLogLines.length); i++) {
      const payload = getPrettyPayloadForRawLine(rawLogLines[i]);
      if (payload?.kind) {
        // Skip tiny/empty payloads like {} or [] because they don't teach affordance well
        const textStr = String(payload.text || "").trim();
        if (textStr.length <= 5) continue;

        expandedRawLineNumbers.add(i + 1);
        break;
      }
    }
  }

  const traceEvents = Array.isArray(execution?.trace?.events)
    ? execution.trace.events
    : [];
  const codeUnitsAll = traceEvents
    .filter(
      (event) =>
        toScreamingSnakeCase(event?.type || "") === "CODE_UNIT_STARTED",
    )
    .sort((a, b) => {
      const ta = Number(a?.timestampNs || 0);
      const tb = Number(b?.timestampNs || 0);
      if (ta !== tb) return ta - tb;
      return Number(a?.idx || 0) - Number(b?.idx || 0);
    });
  const rootBlock = codeUnitsAll[0] || null;
  const codeUnits = codeUnitsAll.slice(1);

  const defaultLimits = governorLimits?.current?.defaultNamespace || {};
  const executionTypeLabel =
    String(entryPoint?.type || context?.transaction?.requestType || "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .trim() || "Unknown";
  const startedAtRaw = context?.transaction?.startTimestamp;
  const reportDateFallback = (() => {
    const generatedAt = String(report?.schema?.generatedAtUtc || "").trim();
    const match = generatedAt.match(/^(\d{4}-\d{2}-\d{2})/);
    return match?.[1] || "";
  })();
  const startedAtLabel = (() => {
    if (!startedAtRaw) return "Unknown";
    const value = String(startedAtRaw).trim();
    const normalized = value
      .replace("T", " ")
      .replace(/\s*(Z|[+-]\d{2}:?\d{2})$/, "")
      .trim();
    const match = normalized.match(
      /(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4}).*?(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)/,
    );
    if (match) return `${match[1]} ${match[2]}`;
    if (
      reportDateFallback &&
      /^\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(normalized)
    ) {
      return `${reportDateFallback} ${normalized}`;
    }
    return normalized || value;
  })();

  const soqlRows =
    defaultLimits?.soqlRows?.used ?? report?.overview?.topMetrics?.soql?.rows;
  const dmlRows =
    defaultLimits?.dmlRows?.used ?? report?.overview?.topMetrics?.dml?.rows;

  if (governorLimitsGrid) {
    renderGovernorLimits(governorLimitsGrid, report);
  }

  /* --- Populate topbar hero header --- */
  const rootClassName =
    entryPoint?.name || codeUnitLabelFromEvent(rootBlock) || null;
  if (topbarClassName) {
    // Extract just the class/trigger name for display.
    // CODE_UNIT_STARTED text can be verbose, e.g.:
    //   "OpportunityTrigger on Opportunity trigger event AfterUpdate for [0068Z...]"
    // We only want "OpportunityTrigger" in the topbar.
    let displayName = rootClassName || "—";
    const triggerOnMatch = displayName.match(
      /^(\S+)\s+on\s+\S+\s+trigger\s+event\b/i,
    );
    if (triggerOnMatch) {
      displayName = triggerOnMatch[1];
    }
    topbarClassName.textContent = displayName;
  }
  if (topbarSubtitle) {
    topbarSubtitle.hidden = !rootClassName;
  }

  const fileName =
    report?.source?.fileName || report?.source?.input?.fileName || null;
  const lineCount = rawLogLines.length;

  const derivedDurationMs = durationMsFromTransactionTimes(
    context?.transaction?.startTimestamp,
    context?.transaction?.endTimestamp,
  );
  // Use || (not ??) so that 0 from identical wall-clock timestamps falls through
  const durationMs =
    derivedDurationMs ||
    (Number.isFinite(Number(context?.transaction?.durationMs)) &&
    Number(context?.transaction?.durationMs) > 0
      ? Number(context?.transaction?.durationMs)
      : null);

  /* --- Top banner right column --- */
  const displayUser = username || userId || null;
  if (topBannerUser) {
    if (displayUser) {
      const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
      setHtml(topBannerUser, `${iconSvg}${escapeHtml(displayUser)}`);
      topBannerUser.hidden = false;
    } else {
      topBannerUser.hidden = true;
    }
  }
  if (topBannerStats) {
    const statParts = [];
    if (lineCount > 0) statParts.push(`${lineCount.toLocaleString()} lines`);
    if (durationMs !== null) {
      const runtimeLabel =
        durationMs < 1000
          ? `${Math.round(durationMs)}ms runtime`
          : `${(durationMs / 1000).toFixed(1)}s runtime`;
      statParts.push(runtimeLabel);
    }
    topBannerStats.textContent = statParts.join(" • ");
    topBannerStats.hidden = statParts.length === 0;
  }
  if (topBannerFile) {
    topBannerFile.textContent = fileName || "";
    topBannerFile.hidden = !fileName;
  }

  const parserIssues = reportIssues;
  const syntheticEmptyMapWarnings = synthesizeEmptyMapWarningsFromRawLog(
    rawLogLines,
    parserIssues,
  );
  const issues = [...parserIssues, ...syntheticEmptyMapWarnings].filter(
    (item) => {
      if (!isAggregateEmptyResultMapWarning(item)) return true;
      const hasDetailedMapWarnings = [
        ...parserIssues,
        ...syntheticEmptyMapWarnings,
      ].some((candidate) => isSpecificEmptyResultMapWarning(candidate));
      return !hasDetailedMapWarnings;
    },
  );
  const hasIssueEvidence = (item) => {
    const lineNumber = Number(item?.evidence?.rawLogLineNumber);
    if (Number.isFinite(lineNumber) && lineNumber >= 1) return true;
    const lineNumbers = Array.isArray(item?.evidence?.rawLogLineNumbers)
      ? item.evidence.rawLogLineNumbers
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n >= 1)
      : [];
    if (lineNumbers.length > 0) return true;
    return (
      rawLineForEvidence(item?.evidence?.raw, item?.evidence?.lineNumber) !==
      null
    );
  };
  const evidenceBackedIssues = issues
    .filter((item) => hasIssueEvidence(item))
    .map((item) => {
      const ev = item?.evidence || {};
      if (ev.rawLogLineNumber) return item;
      const resolved = rawLineForEvidence(ev.raw, ev.lineNumber);
      if (!resolved) return item;
      return { ...item, evidence: { ...ev, rawLogLineNumber: resolved } };
    });
  window._mappedDiagnosticsIssues = evidenceBackedIssues;
  const warnings = evidenceBackedIssues.filter((item) => isWarningItem(item));
  const errors = evidenceBackedIssues.filter((item) => !isWarningItem(item));
  const namespaces = Array.from(
    new Set(
      [
        ...traceEvents.map((item) => String(item?.namespace || "").trim()),
        ...database.soql.map((item) => String(item?.namespace || "").trim()),
        ...database.dml.map((item) => String(item?.namespace || "").trim()),
        ...evidenceBackedIssues.map((item) =>
          String(item?.namespace || "").trim(),
        ),
      ].filter(Boolean),
    ),
  );
  const managedNamespaces = namespaces.filter((ns) => {
    const normalized = String(ns || "")
      .trim()
      .toLowerCase();
    return normalized && normalized !== "default";
  });
  const scopeIds = Array.from(
    new Set(
      (entryPoint?.recordIds || [])
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ),
  );
  const scopeIdGroups = buildScopeIdGroups(report, scopeIds);
  const scopeGroupReportKey = getScopeGroupReportKey(report);
  if (scopeGroupReportKey !== scopeGroupStateReportKey) {
    scopeGroupStateReportKey = scopeGroupReportKey;
    scopeGroupUserHasToggled = false;
    expandedScopeGroupKeys = new Set();
  }
  if (
    scopeIdGroups.length > 0 &&
    expandedScopeGroupKeys.size === 0 &&
    !scopeGroupUserHasToggled
  ) {
    expandedScopeGroupKeys.add(scopeIdGroups[0].key);
  }
  renderCardGrid(
    triageSnapshotGrid,
    [
      {
        title: "Outcome",
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
        value: renderMetricLines([
          pluralizeLabel(errors.length, "error"),
          pluralizeLabel(warnings.length, "warning"),
        ]),
        href: "#diagnostics",
        span: "half",
      },
      {
        title: "Execution Type",
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`,
        value: escapeHtml(executionTypeLabel),
        span: "half",
      },
      {
        title: "Started At",
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2-2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>`,
        value: escapeHtml(startedAtLabel),
        meta: escapeHtml(`User timezone: ${timezone || "Unknown"}`),
        span: "half",
      },
      {
        title: "Managed Packages",
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2-2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>`,
        value:
          managedNamespaces.length > 0
            ? renderMetricLines(managedNamespaces, { inline: true })
            : "None",
        meta: managedNamespaces.length > 0 ? "" : "No managed package activity",
        href: "#data",
        cardClass: "reportMetricCard--managedPackages",
        span: "half",
      },
      {
        title: "Database",
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>`,
        value: renderMetricPairs([
          [
            pluralizeLabel(database.soql.length, "SOQL Query", "SOQL Queries"),
            pluralizeLabel(soqlRows, "Row Read", "Rows Read"),
          ],
          [
            pluralizeLabel(
              database.dml.length,
              "DML Operation",
              "DML Operations",
            ),
            pluralizeLabel(dmlRows, "Row Written", "Rows Written"),
          ],
          [
            pluralizeLabel(database.sosl.length, "SOSL Query", "SOSL Queries"),
            "",
          ],
        ]),
        href: "#data",
        cardClass: "reportMetricCard--database",
        span: "full",
      },
      {
        title: "Scope IDs",
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" x2="21" y1="6" y2="6"/><line x1="3" x2="15" y1="12" y2="12"/><line x1="3" x2="9" y1="18" y2="18"/></svg>`,
        value: scopeIdGroups.length > 0 ? "" : "None",
        detailHtml:
          scopeIdGroups.length > 0 ? renderScopeIdGroups(scopeIdGroups) : "",
        span: "full",
      },
    ],
    "No triage snapshot data.",
    { clustered: true },
  );

  /* --- Verdict card (extension hook — no-op when buildVerdict is not defined) --- */
  if (
    typeof buildVerdict === "function" &&
    typeof verdictPanel !== "undefined" &&
    verdictPanel
  ) {
    const verdictData = buildVerdict(report);
    const verdictIcons = {
      ok: "✓",
      info: "ℹ",
      warn: "⚠",
      critical: "⚠",
      error: "✕",
    };
    const icon = verdictIcons[verdictData.level] || "ℹ";
    setHtml(
      verdictPanel,
      `<div class="verdict-card verdict-card--${escapeHtml(verdictData.level)}"><span class="verdict-icon">${icon}</span><span class="verdict-text">${escapeHtml(verdictData.text)}</span></div>`,
    );
    verdictPanel.hidden = false;
  }

  const failureGroups = groupFailureContexts(report);
  const matchedFailureGroups = new Set();
  const issueTriageItems = evidenceBackedIssues.map((item) => {
    const lineNumbers = issueEvidenceLines(item, rawLineForEvidence);
    const lineText =
      lineNumbers.length > 0
        ? `<span class="findingLineInline">at ${lineNumbers.length === 1 ? "log line" : "log lines"} ${lineNumbers.map((line) => `<a class="reportEvidenceLink jumpRawFromQuery" href="${buildRawLogHref(`log:${line}`)}" data-line="${line}">${line}</a>`).join(", ")}</span>`
        : "";
    const failureGroup = failureGroups.find((group) => {
      if (matchedFailureGroups.has(group)) return false;
      return failureContextMatchesIssue(group, item);
    });
    if (failureGroup) matchedFailureGroups.add(failureGroup);
    return {
      title: `<span class="reportIssueTitleIcon">${issueIcon(item)}</span><span class="reportIssueTitleText">${escapeHtml(issueHeading(item))} ${lineText}</span>`,
      body: renderIssueFindingBody(
        item,
        failureGroup ? renderFailureContextDetails(failureGroup) : "",
      ),
    };
  });
  const unmatchedFailureItems = failureGroups
    .filter((group) => !matchedFailureGroups.has(group))
    .map((group) => {
      const failure = group.failure || {};
      const line = Number(failure?.lineNumber);
      const lineText = Number.isFinite(line)
        ? `<span class="findingLineInline">at log line <a class="reportEvidenceLink jumpRawFromQuery" href="${buildRawLogHref(`log:${line}`)}" data-line="${line}">${line}</a></span>`
        : "";
      const item = {
        type: failure?.type || "EXCEPTION_THROWN",
        summary: failure?.message || "A failure was captured.",
      };
      return {
        title: `<span class="reportIssueTitleIcon">${issueIcon(item)}</span><span class="reportIssueTitleText">${escapeHtml(issueHeading(item))} ${lineText}</span>`,
        body: renderIssueFindingBody(item, renderFailureContextDetails(group)),
      };
    });
  const completeness = report?.metadata?.logCompleteness;
  const completenessStatus = String(completeness?.status || "unknown");
  const completenessReasons = Array.isArray(completeness?.reasons)
    ? completeness.reasons
    : [];
  const qualityItems =
    completenessStatus === "complete"
      ? []
      : [
          {
            title: `<span class="reportIssueTitleIcon">${issueIcon({ type: "PARSING_ERROR" })}</span><span class="reportIssueTitleText">Log Quality Warning</span>`,
            body: `<div class="findingSummary">Some conclusions may be incomplete because the recorded log has missing or uncertain evidence.</div>${completenessReasons.map((reason) => `<div class="findingEvidence">${escapeHtml(String(reason))}</div>`).join("")}`,
          },
        ];
  const triageItems = [
    ...issueTriageItems,
    ...unmatchedFailureItems,
    ...qualityItems,
  ].slice(0, 5);

  renderRichList(
    triageHighlightsList,
    triageItems,
    "No evidence-backed findings were emitted for this report.",
    { grouped: true },
  );

  if (triageHighlightsPanel) {
    triageHighlightsPanel.hidden =
      triageItems.length === 0 && namespaces.length === 0;
  }

  const executionHotspots = traceEvents
    .filter(
      (event) =>
        toScreamingSnakeCase(event?.type || "") !== "CODE_UNIT_STARTED",
    )
    .map((item) => ({
      label: String(item?.label || item?.text || item?.type || "Event"),
      eventType: toScreamingSnakeCase(item?.type || "EVENT"),
      durationMs: durationMsFromEventRecord(item),
    }))
    .filter((item) => item.durationMs > 0)
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 6);
  const triggerNames = codeUnits
    .map((item) => codeUnitLabelFromEvent(item))
    .filter((label) => /trigger/i.test(label))
    .slice(0, 6);

  const executionTimelineRows = traceEvents
    .map((event) => {
      const eventType = toScreamingSnakeCase(event?.type || "EVENT");
      if (!isExecutionStoryEventType(eventType)) return null;
      const sortNs = Number(event?.timestampNs || 0);
      const line =
        rawLineForEvidence(
          event?.raw || event?.evidence?.raw,
          event?.lineNumber ?? event?.evidence?.lineNumber,
        ) || null;
      const durationMs = durationMsFromEventRecord(event);
      const text = compactSingleLine(event?.text || event?.label || eventType);
      return {
        sortNs,
        idx: Number(event?.idx || 0),
        eventType,
        name: text,
        durationMs,
        line,
        sourceLineNumber: event?.sourceLineNumber ?? null,
      };
    })
    .filter(Boolean)
    .filter((item) => !isHiddenInternalExecutionRow(item))
    .map((item) => ({
      ...item,
      isInternal: isSalesforceInternal(item.eventType),
      phaseGroup: getSalesforcePhaseGroup(item.eventType),
    }))
    .sort((a, b) => {
      if (a.sortNs !== b.sortNs) return a.sortNs - b.sortNs;
      const la = a.line != null ? a.line : Infinity;
      const lb = b.line != null ? b.line : Infinity;
      if (la !== lb) return la - lb;
      return (a.idx || 0) - (b.idx || 0);
    });
  const availableEventCategories = new Set(
    executionTimelineRows
      .filter((item) => !item.isInternal)
      .map((item) => getExecutionEventCategory(item.eventType)),
  );
  syncExecutionTypeFilterUi(availableEventCategories);
  const filteredExecutionTimelineRows = executionTimelineRows.filter(
    (item) =>
      !item.isInternal &&
      (selectedExecutionEventCategory === EXECUTION_EVENT_CATEGORY_ALL ||
        getExecutionEventCategory(item.eventType) ===
          selectedExecutionEventCategory),
  );

  if (executionStoryTable) {
    if (filteredExecutionTimelineRows.length === 0) {
      if (executionStorySubheading) {
        executionStorySubheading.textContent =
          "Chain, hotspots, and namespaces involved in the transaction. No events match the selected event-type filter.";
      }
      setHtml(
        executionStoryTable,
        "<p>No execution steps matched the selected event types.</p>",
      );
    } else {
      let lastPhaseGroup = null;
      const EXECUTION_STORY_ROW_LIMIT = 200;
      const visibleExecutionTimelineRows = filteredExecutionTimelineRows.slice(
        0,
        EXECUTION_STORY_ROW_LIMIT,
      );
      if (executionStorySubheading) {
        executionStorySubheading.textContent =
          filteredExecutionTimelineRows.length > EXECUTION_STORY_ROW_LIMIT
            ? `Chain, hotspots, and namespaces involved in the transaction. Showing the first ${EXECUTION_STORY_ROW_LIMIT} of ${filteredExecutionTimelineRows.length} matching events; choose an event-type filter to narrow the story, or use Log Explorer for the complete raw sequence.`
            : `Chain, hotspots, and namespaces involved in the transaction. Showing ${filteredExecutionTimelineRows.length} matching event${filteredExecutionTimelineRows.length === 1 ? "" : "s"}.`;
      }
      const rowsHtml = visibleExecutionTimelineRows
        .map((item) => {
          let groupHeader = "";
          if (!item.isInternal && item.phaseGroup !== lastPhaseGroup) {
            lastPhaseGroup = item.phaseGroup;
            groupHeader = `<tr class="storyPhaseHeaderRow" data-phase-group="${escapeHtml(item.phaseGroup)}"><td colspan="5">${escapeHtml(item.phaseGroup)}</td></tr>`;
          }
          const rowClass = ` data-event-type="${escapeHtml(item.eventType)}"`;
          return `${groupHeader}<tr${rowClass}><td><span class="storyEventTypeBadge">${escapeHtml(item.eventType)}</span></td><td class="storyNameCell">${escapeHtml(item.name)}</td><td>${escapeHtml(formatDurationMs(item.durationMs))}</td><td>${renderSourceLineNumber(item.sourceLineNumber)}</td><td>${logLineLink(item.line)}</td></tr>`;
        })
        .join("");

      setHtml(
        executionStoryTable,
        `<table><thead><tr><th>Event type</th><th>Name</th><th>Duration</th><th>Source line</th><th>Log line</th></tr></thead><tbody>${rowsHtml}</tbody></table>`,
      );
      const detailTable = executionStoryTable.querySelector("table");
      detailTable?.classList.add("executionStoryDetailTable");
    }
  }

  if (executionInsightsPanel) {
    executionInsightsPanel.hidden =
      executionTimelineRows.length === 0 && executionHotspots.length === 0;
  }

  const soqlRowsAll = database?.soql || [];
  const soqlPatterns = Array.isArray(database?.soqlPatterns)
    ? database.soqlPatterns
    : [];
  const loopSuspectPatterns = soqlPatterns.filter((p) => p.isLoopSuspect);
  const loopSuspectQueryIds = new Set();
  for (const pat of loopSuspectPatterns) {
    if (Array.isArray(pat.queryIds))
      pat.queryIds.forEach((id) => loopSuspectQueryIds.add(id));
  }

  if (n1WarningContainer) {
    if (loopSuspectPatterns.length > 0) {
      const sorted = [...loopSuspectPatterns].sort(
        (a, b) =>
          (b.executionCount || b.count || 0) -
          (a.executionCount || a.count || 0),
      );
      const top = sorted[0];
      if (top) {
        setHtml(
          n1WarningContainer,
          `
          <article class="detailCard" style="margin-bottom:16px; border-left:4px solid var(--warn-accent); padding-left:12px;">
            <strong>N+1 SOQL Warning</strong>
            <p class="smallCopy">${loopSuspectPatterns.length} loop-suspect pattern(s) detected. Highest repetition: ${escapeHtml(top.targetObject || top.pattern || "Unknown")} ran ${top.executionCount || top.count || 0} time(s).</p>
          </article>
        `,
        );
      }
      n1WarningContainer.hidden = false;
    } else {
      n1WarningContainer.hidden = true;
    }
  }

  const problematic = [...soqlRowsAll]
    .sort(
      (a, b) =>
        Number(b?.durationMs || 0) - Number(a?.durationMs || 0) ||
        Number(b?.rows || 0) - Number(a?.rows || 0),
    )
    .slice(0, uiConfig.limits.soql);
  const allChronological = [...soqlRowsAll].sort(
    (a, b) =>
      Number(a?.evidence?.timestampNs || 0) -
      Number(b?.evidence?.timestampNs || 0),
  );
  allQueriesCount = allChronological.length;
  const visibleLongestQueryCount = Math.min(
    allQueriesCount,
    uiConfig.limits.soql,
  );
  const renderSoqlRow = (q) => {
    const rawLine = rawLineForEvidence(
      q?.evidence?.raw,
      q?.evidence?.lineNumber,
    );
    const nameText = String(q?.query || "-")
      .replace(/\s+/g, " ")
      .trim();
    const isN1 = loopSuspectQueryIds.has(q.id);
    const n1Badge = isN1
      ? ' <span class="n1Badge" title="N+1 Loop Suspect" style="background:var(--warn-background);color:var(--warn-accent);padding:2px 4px;border-radius:3px;font-size:0.8em;margin-left:6px;border:1px solid var(--warn-border);">N+1</span>'
      : "";
    return [
      `<div><span class="copyCell queryTextCell" data-copy-column="query_name" data-copy-value="${encodeURIComponent(nameText)}" data-icon="copy" style="display:inline-flex;align-items:center;">${escapeHtml(nameText)}${n1Badge}</span></div>`,
      displayValue(q?.rows),
      escapeHtml(secondsFromMs(q?.durationMs)),
      renderSourceLineNumber(q?.evidence?.sourceLineNumber),
      logLineLink(rawLine),
    ];
  };

  setHtml(
    problematicQueriesTable,
    table(
      ["Name", "Rows", "Duration", "Source line", "Log line"],
      problematic.map((q) => renderSoqlRow(q)),
    ).replace("<table>", '<table class="queryTable">'),
  );
  setHtml(
    allQueriesTable,
    queriesExpanded
      ? table(
          ["Name", "Rows", "Duration", "Source line", "Log line"],
          allChronological.map((q) => renderSoqlRow(q)),
        ).replace("<table>", '<table class="queryTable">')
      : "",
  );

  promoteCopyCellsToTd(problematicQueriesTable);
  promoteCopyCellsToTd(allQueriesTable);
  problematicQueriesTable.hidden = queriesExpanded;
  allQueriesWrap.hidden = !queriesExpanded;
  if (toggleAllQueriesBtn) {
    toggleAllQueriesBtn.hidden = allQueriesCount <= uiConfig.limits.soql;
    setExpandButtonLabel(toggleAllQueriesBtn, queriesExpanded, allQueriesCount);
  }
  if (queriesHeading)
    setHtml(
      queriesHeading,
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="section-icon"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>SOQL Queries',
    );
  if (queriesSubheading) {
    queriesSubheading.textContent = queriesExpanded
      ? uiConfig.labels.soqlExpandedSubheading
      : fillCountTemplate(
          uiConfig.labels.soqlTopTemplate,
          visibleLongestQueryCount,
        );
  }

  const slowestQuery =
    [...soqlRowsAll].sort(
      (a, b) => Number(b?.durationMs || 0) - Number(a?.durationMs || 0),
    )[0] || null;
  const structuredSavepoints = Array.isArray(report?.savepoints)
    ? report.savepoints
    : [];

  const dmlRowsAll = database?.dml || [];
  allDmlCount = dmlRowsAll.length;
  const dmlRowsVisible = dmlExpanded
    ? dmlRowsAll
    : dmlRowsAll.slice(0, uiConfig.limits.dml);
  const dmlTableHtml = table(
    ["Object", "Operation", "Rows", "Duration", "Source line", "Log line"],
    dmlRowsVisible.map((d) => {
      const rawLine = rawLineForEvidence(
        d?.evidence?.raw,
        d?.evidence?.lineNumber,
      );
      const objectText = String(d?.sObject || "-");
      return [
        `<span class="copyCell queryTextCell" data-copy-column="dml_object" data-copy-value="${encodeURIComponent(objectText)}" data-icon="copy">${escapeHtml(objectText)}</span>`,
        escapeHtml(d?.operation || "-"),
        displayValue(d?.rows),
        escapeHtml(secondsFromMs(d?.durationMs)),
        renderSourceLineNumber(d?.evidence?.sourceLineNumber),
        logLineLink(rawLine),
      ];
    }),
  );

  setHtml(
    dmlTable,
    dmlTableHtml.replace("<table>", '<table class="dmlTable">'),
  );
  promoteCopyCellsToTd(dmlTable);
  if (dmlSubheading) {
    dmlSubheading.textContent = uiConfig.labels.dmlSubheading;
  }
  if (toggleAllDmlBtn) {
    toggleAllDmlBtn.hidden = allDmlCount <= uiConfig.limits.dml;
    setExpandButtonLabel(toggleAllDmlBtn, dmlExpanded, allDmlCount);
  }

  if (dataLimitsSummaryGrid) {
    setHtml(dataLimitsSummaryGrid, "");
    dataLimitsSummaryGrid.hidden = true;
  }

  if (savepointList) {
    if (structuredSavepoints.length > 0) {
      // Preferred: structured savepoints from report (requires getSavepoints from extension)
      setHtml(
        savepointList,
        table(
          ["Marker", "Name", "Log line"],
          structuredSavepoints.map((sp) => {
            const markerType =
              sp.type === "rollback" ? "SAVEPOINT_ROLLBACK" : "SAVEPOINT_SET";
            const rawRow = sp.rawLine ? rawLineForEvidence(sp.rawLine) : null;
            const lineCell = Number.isFinite(Number(rawRow))
              ? `<a href="${buildRawLogHref(`log:${rawRow}`, "#evidence")}" class="jumpRawFromQuery" data-line="${rawRow}" title="Open raw debug-log line ${rawRow}">${rawRow}</a>`
              : "–";

            let markerName = sp.name || "–";
            const lineSuffixIdx = markerName.indexOf(", line:");
            if (lineSuffixIdx > 0)
              markerName = markerName.substring(0, lineSuffixIdx).trim();

            return [escapeHtml(markerType), escapeHtml(markerName), lineCell];
          }),
        ),
      );
      const markerTable = savepointList.querySelector("table");
      markerTable?.classList.add("markerTable");
    } else {
      setHtml(
        savepointList,
        "<p>No savepoints or rollback markers were detected.</p>",
      );
    }
  }

  if (dataInsightsPanel) {
    dataInsightsPanel.hidden = false;
  }

  const parserWarningItemsRaw = [
    ...(Array.isArray(report?.analysis?.phaseWarnings)
      ? report.analysis.phaseWarnings
      : []),
    ...(Array.isArray(report?.analysis?.warnings)
      ? report.analysis.warnings
      : []),
  ];
  const parserWarningsTotal = parserWarningItemsRaw.length;
  const parserWarningItems = parserWarningsExpanded
    ? parserWarningItemsRaw
    : parserWarningItemsRaw.slice(0, 8);

  if (overviewViewPanel) {
    renderOverviewPanel(overviewViewPanel, report);
  }

  // Schema version banner (FEAT-009)
  if (schemaBanner && schemaBannerText) {
    const schemaVersion = String(report?.schema?.version || "");
    if (schemaVersion !== "3.0.0") {
      schemaBannerText.textContent = `Unsupported report schema version: ${schemaVersion || "missing"}. Expected 3.0.0.`;
      schemaBanner.hidden = false;
    } else {
      schemaBanner.hidden = true;
    }
  }

  if (diagnosticsPanel) {
    setHtml(
      diagnosticsPanel,
      buildRichDiagnosticsMarkup(report, window.diagState),
    );
    bindDiagButtons(diagnosticsPanel);
    promoteCopyCellsToTd(diagnosticsPanel);
  }

  if (diagnosticsPanel) {
    diagnosticsPanel.hidden = false;
  }
}

/**
 * Display a canonical offline report supplied by the current host adapter.
 *
 * Source acquisition and parsing remain host responsibilities. The CLI,
 * browser extension, and VS Code extension use this boundary to replace the
 * active report without duplicating viewer state hydration.
 */
export function showOfflineReport({
  report,
  rawLines = [],
  sourceLabel = "",
} = {}) {
  if (!report || typeof report !== "object") {
    throw new TypeError("A canonical offline report is required.");
  }

  const nextRawLines = Array.isArray(rawLines)
    ? rawLines.map((line) => String(line ?? ""))
    : [];
  currentReportUrl = String(
    sourceLabel ||
      report?.source?.fileName ||
      report?.source?.input?.fileName ||
      "",
  );
  currentRawLogLines = nextRawLines;
  currentReportData = report;
  const mount = document.getElementById("canonicalReportView");
  mount?.replaceChildren();
  document.body.classList.remove("canonical-renderer-active");
  render(report, nextRawLines);
  setViewModeFromHash();
}

document.addEventListener("click", (e) => {
  const copyBtn = e.target.closest(".rawPrettyCopyBtn");
  if (copyBtn) {
    e.preventDefault();
    const row = copyBtn.closest(".rawLine");
    const prettyBlock = row?.querySelector(".rawPrettyBlock");
    const text = String(prettyBlock?.textContent || "");
    if (!text) return;
    (async () => {
      let toCopy = text;
      try {
        const redactionSettings = await loadRedactionSettings();
        if (redactionSettings?.enabled) {
          toCopy = redactLines(
            String(text).split(/\r\n|\r|\n/),
            redactionSettings,
          ).join("\n");
        }
      } catch {
        // Fall back to raw pretty text if settings cannot be loaded.
      }
      await copyText(toCopy);
    })()
      .then(() => {
        copyBtn.textContent = "✓";
        setTimeout(() => {
          setHtml(copyBtn, PRETTY_ICON_COPY);
        }, 1200);
      })
      .catch(() => {
        copyBtn.textContent = "!";
        setTimeout(() => {
          setHtml(copyBtn, PRETTY_ICON_COPY);
        }, 1200);
      });
    return;
  }

  const button = e.target.closest(".rawPrettyBtn");
  if (!button) return;
  e.preventDefault();

  const row = button.closest(".rawLine");
  const prettyCard = row?.querySelector(".rawPrettyCard");
  const prettyBlock = row?.querySelector(".rawPrettyBlock");
  if (!row || !prettyBlock || !prettyCard) return;

  const isOpen = !prettyCard.hasAttribute("hidden");
  const rawLineNumber = Number(
    button.dataset.prettyLine || row.dataset.rawLineNumber,
  );

  if (isOpen) {
    prettyCard.setAttribute("hidden", "");
    setPrettyToggleState(button, false);
    if (Number.isFinite(rawLineNumber) && rawLineNumber > 0)
      expandedRawLineNumbers.delete(rawLineNumber);
    return;
  }

  if (!Number.isFinite(rawLineNumber) || rawLineNumber < 1) return;
  const rawLine = String(currentRawLogLines[rawLineNumber - 1] || "");
  const payload = getPrettyPayloadForRawLine(rawLine);
  const kind = String(payload?.kind || button.dataset.prettyKind || "").trim();
  let formatted = null;
  if (kind === "range") {
    const rangeStr = String(button.dataset.prettyRange || "");
    const dashIdx = rangeStr.indexOf("-");
    const from =
      dashIdx > 0 ? Math.max(1, Number(rangeStr.slice(0, dashIdx))) : 0;
    const to =
      dashIdx > 0
        ? Math.min(
            currentRawLogLines.length,
            Number(rangeStr.slice(dashIdx + 1)),
          )
        : 0;
    if (from > 0 && to >= from) {
      const lines = [];
      const hardEnd = Math.min(to, from + PRETTY_MAX_RANGE_LINES - 1);
      for (let i = from; i <= hardEnd; i += 1)
        lines.push(`${i}: ${currentRawLogLines[i - 1] || ""}`);
      if (hardEnd < to) {
        lines.push("");
        lines.push(
          `... [truncated range: showing ${PRETTY_MAX_RANGE_LINES.toLocaleString()} of ${(to - from + 1).toLocaleString()} lines]`,
        );
      }
      formatted = lines.join("\n");
    }
  } else {
    formatted = payload?.text || null;
  }
  if (!formatted && !payload?.reason) return;

  const out = [];
  if (Array.isArray(payload?.warnings) && payload.warnings.length > 0) {
    out.push(
      `Warnings:\n${payload.warnings.map((item) => `- ${item}`).join("\n")}`,
    );
  }
  if (payload?.reason) {
    out.push(payload.reason);
  }
  if (formatted) out.push(formatted);
  prettyBlock.textContent = out.filter(Boolean).join("\n\n");
  prettyCard.removeAttribute("hidden");
  setPrettyToggleState(button, true);
  if (Number.isFinite(rawLineNumber) && rawLineNumber > 0)
    expandedRawLineNumbers.add(rawLineNumber);
});

document.addEventListener("change", (e) => {
  const select = e.target.closest("#executionTypeFilterSelect");
  if (!select) return;
  selectedExecutionEventCategory = String(
    select.value || EXECUTION_EVENT_CATEGORY_ALL,
  );
  if (currentReportData) {
    render(currentReportData, currentRawLogLines);
    renderRawLogSearchResults(rawSearchInput.value);
  }
});

// --- NATIVE RICH DIAGNOSTICS INJECTION ---
function buildRichDiagnosticsMarkup(report, state = {}) {
  const d = report.diagnostics || {};
  const structuralWarnings = d.structuralWarnings || [];
  const issues = window._mappedDiagnosticsIssues || d.issues || [];
  const lineLink = (item) => {
    const ev = item?.evidence || {};
    const n =
      rawLogLineFromEvidence(ev) ||
      (Array.isArray(ev.rawLogLineNumbers)
        ? ev.rawLogLineNumbers.map(Number).find((x) => x > 0)
        : null);
    if (!n) return "-";
    return `<a class="reportEvidenceLink jumpRawFromQuery" href="#evidence?q=${encodeURIComponent(`log:${n}`)}" data-evidence-line="${n}" title="Open raw debug-log line ${n}">${n}</a>`;
  };

  const showAllIssues = state.issuesExpanded;
  const showAllStructural = state.structuralExpanded;

  const ISSUE_LIMIT = 10;
  const STRUCTURAL_LIMIT = 8;
  const takeVisible = (items, expanded, limit) =>
    expanded ? items : items.slice(0, limit);
  const headerPill = (key, expanded, total, limit) => {
    if (total <= limit) return "";
    const label = expanded ? "Show fewer" : `${String(total)} total \u2192`;
    return `<button class="pillBtn" type="button" data-diag-toggle="${escapeHtml(key)}">${label}</button>`;
  };

  const sortedIssues = [...issues].sort((a, b) => {
    const aErr = a.severity === "error" ? 0 : 1;
    const bErr = b.severity === "error" ? 0 : 1;
    return aErr - bErr;
  });
  const visibleIssues = takeVisible(sortedIssues, showAllIssues, ISSUE_LIMIT);
  const visibleStructural = takeVisible(
    structuralWarnings,
    showAllStructural,
    STRUCTURAL_LIMIT,
  );

  const issueTableHtml = (rows, typeHeader, nameHeader) =>
    rows.length === 0
      ? ""
      : `<div class="tableWrap"><table class="issueTable"><colgroup><col class="issueTypeCol"/><col class="issueNameCol"/><col class="issueLineCol"/></colgroup><thead><tr><th>${typeHeader}</th><th>${nameHeader}</th><th>Log line</th></tr></thead><tbody>${rows.map((item) => `<tr class="${item.severity === "error" ? "issueError" : "issueWarn"}"><td class="issueTypeCell">${escapeHtml(item.type)}</td><td class="copyCell" data-copy-column="issue_message" data-copy-value="${encodeURIComponent(item.summary)}" data-icon="copy">${escapeHtml(item.summary)}${item.detail ? `<div class="smallCopy">${escapeHtml(item.detail)}</div>` : ""}${item.confidence ? `<div class="inlineMeta">${escapeHtml(item.confidence)}</div>` : ""}</td><td class="issueLineCell">${lineLink(item)}</td></tr>`).join("")}</tbody></table></div>`;

  const execCtx = report?.context?.executionContext || null;
  const execCtxPanel = execCtx
    ? (() => {
        const isOverride = execCtx.contextSource === "override";
        const overrideBadge = isOverride
          ? `<span class="topbar-pill" style="margin-left:8px;font-size:0.75rem;">manual override</span>`
          : "";
        const signalsList =
          Array.isArray(execCtx.signals) && execCtx.signals.length > 0
            ? `<p class="smallCopy" style="margin-top:6px;">${execCtx.signals.map(escapeHtml).join(" · ")}</p>`
            : "";
        return `
    <section class="panel">
      <div class="rawLogHeader">
        <div>
          <h2><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="section-icon"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Execution Context</h2>
          <p class="subheading sectionSubheading">How the execution context was determined</p>
        </div>
      </div>
      <div style="padding-top:16px;">
        <div class="detailCard" style="border:none; background:transparent; border-left:2px solid var(--line); border-radius:0; padding-left:12px;">
          <strong>${escapeHtml(execCtx.label || execCtx.type || "Unknown")}${overrideBadge}</strong>
          <p class="smallCopy" style="margin-top:6px;">Confidence: ${escapeHtml(execCtx.confidence || "inferred")}</p>
          ${signalsList}
        </div>
      </div>
    </section>`;
      })()
    : "";

  return `
    ${execCtxPanel}
    <section class="panel">
      <div class="rawLogHeader">
        <div>
          <h2><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="section-icon"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Structural Warnings</h2>
          <p class="subheading sectionSubheading">Show transaction-shape risks that are often lost when only the generic list is visible.</p>
        </div>
        ${headerPill("structural", showAllStructural, structuralWarnings.length, STRUCTURAL_LIMIT)}
      </div>
      <div style="padding-top: 16px;">
        ${
          visibleStructural.length === 0
            ? '<div class="emptyInline">No structured mixed-DML or recursive-trigger warnings were detected.</div>'
            : issueTableHtml(
                visibleStructural.map((item) => ({
                  ...item,
                  severity: "warn",
                })),
                "Warning",
                "Detail",
              )
        }
      </div>
    </section>

    <section class="panel">
      <div class="rawLogHeader">
        <div>
          <h2><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="section-icon"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>What is suspicious</h2>
          <p class="subheading sectionSubheading">Errors and warnings from this execution. Errors first.</p>
        </div>
        ${headerPill("issues", showAllIssues, sortedIssues.length, ISSUE_LIMIT)}
      </div>
      <div style="padding-top: 16px;">
        ${
          visibleIssues.length === 0
            ? '<div class="emptyInline">No diagnostic issues were reported.</div>'
            : issueTableHtml(visibleIssues, "Type", "Issue")
        }
      </div>
    </section>

  `;
}

window.diagState = {
  issuesExpanded: false,
  structuralExpanded: false,
};

window.toggleDiagSection = function (key) {
  if (key === "issues")
    window.diagState.issuesExpanded = !window.diagState.issuesExpanded;
  if (key === "structural")
    window.diagState.structuralExpanded = !window.diagState.structuralExpanded;
  const diagnosticsPanel = document.getElementById("diagnosticsPanel");
  if (diagnosticsPanel && currentReportData) {
    setHtml(
      diagnosticsPanel,
      buildRichDiagnosticsMarkup(currentReportData, window.diagState),
    );
    bindDiagButtons(diagnosticsPanel);
    promoteCopyCellsToTd(diagnosticsPanel);
  }
};

function bindDiagButtons(panel) {
  panel.querySelectorAll("[data-evidence-line]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      openRawLogQuery(`line:${button.getAttribute("data-evidence-line")}`);
    });
  });
  panel.querySelectorAll("[data-diag-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      window.toggleDiagSection(button.getAttribute("data-diag-toggle"));
    });
  });
}

// === VIEWER_INIT_START ===

function setViewerReady() {
  document.body.classList.remove("initializing");
}

function showViewerLoadFailure(title, detail) {
  document.body.classList.add("canonical-renderer-active");
  const mount = document.getElementById("canonicalReportView");
  if (!mount) return;
  mount.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "panel loadFailurePanel";
  panel.setAttribute("role", "alert");
  const heading = document.createElement("h2");
  heading.className = "sectionTitle";
  heading.textContent = title;
  const copy = document.createElement("p");
  copy.className = "sectionCopy";
  copy.textContent = detail;
  const retry = document.createElement("button");
  retry.className = "actionBtn";
  retry.type = "button";
  retry.textContent = "Try again";
  retry.addEventListener("click", () => window.location.reload());
  panel.append(heading, copy, retry);
  mount.append(panel);
  heading.setAttribute("tabindex", "-1");
  heading.focus();
}

/**
 * Returns the ?log= query parameter value.
 * The viewer fetches and parses this raw log file client-side via Web Worker.
 */
function getRequestedLogFile() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    return String(params.get("log") || "").trim();
  } catch {
    return "";
  }
}

/**
 * Parse a raw log file in a Web Worker.
 * Returns the worker payload containing the parsed report.
 */
function parseLogInWorker(logText, fileName) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker("./apex-parser-worker.js");

    // Timeout: reject if the worker doesn't respond within 120 seconds
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        worker.terminate();
        reject(
          new Error(
            "Parse timed out after 120 seconds. The log file may be too large.",
          ),
        );
      }
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

async function initializeViewer() {
  // Initialize sidebar — file click opens a new tab
  initSidebar({
    onFileClick: (fileName) => {
      window.open(`/?log=${encodeURIComponent(fileName)}`, "_blank");
    },
    onRefresh: () => {
      fetchSidebarFiles();
    },
  });

  // Fetch available log files from the CLI server (non-blocking)
  fetchSidebarFiles();

  try {
    const logFileName = getRequestedLogFile();
    if (!logFileName) {
      setViewerReady();
      showViewerLoadFailure(
        "Choose an Apex debug log",
        "No log file was selected. Return to the folder list or add ?log=<filename> to this URL.",
      );
      return;
    }

    const logUrl = `/logs/${encodeURIComponent(logFileName)}`;
    const res = await fetch(logUrl, { cache: "no-store" });
    if (!res.ok)
      throw new Error(
        `Could not fetch log file: ${logFileName} (HTTP ${res.status})`,
      );
    const logText = await res.text();
    const rawLogLines = logText.split(/\r\n|\r|\n/);

    const payload = await parseLogInWorker(logText, logFileName);
    const report = payload.report;

    // Hydrate with rawLog lines for the Log Explorer tab
    if (report && typeof report === "object") {
      report.rawLog = {
        lines: rawLogLines.map((text, index) => ({
          lineNumber: index + 1,
          text,
        })),
      };
      report.source = report.source || {};
      report.source.fileName = report.source.fileName || logFileName;
      report.source.input = report.source.input || {};
      report.source.input.fileName =
        report.source.input.fileName || logFileName;
    }

    showOfflineReport({
      report,
      rawLines: rawLogLines,
      sourceLabel: logFileName,
    });
    setViewerReady();
  } catch (err) {
    setViewerReady();
    console.error("Viewer initialization failed:", err);
    showViewerLoadFailure(
      "The log could not be analyzed",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Fetch log file list from CLI server and populate sidebar. */
function fetchSidebarFiles() {
  const currentLog = getRequestedLogFile();
  fetch("/api/logs")
    .then((res) => (res.ok ? res.json() : Promise.reject()))
    .then((files) => {
      if (Array.isArray(files) && files.length > 0) {
        populateSidebar(files, currentLog);
      }
    })
    .catch(() => {
      // Silent fail — sidebar stays hidden (e.g. single-file mode or no server)
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
  saveLogExplorerSettings({
    contextRows: getSelectedContextRows(),
    userDebugOnly: isUserDebugOnlyMode(),
    errorsOnly: isErrorsOnlyMode(),
  });
  renderRawLogSearchResults(rawSearchInput.value);
});

if (rawUserDebugOnlyToggle) {
  rawUserDebugOnlyToggle.addEventListener("change", () => {
    const userDebugOnly = isUserDebugOnlyMode();
    // User Debug and Errors are mutually exclusive
    if (userDebugOnly && rawErrorsToggle?.checked)
      rawErrorsToggle.checked = false;
    if (userDebugOnly) {
      // Clear any active query so debug lines appear immediately
      rawSearchInput.value = "";
      if (rawContextSelect) {
        rawContextSelect.value = "0";
        rawContextSelect.disabled = true;
      }
    } else {
      if (rawContextSelect)
        rawContextSelect.disabled =
          isErrorsOnlyMode() || Boolean(rawShowAllToggle?.checked);
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
      if (rawUserDebugOnlyToggle?.checked) {
        rawUserDebugOnlyToggle.checked = false;
      }
      // Errors and All Lines are mutually exclusive
      if (rawShowAllToggle?.checked) rawShowAllToggle.checked = false;
      // Clear any active query so error lines appear immediately
      rawSearchInput.value = "";
      if (rawContextSelect) {
        rawContextSelect.value = "0";
        rawContextSelect.disabled = true;
      }
    } else {
      if (rawContextSelect)
        rawContextSelect.disabled =
          isUserDebugOnlyMode() || Boolean(rawShowAllToggle?.checked);
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
    // Query is always "" when All Lines is active (set blank in the checked branch
    // above). Just re-render so the capped empty-query preview kicks in.
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

// ─── Redaction settings panel (viewer) ───────────────────────────────────────

(async () => {
  const s = await loadRedactionSettings();
  if (redactEnabledChk) redactEnabledChk.checked = s.enabled;
  if (redactEmailChk) redactEmailChk.checked = s.email;
  if (redactSfIdChk) redactSfIdChk.checked = s.sfId;
  if (redactPhoneChk) redactPhoneChk.checked = s.phone;
  if (redactNamesChk) redactNamesChk.checked = s.names;
  if (redactNameListArea)
    redactNameListArea.value = (s.nameList || []).join("\n");
  if (redactOptionsDiv) redactOptionsDiv.hidden = !s.enabled;
})();

if (redactionSettingsBtn && redactionPanel) {
  redactionSettingsBtn.addEventListener("click", () => {
    redactionPanel.hidden = !redactionPanel.hidden;
  });
}

if (redactEnabledChk && redactOptionsDiv) {
  redactEnabledChk.addEventListener("change", () => {
    redactOptionsDiv.hidden = !redactEnabledChk.checked;
  });
}

if (redactSaveViewerBtn) {
  redactSaveViewerBtn.addEventListener("click", async () => {
    const nameLines = redactNameListArea?.value ?? "";
    const nameList = nameLines
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean);
    const settings = {
      enabled: redactEnabledChk?.checked ?? false,
      email: redactEmailChk?.checked ?? true,
      sfId: redactSfIdChk?.checked ?? true,
      phone: redactPhoneChk?.checked ?? true,
      names: redactNamesChk?.checked ?? true,
      nameList,
    };
    await saveRedactionSettings(settings);
    if (redactViewerStatus) {
      redactViewerStatus.textContent = "Saved.";
      setTimeout(() => {
        redactViewerStatus.textContent = "";
      }, 2000);
    }
  });
}

// ─── End Redaction settings panel ────────────────────────────────────────────

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
  const scopeIdLink =
    e.target instanceof Element ? e.target.closest(".scopeGroupIdLink") : null;
  if (scopeIdLink) {
    if (!isPlainPrimaryClick(e)) return;
    if (maybeOpenConfiguredNewTab(scopeIdLink)) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    const searchQuery = String(scopeIdLink.dataset.searchQuery || "").trim();
    if (searchQuery) {
      openRawLogQuery(searchQuery);
      return;
    }
  }
});

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
    await copyText(value);
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

function comparisonValue(value, unit) {
  if (value === null || value === undefined) return "—";
  const formatted = new Intl.NumberFormat().format(value);
  return unit === "ms"
    ? `${formatted} ms`
    : unit === "bytes"
      ? `${formatted} bytes`
      : formatted;
}

function renderComparisonResult(comparison) {
  if (!comparisonResults) return;
  const rows = comparison.metrics
    .map((metric) => {
      const delta =
        metric.delta === null
          ? "—"
          : `${metric.delta > 0 ? "+" : ""}${comparisonValue(metric.delta, metric.unit)}`;
      return `<tr><th scope="row">${escapeHtml(metric.label)}</th><td>${comparisonValue(metric.baseline, metric.unit)}</td><td>${comparisonValue(metric.candidate, metric.unit)}</td><td class="mono">${delta}</td></tr>`;
    })
    .join("");
  const evidenceWarning = [comparison.baseline, comparison.candidate].some(
    (item) => item?.evidence?.status !== "complete",
  )
    ? `<div class="notice notice--warning" role="status"><strong>Check evidence completeness before interpreting these deltas.</strong> Baseline: ${escapeHtml(comparison.baseline.evidence.status)}; candidate: ${escapeHtml(comparison.candidate.evidence.status)}. A missing boundary or truncated log can make counts and duration appear lower than they were.</div>`
    : "";
  comparisonResults.innerHTML = `${evidenceWarning}<div class="comparison-context"><div><strong>Baseline</strong><span>${escapeHtml(comparison.baseline.fileName)}</span></div><div><strong>Candidate</strong><span>${escapeHtml(comparison.candidate.fileName)}</span></div></div><div class="tableWrap"><table class="queryTable comparison-table"><thead><tr><th>Metric</th><th>Baseline</th><th>Candidate</th><th>Delta</th></tr></thead><tbody>${rows}</tbody></table></div><p class="comparison-note">Delta is candidate minus baseline. A positive value means the candidate used more; a negative value means it used less. Interpret each metric in the context of the transaction.</p>`;
}

async function parseComparisonFile(file) {
  if (!file) throw new Error("Select both a baseline log and a candidate log.");
  if (!/\.log$/i.test(file.name))
    throw new Error(`${file.name} is not a .log file.`);
  let text;
  if (typeof file.stream === "function") {
    const reader = file.stream().getReader();
    const decoder = new TextDecoder();
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode());
      text = chunks.join("");
    } finally {
      reader.releaseLock();
    }
  } else {
    text = await file.text();
  }
  const payload = await parseLogInWorker(text, file.name);
  if (!payload?.report || typeof payload.report !== "object")
    throw new Error(`The parser did not return a report for ${file.name}.`);
  return payload.report;
}

comparisonRunBtn?.addEventListener("click", async () => {
  const baseline = comparisonBaselineInput?.files?.[0];
  const candidate = comparisonCandidateInput?.files?.[0];
  comparisonRunBtn.disabled = true;
  if (comparisonExportBtn) comparisonExportBtn.hidden = true;
  if (comparisonStatus)
    comparisonStatus.textContent = "Parsing both logs locally…";
  try {
    const [baselineReport, candidateReport] = await Promise.all([
      parseComparisonFile(baseline),
      parseComparisonFile(candidate),
    ]);
    currentComparison = compareReports(baselineReport, candidateReport, {
      baseline: baseline.name,
      candidate: candidate.name,
    });
    renderComparisonResult(currentComparison);
    if (comparisonStatus)
      comparisonStatus.textContent =
        "Comparison ready. The original files were not stored.";
    if (comparisonExportBtn) comparisonExportBtn.hidden = false;
  } catch (error) {
    currentComparison = null;
    if (comparisonResults) comparisonResults.textContent = "";
    if (comparisonStatus)
      comparisonStatus.textContent =
        error instanceof Error ? error.message : String(error);
  } finally {
    comparisonRunBtn.disabled = false;
  }
});

comparisonExportBtn?.addEventListener("click", () => {
  if (!currentComparison) return;
  const blob = new Blob([`${JSON.stringify(currentComparison, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "apex-log-comparison.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
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

schemaBannerDismiss?.addEventListener("click", () => {
  if (schemaBanner) schemaBanner.hidden = true;
});

async function init() {
  const isInjectedHost = globalThis.__APEX_LOG_INSIGHTS_HOST__ === "vscode";
  initializeThemeControls();
  if (rawUsageHint && !rawUsageHint.textContent.trim()) {
    rawUsageHint.textContent = buildAdaptiveRefineHint(
      currentRawLogLines.length,
    );
  }
  await initializeLogExplorerSettings();
  if (!isInjectedHost) {
    await loadUIConfig();
    await initializeViewer();
  }
  syncRawCopyButtons();
  setSectionCollapsed(toggleResourceUsageBtn, resourceUsageBody, true);
  setViewModeFromHash();
}

init();
// === VIEWER_INIT_END ===
