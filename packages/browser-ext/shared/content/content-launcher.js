(() => {
  "use strict";

  const href = String(window.location.href || "");
  const pathname = String(window.location.pathname || "");
  const looksLikeLog =
    /\.log(?:$|[?#])/i.test(href) || /\.log$/i.test(pathname);
  if (!looksLikeLog) return;
  if (document.getElementById("apex-open-launcher")) return;

  function getPageLogText() {
    const pre = document.querySelector("pre");
    if (pre && pre.textContent) return pre.textContent;
    return document.body ? String(document.body.innerText || "") : "";
  }

  function formatBytes(bytes) {
    const size = Number(bytes || 0);
    if (!Number.isFinite(size) || size <= 0) return "Unknown size";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  const MAX_CACHED_LOG_PAYLOADS = 5;
  const MAX_LOG_BYTES = 25 * 1024 * 1024;

  function isCachedLogPayloadKey(key) {
    return /^apex-log-\d+(?:-[a-z0-9]{6})?$/.test(key);
  }

  async function pruneCachedLogPayloads(preserveKey) {
    const stored = await chrome.storage.local.get(null);
    const payloads = Object.entries(stored)
      .filter(([key]) => isCachedLogPayloadKey(key) && key !== preserveKey)
      .sort(
        ([, left], [, right]) =>
          Number(right?.cachedAt || 0) - Number(left?.cachedAt || 0),
      );
    const staleKeys = payloads
      .slice(Math.max(0, MAX_CACHED_LOG_PAYLOADS - 1))
      .map(([key]) => key);
    if (staleKeys.length) {
      await chrome.storage.local.remove(staleKeys);
    }
  }

  function looksLikeSalesforceDebugLog(text) {
    const sample = String(text || "")
      .split(/\r\n|\r|\n/)
      .slice(0, 160)
      .join("\n");
    if (!sample.trim()) return false;
    const eventMatches =
      sample.match(
        /\b(CODE_UNIT_STARTED|USER_DEBUG|SOQL_EXECUTE_BEGIN|DML_BEGIN|EXECUTION_STARTED|LIMIT_USAGE_FOR_NS|CUMULATIVE_LIMIT_USAGE)\b/g,
      ) || [];
    const timestampedLines =
      sample.match(
        /^\d{2}:\d{2}:\d{2}\.\d{1,3}\s*\(\d+\)\|[A-Z][A-Z0-9_]*\|/gm,
      ) || [];
    return timestampedLines.length >= 3 || eventMatches.length >= 3;
  }

  const pageText = getPageLogText();
  const fileName = pathname.split("/").filter(Boolean).pop() || "debug.log";
  const byteSize = new TextEncoder().encode(pageText).length;
  const isSalesforceLog = looksLikeSalesforceDebugLog(pageText);
  const isOversized = byteSize > MAX_LOG_BYTES;

  // ─── Active logo SVG (inline data URI to avoid needing web_accessible_resources) ─
  const logoSvgDataUri =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg viewBox="0 0 24 24" width="128" height="128" xmlns="http://www.w3.org/2000/svg">' +
        '<rect x="2" y="2" width="20" height="20" rx="3" fill="#ffffff" stroke="#0066ff" stroke-width="1.5"/>' +
        '<line x1="6" y1="8" x2="18" y2="8" stroke="#ef4444" stroke-width="1.8" stroke-linecap="round"/>' +
        '<line x1="6" y1="12" x2="18" y2="12" stroke="#0066ff" stroke-width="1.8" stroke-linecap="round"/>' +
        '<line x1="6" y1="16" x2="18" y2="16" stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round"/>' +
        "</svg>",
    );

  const root = document.createElement("div");
  root.id = "apex-open-launcher";
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Apex Log Insights log actions");
  root.style.position = "fixed";
  root.style.top = "20px";
  root.style.right = "20px";
  root.style.zIndex = "2147483647";
  root.style.display = "flex";
  root.style.gap = "12px";
  root.style.padding = "16px 18px";
  root.style.border = "1px solid #c9c9c9";
  root.style.borderRadius = "18px";
  // Keep the log-page prompt neutral, independent of the report theme.
  root.style.background = "#ffffff";
  root.style.boxShadow = "0 18px 40px rgba(0,0,0,0.16)";
  root.style.fontFamily =
    "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  root.style.color = "#2e2e2e";
  root.style.flexDirection = "column";
  root.style.alignItems = "flex-start";
  root.style.minWidth = "340px";
  root.style.maxWidth = "500px";
  root.style.backdropFilter = "blur(8px)";

  const brandRow = document.createElement("div");
  brandRow.style.display = "flex";
  brandRow.style.alignItems = "center";
  brandRow.style.gap = "8px";

  const logoImg = document.createElement("img");
  logoImg.src = logoSvgDataUri;
  logoImg.width = 22;
  logoImg.height = 22;
  logoImg.alt = "";
  logoImg.style.flexShrink = "0";

  const label = document.createElement("div");
  label.style.fontSize = "15px";
  label.style.fontWeight = "600";
  label.style.lineHeight = "1.2";
  label.style.letterSpacing = "-0.005em";

  const detail = document.createElement("div");
  detail.style.fontSize = "13px";
  detail.style.lineHeight = "1.45";
  detail.style.fontFamily =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  detail.style.fontWeight = "500";
  detail.style.color = "#5c5c5c";

  if (!isSalesforceLog || isOversized) {
    root.style.border = "1px solid #dd7a01";
    root.style.background = "#fbf3e0";
    label.textContent = isOversized
      ? "This log exceeds the 25 MiB input limit"
      : "This .log file is not a Salesforce debug log";
    detail.textContent = isOversized
      ? `${fileName} • ${formatBytes(byteSize)}. The analyzer did not cache or copy this oversized page.`
      : `${fileName} • ${formatBytes(byteSize)}. Apex Log Insights only auto-analyzes Salesforce debug logs with standard Salesforce event lines.`;
    detail.style.color = "#6f3400";
    brandRow.appendChild(logoImg);
    brandRow.appendChild(label);
    root.appendChild(brandRow);
    root.appendChild(detail);
    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.textContent = "Dismiss";
    dismissBtn.style.border = "1px solid #dd7a01";
    dismissBtn.style.background = "#ffffff";
    dismissBtn.style.color = "#6f3400";
    dismissBtn.style.borderRadius = "10px";
    dismissBtn.style.padding = "8px 11px";
    dismissBtn.style.fontSize = "12px";
    dismissBtn.style.fontWeight = "600";
    dismissBtn.style.lineHeight = "1";
    dismissBtn.style.cursor = "pointer";
    dismissBtn.style.boxShadow = "none";
    dismissBtn.style.transition =
      "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease";
    dismissBtn.addEventListener("click", () => {
      root.remove();
    });
    root.appendChild(dismissBtn);
    document.documentElement.appendChild(root);
    return;
  }

  label.textContent = "Salesforce Debug Log Detected";
  detail.textContent = `${fileName} • ${formatBytes(byteSize)}`;

  const progress = document.createElement("div");
  progress.style.fontSize = "13px";
  progress.style.fontWeight = "500";
  progress.style.lineHeight = "1.4";
  progress.style.color = "#5c5c5c";
  progress.textContent = "Analyzed locally. Your data stays on your machine.";

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  actions.style.marginTop = "0";
  actions.style.flexWrap = "wrap";

  function makeButton(labelText, primary) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = labelText;
    button.style.border = primary ? "1px solid #8c8c8c" : "1px solid #c9c9c9";
    button.style.background = primary ? "#f3f3f3" : "#ffffff";
    button.style.color = primary ? "#2e2e2e" : "#5c5c5c";
    button.style.borderRadius = "10px";
    button.style.padding = primary ? "8px 12px" : "8px 11px";
    button.style.fontSize = "12px";
    button.style.fontWeight = "600";
    button.style.lineHeight = "1";
    button.style.cursor = "pointer";
    button.style.boxShadow = "none";
    button.style.transition =
      "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease";
    return button;
  }

  const openBtn = makeButton("Open Apex Log Insights", true);
  const dismissBtn = makeButton("Dismiss", false);

  let intervalId = null;
  let step = 0;
  const renderProgress = () => {
    const dots = ".".repeat((step % 3) + 1);
    progress.textContent = `Preparing report${dots}`;
    step += 1;
  };

  function stopProgress() {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  }

  function startProgress() {
    stopProgress();
    step = 0;
    renderProgress();
    intervalId = window.setInterval(renderProgress, 350);
  }

  brandRow.appendChild(logoImg);
  brandRow.appendChild(label);
  root.appendChild(brandRow);
  root.appendChild(detail);
  root.appendChild(progress);
  actions.appendChild(openBtn);
  actions.appendChild(dismissBtn);
  root.appendChild(actions);
  document.documentElement.appendChild(root);

  dismissBtn.addEventListener("click", () => {
    stopProgress();
    root.remove();
  });

  openBtn.addEventListener("click", () => {
    openBtn.disabled = true;
    dismissBtn.disabled = true;
    startProgress();

    // Store the already-read log text so app.html never needs to re-fetch it.
    // Re-fetching from a chrome-extension:// page fails due to CORS/auth.
    const storageKey = `apex-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const openAnalyzerWithStorageKey = () => {
      let target;
      try {
        target = chrome.runtime.getURL(
          `app.html?storageKey=${encodeURIComponent(storageKey)}`,
        );
      } catch (error) {
        stopProgress();
        root.style.border = "1px solid #b60554";
        root.style.background = "#fef0f3";
        label.textContent = "Apex Log Insights was reloaded";
        detail.textContent =
          "The old content script lost its extension context. Refresh this page to reopen the analyzer.";
        progress.textContent =
          error instanceof Error
            ? error.message
            : "Extension context invalidated.";
        progress.style.color = "#8a033e";
        openBtn.disabled = false;
        dismissBtn.disabled = false;
        return false;
      }
      stopProgress();
      window.location.assign(target);
      return true;
    };

    const openAnalyzerWithSourceUrl = () => {
      let target;
      try {
        target = chrome.runtime.getURL(
          `app.html?sourceUrl=${encodeURIComponent(href)}`,
        );
      } catch (error) {
        stopProgress();
        root.style.border = "1px solid #b60554";
        root.style.background = "#fef0f3";
        label.textContent = "Failed to open analyzer";
        detail.textContent =
          error instanceof Error
            ? error.message
            : "Extension context invalidated.";
        progress.textContent = "";
        progress.style.color = "#8a033e";
        openBtn.disabled = false;
        dismissBtn.disabled = false;
        return false;
      }
      stopProgress();
      window.location.assign(target);
      return true;
    };

    // Keep a bounded cache so refresh works without retaining every log ever opened.
    pruneCachedLogPayloads(storageKey)
      .then(() =>
        chrome.storage.local.set({
          [storageKey]: {
            logText: pageText,
            fileName,
            fileSizeBytes: byteSize,
            sourceHref: href,
            cachedAt: Date.now(),
          },
        }),
      )
      .then(() => {
        // Verify the write completed before navigating away
        return chrome.storage.local.get(storageKey);
      })
      .then((result) => {
        if (result[storageKey]) {
          openAnalyzerWithStorageKey();
        } else {
          // Storage write didn't persist — fall back to source URL
          if (!openAnalyzerWithSourceUrl()) {
            throw new Error(
              "Storage write failed to persist and source URL fallback unavailable.",
            );
          }
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        const isQuotaError = /quota/i.test(message);
        if (isQuotaError) {
          label.textContent = "Large log detected";
          detail.textContent =
            "Captured storage quota exceeded. Opening analyzer via source URL instead.";
          progress.textContent = "Falling back to source URL launch…";
          progress.style.color = "#60a5fa";
          if (openAnalyzerWithSourceUrl()) return;
        }
        stopProgress();
        root.style.border = "1px solid #b60554";
        root.style.background = "#fef0f3";
        label.textContent = "Failed to prepare log for analysis";
        detail.textContent = message;
        progress.textContent = "";
        progress.style.color = "#8a033e";
        openBtn.disabled = false;
        dismissBtn.disabled = false;
      });
  });
})();
