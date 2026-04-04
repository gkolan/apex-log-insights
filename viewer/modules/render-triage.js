import { evidenceButton } from "./shared-evidence.js";
import { escapeHtml, formatList, formatMs, num } from "./shared-format.js";

export function renderTriage(report) {
  const statusClass = `status-${escapeHtml(report.summary.status.outcome)}`;
  const highlights = report.summary.highlights;
  const highlightHtml = highlights.length === 0
    ? '<div class="emptyInline">No evidence-backed highlights were emitted for this report.</div>'
    : `
      <div class="stack">
        ${highlights.map((item) => `
          <article class="listCard">
            <strong class="listTitle">${escapeHtml(item.title)}</strong>
            <p class="smallCopy">${escapeHtml(item.summary)}</p>
            <div class="actionRow">
              <span class="confidencePill">${escapeHtml(item.kind)}</span>
              ${evidenceButton(item, "Jump to evidence")}
            </div>
          </article>
        `).join("")}
      </div>
    `;

  return `
    <section class="viewPanel">
      <article class="sectionCard panel">
        <div class="sectionHead rawLogHeader">
          <div>
            <h2 class="sectionTitle">What happened</h2>
            <p class="sectionCopy subheading">Lead with the outcome, then use evidence-backed highlights to decide where to drill in.</p>
          </div>
          <div class="actionRow">
            <span class="statusPill ${statusClass}">${escapeHtml(report.summary.status.outcome.toUpperCase())}</span>
            <span class="metaPill">${num(report.summary.status.errorCount)} errors</span>
            <span class="metaPill">${num(report.summary.status.warningCount)} warnings</span>
          </div>
        </div>
        <div class="sectionBody grid2">
          <div>
            ${highlightHtml}
          </div>
          <div class="stack">
            <div class="detailCard">
              <strong>Transaction Identity</strong>
              <p class="smallCopy">Entry point</p>
              <div class="mono">${escapeHtml(report.summary.title)}</div>
              <p class="smallCopy">Request type</p>
              <div>${escapeHtml(report.summary.requestType || "-")}</div>
              <p class="smallCopy">Namespaces</p>
              <div>${escapeHtml(formatList(report.summary.namespaces))}</div>
            </div>
            <div class="detailCard">
              <strong>Dominant Cost Snapshot</strong>
              <p class="smallCopy">Runtime ${escapeHtml(formatMs(report.summary.topMetrics.durationMs))} · CPU ${escapeHtml(formatMs(report.summary.topMetrics.cpuTimeMs))}</p>
              <p class="smallCopy">SOQL ${num(report.summary.topMetrics.soqlCount)} / rows ${num(report.summary.topMetrics.soqlRows)}</p>
              <p class="smallCopy">DML ${num(report.summary.topMetrics.dmlCount)} / rows ${num(report.summary.topMetrics.dmlRows)}</p>
              <div class="actionRow" style="margin-top:8px;">
                ${report.summary.quickLinks.map((item) => `<button class="actionBtn" type="button" data-nav-view="${escapeHtml(item.view)}">${escapeHtml(item.label)}</button>`).join("")}
              </div>
            </div>
          </div>
        </div>
      </article>
    </section>
  `;
}
