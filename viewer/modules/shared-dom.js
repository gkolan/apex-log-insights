/**
 * Copy text to clipboard with textarea fallback for non-HTTPS or permission-denied environments.
 * Throws if both the Clipboard API and the execCommand fallback fail.
 */
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to textarea copy strategy
    }
  }
  // Hidden textarea copy strategy works in all origins without permission grants
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error("Clipboard copy failed (execCommand fallback also failed)");
}

/**
 * Serialise headers + rows to RFC 4180 CSV and trigger a browser download.
 * @param {string} filename - e.g. "apex-insights-soql-2026.csv"
 * @param {string[]} headers - Column headers
 * @param {(string|number|null|undefined)[][]} rows - Data rows
 */
export function downloadCsv(filename, headers, rows) {
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(escape).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export function createFragment(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${String(html || "").trim()}</body>`, "text/html");
  const frag = document.createDocumentFragment();
  while (doc.body.firstChild) {
    frag.appendChild(doc.body.firstChild);
  }
  return frag;
}

export function qs(root, selector) {
  return root.querySelector(selector);
}
