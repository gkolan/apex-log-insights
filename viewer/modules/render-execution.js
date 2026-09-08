import { evidenceButton } from "./shared-evidence.js";
import { escapeHtml, formatMs, num } from "./shared-format.js";

function isExecutionSectionExpanded(state, key) {
  return Array.isArray(state?.expanded) && state.expanded.includes(key);
}

function takeVisibleExecutionItems(items, expanded, limit) {
  return expanded ? items : items.slice(0, limit);
}

function executionExpandButton(key, expanded, total, limit) {
  if (total <= limit) return "";
  return `<button class="actionBtn" type="button" data-toggle-section="${escapeHtml(key)}" aria-expanded="${expanded ? "true" : "false"}">${expanded ? "Show fewer" : `Show all (${num(total)})`}</button>`;
}

const PHASE_MODEL_COPY = {
  trigger:
    "Canonical Salesforce lifecycle with observed vs inferred confidence.",
  batch:
    "Batch Apex lifecycle: Initialise → Execute Chunk → Finish → Post-Commit.",
  async: "Async Apex lifecycle: Initialise → Execute → Post-Commit.",
  anonymous: "Anonymous Apex lifecycle: Execute → Post-Commit.",
  scheduled: "Scheduled Apex lifecycle: Initialise → Execute → Post-Commit.",
};

