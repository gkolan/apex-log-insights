import { logLineCell, sourceLineCell } from "./shared-evidence.js";
import { escapeHtml, formatMs, num } from "./shared-format.js";

function isQueryOptionActive(state, key) {
  return Array.isArray(state?.expanded) && state.expanded.includes(key);
}

export function renderN1Banner(rows) {
  const suspects = rows.filter((row) => row.isLoopSuspect);
  if (suspects.length === 0) return "";
  const top = suspects[0];
  return `
    <article class="detailCard" style="margin-bottom:16px; border-left:4px solid var(--warn-accent);">
      <strong>N+1 SOQL Warning</strong>
      <p class="smallCopy">${num(suspects.length)} loop-suspect pattern(s) detected. Highest repetition: ${escapeHtml(top.targetObject)} ran ${num(top.executionCount)} time(s).</p>
    </article>
  `;
}

export function renderValidationBlocks(rows) {
  if (rows.length === 0) {
    return '<p class="smallCopy">No structured validation blocks were present.</p>';
  }

  return `
    <div class="stack">
      ${rows
        .map(
          (row) => `
        <div class="listCard">
          <strong class="listTitle">${escapeHtml(row.label)}</strong>
          <div class="inlineMeta">${num(row.failedRules.length)} failed of ${num(row.totalRules)} rule(s)</div>
          ${
            row.failedRules.length === 0
              ? '<p class="smallCopy">No failed validation rules in this block.</p>'
              : `<div class="smallCopy">${escapeHtml(row.failedRules.map((rule) => `${rule.name} (${rule.outcome})`).join(", "))}</div>`
          }
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

export function renderSoqlPatterns(rows) {
  if (rows.length === 0) {
    return '<p class="smallCopy">No repeated SOQL patterns were detected.</p>';
  }

  return `
    <div class="stack">
      ${rows
        .map(
          (row) => `
        <div class="listCard">
          <strong class="listTitle">${escapeHtml(row.targetObject)}${row.isLoopSuspect ? ' <span class="smallCopy">&middot; N+1 Candidate</span>' : ""}</strong>
          <div class="inlineMeta">${num(row.executionCount)} execution(s) &middot; ${num(row.totalRows)} row(s) &middot; ${escapeHtml(formatMs(row.avgDurationMs))} avg</div>
          <div class="smallCopy">${escapeHtml(row.pattern)}</div>
          ${row.loopEvidence ? `<div class="smallCopy">${escapeHtml(row.loopEvidence)}</div>` : ""}
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

export function renderSoqlGrouped(allPatterns, allSoql, state) {
  if (allPatterns.length === 0) {
    return '<p class="smallCopy">No SOQL pattern data available for grouped view.</p>';
  }

  const sortByCount = isQueryOptionActive(state, "soql-sort-count");
  const sortByRows = isQueryOptionActive(state, "soql-sort-rows");
  const sortKey = sortByCount
    ? "executionCount"
    : sortByRows
      ? "totalRows"
      : "totalDurationMs";

  const sorted = allPatterns.slice().sort((a, b) => {
    if (sortKey === "executionCount")
      return b.executionCount - a.executionCount;
    if (sortKey === "totalRows") return b.totalRows - a.totalRows;
    return b.totalDurationMs - a.totalDurationMs;
  });

  // "Total Duration" button removes whichever alternate sort is active (returns to default)
  const durationResetKey = sortByCount
    ? "soql-sort-count"
    : sortByRows
      ? "soql-sort-rows"
      : "";
  const isDurationActive = !sortByCount && !sortByRows;

  const soqlById = new Map(allSoql.map((s) => [s.id, s]));

  return `
    <div class="actionRow" style="margin-bottom:8px;gap:4px;">
      <span class="smallCopy" style="margin-right:4px;">Sort:</span>
      <button class="pillBtn${isDurationActive ? " active" : ""}" type="button" data-toggle-section="${escapeHtml(durationResetKey)}">Total Duration</button>
      <button class="pillBtn${sortByCount ? " active" : ""}" type="button" data-toggle-section="soql-sort-count">Executions</button>
      <button class="pillBtn${sortByRows ? " active" : ""}" type="button" data-toggle-section="soql-sort-rows">Total Rows</button>
    </div>
    <div class="tableWrap">
      <table class="soqlGroupTable">
        <thead>
          <tr>
            <th>Query</th><th>Exec</th><th>Total Rows</th><th>Total (ms)</th><th>Avg (ms)</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${sorted
            .map((pat) => {
              const expandKey = `soql-group-${pat.id}`;
              const expanded = isQueryOptionActive(state, expandKey);
              const children = pat.queryIds
                .map((id) => soqlById.get(id))
                .filter(Boolean);
              const n1Badge = pat.isLoopSuspect
                ? ' <span class="n1Badge">N+1</span>'
                : "";
              return `
              <tr class="soqlGroupRow${pat.isLoopSuspect ? " n1Suspect" : ""}">
                <td>
                  <div class="soqlGroupLabel"><code class="soql-preview-block">${escapeHtml(pat.pattern)}</code>${n1Badge}</div>
                  <div class="smallCopy">${escapeHtml(pat.targetObject)}</div>
                </td>
                <td>${num(pat.executionCount)}</td>
                <td>${num(pat.totalRows)}</td>
                <td>${escapeHtml(formatMs(pat.totalDurationMs))}</td>
                <td>${escapeHtml(formatMs(pat.avgDurationMs))}</td>
                <td>${children.length > 0 ? `<button class="actionBtn" type="button" data-toggle-section="${escapeHtml(expandKey)}">${expanded ? "Hide" : "Show"}</button>` : ""}</td>
              </tr>
              ${
                expanded && children.length > 0
                  ? `
                <tr class="soqlSubRow">
                  <td colspan="6">
                    <table class="soqlSubTable">
                      <thead><tr><th>SOQL</th><th>Rows</th><th>Duration</th><th>Source line</th><th>Log line</th></tr></thead>
                      <tbody>
                        ${children
                          .map(
                            (item) => `
                          <tr>
                            <td><code class="soql-preview-block">${escapeHtml(
                              String(item.label || "")
                                .replace(/\s+/g, " ")
                                .trim(),
                            )}</code></td>
                            <td>${num(item.rows)}</td>
                            <td>${escapeHtml(formatMs(item.durationMs))}</td>
                            <td>${sourceLineCell(item)}</td>
                            <td>${logLineCell(item)}</td>
                          </tr>
                        `,
                          )
                          .join("")}
                      </tbody>
                    </table>
                  </td>
                </tr>
              `
                  : ""
              }
            `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function renderCallouts(rows) {
  if (rows.length === 0) {
    return '<tr><td colspan="7">No callout data.</td></tr>';
  }

  return rows
    .map((item) => {
      const status =
        item.statusCode !== null
          ? `${item.statusCode}${item.statusText ? ` ${item.statusText}` : ""}`
          : "-";
      return `
      <tr>
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
    .join("");
}

export function renderNamedCredentials(rows) {
  if (rows.length === 0) {
    return '<p class="smallCopy">No named credential activity was detected.</p>';
  }

  return `
    <div class="stack">
      ${rows
        .map((item) => {
          const status =
            item.statusCode !== null
              ? `${item.statusCode}${item.statusText ? ` ${item.statusText}` : ""}`
              : null;
          return `
          <div class="listCard">
            <strong class="listTitle">${escapeHtml(item.credentialName)}</strong>
            <div class="inlineMeta">${escapeHtml(item.method || "-")}${item.endpoint ? ` &middot; ${escapeHtml(item.endpoint)}` : ""}${status ? ` &middot; ${escapeHtml(status)}` : ""} &middot; ${escapeHtml(formatMs(item.durationMs))}</div>
          </div>
        `;
        })
        .join("")}
    </div>
  `;
}
