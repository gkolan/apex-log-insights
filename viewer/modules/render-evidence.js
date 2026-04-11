import { escapeHtml } from "./shared-format.js";



function evidenceHref(lineNumber) {
  const line = Number(lineNumber);
  if (!Number.isFinite(line) || line < 1) return "#evidence";
  return `#evidence?q=${encodeURIComponent(`line:${line}`)}`;
}

function parseQuery(value) {
  const text = String(value || "").trim();
  if (!text) return { kind: "all", value: "" };

  if (/^lines\s*:\s*all$/i.test(text)) {
    return { kind: "all", value: "all" };
  }

  const lineMatch = text.match(/^line\s*:\s*(\d+)$/i);
  if (lineMatch) {
    return { kind: "line", line: Number(lineMatch[1]) };
  }

  const rangeMatch = text.match(/^lines\s*:\s*(\d+)\s*-\s*(\d+)$/i);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    return {
      kind: "range",
      start: Math.min(start, end),
      end: Math.max(start, end),
    };
  }

  return { kind: "text", value: text };
}

function getRegex(query, options) {
  if (query.kind !== "text" || !query.value || !options?.regex) return null;
  // Reject excessively long patterns to mitigate ReDoS
  if (query.value.length > 500) return { error: "Pattern too long (max 500 characters)" };
  try {
    return new RegExp(query.value, options.caseSensitive ? "g" : "gi");
  } catch (err) {
    return { error: String(err?.message || "Invalid regex") };
  }
}

/** Returns the regex parse error message if the current query + options produce an invalid regex, else null. */
function getRegexError(query, options) {
  const r = getRegex(query, options);
  return r && r.error ? r.error : null;
}

function markMatches(text, query, options) {
  if (!query || query.kind !== "text" || !query.value) {
    return escapeHtml(text);
  }

  const source = String(text || "");
  const regex = getRegex(query, options);
  if (regex && !regex.error) {
    let out = "";
    let lastIndex = 0;
    for (const match of source.matchAll(regex)) {
      const index = match.index ?? -1;
      if (index < 0) continue;
      out += escapeHtml(source.slice(lastIndex, index));
      out += `<mark>${escapeHtml(match[0])}</mark>`;
      lastIndex = index + match[0].length;
      if (match[0].length === 0) break;
    }
    out += escapeHtml(source.slice(lastIndex));
    return out || escapeHtml(source);
  }

  const target = options?.caseSensitive ? query.value : query.value.toLowerCase();
  const searchSource = options?.caseSensitive ? source : source.toLowerCase();
  let index = 0;
  let out = "";

  while (index < source.length) {
    const found = searchSource.indexOf(target, index);
    if (found === -1) {
      out += escapeHtml(source.slice(index));
      break;
    }
    out += escapeHtml(source.slice(index, found));
    out += `<mark>${escapeHtml(source.slice(found, found + target.length))}</mark>`;
    index = found + target.length;
  }

  return out;
}

function filterLines(lines, query, options) {
  if (query.kind === "all") return lines;
  if (query.kind === "line") return lines.filter((line) => line.number === query.line);
  if (query.kind === "range") return lines.filter((line) => line.number >= query.start && line.number <= query.end);
  const regex = getRegex(query, options);
  if (regex && !regex.error) {
    return lines.filter((line) => {
      regex.lastIndex = 0;
      return regex.test(line.text);
    });
  }
  if (regex && regex.error) return lines; // invalid regex — don't silently degrade to text search
  if (options?.caseSensitive) {
    return lines.filter((line) => line.text.includes(query.value));
  }
  return lines.filter((line) => line.text.toLowerCase().includes(query.value));
}

