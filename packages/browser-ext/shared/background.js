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
  chrome.action.setIcon(params).catch((err) => { console.warn('[apex-log-insights]', err.message ?? err); });
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
      const cleanup = (result) => {
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
  chrome.tabs.create({ url }).catch((err) => { console.warn('[apex-log-insights]', err.message ?? err); });
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
