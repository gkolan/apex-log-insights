import { evidenceButton } from "./shared-evidence.js";
import { escapeHtml, formatMs, num } from "./shared-format.js";
import { renderLimits, renderLimitHealth } from "./render-limits.js";
import {
  renderN1Banner,
  renderValidationBlocks,
  renderSoqlPatterns,
  renderSoqlGrouped,
  renderCallouts,
  renderNamedCredentials,
} from "./render-queries.js";

function isExpanded(state, key) {
  return Array.isArray(state?.expanded) && state.expanded.includes(key);
}

function takeVisible(items, expanded, limit) {
  const arr = Array.isArray(items) ? items : [];
  return expanded ? arr : arr.slice(0, limit);
}

function expandButton(key, expanded, total, limit) {
  if (total <= limit) return "";
  return `<button class="actionBtn" type="button" data-toggle-section="${escapeHtml(key)}">${expanded ? "Show fewer" : `Show all (${num(total)})`}</button>`;
}

function formatPct(value) {
  return value === null || value === undefined ? "-" : `${Math.round(Number(value))}%`;
}

export function renderData(report, state = {}) {
  const showAllSoql = isExpanded(state, "data-soql");
  const showAllDml = isExpanded(state, "data-dml");
  const showAllCallouts = isExpanded(state, "data-callouts");
  const showAllNamedCredentials = isExpanded(state, "data-named-credentials");
  const showAllSavepoints = isExpanded(state, "data-savepoints");
  const showAllPhaseHeadroom = isExpanded(state, "data-phase-headroom");
  const showAllPatterns = isExpanded(state, "data-soql-patterns");
  const soqlGrouped = isExpanded(state, "soql-grouped");
  const visibleSoql = takeVisible(report.data.soql, showAllSoql, 10);
  const visibleDml = takeVisible(report.data.dml, showAllDml, 10);
  // Prefer unified integrationOperations (v0.15.0+); fall back to callouts for old reports
  const externalCallsSource = (report.data.integrationOperations?.length > 0 || report.data.integrationOperationTotalCount > 0)
    ? report.data.integrationOperations
    : report.data.callouts;
  const visibleCallouts = takeVisible(externalCallsSource, showAllCallouts, 8);
  const visibleNamedCredentials = takeVisible(report.data.namedCredentials, showAllNamedCredentials, 8);
  const visibleSavepoints = takeVisible(report.data.savepoints, showAllSavepoints, 8);
  const visiblePhaseHeadroom = takeVisible(report.data.phaseHeadroom, showAllPhaseHeadroom, 8);
  const visiblePatterns = takeVisible(report.data.soqlPatterns, showAllPatterns, 8);
  const soqlHeading = soqlGrouped
    ? `Showing ${num(report.data.soqlPatterns.length)} pattern(s) from ${num(report.data.soqlTotalCount)} execution(s).`
    : `Showing ${num(visibleSoql.length)} of ${num(report.data.soqlTotalCount)} SOQL item(s) and ${num(visibleDml.length)} of ${num(report.data.dmlTotalCount)} DML item(s).`;
  return `
    <section class="viewPanel">
      <article class="sectionCard panel">
        <div class="sectionHead rawLogHeader">
          <div>
            <h2 class="sectionTitle">What touched the database</h2>
            <p class="sectionCopy subheading">Prioritize expensive queries and DML, then confirm whether limits are trending toward risk. ${soqlHeading}</p>
          </div>
          <div class="actionRow noPrint" style="gap:6px;">
            <button class="pillBtn" type="button" data-export-csv="soql" title="Download all SOQL rows as CSV">Export SOQL CSV</button>
            <button class="pillBtn" type="button" data-export-csv="dml" title="Download all DML rows as CSV">Export DML CSV</button>
            <button class="pillBtn" type="button" data-print-view title="Print or save as PDF">Print / PDF</button>
          </div>
        </div>
        <div class="sectionBody${soqlGrouped ? "" : " grid2"}">
          <div class="tableWrap">
            <div class="actionRow" style="margin-bottom:8px;gap:6px;">
              <button class="pillBtn${soqlGrouped ? " active" : ""}" type="button" data-toggle-section="soql-grouped">Group by query</button>
              ${soqlGrouped ? "" : expandButton("data-soql", showAllSoql, report.data.soqlTotalCount, 10)}
            </div>
            ${soqlGrouped
              ? renderSoqlGrouped(report.data.soqlPatterns, report.data.soql, state)
              : `<table>
              <thead>
                <tr><th>SOQL</th><th>Rows</th><th>Duration</th><th>Evidence</th><th></th></tr>
              </thead>
              <tbody>
                ${visibleSoql.length === 0
                  ? '<tr><td colspan="5">No SOQL data.</td></tr>'
                  : visibleSoql.map((item) => `
                    <tr>
                      <td>
                        ${escapeHtml(String(item.label || "").replace(/\s+/g, " ").trim())}
                        ${item.explain ? `<br><span class="smallCopy textMuted" title="${escapeHtml(item.explain.raw || "")}">Explain: ${item.explain.available === false ? "Unavailable" : (() => {
                          const op = String(item.explain.leadingOperationType || "").trim();
                          const rows = Number(item.explain.cardinality);
                          if (op && Number.isFinite(rows) && rows >= 0) return `${escapeHtml(op)} · ${num(rows)} rows`;
                          const cost = Number(item.explain.relativeCost);
                          const rowLabel = Number.isFinite(rows) && rows >= 0 ? num(rows) : "-";
                          const costLabel = Number.isFinite(cost) ? num(cost) : "-";
                          return `Cost: ${costLabel} · Cardinality: ${rowLabel}${item.explain.indexed ? " (Indexed)" : ""}`;
                        })()}</span>` : ""}
                      </td>
                      <td>${num(item.rows)}</td>
                      <td>${escapeHtml(formatMs(item.durationMs))}</td>
                      <td>${evidenceButton(item, "Line") || "-"}</td>
                      <td><button class="copyBtn pillBtn" type="button" data-copy="${escapeHtml(item.fullQuery || item.label)}" title="Copy SOQL to clipboard">Copy</button></td>
                    </tr>
                  `).join("")}
              </tbody>
            </table>`}
          </div>
          <div class="tableWrap">
            <div class="actionRow" style="margin-bottom:8px;">${expandButton("data-dml", showAllDml, report.data.dmlTotalCount, 10)}</div>
            <table>
              <thead>
                <tr><th>DML</th><th>Object</th><th>Rows</th><th>Duration</th></tr>
              </thead>
              <tbody>
                ${visibleDml.length === 0
                  ? '<tr><td colspan="4">No DML data.</td></tr>'
                  : visibleDml.map((item) => `
                    <tr>
                      <td>${escapeHtml(item.operation)}</td>
                      <td>${escapeHtml(item.sObject)}</td>
                      <td>${num(item.rows)}</td>
                      <td>${escapeHtml(formatMs(item.durationMs))}</td>
                    </tr>
                  `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </article>

      <article class="sectionCard panel">
        <div class="sectionHead rawLogHeader">
          <div>
            <h2 class="sectionTitle">External Calls</h2>
            <p class="sectionCopy subheading">Unified callout and named credential activity. Named Credential column shows the credential used, or blank for direct Http.send() calls. Showing ${num(visibleCallouts.length)} of ${num(report.data.integrationOperationTotalCount || report.data.calloutTotalCount)} operation(s).</p>
          </div>
          <div class="actionRow noPrint" style="gap:6px;">
            <button class="pillBtn" type="button" data-export-csv="callouts" title="Download all external call rows as CSV">Export CSV</button>
          </div>
        </div>
        <div class="sectionBody">
          <div class="actionRow" style="margin-bottom:8px;">${expandButton("data-callouts", showAllCallouts, report.data.integrationOperationTotalCount || report.data.calloutTotalCount, 8)}</div>
          <div class="tableWrap">
            <table>
              <thead>
                <tr><th>Named Credential</th><th>Method</th><th>Host</th><th>Endpoint</th><th>Status</th><th>Duration</th><th>Evidence</th></tr>
              </thead>
              <tbody>
                ${visibleCallouts.length === 0
                  ? '<tr><td colspan="7">No external call data.</td></tr>'
                  : visibleCallouts.map((item) => {
                    const status = item.statusCode !== null
                      ? `${item.statusCode}${item.statusText ? ` ${item.statusText}` : ""}`
                      : "-";
                    return `
                      <tr>
                        <td>${item.credentialName ? escapeHtml(item.credentialName) : '<span class="textMuted">—</span>'}</td>
                        <td>${escapeHtml(item.method || "UNKNOWN")}</td>
                        <td>${escapeHtml(item.host || "-")}</td>
                        <td>${escapeHtml(item.endpoint || "Callout")}</td>
                        <td>${escapeHtml(status)}</td>
                        <td>${escapeHtml(formatMs(item.durationMs))}</td>
                        <td>${evidenceButton(item, "Line") || "-"}</td>
                      </tr>
                    `;
                  }).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </article>

      <article class="sectionCard panel">
        <div class="sectionHead rawLogHeader">
          <div>
            <h2 class="sectionTitle">Governor Limits and Savepoints</h2>
            <p class="sectionCopy subheading">Keep limit visibility explicit, but avoid burying the report under raw snapshots.</p>
          </div>
        </div>
        <div class="sectionBody grid2">
          <div>${renderLimits(report.data.limits)}</div>
          <div class="stack">
            <div class="detailCard">
            <strong>Savepoints</strong>
              <div class="actionRow" style="margin:8px 0;">${expandButton("data-savepoints", showAllSavepoints, report.data.savepointTotalCount, 8)}</div>
              ${visibleSavepoints.length === 0
                ? '<p class="smallCopy">No savepoints or rollback markers were detected.</p>'
              : `<div class="smallCopy">${num(visibleSavepoints.length)} of ${num(report.data.savepointTotalCount)} item(s)</div>${visibleSavepoints.map((item, index) => `<div class="listCard">${escapeHtml(item?.label || item?.name || `Savepoint ${index + 1}`)}</div>`).join("")}`}
            </div>
            <div class="detailCard">
              <strong>Burn Rate</strong>
              ${renderLimitHealth(report.data.limitHealth)}
            </div>
          </div>
        </div>
      </article>

      <article class="sectionCard panel">
        <div class="sectionHead rawLogHeader">
          <div>
            <h2 class="sectionTitle">Validation and Phase Headroom</h2>
            <p class="sectionCopy subheading">Show failed validation rules and where remaining phases may run close to limits.</p>
          </div>
        </div>
        <div class="sectionBody grid2">
          <div class="detailCard">
            <strong>Validation Blocks</strong>
            ${renderValidationBlocks(report.data.validationBlocks)}
          </div>
          <div class="detailCard">
            <strong>Phase Headroom</strong>
            <div class="actionRow" style="margin:8px 0;">${expandButton("data-phase-headroom", showAllPhaseHeadroom, report.data.phaseHeadroomTotalCount, 8)}</div>
            ${visiblePhaseHeadroom.length === 0
              ? '<p class="smallCopy">No phase headroom projections were present.</p>'
              : `<div class="smallCopy">${num(visiblePhaseHeadroom.length)} of ${num(report.data.phaseHeadroomTotalCount)} phase projection(s)</div><div class="stack">${visiblePhaseHeadroom.map((item) => `
                <div class="listCard">
                  <strong class="listTitle">${escapeHtml(item.label)}</strong>
                  <div class="inlineMeta">SOQL ${escapeHtml(formatPct(item.soqlPctAfter))} · DML ${escapeHtml(formatPct(item.dmlPctAfter))} · CPU ${escapeHtml(formatPct(item.cpuPctAfter))}</div>
                  <div class="smallCopy">${num(item.phasesRemaining)} phase(s) remaining${item.warning ? ` · ${escapeHtml(item.warning)}` : ""}</div>
                </div>
              `).join("")}</div>`}
          </div>
        </div>
      </article>

      <article class="sectionCard panel">
        <div class="sectionHead rawLogHeader">
          <div>
            <h2 class="sectionTitle">SOQL Pattern Warnings</h2>
            <p class="sectionCopy subheading">Surface repeated query patterns from the canonical parser output and flag loop suspects instead of hiding non-N+1 repeats. Showing ${num(visiblePatterns.length)} of ${num(report.data.soqlPatternTotalCount)} pattern(s).</p>
          </div>
        </div>
        <div class="sectionBody">
          <div class="detailCard">
            ${renderN1Banner(report.data.soqlPatterns)}
            <div class="actionRow" style="margin-bottom:8px;">${expandButton("data-soql-patterns", showAllPatterns, report.data.soqlPatternTotalCount, 8)}</div>
            <strong>SOQL Patterns</strong>
            ${renderSoqlPatterns(visiblePatterns)}
          </div>
        </div>
      </article>
    </section>
  `;
}
