const SAMPLE_PATH = "../reports/apex-07Lbc00000Ihnw6EAB.apex-insights.json";
const REPORTS_PATH = "../reports/";

function pushUnique(list, value) {
  const text = String(value || "").trim();
  if (!text) return;
  if (!list.includes(text)) list.push(text);
}

function basename(value) {
  return String(value || "").split("/").filter(Boolean).pop() || "";
}

function reportCandidates(availableReports = []) {
  const params = new URLSearchParams(window.location.search || "");
  const requested = String(params.get("report") || "").trim();
  const out = [];
  pushUnique(out, requested || SAMPLE_PATH);
  if (requested && !requested.includes("/")) {
    pushUnique(out, `${REPORTS_PATH}${requested}`);
  }
  for (const value of availableReports) pushUnique(out, value);
  return out;
}

function stripUrlFragments(value) {
  return String(value || "").split("#")[0].split("?")[0];
}

export function parseDirectoryListing(html, basePath = REPORTS_PATH) {
  const out = [];
  const matches = String(html || "").matchAll(/href=["']([^"']+)["']/gi);
  for (const match of matches) {
    const href = stripUrlFragments(match[1]);
    if (!href || href === "/" || href === "../" || !href.endsWith(".json")) continue;
    if (href.startsWith("http://") || href.startsWith("https://")) continue;
    pushUnique(out, href.includes("/") ? href : `${basePath}${href}`);
  }
  return out;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status})`);
  }
  return response.json();
}

async function tryFetchText(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
}

async function availableReports() {
  const html = await tryFetchText(REPORTS_PATH);
  const listed = parseDirectoryListing(html);
  if (listed.length > 0) return listed;
  return [SAMPLE_PATH];
}

function rawLogCandidates(report) {
  const out = [];
  const names = [
    report?.source?.fileName,
    report?.source?.input?.fileName,
    report?.source?.input?.logId ? `apex-${report.source.input.logId}.log` : "",
  ];
  for (const name of names) {
    const base = basename(name);
    if (!base) continue;
    pushUnique(out, `../logs/${base}`);
  }
  return out;
}

async function loadRawLines(report) {
  const embedded = Array.isArray(report?.rawLog?.lines) ? report.rawLog.lines : [];
  if (embedded.length > 0) {
    return embedded.map((entry, index) => ({
      number: Number(entry?.lineNumber ?? entry?.line ?? index + 1),
      text: String(entry?.text ?? entry?.raw ?? ""),
    }));
  }

  for (const url of rawLogCandidates(report)) {
    const text = await tryFetchText(url);
    if (!text) continue;
    return text.split(/\r?\n/).map((line, index) => ({
      number: index + 1,
      text: line,
    }));
  }

  return [];
}

export async function loadReport() {
  const reportOptions = await availableReports();
  let lastError = null;
  for (const candidate of reportCandidates(reportOptions)) {
    try {
      const report = await fetchJson(candidate);
      const rawLines = await loadRawLines(report);
      return {
        report,
        reportUrl: candidate,
        reportOptions,
        rawLines,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Unable to load any report candidates.");
}