export function renderExecution(report, state = {}) {
  const showAllChain = isExecutionSectionExpanded(state, "exec-chain");
  const showAllTree = isExecutionSectionExpanded(state, "exec-tree");
  const showAllHotspots = isExecutionSectionExpanded(state, "exec-hotspots");
  const showAllTriggers = isExecutionSectionExpanded(state, "exec-trigger-names");
  const showAllCascade = isExecutionSectionExpanded(state, "exec-cascade");
  const showAllManagedImpact = isExecutionSectionExpanded(state, "exec-managed-impact");
  const chain = takeVisibleExecutionItems(report.execution.chain, showAllChain, 8);
  const tree = takeVisibleExecutionItems(report.execution.tree || [], showAllTree, 30);
  const phases = report.execution.phases;
  const phaseModel =
    report.diagnostics?.executionContext?.phaseModel || "trigger";
  const phaseDetails = report.execution.phaseDetails;
  const hotspots = takeVisibleExecutionItems(report.execution.hotspots, showAllHotspots, 8);
  const triggerNames = takeVisibleExecutionItems(
    report.execution.triggerNames,
    showAllTriggers,
    12,
  );
  const triggerCascade = takeVisibleExecutionItems(
    report.execution.triggerCascade,
    showAllCascade,
    8,
  );
  const managedImpact = takeVisibleExecutionItems(
    report.execution.managedImpact,
    showAllManagedImpact,
    8,
  );
  const timelineSummary = report.execution.timelineSummary;
  const hotspotDurations = hotspots
    .map((item) => item.durationMs)
    .filter((d) => d != null && d > 0);
  const maxHotspot =
    hotspotDurations.length > 0 ? Math.max(...hotspotDurations) : 1;

  return `
    <section class="viewPanel">
      <section class="panel" id="blocksPanel">
        <div class="sectionHead rawLogHeader">
          <div>
            <h2 class="sectionTitle">What ran, in what order</h2>
            <p class="sectionCopy subheading">Start with the top-level chain, then inspect the lifecycle phases and hotspots.</p>
          </div>
        </div>
        <div class="sectionBody grid2">
          <div class="stack">
            <div class="actionRow">${executionExpandButton("exec-chain", showAllChain, report.execution.chainTotalCount || report.execution.chain.length, 8)}</div>
            ${
              chain.length === 0
                ? '<div class="emptyInline">No top-level execution blocks were available.</div>'
                : chain
                    .map(
                      (item) => `
              <article class="listCard">
                <strong class="listTitle">${escapeHtml(item.label)}</strong>
                <div class="listMeta">${escapeHtml(item.category)} &middot; ${escapeHtml(formatMs(item.durationMs))}</div>
                <div class="actionRow" style="margin-top:8px;">${evidenceButton(item, "Open line")}</div>
              </article>
            `,
                    )
                    .join("")
            }
          </div>
          <div class="stack">
            <div class="detailCard">
              <strong>Lifecycle Phases</strong>
              <p class="smallCopy">${escapeHtml(PHASE_MODEL_COPY[phaseModel] || PHASE_MODEL_COPY.trigger)}</p>
              <ol class="lifecycleStepper">
                ${
                  phases.length === 0
                    ? '<div class="emptyInline">No phases found.</div>'
                    : phases
                        .map(
                          (phase) => `
                  <li class="listCard phase-${escapeHtml(phase.status)}">
                    <strong class="listTitle">${escapeHtml(phase.name)}</strong>
                    <div class="inlineMeta">${escapeHtml(phase.status)}${phase.confidence ? ` &middot; ${escapeHtml(phase.confidence)}` : ""}</div>
                    ${(() => {
                      const detail =
                        phaseDetails.find((item) => item.id === phase.id) ||
                        null;
                      if (!detail)
                        return phase.warnings?.length
                          ? `<p class="smallCopy">${escapeHtml(phase.warnings[0])}</p>`
                          : "";
                      const lineText = detail.startLine
                        ? `L${detail.startLine}${detail.endLine && detail.endLine !== detail.startLine ? `-${detail.endLine}` : ""}`
                        : "No line range";
                      const warningText = detail.warnings.length
                        ? ` &middot; ${escapeHtml(detail.warnings[0])}`
                        : "";
                      const inputParts = [
                        detail.executionType
                          ? `Request ${detail.executionType}`
                          : "",
                        detail.rootCodeUnit
                          ? `Root ${detail.rootCodeUnit}`
                          : "",
                      ].filter(Boolean);
                      return `
                        <p class="smallCopy">Events ${num(detail.observedEventCount)} &middot; SOQL ${num(detail.soqlCount)} &middot; DML ${num(detail.dmlCount)} &middot; ${escapeHtml(lineText)}${warningText}</p>
                        ${inputParts.length === 0 ? "" : `<p class="smallCopy">${escapeHtml(inputParts.join(" / "))}</p>`}
                      `;
                    })()}
                  </li>
                `,
                        )
                        .join("")
                }
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="sectionHead rawLogHeader"><div><h2 class="sectionTitle">Code-Unit Waterfall</h2><p class="sectionCopy subheading">Follow nested execution depth without flattening child code units into unrelated rows.</p></div><div class="actionRow">${executionExpandButton("exec-tree", showAllTree, report.execution.treeTotalCount || 0, 30)}</div></div>
        <div class="sectionBody">
          ${tree.length === 0 ? '<div class="emptyInline">No hierarchical execution blocks were available.</div>' : `<ol class="executionWaterfall">${tree.map((item) => `<li style="--execution-depth:${Math.min(item.depth, 12)}"><div class="waterfallNode"><span class="waterfallConnector" aria-hidden="true"></span><span><strong class="listTitle">${escapeHtml(item.label)}</strong><span class="inlineMeta">${escapeHtml(item.category)} · ${escapeHtml(formatMs(item.durationMs))}</span></span>${evidenceButton(item, "Open line")}</div></li>`).join("")}</ol>`}
        </div>
      </section>

      <section class="panel">
        <div class="sectionHead rawLogHeader">
          <div>
            <h2 class="sectionTitle">Hotspots and Packages</h2>
            <p class="sectionCopy subheading">Use duration-weighted hotspots before expanding into deep trace inspection.</p>
          </div>
        </div>
        <div class="sectionBody grid2">
          <div class="stack">
            <div class="actionRow">${executionExpandButton("exec-hotspots", showAllHotspots, report.execution.hotspotTotalCount || report.execution.hotspots.length, 8)}</div>
            ${
              hotspots.length === 0
                ? '<div class="emptyInline">No hotspot data found.</div>'
                : hotspots
                    .map(
                      (item) => `
              <div class="timelineRow">
                <strong class="listTitle">${escapeHtml(item.label)}</strong>
                <div class="inlineMeta">${escapeHtml(formatMs(item.durationMs))} &middot; SOQL ${num(item.soqlCount)} &middot; DML ${num(item.dmlCount)}</div>
                <div class="timelineTrack"><div class="timelineFill" style="width:${Math.max(8, (item.durationMs / maxHotspot) * 100)}%;"></div></div>
              </div>
            `,
                    )
                    .join("")
            }
          </div>
          <div class="stack">
            <div class="detailCard">
              <strong>Managed Packages</strong>
              ${
                report.execution.packages.length === 0
                  ? '<p class="smallCopy">No managed package activity was reported.</p>'
                  : report.execution.packages
                      .map(
                        (item) =>
                          `<div class="listCard"><strong class="listTitle">${escapeHtml(item.namespace)}</strong><div class="inlineMeta">${escapeHtml(item.packageName)}</div></div>`,
                      )
                      .join("")
              }
            </div>
            <div class="detailCard">
              <strong>Trigger Chain</strong>
              <div class="actionRow" style="margin:8px 0;">${executionExpandButton("exec-trigger-names", showAllTriggers, report.execution.triggerNames.length, 12)}</div>
              ${
                triggerNames.length === 0
                  ? '<p class="smallCopy">No trigger names were surfaced for this report.</p>'
                  : `<div class="stack">${triggerNames.map((name) => `<div class="listCard">${escapeHtml(name)}</div>`).join("")}</div>`
              }
            </div>
            <div class="detailCard">
              <strong>Trigger Cascade</strong>
              <div class="actionRow" style="margin:8px 0;">${executionExpandButton("exec-cascade", showAllCascade, report.execution.triggerCascade.length, 8)}</div>
              ${
                triggerCascade.length === 0
                  ? '<p class="smallCopy">No structured trigger-cascade data was present.</p>'
                  : `<div class="stack">${triggerCascade.map((item) => `<div class="listCard"><strong class="listTitle">${escapeHtml(item.label)}</strong><div class="inlineMeta">Depth ${num(item.depth)} &middot; Children ${num(item.childCount)} &middot; ${escapeHtml(formatMs(item.durationMs))}</div></div>`).join("")}</div>`
              }
            </div>
            <div class="detailCard">
              <strong>Managed Impact</strong>
              <div class="actionRow" style="margin:8px 0;">${executionExpandButton("exec-managed-impact", showAllManagedImpact, report.execution.managedImpact.length, 8)}</div>
              ${
                managedImpact.length === 0
                  ? '<p class="smallCopy">No per-namespace managed-package impact rows were present.</p>'
                  : `<div class="stack">${managedImpact.map((item) => `<div class="listCard"><strong class="listTitle">${escapeHtml(item.namespace)}</strong><div class="inlineMeta">${escapeHtml(formatMs(item.totalDurationMs))} &middot; SOQL ${num(item.soqlCount)} &middot; DML ${num(item.dmlCount)}${item.pctOfTotalDuration !== null ? ` &middot; ${escapeHtml(String(Math.round(item.pctOfTotalDuration)))}% total` : ""}</div></div>`).join("")}</div>`
              }
            </div>
            <div class="detailCard">
              <strong>Timeline Snapshot</strong>
              ${
                timelineSummary.totalEvents === 0
                  ? '<p class="smallCopy">No structured timeline was present for this report.</p>'
                  : `
                  <p class="smallCopy">${num(timelineSummary.totalEvents)} event(s) across ${num(timelineSummary.namespaceCount)} namespace(s).</p>
                  <p class="smallCopy">First: ${escapeHtml(timelineSummary.firstEvent?.type || "-")}${timelineSummary.firstEvent?.lineNumber ? ` &middot; Log line ${timelineSummary.firstEvent.lineNumber}` : ""}</p>
                  <p class="smallCopy">Last: ${escapeHtml(timelineSummary.lastEvent?.type || "-")}${timelineSummary.lastEvent?.lineNumber ? ` &middot; Log line ${timelineSummary.lastEvent.lineNumber}` : ""}</p>
                  ${
                    timelineSummary.topTypes.length === 0
                      ? ""
                      : `<div class="stack">${timelineSummary.topTypes.map((item) => `<div class="listCard"><strong class="listTitle">${escapeHtml(item.type)}</strong><div class="inlineMeta">${num(item.count)} occurrence(s)</div></div>`).join("")}</div>`
                  }
                `
              }
            </div>
          </div>
        </div>
      </section>
    </section>
  `;
}
