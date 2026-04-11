const STORAGE_KEY = "apex-redaction-settings";
const LOG_EXPLORER_SETTINGS_KEY = "apex-log-explorer-settings";
const SIDEBAR_SETTINGS_KEY = "apex-sidebar-settings";
const THEME_STORAGE_KEY = "apex-log-insights-theme";
const isFirefox = /Firefox/.test(navigator.userAgent);
const RAW_CONTEXT_OPTIONS = [0, 2, 5, 10, 25, 50, 100];

const DEFAULT_REDACTION_SETTINGS = {
  enabled: false,
  email: true,
  sfId: true,
  phone: true,
  names: true,
  nameList: [],
};

const DEFAULT_LOG_EXPLORER_SETTINGS = {
  contextRows: 0,
  userDebugOnly: false,
  errorsOnly: false,
  openLinksInNewTab: false,
};

const openWelcomeBtn = document.getElementById("openWelcomeBtn");
const redactEnabled = document.getElementById("redactEnabled");
const redactOptions = document.getElementById("redactOptions");
const redactEmail = document.getElementById("redactEmail");
const redactSfId = document.getElementById("redactSfId");
const redactPhone = document.getElementById("redactPhone");
const redactNames = document.getElementById("redactNames");
const redactNameList = document.getElementById("redactNameList");
const defaultContextRows = document.getElementById("defaultContextRows");
const openLinksInNewTab = document.getElementById("openLinksInNewTab");
const sidebarEnabled = document.getElementById("sidebarEnabled");
const preferencesPanel = document.getElementById("preferencesPanel");
const fileAccessBanner = document.getElementById("fileAccessBanner");
const openFileAccessSettingsBtn = document.getElementById("openFileAccessSettingsBtn");
const dismissFileAccessBannerBtn = document.getElementById("dismissFileAccessBannerBtn");
const fileAccessStatusBadge = document.getElementById("fileAccessStatusBadge");

let fileAccessBannerDismissed = false;

function getFileSchemeAccessAllowed() {
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

function applyTheme(actualTheme) {
  const nextTheme = actualTheme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  return nextTheme;
}

function resolveTheme(preference) {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  // "system" or default: resolve based on media query
  try {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
  } catch {
    // Ignore media query issues and fall back to dark mode.
  }
  return "dark";
}

async function getPreferredTheme() {
  try {
    const stored = await chrome.storage.local.get(THEME_STORAGE_KEY);
    const pref = stored?.[THEME_STORAGE_KEY];
    if (pref === "light" || pref === "dark" || pref === "system") {
      return pref;
    }
  } catch {
    // Ignore storage issues and fall back to system preference.
  }
  return "system";
}

function syncThemeButtons(preference) {
  const themeSystemBtn = document.getElementById("themeSystemBtn");
  const themeLightBtn = document.getElementById("themeLightBtn");
  const themeDarkBtn = document.getElementById("themeDarkBtn");

  [themeSystemBtn, themeLightBtn, themeDarkBtn].forEach((btn) => {
    if (btn) btn.classList.remove("active");
  });

  if (preference === "light" && themeLightBtn) themeLightBtn.classList.add("active");
  else if (preference === "dark" && themeDarkBtn) themeDarkBtn.classList.add("active");
  else if (themeSystemBtn) themeSystemBtn.classList.add("active");
}

function setFileAccessBannerVisible(visible) {
  if (!fileAccessBanner) return;
  fileAccessBanner.hidden = !visible;
}

function setPreferencesVisible(visible) {
  if (!preferencesPanel) return;
  preferencesPanel.hidden = !visible;
}

function setFileAccessStatus(allowed) {
  if (!fileAccessStatusBadge) return;
  fileAccessStatusBadge.classList.remove("is-ok", "is-warning");
  if (allowed) {
    fileAccessStatusBadge.textContent = "File access: enabled";
    fileAccessStatusBadge.classList.add("is-ok");
    return;
  }
  fileAccessStatusBadge.textContent = "File access: required";
  fileAccessStatusBadge.classList.add("is-warning");
}

async function maybeShowFileAccessBanner() {
  if (!fileAccessBanner) return;
  // Firefox grants file:// access via install permissions — no separate toggle needed.
  const allowed = isFirefox ? true : await getFileSchemeAccessAllowed();
  setFileAccessStatus(allowed);
  if (fileAccessBannerDismissed && allowed) {
    // access was granted after dismissal — show preferences now
    setFileAccessBannerVisible(false);
    setPreferencesVisible(true);
    return;
  }
  if (fileAccessBannerDismissed) {
    // was dismissed but access still missing — restore banner so user isn't stuck
    fileAccessBannerDismissed = false;
  }
  setFileAccessBannerVisible(!allowed);
  setPreferencesVisible(allowed);
  // BUG-008 fix: hide/show dismiss button based on access state.
  // When access is required, disabling the dismiss button prevents the dead-end
  // state where neither the banner nor preferences are reachable.
  if (dismissFileAccessBannerBtn) {
    dismissFileAccessBannerBtn.hidden = !allowed;
  }
}

if (openWelcomeBtn) {
  openWelcomeBtn.addEventListener("click", async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
    window.close();
  });
}

