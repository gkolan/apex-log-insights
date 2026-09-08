/* ─── Icon paths for each extension state ─────────────────────────────────── */

const ICON_PATHS = {
  active: {
    16: "icons/icon-active-16.png",
    48: "icons/icon-active-48.png",
    128: "icons/icon-active-128.png",
  },
  idle: {
    16: "icons/icon-idle-16.png",
    48: "icons/icon-idle-48.png",
    128: "icons/icon-idle-128.png",
  },
  disabled: {
    16: "icons/icon-disabled-16.png",
    48: "icons/icon-disabled-48.png",
    128: "icons/icon-disabled-128.png",
  },
};

/* ─── Set the toolbar icon for a given tab (or globally) ──────────────────── */

function setIcon(state, tabId) {
  const path = ICON_PATHS[state] || ICON_PATHS.idle;
  const params = { path };
  if (tabId != null) params.tabId = tabId;
  chrome.action.setIcon(params).catch((err) => {
    console.warn("[apex-log-insights]", err.message ?? err);
  });
}

/* ─── Check if file:// access is permitted ────────────────────────────────── */

function isFileAccessAllowed() {
  return new Promise((resolve) => {
    try {
      if (!chrome?.extension?.isAllowedFileSchemeAccess) {
        resolve(false);
        return;
      }
      let timeoutId;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
      };
      timeoutId = setTimeout(() => {
        resolve(false);
      }, 3_000);
      chrome.extension.isAllowedFileSchemeAccess((allowed) => {
        if (chrome.runtime?.lastError) {
          cleanup();
          resolve(false);
          return;
        }
        cleanup();
        resolve(Boolean(allowed));
      });
    } catch {
      resolve(false);
    }
  });
}

/* ─── Update the global icon based on file-access permission ──────────────── */

async function updateGlobalIcon() {
  const allowed = await isFileAccessAllowed();
  setIcon(allowed ? "idle" : "disabled");
}

/* ─── Tab-level icon: active when viewing a log or the report ─────────────── */

function isExtensionReportUrl(url) {
  try {
    const reportUrl = chrome.runtime.getURL("app.html");
    return url.startsWith(reportUrl);
  } catch {
    return false;
  }
}

function updateTabIcon(tabId, url) {
  if (!url) return;
  const looksLikeLog = /\.log(?:$|[?#])/i.test(url);
  if (looksLikeLog || isExtensionReportUrl(url)) {
    setIcon("active", tabId);
  }
  // Other tabs keep the global icon (idle or disabled) — no per-tab override needed.
}

/* ─── Lifecycle events ────────────────────────────────────────────────────── */

chrome.runtime.onInstalled.addListener((details) => {
  updateGlobalIcon();
  if (details?.reason !== "install") return;
  const url = chrome.runtime.getURL("welcome.html");
  chrome.tabs.create({ url }).catch((err) => {
    console.warn("[apex-log-insights]", err.message ?? err);
  });
});

chrome.runtime.onStartup.addListener(() => {
  updateGlobalIcon();
});

/* ─── React to tab navigation ─────────────────────────────────────────────── */

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    updateTabIcon(tabId, tab.url || changeInfo.url || "");
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab?.url) updateTabIcon(activeInfo.tabId, tab.url);
  } catch {
    // Tab may have been closed already — ignore.
  }
});

/* ─── Sidebar: scan file:// directory for .log files ────────────────────── */
// Chrome renders file:// directory listings via JavaScript — fetch() only
// returns the raw HTML template without <a> tags. We open a background tab
// to let Chrome render the listing, scrape the links, then close it.
// This feature is opt-in (off by default) via popup.html settings.

async function scanDirectoryViaTab(dirUrl) {
  let tabId;
  try {
    const tab = await chrome.tabs.create({ url: dirUrl, active: false });
    tabId = tab.id;
  } catch {
    // scan tab creation failed — silently return empty
    return [];
  }

  // Wait for the tab to finish loading (max 4s)
  await new Promise((resolve) => {
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }, 4000);
  });

  let files = [];
  try {
    const injection = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const results = [];

        // Both Chrome and Firefox render file:// directory listings as
        // HTML tables with <tr> rows containing <a> links to files.
        //
        // Chrome: data-value attribute on <td> contains Unix timestamp.
        // Firefox: separate Date and Time columns as text (e.g. "2/9/26" + "12:27 PM"),
        //          plus a sortable-data attribute with a date string.
        const rows = document.querySelectorAll("tr");
        rows.forEach((row) => {
          const link = row.querySelector("a");
          if (!link) return;
          // Firefox wraps filenames in a nested table — get just the text
          const name = (link.textContent || "").replace(/\s+/g, " ").trim();
          if (!name || name === ".." || name === "." || name.endsWith("/"))
            return;
          if (!name.toLowerCase().endsWith(".log")) return;
          // Skip directory entries (Firefox uses .dir class)
          if (row.classList.contains("dir")) return;

          let modifiedAt = null;
          const cells = row.querySelectorAll("td");
          for (const cell of cells) {
            if (cell.contains(link)) continue; // skip the name cell
            // Chrome: data-value with numeric timestamp
            const dataVal = cell.getAttribute("data-value");
            if (dataVal && /^\d{10,13}$/.test(dataVal)) {
              const ts = Number(dataVal);
              modifiedAt = ts > 1e12 ? ts : ts * 1000;
              break;
            }
            // Firefox: sortable-data with parseable date string
            const sortable = cell.getAttribute("sortable-data");
            if (sortable && !modifiedAt) {
              const parsed = Date.parse(sortable);
              if (!isNaN(parsed)) {
                modifiedAt = parsed;
                continue;
              }
            }
            // Fallback: try parsing cell text as a date
            const text = (cell.textContent || "").trim();
            if (!modifiedAt && text && /\d/.test(text)) {
              const parsed = Date.parse(text);
              if (!isNaN(parsed) && parsed > 946684800000) {
                // after year 2000
                modifiedAt = parsed;
              }
            }
          }
          results.push({ name, modifiedAt });
        });

        // Fallback: scrape <a> tags directly (handles unusual formats)
        if (results.length === 0) {
          document.querySelectorAll("a").forEach((a) => {
            const name = (a.textContent || "").trim();
            if (!name || name === ".." || name === "." || name.endsWith("/"))
              return;
            if (!name.toLowerCase().endsWith(".log")) return;
            results.push({ name, modifiedAt: null });
          });
        }

        return results;
      },
    });
    files = injection?.[0]?.result || [];
  } catch {
    // executeScript failed — tab may have closed or permission denied
  }

  // Close the scan tab immediately
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    /* ignore */
  }

  // Sort by last modified descending (newest first), nulls last
  files.sort((a, b) => {
    const ta = a.modifiedAt || 0;
    const tb = b.modifiedAt || 0;
    return tb - ta;
  });

  return files;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "SCAN_DIRECTORY") return false;
  const dirUrl = String(message.url || "");
  if (!dirUrl.startsWith("file://")) {
    sendResponse({ ok: false, files: [] });
    return false;
  }
  scanDirectoryViaTab(dirUrl)
    .then((files) => {
      sendResponse({ ok: true, files });
    })
    .catch(() => {
      sendResponse({ ok: false, files: [] });
    });
  return true; // keep channel open for async response
});
