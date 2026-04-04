export function num(value, fallback = "-") {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : String(value);
}

export function formatMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  if (n >= 1000) return `${(n / 1000).toFixed(2)} s`;
  return `${Math.round(n)} ms`;
}

export function formatBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "-";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatList(value) {
  if (!Array.isArray(value) || value.length === 0) return "-";
  return value.join(", ");
}

export function formatSeverity(value) {
  const raw = String(value || "").toLowerCase();
  if (raw === "error") return "error";
  if (raw === "warn" || raw === "warning") return "warn";
  return "info";
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[<>&"']/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

export function truncate(value, max = 180) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

export function byNumberDesc(selector) {
  return (left, right) => Number(selector(right) || 0) - Number(selector(left) || 0);
}