export function renderEvidence(report, state) {
  const lines = report?.evidence?.rawLines ?? [];
  const evidenceIndex = Array.isArray(report?.evidence?.index) ? report.evidence.index : [];
  const query = parseQuery(state.query);
  const searchOptions = {
    regex: Boolean(state?.regex),
    caseSensitive: Boolean(state?.caseSensitive),
  };
  const regexError = getRegexError(query, searchOptions);
  const filtered = filterLines(lines, query, searchOptions);
  const paged = regexError ? [] : filtered;
  const targetLine = state.line ? Number(state.line) : null;

  const lineHtml = regexError
    ? `<div class="emptyInline">Invalid regex — fix the pattern to search. <em>${escapeHtml(regexError)}</em></div>`
    : filtered.length === 0
    ? '<div class="emptyInline">No matching lines. Use <code>line:42</code>, <code>lines:10-40</code>, <code>lines:all</code>, or free text.</div>'
    : `
      <div class="rawViewport">
        ${paged.map((line) => {
          const classes = ["rawLine"];
          const isMatch = query.kind === "text" && query.value && filterLines([line], query, searchOptions).length > 0;
          const isTarget = targetLine && line.number === targetLine;
          if (isMatch) classes.push("isMatch");
          if (isTarget) classes.push("isTarget");
          return `
            <div class="${classes.join(" ")}">
              <div class="rawLineNo">L${line.number}</div>
              <div class="rawLineText">${markMatches(line.text, query, searchOptions)}</div>
            </div>
          `;
        }).join("")}
      </div>
    `;

  return `
    <section class="viewPanel">
      <section class="panel" id="rawLogPanel">
        <div class="sectionHead rawLogHeader rawLogHeader--raw">
          <div>
            <h2 class="sectionTitle">Log Explorer</h2>
            <p class="sectionCopy subheading">Raw lines, exact proof, and line-targeted search</p>
          </div>
        </div>
        <div class="sectionBody stack">
          <div class="rawToolbar">
            <div class="rawSearchField">
              <input id="evidenceSearchInput" class="searchInput" type="text" value="${escapeHtml(state.query || "")}" placeholder="Use line:42, lines:42-90, lines:all, or a search term" />
              <button id="evidenceSearchBtn" class="actionBtn actionBtn-primary rawSearchBtn" type="button">Search</button>
              <button id="evidenceClearBtn" class="actionBtn rawClearBtn" type="button">Clear</button>
            </div>
            <div class="rawCopyActions">
              <label class="smallCopy"><input id="evidenceRegexToggle" type="checkbox" ${state.regex ? "checked" : ""} /> Regex</label>
              <label class="smallCopy"><input id="evidenceCaseToggle" type="checkbox" ${state.caseSensitive ? "checked" : ""} /> Case-sensitive</label>
            </div>
            <div class="rawCopyActions">
              <button id="copyVisibleBtn" class="actionBtn rawCopyBtn" type="button">Copy visible</button>
              <button id="copyMatchedBtn" class="actionBtn rawCopyBtn" type="button">Copy matched</button>
            </div>
          </div>
          <div id="evidenceStatus" class="rawStatus rawSearchStatus">${regexError ? `Regex error: ${escapeHtml(regexError)}` : lines.length ? `${filtered.length} line(s) shown.` : "Raw log lines are unavailable for this report file."}</div>
          <div class="rawLogBody">
            ${lineHtml}
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="sectionHead rawLogHeader">
          <div>
            <h2 class="sectionTitle">Evidence Pointers</h2>
            <p class="sectionCopy subheading">Quick jumps derived from highlights, issues, queries, DML entries, and the structured evidence index.</p>
          </div>
        </div>
        <div class="sectionBody">
          ${report.evidence.lookup.length === 0
            ? '<div class="emptyInline">This report does not include line-linked evidence pointers.</div>'
            : `<div class="stack">${report.evidence.lookup.map((item) => `<div class="listCard"><strong class="listTitle">${escapeHtml(item.label)}</strong><div class="inlineMeta">Log row ${item.rawLogLineNumber}${item.confidence ? ` · ${escapeHtml(item.confidence)}` : ""}</div><div class="actionRow" style="margin-top:8px;">${item.rawLogLineNumber ? `<a class="lineBtn" href="${evidenceHref(item.rawLogLineNumber)}" data-evidence-line="${item.rawLogLineNumber}">Jump to line</a>` : ""}</div></div>`).join("")}</div>`}
        </div>
      </section>

      <section class="panel">
        <div class="sectionHead rawLogHeader">
          <div>
            <h2 class="sectionTitle">Structured Index</h2>
            <p class="sectionCopy subheading">Pointers taken directly from the evidence index so the UI follows the TS report contract.</p>
          </div>
        </div>
        <div class="sectionBody">
          ${evidenceIndex.length === 0
            ? '<div class="emptyInline">No structured evidence-index pointers were available.</div>'
            : `<div class="stack">${evidenceIndex.map((item) => { const jumpLine = item.rawLogLineNumber || item.line || item.startLine; return `<div class="listCard"><strong class="listTitle">${escapeHtml(item.label)}</strong><div class="inlineMeta">${escapeHtml(item.kind)} · L${item.line || item.startLine}${item.confidence ? ` · ${escapeHtml(item.confidence)}` : ""}</div><div class="actionRow" style="margin-top:8px;">${jumpLine ? `<a class="lineBtn" href="${evidenceHref(jumpLine)}" data-evidence-line="${jumpLine}">Jump to line</a>` : ""}</div></div>`; }).join("")}</div>`}
        </div>
      </section>
    </section>
  `;
}
