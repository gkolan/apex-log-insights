import { evidenceButton } from "./shared-evidence.js";
import { escapeHtml, formatList, formatMs, num } from "./shared-format.js";

function issueRows(items, emptyText) {
  if (items.length === 0) {
    return `<p>${escapeHtml(emptyText)}</p>`;
  }

  return `
    <div class="tableWrap">
      <table class="issueTable">
        <thead>
          <tr><th>Name</th><th>Type</th><th>Line #</th></tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td>${escapeHtml(item.summary)}</td>
              <td>${escapeHtml(item.type || item.severity || "Issue")}</td>
              <td>${evidenceButton(item, "Open") || "-"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function limitsMarkup(limits) {
  const rows = Object.entries(limits || {});
  if (rows.length === 0) return "<p>No data.</p>";

  return `
    <div class="grid2">
      ${rows.map(([name, value]) => `
        <div class="detailCard">
          <strong>${escapeHtml(name)}</strong>
          <p class="smallCopy">Used ${num(value?.used)} of ${num(value?.max)}</p>
          <div class="inlineMeta">${escapeHtml(value?.status || "-")}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function soqlTable(items) {
  if (items.length === 0) return "<p>No data.</p>";
  return `
    <div class="tableWrap">
      <table>
        <thead>
          <tr><th>Name</th><th>Rows</th><th>Duration</th><th>Line #</th></tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td>${escapeHtml(item.label)}</td>
              <td>${num(item.rows)}</td>
              <td>${escapeHtml(formatMs(item.durationMs))}</td>
              <td>${evidenceButton(item, "Open") || "-"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function dmlTable(items) {
  if (items.length === 0) return "<p>No data.</p>";
  return `
    <div class="tableWrap">
      <table>
        <thead>
          <tr><th>Operation</th><th>Object</th><th>Rows</th><th>Duration</th></tr>
        </thead>
        <tbody>
          ${items.map((item) => `
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
  `;
}

export function renderReport(report) {
  const issues = report.diagnostics.issues;
  const errors = issues.filter((item) => item.severity === "error");
  const warnings = issues.filter((item) => item.severity !== "error");
  const parserWarnings = report.diagnostics.parserWarnings.map((item, index) => ({
    id: `parser-warning-${index + 1}`,
    summary: item.text,
    type: item.phase || "Parser Warning",
    evidence: {},
  }));

  return `
    <section class="viewPanel">
      <section class="panel" id="summaryPanel">
        <div class="rawLogHeader">
          <div>
            <h2>Overview</h2>
            <p class="subheading">Transaction metadata, timing, and database activity</p>
          </div>
        </div>
        <div class="sectionBody">
          <div class="grid2">
            <div class="detailCard">
              <strong>Transaction Identity</strong>
              <p class="smallCopy">Entry point</p>
              <div class="mono">${escapeHtml(report.summary.title)}</div>
              <p class="smallCopy">Request type</p>
              <div>${escapeHtml(report.summary.requestType || "-")}</div>
              <p class="smallCopy">Namespaces</p>
              <div>${escapeHtml(formatList(report.summary.namespaces))}</div>
              <p class="smallCopy">User</p>
              <div>${escapeHtml(report.summary.user || "-")}</div>
            </div>
            <div class="detailCard">
              <strong>Activity Snapshot</strong>
              <p class="smallCopy">Outcome ${escapeHtml(report.summary.status.outcome.toUpperCase())}</p>
              <p class="smallCopy">Runtime ${escapeHtml(formatMs(report.summary.durationMs))}</p>
              <p class="smallCopy">CPU ${escapeHtml(formatMs(report.summary.topMetrics.cpuTimeMs))}</p>
              <p class="smallCopy">SOQL ${num(report.summary.topMetrics.soqlCount)} / rows ${num(report.summary.topMetrics.soqlRows)}</p>
              <p class="smallCopy">DML ${num(report.summary.topMetrics.dmlCount)} / rows ${num(report.summary.topMetrics.dmlRows)}</p>
            </div>
          </div>
          <div class="stack" style="margin-top:16px;">
            ${report.summary.highlights.length === 0
              ? '<p>No highlights.</p>'
              : report.summary.highlights.map((item) => `
                <article class="detailCard">
                  <strong>${escapeHtml(item.title)}</strong>
                  <p class="smallCopy">${escapeHtml(item.summary)}</p>
                  <div class="actionRow">
                    <span class="topbar-pill topbar-pill-muted">${escapeHtml(item.kind)}</span>
                    ${evidenceButton(item, "Jump to line")}
                  </div>
                </article>
              `).join("")}
          </div>
        </div>
      </section>

      <section class="panel" id="resourceUsagePanel">
        <div class="rawLogHeader">
          <div>
            <h2>Resource Usage</h2>
            <p class="subheading">Limit consumption and package breakdown</p>
          </div>
        </div>
        <div class="sectionBody">
          ${limitsMarkup(report.data.limits)}
          <div class="grid2" style="margin-top:16px;">
            <div class="detailCard">
              <strong>Savepoints</strong>
              ${report.data.savepoints.length === 0
                ? '<p class="smallCopy">No savepoints or rollback markers were detected.</p>'
                : report.data.savepoints.map((item, index) => `<div class="smallCopy">${escapeHtml(item?.label || item?.name || `Savepoint ${index + 1}`)}</div>`).join("")}
            </div>
            <div class="detailCard">
              <strong>Instrumentation</strong>
              <p class="smallCopy">Debug levels: ${report.diagnostics.debugQuality ? "present" : "not present"}</p>
              <p class="smallCopy">System mode transitions: ${num(report.diagnostics.systemMode.length)}</p>
              <p class="smallCopy">Heap analysis: ${report.diagnostics.heap ? "present" : "not present"}</p>
            </div>
          </div>
        </div>
      </section>

      <section class="panel" id="errorsPanel" ${errors.length === 0 ? "hidden" : ""}>
        <div class="rawLogHeader">
          <div>
            <h2>Exceptions</h2>
            <p class="subheading">Top issues classified as errors</p>
          </div>
          <span class="pillBtn">${num(errors.length)} total</span>
        </div>
        <div class="sectionBody">
          ${issueRows(errors, "No exceptions were reported.")}
        </div>
      </section>

      <section class="panel" id="warningsPanel" ${(warnings.length === 0 && parserWarnings.length === 0) ? "hidden" : ""}>
        <div class="rawLogHeader">
          <div>
            <h2>Warnings</h2>
            <p class="subheading">Warnings and parser caveats</p>
          </div>
          <span class="pillBtn">${num(warnings.length + parserWarnings.length)} total</span>
        </div>
        <div class="sectionBody">
          ${issueRows([...warnings, ...parserWarnings], "No warnings were reported.")}
        </div>
      </section>

      <section class="panel" id="dmlPanel">
        <div class="rawLogHeader">
          <div>
            <h2>DML Rows</h2>
            <p class="subheading">Total records inserted, updated, deleted, or upserted</p>
          </div>
          <span class="pillBtn">${num(report.data.dml.length)} total</span>
        </div>
        <div class="sectionBody">
          ${dmlTable(report.data.dml)}
        </div>
      </section>

      <section class="panel" id="problematicQueriesPanel">
        <div class="rawLogHeader">
          <div>
            <h2>SOQL Queries</h2>
            <p class="subheading">Top queries ranked by runtime</p>
          </div>
          <span class="pillBtn">${num(report.data.soql.length)} total</span>
        </div>
        <div class="sectionBody">
          ${soqlTable(report.data.soql)}
        </div>
      </section>
    </section>
  `;
}