if (openFileAccessSettingsBtn) {
  openFileAccessSettingsBtn.addEventListener("click", async () => {
    if (isFirefox) {
      try {
        await chrome.tabs.create({ url: "about:addons" });
      } catch {
        // about:addons blocked — guide user manually
        window.alert("Open about:addons in your address bar, then click Apex Log Insights to manage permissions.");
        return;
      }
      window.close();
      return;
    }
    const id = chrome.runtime.id;
    // Chrome MV3 allows extensions to open chrome://extensions and the ?id= detail view.
    // Try the specific detail page first, fall back to the main extensions page.
    try {
      await chrome.tabs.create({ url: `chrome://extensions/?id=${id}` });
    } catch {
      try {
        await chrome.tabs.create({ url: "chrome://extensions" });
      } catch {
        return; // Both blocked — leave popup open so user can see the banner.
      }
    }
    window.close();
  });
}

if (dismissFileAccessBannerBtn) {
  dismissFileAccessBannerBtn.addEventListener("click", () => {
    fileAccessBannerDismissed = true;
    setFileAccessBannerVisible(false);
  });
}

// ─── Redaction settings ───────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const s = stored?.[STORAGE_KEY];
    return s && typeof s === "object" ? { ...DEFAULT_REDACTION_SETTINGS, ...s } : { ...DEFAULT_REDACTION_SETTINGS };
  } catch {
    return { ...DEFAULT_REDACTION_SETTINGS };
  }
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

function sanitizeContextRows(value) {
  const n = Number(value);
  return RAW_CONTEXT_OPTIONS.includes(n) ? n : DEFAULT_LOG_EXPLORER_SETTINGS.contextRows;
}

async function loadLogExplorerSettings() {
  try {
    const stored = await chrome.storage.local.get(LOG_EXPLORER_SETTINGS_KEY);
    const s = stored?.[LOG_EXPLORER_SETTINGS_KEY];
    if (s && typeof s === "object") {
      return {
        contextRows: sanitizeContextRows(s.contextRows),
        userDebugOnly: Boolean(s.userDebugOnly),
        errorsOnly: Boolean(s.errorsOnly),
        openLinksInNewTab: Boolean(s.openLinksInNewTab),
      };
    }
  } catch {
    // Ignore storage read errors and use defaults.
  }
  return { ...DEFAULT_LOG_EXPLORER_SETTINGS };
}

async function saveLogExplorerSettings(settings) {
  // Read-modify-write: preserve fields (userDebugOnly, errorsOnly) that the popup UI
  // does not control, so saving from the popup never clobbers app-set toggle state.
  const existing = await loadLogExplorerSettings();
  await chrome.storage.local.set({
    [LOG_EXPLORER_SETTINGS_KEY]: {
      ...existing,
      contextRows: sanitizeContextRows(settings?.contextRows),
      openLinksInNewTab: Boolean(settings?.openLinksInNewTab),
    },
  });
}

function readLogExplorerSettingsFromUi() {
  return {
    contextRows: sanitizeContextRows(defaultContextRows?.value),
    openLinksInNewTab: openLinksInNewTab?.checked ?? false,
  };
}

