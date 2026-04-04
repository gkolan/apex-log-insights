import { evidenceButton } from "./shared-evidence.js";
import { escapeHtml, formatBytes } from "./shared-format.js";

function isExpanded(state, key) {
  return Array.isArray(state?.expanded) && state.expanded.includes(key);
}

function takeVisible(items, expanded, limit) {
  const arr = Array.isArray(items) ? items : [];
  return expanded ? arr : arr.slice(0, limit);
}

function expandButton(key, expanded, total, limit) {
  if (total <= limit) return "";
  return `<button class="actionBtn" type="button" data-toggle-section="${escapeHtml(key)}">${expanded ? "Show fewer" : `Show all (${String(total)})`}</button>`;
}

export function renderDiagnostics(report, state = {}) {
  const heapSummary = report.diagnostics.heapSummary;
  const cpuBreakdown = report.diagnostics.cpuBreakdown;
  const showAllIssues = isExpanded(state, "diag-issues");
  const showAllStructural = isExpanded(state, "diag-structural");
  const showAllDebugWarnings = isExpanded(state, "diag-debug-warnings");
  const showAllDebugEvents = isExpanded(state, "diag-debug-events");
  const showAllParserWarnings = isExpanded(state, "diag-parser-warnings");
  const visibleIssues = takeVisible(report.diagnostics.issues, showAllIssues, 12);
  const visibleStructural = takeVisible(report.diagnostics.structuralWarnings, showAllStructural, 8);
  const visibleDebugWarnings = takeVisible(report.diagnostics.debugWarnings, showAllDebugWarnings, 8);
  const visibleDebugEvents = takeVisible(report.diagnostics.debugEvents, showAllDebugEvents, 20);
  const visibleParserWarnings = takeVisible(report.diagnostics.parserWarnings, showAllParserWarnings, 10);
  return `
    <section class="viewPanel">
      <article class="sectionCard panel">
        <div class="sectionHead rawLogHeader">
          <div>
            <h2 class="sectionTitle">What is suspicious</h2>
            <p class="sectionCopy subheading">Surface errors, warnings, confidence, and instrumentation gaps without forcing a raw-log scan first. Showing ${escapeHtml(String(visibleIssues.length))} of ${escapeHtml(String(report.diagnostics.issueCountTotal || 0))} issue(s).</p>
          </div>
        </div>
        <div class="sectionBody">
          <div class="actionRow" style="margin-bottom:8px;">${expandButton("diag-issues", showAllIssues, report.diagnostics.issueCountTotal || 0, 12)}</div>
          <div class="stack">
            ${visibleIssues.length === 0
              ? '<div class="emptyInline">No diagnostic issues were reported.</div>'
              : visibleIssues.map((item) => `
                <article class="issueRow issue-${escapeHtml(item.severity)}">
                  <div class="issueHead">
                    <div>
                      <strong class="listTitle">${escapeHtml(item.summary)}</strong>
                      <div class="inlineMeta">${escapeHtml(item.type)}${item.confidence ? ` · ${escapeHtml(item.confidence)}` : ""}</div>
                    </div>
                    <div class="actionRow">${evidenceButton(item, "Open line")}</div>
                  </div>
                  ${item.detail ? `<div class="smallCopy">${escapeHtml(item.detail)}</div>` : ""}
                </article>
              `).join("")}
          </div>
        </div>
      </article>

      <article class="sectionCard panel">
        <div class="sectionHead rawLogHeader">
          <div>
            <h2 class="sectionTitle">Structural Warnings</h2>
            <p class="sectionCopy subheading">Show transaction-shape risks that are often lost when only the generic issues list is visible.</p>
          </div>
        </div>
        <div class="sectionBody">
          <div class="actionRow" style="margin-bottom:8px;">${expandButton("diag-structural", showAllStructural, report.diagnostics.structuralWarnings.length, 8)}</div>
          <div class="stack">
            ${visibleStructural.length === 0
              ? '<div class="emptyInline">No structured mixed-DML or recursive-trigger warnings were detected.</div>'
              : visibleStructural.map((item) => `
                <article class="issueRow issue-warn">
                  <div class="issueHead">
                    <div>
                      <strong class="listTitle">${escapeHtml(item.type)}</strong>
                      <div class="inlineMeta">${escapeHtml(item.summary)}</div>
                    </div>
                    <div class="actionRow">${evidenceButton(item, "Open line")}</div>
                  </div>
                  ${item.detail ? `<div class="smallCopy">${escapeHtml(item.detail)}</div>` : ""}
                </article>
              `).join("")}
          </div>
        </div>
      </article>

      <article class="sectionCard panel">
        <div class="sectionHead rawLogHeader">
          <div>
            <h2 class="sectionTitle">Instrumentation Quality</h2>
            <p class="sectionCopy subheading">Expose parser confidence and missing-signal caveats so the user knows what is observed vs inferred.</p>
          </div>
        </div>
        <div class="sectionBody grid3">
          <div class="detailCard">
            <strong>Execution Context</strong>
            ${report.diagnostics.executionContext
              ? `<div class="inlineMeta">${escapeHtml(report.diagnostics.executionContext.label)} · ${escapeHtml(report.diagnostics.executionContext.confidence)}</div>${report.diagnostics.executionContext.signals.length > 0 ? `<div class="smallCopy">${escapeHtml(report.diagnostics.executionContext.signals[0])}</div>` : ""}`
              : '<p class="smallCopy">Execution context not detected.</p>'}
          </div>
          <div class="detailCard">
            <strong>Debug Levels</strong>
            <div class="actionRow" style="margin:8px 0;">${expandButton("diag-debug-warnings", showAllDebugWarnings, report.diagnostics.debugWarningCountTotal, 8)}</div>
            ${visibleDebugWarnings.length === 0
              ? `<p class="smallCopy">${report.diagnostics.debugQuality ? "Debug-level quality data is present with no explicit warnings." : "No debug-level quality payload was present."}</p>`
              : `<div class="smallCopy">${escapeHtml(String(visibleDebugWarnings.length))} of ${escapeHtml(String(report.diagnostics.debugWarningCountTotal))} warning(s)</div><div class="stack">${visibleDebugWarnings.map((item) => `<div class="listCard"><strong class="listTitle">${escapeHtml(item.category)}</strong><div class="inlineMeta">${escapeHtml(item.currentLevel)} -> ${escapeHtml(item.recommendation)}</div>${item.impact ? `<div class="smallCopy">${escapeHtml(item.impact)}</div>` : ""}</div>`).join("")}</div>`}
          </div>
          <div class="detailCard">
            <strong>System Mode</strong>
            ${report.diagnostics.systemModeTimeline.length === 0
              ? report.diagnostics.systemMode.length === 0
                ? '<p class="smallCopy">No system mode transitions were recorded.</p>'
                : `<p class="smallCopy">${report.diagnostics.systemMode.length} transition(s) recorded.</p>`
              : `<div class="stack">${report.diagnostics.systemModeTimeline.map((item) => `<div class="listCard"><strong class="listTitle">${escapeHtml(item.direction)} ${escapeHtml(item.state)} mode</strong><div class="inlineMeta">${item.lineNumber ? `L${item.lineNumber}` : "No line"}</div></div>`).join("")}</div>`}
          </div>
          <div class="detailCard">
            <strong>Heap Analysis</strong>
            ${heapSummary
              ? `<div class="smallCopy">Peak ${escapeHtml(formatBytes(heapSummary.peakCumulativeBytes))} · Alloc ${escapeHtml(String(heapSummary.allocationCount))} · Free ${escapeHtml(String(heapSummary.deallocationCount))}</div>${heapSummary.hotspots && heapSummary.hotspots.length > 0
                ? `<div class="tableWrap" style="margin-top:8px;"><table><thead><tr><th>Line</th><th>Allocs</th><th>Namespace</th></tr></thead><tbody>${heapSummary.hotspots.map((h) => `<tr><td>${h.line !== null ? escapeHtml(String(h.line)) : "–"}</td><td>${escapeHtml(String(h.allocations))}</td><td>${escapeHtml(h.namespace || "default")}</td></tr>`).join("")}</tbody></table></div>`
                : ""}`
              : '<p class="smallCopy">No heap analysis payload was present.</p>'}
          </div>
        </div>
        <div class="sectionBody" style="padding-top:0;">
          <div class="detailCard">
            <strong>CPU Attribution</strong>
            ${cpuBreakdown.byType.length === 0 && cpuBreakdown.byNamespace.length === 0
              ? '<p class="smallCopy">No CPU attribution payload was present.</p>'
              : `
                <div class="stack" style="margin-top:10px;">
                  ${cpuBreakdown.byType.length === 0
                    ? ''
                    : `<div class="listCard"><strong class="listTitle">By Type</strong><div class="stack">${cpuBreakdown.byType.map((item) => `<div><div class="inlineMeta">${escapeHtml(item.label)} · ${escapeHtml(String(item.durationMs))} ms</div><div class="smallCopy">${escapeHtml(String(item.count))} span(s)</div></div>`).join("")}</div></div>`}
                  ${cpuBreakdown.byNamespace.length === 0
                    ? ''
                    : `<div class="listCard"><strong class="listTitle">By Namespace</strong><div class="stack">${cpuBreakdown.byNamespace.map((item) => `<div><div class="inlineMeta">${escapeHtml(item.namespace)} · ${escapeHtml(String(item.totalDurationMs))} ms total</div><div class="smallCopy">${escapeHtml(String(item.selfDurationMs))} ms self · ${escapeHtml(String(item.spanCount))} span(s)</div></div>`).join("")}</div></div>`}
                </div>
              `}
          </div>
        </div>
        <div class="sectionBody" style="padding-top:0;">
          <div class="detailCard">
            <strong>Parser Warnings</strong>
            <div class="actionRow" style="margin:8px 0;">${expandButton("diag-parser-warnings", showAllParserWarnings, report.diagnostics.parserWarningCountTotal, 10)}</div>
            ${visibleParserWarnings.length === 0
              ? '<p class="smallCopy">No phase inference warnings were surfaced.</p>'
              : `<div class="smallCopy">${escapeHtml(String(visibleParserWarnings.length))} of ${escapeHtml(String(report.diagnostics.parserWarningCountTotal))} warning(s)</div><div class="stack" style="margin-top:10px;">${visibleParserWarnings.map((item) => `<div class="listCard"><strong class="listTitle">${escapeHtml(item.phase)}</strong><div class="smallCopy">${escapeHtml(item.text)}</div></div>`).join("")}</div>`}
          </div>
        </div>
      </article>

      <article class="sectionCard panel">
        <div class="sectionHead rawLogHeader">
          <div>
            <h2 class="sectionTitle">Debug Output</h2>
            <p class="sectionCopy subheading">Render the full canonical debug stream in timestamp order so users do not need to inspect each span separately.</p>
          </div>
        </div>
        <div class="sectionBody">
          <div class="actionRow" style="margin-bottom:8px;">${expandButton("diag-debug-events", showAllDebugEvents, report.diagnostics.debugEventCountTotal, 20)}</div>
          ${visibleDebugEvents.length === 0
            ? '<div class="emptyInline">No USER_DEBUG events were surfaced.</div>'
            : `
              <div class="smallCopy">${escapeHtml(String(visibleDebugEvents.length))} of ${escapeHtml(String(report.diagnostics.debugEventCountTotal))} debug event(s)</div>
              <div class="stack" style="margin-top:10px;">
                ${visibleDebugEvents.map((item) => `
                  <article class="listCard">
                    <div class="issueHead">
                      <div>
                        <strong class="listTitle">${escapeHtml(item.namespace)}</strong>
                        <div class="smallCopy">${escapeHtml(item.message || '(empty debug message)')}</div>
                      </div>
                      <div class="actionRow">${evidenceButton(item, "Open line")}</div>
                    </div>
                  </article>
                `).join("")}
              </div>
            `}
        </div>
      </article>
    </section>
  `;
}
