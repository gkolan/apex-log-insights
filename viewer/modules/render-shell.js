import { renderTriage } from "./render-triage.js";
import { renderExecution } from "./render-execution.js";
import { renderData } from "./render-data.js";
import { renderDiagnostics } from "./render-diagnostics.js";
import { renderEvidence } from "./render-evidence.js";
import { createFragment, qs, copyText, downloadCsv } from "./shared-dom.js";
import { escapeHtml, formatList, formatMs, num } from "./shared-format.js";

const VIEWS = [
  { id: "triage", title: "Triage Summary" },
  { id: "execution", title: "Execution Story" },
  { id: "data", title: "Data and Limits" },
  { id: "diagnostics", title: "Diagnostics" },
  { id: "evidence", title: "Log Explorer" },
];

function clampView(value) {
  return VIEWS.some((item) => item.id === value) ? value : "triage";
}

function parseHash() {
  const raw = String(window.location.hash || "").replace(/^#/, "");
  if (!raw) return { view: "triage", query: "", line: "", regex: false, caseSensitive: false, offset: 0, expanded: [] };
  const [viewPart, queryPart = ""] = raw.split("?");
  const params = new URLSearchParams(queryPart);
  return {
    view: clampView(viewPart || "triage"),
    query: String(params.get("query") || ""),
    line: String(params.get("line") || ""),
    regex: params.get("regex") === "1",
    caseSensitive: params.get("case") === "1",
    offset: Math.max(0, Number(params.get("offset") || 0) || 0),
    expanded: String(params.get("expanded") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function writeHash(state) {
  const params = new URLSearchParams();
  if (state.view === "evidence" && state.query) params.set("query", state.query);
  if (state.view === "evidence" && state.line) params.set("line", state.line);
  if (state.view === "evidence" && state.regex) params.set("regex", "1");
  if (state.view === "evidence" && state.caseSensitive) params.set("case", "1");
  if (state.view === "evidence" && state.offset > 0) params.set("offset", String(state.offset));
  if (state.expanded?.length) params.set("expanded", state.expanded.join(","));
  const suffix = params.toString();
  const nextHash = `#${state.view}${suffix ? `?${suffix}` : ""}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return true;
  }
  return false;
}

function renderView(report, state) {
  if (state.view === "execution") return renderExecution(report, state);
  if (state.view === "data") return renderData(report, state);
  if (state.view === "diagnostics") return renderDiagnostics(report, state);
  if (state.view === "evidence") return renderEvidence(report, state);
  return renderTriage(report);
}

function summaryStatusClass(outcome) {
  const value = String(outcome || "ok").toLowerCase();
  if (value === "error") return "status-error";
  if (value === "warn" || value === "warning") return "status-warn";
  return "status-ok";
}

function heroMarkup(report, sourceUrl) {
  const statusClass = summaryStatusClass(report.summary.status.outcome);
  const lineCount = Number(report?.summary?.topMetrics?.lines || 0);
  return `
    <header class="topbar">
      <div class="beta-banner">
        <span class="beta-banner-text">Public Beta • Feedback Welcome</span>
        <span class="beta-banner-version">v1.0.0</span>
      </div>
      <div class="topbar-row topbar-row-primary">
        <div class="topbar-left">
          <div class="topbar-logo" aria-hidden="true">
            <img src="../docs/loglens-icons/svgs/active.svg" alt="" width="32" height="32" />
          </div>
          <div class="topbar-identity">
            <div class="topbar-title-row">
              <h1>Apex Log Insights</h1>
              <p class="topbar-subtitle">for <span>${escapeHtml(report.summary.title)}</span></p>
            </div>
            <p class="topbar-filename">${escapeHtml(reportLabel(sourceUrl))}</p>
          </div>
        </div>
        <div class="topbar-right">
          <div class="topbar-summary">
            <div class="topbar-meta" id="topbarMeta">
              ${lineCount > 0 ? `<span class="topbar-stat">${num(lineCount)} lines</span>` : ""}
              <span class="topbar-stat">${escapeHtml(formatMs(report.summary.durationMs))} runtime</span>
              <span class="topbar-stat">${escapeHtml(formatMs(report.summary.topMetrics.cpuTimeMs))} CPU</span>
            </div>
            <div class="topbar-pills" id="topbarPills">
              ${report.summary.user ? `<span class="topbar-pill topbar-pill-muted">${escapeHtml(report.summary.user)}</span>` : ""}
              <span class="topbar-pill ${statusClass}">${escapeHtml(report.summary.status.outcome === "warn" ? `${report.summary.status.warningCount} Warning${report.summary.status.warningCount === 1 ? "" : "s"}` : report.summary.status.outcome === "error" ? `${report.summary.status.errorCount} Error${report.summary.status.errorCount === 1 ? "" : "s"}` : "No Errors")}</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  `;
}

function reportLabel(value) {
  return String(value || "").split("/").filter(Boolean).pop() || String(value || "");
}

function navMarkup(activeView) {
  return `
    <nav class="report-nav" aria-label="Primary sections">
      <div class="report-nav-inner">
        <div class="controls">
        ${VIEWS.map((item) => `
          <a class="${activeView === item.id ? "activeTab" : ""}" href="#${item.id}">${escapeHtml(item.title)}</a>
        `).join("")}
        </div>
      </div>
    </nav>
  `;
}

export function createShell({ mount, report, reportOptions = [], sourceUrl }) {
  const state = parseHash();

  function rerender() {
    const markup = `
      <div class="viewerRoot">
        ${heroMarkup(report, sourceUrl)}
        ${navMarkup(state.view)}
        <main class="reportMain viewWrap">
          ${renderView(report, state)}
        </main>
        <footer class="footerbar">
          <div class="footerbar-inner">
            <span class="footerbar-text">Built with open source</span>
          </div>
        </footer>
      </div>
    `;
    mount.innerHTML = "";
    mount.appendChild(createFragment(markup));
    bind();
  }

  function setView(nextView) {
    state.view = clampView(nextView);
    if (!writeHash(state)) rerender();
  }

  function toggleExpanded(key) {
    const current = new Set(Array.isArray(state.expanded) ? state.expanded : []);
    if (current.has(key)) current.delete(key);
    else current.add(key);
    state.expanded = [...current];
    if (!writeHash(state)) rerender();
  }

  function jumpToEvidence(line) {
    state.view = "evidence";
    state.line = String(line || "");
    if (state.line) state.query = `line:${state.line}`;
    state.offset = 0;
    if (!writeHash(state)) rerender();
    // Scroll the highlighted row into view after the DOM updates
    requestAnimationFrame(() => {
      const target = document.querySelector(".isTarget");
      if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function bindCopy(root) {
    const status = qs(root, "#evidenceStatus");
    const rawLines = Array.from(root.querySelectorAll(".rawLine"));
    const copy = async (selector, emptyMessage, successLabel) => {
      const rows = Array.from(root.querySelectorAll(selector));
      if (rows.length === 0) {
        if (status) status.textContent = emptyMessage;
        return;
      }
      const text = rows.map((row) => row.querySelector(".rawLineText")?.textContent || "").join("\n");
      try {
        await copyText(text);
        if (status) status.textContent = `Copied ${rows.length} ${successLabel} line(s).`;
      } catch {
        if (status) status.textContent = "Clipboard copy failed.";
      }
    };

    const copyVisibleBtn = qs(root, "#copyVisibleBtn");
    const copyMatchedBtn = qs(root, "#copyMatchedBtn");
    if (copyVisibleBtn) {
      copyVisibleBtn.disabled = rawLines.length === 0;
      copyVisibleBtn.addEventListener("click", () => copy(".rawLine", "No visible lines to copy.", "visible"));
    }
    if (copyMatchedBtn) {
      copyMatchedBtn.disabled = root.querySelectorAll(".rawLine.isMatch").length === 0;
      copyMatchedBtn.addEventListener("click", () => copy(".rawLine.isMatch", "No matched lines to copy.", "matched"));
    }
  }

  function bind() {
    mount.querySelectorAll("[data-nav-view]").forEach((button) => {
      button.addEventListener("click", () => setView(button.getAttribute("data-nav-view")));
    });

    mount.querySelectorAll("[data-toggle-section]").forEach((button) => {
      button.addEventListener("click", () => toggleExpanded(button.getAttribute("data-toggle-section")));
    });

    mount.querySelectorAll("[data-evidence-line]").forEach((button) => {
      button.addEventListener("click", (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        jumpToEvidence(button.getAttribute("data-evidence-line"));
      });
    });

    mount.querySelectorAll("[data-evidence-offset]").forEach((button) => {
      button.addEventListener("click", () => {
        state.view = "evidence";
        state.offset = Math.max(0, Number(button.getAttribute("data-evidence-offset") || 0) || 0);
        if (!writeHash(state)) rerender();
      });
    });

    mount.querySelectorAll("[data-copy]").forEach((button) => {
      button.addEventListener("click", async () => {
        const text = button.getAttribute("data-copy") || "";
        try {
          await copyText(text);
          const original = button.textContent;
          button.textContent = "Copied";
          setTimeout(() => { button.textContent = original; }, 1500);
        } catch {
          button.textContent = "Failed";
          setTimeout(() => { button.textContent = "Copy"; }, 1500);
        }
      });
    });

    const searchInput = qs(mount, "#evidenceSearchInput");
    const searchBtn = qs(mount, "#evidenceSearchBtn");
    const clearBtn = qs(mount, "#evidenceClearBtn");
    const regexToggle = qs(mount, "#evidenceRegexToggle");
    const caseToggle = qs(mount, "#evidenceCaseToggle");

    if (searchInput && searchBtn) {
      searchBtn.addEventListener("click", () => {
        state.view = "evidence";
        state.query = searchInput.value.trim();
        state.line = "";
        state.offset = 0;
        if (!writeHash(state)) rerender();
      });

      searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          searchBtn.click();
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        state.query = "";
        state.line = "";
        state.regex = false;
        state.caseSensitive = false;
        state.offset = 0;
        if (!writeHash(state)) rerender();
      });
    }

    if (regexToggle) {
      regexToggle.checked = Boolean(state.regex);
      regexToggle.addEventListener("change", () => {
        state.view = "evidence";
        state.regex = regexToggle.checked;
        state.offset = 0;
        if (!writeHash(state)) rerender();
      });
    }

    if (caseToggle) {
      caseToggle.checked = Boolean(state.caseSensitive);
      caseToggle.addEventListener("change", () => {
        state.view = "evidence";
        state.caseSensitive = caseToggle.checked;
        state.offset = 0;
        if (!writeHash(state)) rerender();
      });
    }

    // CSV export handlers
    const timestamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    mount.querySelectorAll("[data-export-csv]").forEach((button) => {
      button.addEventListener("click", () => {
        const tableType = button.getAttribute("data-export-csv");
        const ts = timestamp();
        if (tableType === "soql") {
          const rows = report.data.soql.map((r) => [r.label, r.rows, r.durationMs]);
          downloadCsv(`apex-insights-soql-${ts}.csv`, ["Query", "Rows", "Duration (ms)"], rows);
        } else if (tableType === "dml") {
          const rows = report.data.dml.map((r) => [r.operation, r.sObject, r.rows, r.durationMs]);
          downloadCsv(`apex-insights-dml-${ts}.csv`, ["Operation", "Object", "Rows", "Duration (ms)"], rows);
        } else if (tableType === "callouts") {
          // Export integrationOperations if available, else fall back to callouts
          const source = (report.data.integrationOperations?.length > 0) ? report.data.integrationOperations : report.data.callouts;
          const rows = source.map((r) => [r.credentialName ?? "", r.method, r.host, r.endpoint, r.statusCode, r.statusText, r.durationMs]);
          downloadCsv(`apex-insights-external-calls-${ts}.csv`, ["Named Credential", "Method", "Host", "Endpoint", "Status Code", "Status Text", "Duration (ms)"], rows);
        }
      });
    });

    // Print handler
    mount.querySelectorAll("[data-print-view]").forEach((button) => {
      button.addEventListener("click", () => window.print());
    });

    bindCopy(mount);
  }

  window.addEventListener("hashchange", () => {
    const next = parseHash();
    state.view = next.view;
    state.query = next.query;
    state.line = next.line;
    state.regex = next.regex;
    state.caseSensitive = next.caseSensitive;
    state.offset = next.offset;
    state.expanded = next.expanded;
    rerender();
  });

  rerender();
}