function readRedactionSettingsFromUi() {
  const nameLines = redactNameList?.value ?? "";
  const nameList = nameLines.split("\n").map((n) => n.trim()).filter(Boolean);
  return {
    enabled: redactEnabled?.checked ?? false,
    email: redactEmail?.checked ?? true,
    sfId: redactSfId?.checked ?? true,
    phone: redactPhone?.checked ?? true,
    names: redactNames?.checked ?? true,
    nameList,
  };
}

async function persistAllSettingsFromUi() {
  await Promise.all([
    saveSettings(readRedactionSettingsFromUi()),
    saveLogExplorerSettings(readLogExplorerSettingsFromUi()),
  ]);
}

function applySettingsToUi(s) {
  if (redactEnabled) redactEnabled.checked = s.enabled;
  if (redactOptions) redactOptions.hidden = !s.enabled;
  if (redactEmail) redactEmail.checked = s.email;
  if (redactSfId) redactSfId.checked = s.sfId;
  if (redactPhone) redactPhone.checked = s.phone;
  if (redactNames) redactNames.checked = s.names;
  if (redactNameList) redactNameList.value = (s.nameList || []).join("\n");
}

// Load settings on popup open
getPreferredTheme().then((preference) => {
  const actualTheme = resolveTheme(preference);
  applyTheme(actualTheme);
  syncThemeButtons(preference);
});
loadSettings().then(applySettingsToUi);
loadLogExplorerSettings().then((settings) => {
  if (defaultContextRows) defaultContextRows.value = String(settings.contextRows);
  if (openLinksInNewTab) openLinksInNewTab.checked = Boolean(settings.openLinksInNewTab);
});

// Sidebar settings — only available on Chrome/Edge (not Firefox)
const sidebarGroup = document.getElementById("sidebarGroup");
if (!isFirefox && sidebarGroup) {
  sidebarGroup.hidden = false;
}
chrome.storage.local.get(SIDEBAR_SETTINGS_KEY).then((stored) => {
  const settings = stored?.[SIDEBAR_SETTINGS_KEY] || {};
  if (sidebarEnabled) sidebarEnabled.checked = Boolean(settings.enabled);
}).catch(() => {});

if (sidebarEnabled) {
  sidebarEnabled.addEventListener("change", () => {
    chrome.storage.local.set({
      [SIDEBAR_SETTINGS_KEY]: { enabled: sidebarEnabled.checked },
    }).catch(() => {});
  });
}

maybeShowFileAccessBanner();

if (redactEnabled && redactOptions) {
  redactEnabled.addEventListener("change", () => {
    redactOptions.hidden = !redactEnabled.checked;
    persistAllSettingsFromUi().catch(console.error);
  });
}

[
  redactEmail,
  redactSfId,
  redactPhone,
  redactNames,
  openLinksInNewTab,
  defaultContextRows,
].forEach((field) => {
  field?.addEventListener("change", () => {
    persistAllSettingsFromUi().catch(console.error);
  });
});

if (redactNameList) {
  // Debounced input save so closing popup before blur doesn't lose edits.
  let _redactNameListSaveTimer = null;
  redactNameList.addEventListener("input", () => {
    clearTimeout(_redactNameListSaveTimer);
    _redactNameListSaveTimer = setTimeout(() => persistAllSettingsFromUi().catch(console.error), 500);
  });
  // Keep the change listener as a final flush on blur/commit.
  redactNameList.addEventListener("change", () => {
    clearTimeout(_redactNameListSaveTimer);
    persistAllSettingsFromUi().catch(console.error);
  });
}

// ─── Theme toggle buttons ────────────────────────────────────────────────────────

const themeSystemBtn = document.getElementById("themeSystemBtn");
const themeLightBtn = document.getElementById("themeLightBtn");
const themeDarkBtn = document.getElementById("themeDarkBtn");

async function setThemePreference(preference) {
  try {
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: preference });
    syncThemeButtons(preference);
    const actualTheme = resolveTheme(preference);
    applyTheme(actualTheme);
  } catch (err) {
    console.error("Failed to save theme preference:", err);
  }
}

if (themeSystemBtn) {
  themeSystemBtn.addEventListener("click", () => setThemePreference("system"));
}

if (themeLightBtn) {
  themeLightBtn.addEventListener("click", () => setThemePreference("light"));
}

if (themeDarkBtn) {
  themeDarkBtn.addEventListener("click", () => setThemePreference("dark"));
}
