import { escapeHtml, num } from "./shared-format.js";

const LIMIT_TOOLTIPS = {
  soqlQueries: "Maximum number of SOQL queries per transaction (default: 100)",
  soqlRows: "Maximum total rows returned by all SOQL queries (default: 50,000)",
  dmlStatements: "Maximum DML operations per transaction (default: 150)",
  dmlRows: "Maximum rows affected by all DML operations (default: 10,000)",
  cpuTime: "Maximum Apex CPU execution time in milliseconds (default: 10,000 ms)",
  heapBytes: "Maximum heap memory allocated to Apex code (default: 6 MB sync / 12 MB async)",
  callouts: "Maximum external HTTP callouts per transaction (default: 100)",
  emailInvocations: "Maximum sendEmail() calls per transaction (default: 10)",
  futureCalls: "Maximum @future method calls queued (default: 50)",
  queueables: "Maximum Queueable jobs added to the queue (default: 50)",
};

function limitTooltip(key) {
  return LIMIT_TOOLTIPS[key] ? ` title="${escapeHtml(LIMIT_TOOLTIPS[key])}"` : "";
}

function formatPct(value) {
  return value === null || value === undefined ? "-" : `${Math.round(Number(value))}%`;
}

export function renderLimits(limits) {
  const rows = Object.entries(limits || {});
  if (rows.length === 0) {
    return '<div class="emptyInline">No governor limit data was available.</div>';
  }

  return `
    <div class="tableWrap">
      <table>
        <thead>
          <tr><th>Limit</th><th>Used</th><th>Max</th><th>Status</th></tr>
        </thead>
        <tbody>
          ${rows.map(([name, value]) => `
            <tr>
              <td${limitTooltip(name)}>${escapeHtml(name)}</td>
              <td>${num(value?.used)}</td>
              <td>${num(value?.max)}</td>
              <td>${escapeHtml(value?.status || "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function renderLimitHealth(rows) {
  if (rows.length === 0) {
    return '<div class="emptyInline">No burn-rate or limit-severity data was available.</div>';
  }

  return `
    <div class="tableWrap">
      <table>
        <thead>
          <tr><th>Limit</th><th>Used</th><th>Max</th><th>%</th><th>Status</th></tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td${limitTooltip(row.limitKey || row.id || row.label)}>${escapeHtml(row.label)}</td>
              <td>${num(row.used)}</td>
              <td>${num(row.max)}</td>
              <td>
                ${escapeHtml(formatPct(row.pctUsed))}
                ${row.pctUsed === null || row.pctUsed === undefined ? "" : `<div class="timelineTrack" style="margin-top:6px;"><div class="timelineFill" style="width:${Math.max(0, Math.min(100, Number(row.pctUsed)))}%;"></div></div>`}
              </td>
              <td>${escapeHtml(row.status || "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}
