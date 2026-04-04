const THEME_STORAGE_KEY = "apex-log-insights-theme";

const openSettingsBtn = document.getElementById("openSettingsBtn");
const onboardingBadge = document.getElementById("onboardingBadge");
const statusText = document.getElementById("statusText");
const mockToggle = document.getElementById("mockToggle");
const themeLightBtn = document.getElementById("themeLightBtn");
const themeDarkBtn = document.getElementById("themeDarkBtn");

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

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  themeLightBtn?.classList.toggle("is-active", nextTheme === "light");
  themeDarkBtn?.classList.toggle("is-active", nextTheme === "dark");
  themeLightBtn?.setAttribute("aria-pressed", nextTheme === "light" ? "true" : "false");
  themeDarkBtn?.setAttribute("aria-pressed", nextTheme === "dark" ? "true" : "false");
  return nextTheme;
}

async function getPreferredTheme() {
  try {
    const stored = await chrome.storage.local.get(THEME_STORAGE_KEY);
    if (stored?.[THEME_STORAGE_KEY] === "light" || stored?.[THEME_STORAGE_KEY] === "dark") {
      return stored[THEME_STORAGE_KEY];
    }
  } catch {
    // Ignore storage issues and fall back to system preference.
  }
  try {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
      return "light";
    }
  } catch {
    // Ignore media query issues and fall back to dark mode.
  }
  return "dark";
}

async function persistTheme(theme) {
  const nextTheme = applyTheme(theme);
  try {
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: nextTheme });
  } catch {
    // Ignore storage write failures.
  }
}

async function initializeTheme() {
  const preferred = await getPreferredTheme();
  applyTheme(preferred);
}

async function openExtensionSettings() {
  try {
    await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  } catch {
    await chrome.tabs.create({ url: "chrome://extensions" });
  }
}

function applyPermissionState(allowed) {
  document.body.classList.toggle("welcome-permission-enabled", allowed);

  if (allowed) {
    if (onboardingBadge) onboardingBadge.textContent = "Setup complete";
    if (statusText) {
      statusText.textContent = "";
      statusText.classList.remove("welcomeGateStatusReady");
      statusText.hidden = true;
    }
    if (mockToggle) mockToggle.classList.add("is-enabled");
    return;
  }

  if (onboardingBadge) onboardingBadge.textContent = "Verification required";
  if (statusText) {
    statusText.hidden = false;
    statusText.textContent = "Permission is currently disabled.";
    statusText.classList.remove("welcomeGateStatusReady");
  }
  if (mockToggle) mockToggle.classList.remove("is-enabled");
}

async function refreshStatus() {
  const allowed = await getFileSchemeAccessAllowed();
  applyPermissionState(allowed);
  return allowed;
}

if (themeLightBtn) {
  themeLightBtn.addEventListener("click", () => persistTheme("light"));
}

if (themeDarkBtn) {
  themeDarkBtn.addEventListener("click", () => persistTheme("dark"));
}

if (openSettingsBtn) {
  openSettingsBtn.addEventListener("click", () => {
    openExtensionSettings();
  });
}

initializeTheme();
refreshStatus();
