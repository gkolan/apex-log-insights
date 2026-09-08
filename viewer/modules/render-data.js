import { logLineCell, sourceLineCell } from "./shared-evidence.js";
import { escapeHtml, formatMs, num } from "./shared-format.js";
import { renderLimits, renderLimitHealth } from "./render-limits.js";
import {
  renderN1Banner,
  renderValidationBlocks,
  renderSoqlPatterns,
  renderSoqlGrouped,
} from "./render-queries.js";

function isDataSectionExpanded(state, key) {
  return Array.isArray(state?.expanded) && state.expanded.includes(key);
}

function takeVisibleDataItems(items, expanded, limit) {
  const arr = Array.isArray(items) ? items : [];
  return expanded ? arr : arr.slice(0, limit);
}

function dataExpandButton(key, expanded, total, limit) {
  if (total <= limit) return "";
  return `<button class="actionBtn" type="button" data-toggle-section="${escapeHtml(key)}" aria-expanded="${expanded ? "true" : "false"}">${expanded ? "Show fewer" : `Show all (${num(total)})`}</button>`;
}

function formatDataPct(value) {
  return value === null || value === undefined
    ? "-"
    : `${Math.round(Number(value))}%`;
}

function renderTrajectoryChart(points) {
  const usable = points.filter(
    (point) => point.timestampNs !== null && point.cpuUsed !== null,
  );
  if (usable.length < 2) {
    return '<p class="smallCopy">At least two CPU limit snapshots are required for a trajectory.</p>';
  }
  const minTime = usable[0].timestampNs;
  const maxTime = usable[usable.length - 1].timestampNs;
  const maxValue = Math.max(...usable.map((point) => point.cpuUsed), 1);
  const coordinates = usable
    .map((point) => {
      const x = maxTime === minTime ? 0 : ((point.timestampNs - minTime) / (maxTime - minTime)) * 100;
      const y = 38 - (point.cpuUsed / maxValue) * 34;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return `<figure class="dataFigure"><svg class="trajectoryChart" viewBox="0 0 100 42" role="img" aria-labelledby="cpuTrajectoryTitle cpuTrajectoryDesc" preserveAspectRatio="none"><title id="cpuTrajectoryTitle">CPU use over the transaction</title><desc id="cpuTrajectoryDesc">CPU use increased from ${num(usable[0].cpuUsed)} to ${num(usable[usable.length - 1].cpuUsed)} milliseconds across ${num(usable.length)} snapshots.</desc><line x1="0" y1="38" x2="100" y2="38" class="chartAxis"></line><polyline points="${coordinates}" class="chartLine"></polyline></svg><figcaption>${num(usable.length)} snapshots · peak ${num(maxValue)} ms</figcaption></figure>`;
}

function renderRecordGraph(groups) {
  if (groups.length === 0) {
    return '<p class="smallCopy">No record IDs were observed in parsed variable assignments.</p>';
  }
  const maxCount = Math.max(...groups.map((group) => group.recordCount), 1);
  return `<div class="recordGraph">${groups.map((group) => `<details class="listCard"><summary><span><strong class="listTitle">${escapeHtml(group.sObjectType)}</strong><span class="inlineMeta">${num(group.recordCount)} record(s)${group.keyPrefix ? ` · ${escapeHtml(group.keyPrefix)}` : ""}</span></span><span class="recordBar" aria-hidden="true"><span style="--record-width:${Math.max(4, (group.recordCount / maxCount) * 100)}%"></span></span></summary><div class="stack recordDetails">${group.records.length === 0 ? '<p class="smallCopy">Record detail was not retained.</p>' : group.records.map((record) => `<div class="detailCard"><strong class="mono">${escapeHtml(record.id)}</strong><div class="smallCopy">${num(record.fields.length)} field(s) · ${num(record.relationships.length)} relationship(s)</div></div>`).join("")}${group.recordsTruncated ? `<p class="smallCopy">Showing the first ${num(group.records.length)} of ${num(group.recordCount)} records.</p>` : ""}</div></details>`).join("")}</div>`;
}

function renderAutomation(blocks) {
  if (blocks.length === 0) {
    return '<p class="smallCopy">No Flow or Workflow execution blocks were observed.</p>';
  }
  return `<div class="stack">${blocks.map((block) => `<details class="listCard"><summary><span><strong class="listTitle">${escapeHtml(block.label)}</strong><span class="inlineMeta">${escapeHtml(block.kind === "flow" ? "Flow" : "Workflow")} · ${num(block.eventCount)} event(s) · ${num(block.errorCount)} error(s) · ${escapeHtml(formatMs(block.durationMs))}</span></span></summary><ol class="automationSteps">${block.steps.map((step) => `<li><span class="mono">${escapeHtml(step.type)}</span>${step.text ? `<span>${escapeHtml(step.text)}</span>` : ""}${step.lineNumber ? `<a href="#evidence?line=${step.lineNumber}" data-evidence-line="${step.lineNumber}">Log line ${step.lineNumber}</a>` : ""}</li>`).join("")}</ol></details>`).join("")}</div>`;
}

export function renderData(report, state = {}) {
  const showAllSoql = isDataSectionExpanded(state, "data-soql");
  const showAllDml = isDataSectionExpanded(state, "data-dml");
  const showAllCallouts = isDataSectionExpanded(state, "data-callouts");
  const showAllSavepoints = isDataSectionExpanded(state, "data-savepoints");
  const showAllPhaseHeadroom = isDataSectionExpanded(state, "data-phase-headroom");
  const showAllPatterns = isDataSectionExpanded(state, "data-soql-patterns");
  const soqlGrouped = isDataSectionExpanded(state, "soql-grouped");
  const visibleSoql = takeVisibleDataItems(report.data.soql, showAllSoql, 10);
  const visibleDml = takeVisibleDataItems(report.data.dml, showAllDml, 10);
  // Prefer unified integrationOperations (v0.15.0+); fall back to callouts for old reports
  const externalCallsSource =
    report.data.integrationOperations?.length > 0 ||
    report.data.integrationOperationTotalCount > 0
      ? report.data.integrationOperations
      : report.data.callouts;
  const visibleCallouts = takeVisibleDataItems(externalCallsSource, showAllCallouts, 8);
  const visibleSavepoints = takeVisibleDataItems(
    report.data.savepoints,
    showAllSavepoints,
    8,
  );
  const visiblePhaseHeadroom = takeVisibleDataItems(
    report.data.phaseHeadroom,
    showAllPhaseHeadroom,
    8,
  );
  const visiblePatterns = takeVisibleDataItems(
    report.data.soqlPatterns,
    showAllPatterns,
    8,
  );
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
          </div>
        </div>
        <div class="sectionBody${soqlGrouped ? "" : " grid2"}">
          <div class="tableWrap">
            <div class="actionRow" style="margin-bottom:8px;gap:6px;">
              <button class="pillBtn${soqlGrouped ? " active" : ""}" type="button" data-toggle-section="soql-grouped">Group by query</button>
              ${soqlGrouped ? "" : dataExpandButton("data-soql", showAllSoql, report.data.soqlTotalCount, 10)}
            </div>
            ${
              soqlGrouped
                ? renderSoqlGrouped(
                    report.data.soqlPatterns,
                    report.data.soql,
                    state,
                  )
                : `<table>
              <thead>
                <tr><th>SOQL</th><th>Rows</th><th>Duration</th><th>Action</th><th>Source line</th><th>Log line</th></tr>
              </thead>
              <tbody>
                ${
                  visibleSoql.length === 0
                    ? '<tr><td colspan="6">No SOQL data.</td></tr>'
                    : visibleSoql
                        .map(
                          (item) => `
                    <tr>
                      <td>
                        ${escapeHtml(
                          String(item.label || "")
                            .replace(/\s+/g, " ")
                            .trim(),
                        )}
                        ${
                          item.explain
                            ? `<br><span class="smallCopy textMuted" title="${escapeHtml(item.explain.raw || "")}">Explain: ${
                                item.explain.available === false
                                  ? "Unavailable"
                                  : (() => {
                                      const op = String(
                                        item.explain.leadingOperationType || "",
                                      ).trim();
                                      const rows = Number(
                                        item.explain.cardinality,
                                      );
                                      if (
                                        op &&
                                        Number.isFinite(rows) &&
                                        rows >= 0
                                      )
                                        return `${escapeHtml(op)} &middot; ${num(rows)} rows`;
                                      const cost = Number(
                                        item.explain.relativeCost,
                                      );
                                      const rowLabel =
                                        Number.isFinite(rows) && rows >= 0
                                          ? num(rows)
                                          : "-";
                                      const costLabel = Number.isFinite(cost)
                                        ? num(cost)
                                        : "-";
                                      return `Cost: ${costLabel} &middot; Cardinality: ${rowLabel}${item.explain.indexed ? " (Indexed)" : ""}`;
                                    })()
                              }</span>`
                            : ""
                        }
                      </td>
                      <td>${num(item.rows)}</td>
                      <td>${escapeHtml(formatMs(item.durationMs))}</td>
                      <td><button class="copyBtn pillBtn" type="button" data-copy="${escapeHtml(item.fullQuery || item.label)}" title="Copy SOQL to clipboard">Copy</button></td>
                      <td>${sourceLineCell(item)}</td>
                      <td>${logLineCell(item)}</td>
                    </tr>
                  `,
                        )
                        .join("")
                }
              </tbody>
            </table>`
            }
          </div>
          <div class="tableWrap">
            <div class="actionRow" style="margin-bottom:8px;">${dataExpandButton("data-dml", showAllDml, report.data.dmlTotalCount, 10)}</div>
            <table>
              <thead>
                <tr><th>DML</th><th>Object</th><th>Rows</th><th>Duration</th></tr>
              </thead>
              <tbody>
                ${
                  visibleDml.length === 0
                    ? '<tr><td colspan="4">No DML data.</td></tr>'
                    : visibleDml
                        .map(
                          (item) => `
                    <tr>
                      <td>${escapeHtml(item.operation)}</td>
                      <td>${escapeHtml(item.sObject)}</td>
                      <td>${num(item.rows)}</td>
                      <td>${escapeHtml(formatMs(item.durationMs))}</td>
                    </tr>
                  `,
                        )
                        .join("")
                }
              </tbody>
            </table>
          </div>
        </div>
      </article>

      <article class="sectionCard panel">
        <div class="sectionHead rawLogHeader">
          <div>
            <h2 class="sectionTitle">Resource Trajectory</h2>
            <p class="sectionCopy subheading">See how CPU consumption changed during the transaction, not only its final value.</p>
          </div>
        </div>
        <div class="sectionBody">${renderTrajectoryChart(report.data.limitTrajectory)}</div>
      </article>

      <article class="sectionCard panel">
        <div class="sectionHead rawLogHeader"><div><h2 class="sectionTitle">Records and Automation</h2><p class="sectionCopy subheading">Connect the records found in assignments with observed Flow and Workflow activity.</p></div></div>
        <div class="sectionBody grid2"><div class="detailCard"><strong>Record Graph</strong><p class="smallCopy">${num(report.data.recordTotalCount)} unique record(s) across ${num(report.data.recordGraph.length)} object type(s).</p>${renderRecordGraph(report.data.recordGraph)}</div><div class="detailCard"><strong>Automation Story</strong>${renderAutomation(report.data.automation)}</div></div>
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
          <div class="actionRow" style="margin-bottom:8px;">${dataExpandButton("data-callouts", showAllCallouts, report.data.integrationOperationTotalCount || report.data.calloutTotalCount, 8)}</div>
          <div class="tableWrap">
            <table>
              <thead>
                <tr><th>Named Credential</th><th>Method</th><th>Host</th><th>Endpoint</th><th>Status</th><th>Duration</th><th>Source line</th><th>Log line</th></tr>
              </thead>
              <tbody>
                ${
                  visibleCallouts.length === 0
                    ? '<tr><td colspan="8">No external call data.</td></tr>'
                    : visibleCallouts
                        .map((item) => {
                          const status =
                            item.statusCode !== null
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
                        <td>${sourceLineCell(item)}</td>
                        <td>${logLineCell(item)}</td>
                      </tr>
                    `;
                        })
                        .join("")
                }
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
              <div class="actionRow" style="margin:8px 0;">${dataExpandButton("data-savepoints", showAllSavepoints, report.data.savepointTotalCount, 8)}</div>
              ${
                visibleSavepoints.length === 0
                  ? '<p class="smallCopy">No savepoints or rollback markers were detected.</p>'
                  : `<div class="smallCopy">${num(visibleSavepoints.length)} of ${num(report.data.savepointTotalCount)} item(s)</div>${visibleSavepoints.map((item, index) => `<div class="listCard">${escapeHtml(item?.label || item?.name || `Savepoint ${index + 1}`)}</div>`).join("")}`
              }
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
            <div class="actionRow" style="margin:8px 0;">${dataExpandButton("data-phase-headroom", showAllPhaseHeadroom, report.data.phaseHeadroomTotalCount, 8)}</div>
            ${
              visiblePhaseHeadroom.length === 0
                ? '<p class="smallCopy">No phase headroom projections were present.</p>'
                : `<div class="smallCopy">${num(visiblePhaseHeadroom.length)} of ${num(report.data.phaseHeadroomTotalCount)} phase projection(s)</div><div class="stack">${visiblePhaseHeadroom
                    .map(
                      (item) => `
                <div class="listCard">
                  <strong class="listTitle">${escapeHtml(item.label)}</strong>
                  <div class="inlineMeta">SOQL ${escapeHtml(formatDataPct(item.soqlPctAfter))} &middot; DML ${escapeHtml(formatDataPct(item.dmlPctAfter))} &middot; CPU ${escapeHtml(formatDataPct(item.cpuPctAfter))}</div>
                  <div class="smallCopy">${num(item.phasesRemaining)} phase(s) remaining${item.warning ? ` &middot; ${escapeHtml(item.warning)}` : ""}</div>
                </div>
              `,
                    )
                    .join("")}</div>`
            }
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
            <div class="actionRow" style="margin-bottom:8px;">${dataExpandButton("data-soql-patterns", showAllPatterns, report.data.soqlPatternTotalCount, 8)}</div>
            <strong>SOQL Patterns</strong>
            ${renderSoqlPatterns(visiblePatterns)}
          </div>
        </div>
      </article>
    </section>
  `;
}
