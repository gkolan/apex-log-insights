globalThis.__APEX_LOG_INSIGHTS_HOST__ = "vscode";

const vscode = acquireVsCodeApi();
const { showOfflineReport } = await import("./app.js");

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!isObject(message)) return;
  if (message.type === "SHOW_REPORT") {
    if (!isObject(message.report) || !Array.isArray(message.rawLines)) return;
    showOfflineReport({
      report: message.report,
      rawLines: message.rawLines,
      sourceLabel: typeof message.sourceLabel === "string" ? message.sourceLabel : "",
    });
    finishInitializing();
    setStatus(message.isDirty ? "Unsaved content" : "");
  } else if (message.type === "SOURCE_CHANGED") {
    finishInitializing();
    setStatus("Source changed — refresh analysis", true);
  } else if (
    message.type === "SOURCE_UNAVAILABLE" &&
    typeof message.message === "string"
  ) {
    finishInitializing();
    setStatus(message.message, false);
  } else if (message.type === "ANALYSIS_CANCELED") {
    finishInitializing();
    setStatus("Analysis canceled", true);
  } else if (message.type === "ANALYSIS_ERROR" && typeof message.message === "string") {
    finishInitializing();
    setStatus(`Analysis failed: ${message.message}`, true);
  }
});

function finishInitializing() {
  document.body.classList.remove("initializing");
}

function setStatus(label, refresh = false) {
  const banner = document.querySelector("#schemaBanner");
  const text = document.querySelector("#schemaBannerText");
  if (!banner || !text) return;
  text.replaceChildren(document.createTextNode(label));
  const oldButton = banner.querySelector(".vscodeRefreshAnalysis");
  oldButton?.remove();
  if (refresh) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vscodeRefreshAnalysis";
    button.textContent = "Refresh Analysis";
    button.addEventListener("click", () => vscode.postMessage({ type: "REFRESH" }));
    banner.append(button);
  }
  banner.hidden = !label;
}

document.addEventListener(
  "click",
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest("a");
    if (!anchor) return;

    let rawLine = anchor.dataset.line || anchor.dataset.evidenceLine;
    if (!rawLine) {
      const query = new URL(anchor.href).searchParams.get("q") || "";
      const match = /^(?:log|line):(\d+)$/.exec(query);
      rawLine = match?.[1];
    }
    const lineNumber = Number(rawLine);
    if (Number.isInteger(lineNumber) && lineNumber > 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      vscode.postMessage({ type: "OPEN_LOG_LINE", lineNumber });
      return;
    }

    if (anchor.target === "_blank" || /^https?:/i.test(anchor.href)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      vscode.postMessage({ type: "OPEN_EXTERNAL", href: anchor.href });
    }
  },
  true,
);

vscode.postMessage({ type: "READY" });

const privacyLabel = document.querySelector(".top-banner-label");
privacyLabel?.replaceChildren(
  document.createTextNode(
    "Analyzed in your VS Code extension host. Apex Log Insights does not upload this log.",
  ),
);
