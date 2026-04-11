import { escapeHtml } from "./shared-format.js";

/**
 * Sidebar module — displays a list of .log files for quick navigation.
 *
 * Files are auto-discovered:
 *   - CLI mode: fetched from /api/logs (recursive scan of the served folder).
 *   - Extension mode: parsed from the file:// parent directory via background script.
 *
 * Clicking a file opens it in a new browser tab. No manual folder picker.
 */

// ── DOM refs (resolved lazily on init) ──────────────────────────────────────

let sidebarEl = null;
let sidebarFileList = null;
let sidebarFolderName = null;
let sidebarToggleBtn = null;
let sidebarCloseBtn = null;
let sidebarRefreshBtn = null;
let sidebarOverlay = null;

// ── State ───────────────────────────────────────────────────────────────────

let currentFiles = [];
let activeFileName = "";
let onFileClick = null; // callback: (fileName, fileEntry) => void

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatSidebarDate(dateValue) {
  if (!dateValue) return "";
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${date} ${h}:${m}:${s}`;
}

// ── Render ──────────────────────────────────────────────────────────────────

function renderFileList() {
  if (!sidebarFileList) return;
  if (currentFiles.length === 0) {
    sidebarFileList.innerHTML = '<li class="file-sidebar-empty">No .log files found</li>';
    return;
  }
  sidebarFileList.innerHTML = currentFiles
    .map((f) => {
      const isActive = f.name === activeFileName;
      const dateStr = formatSidebarDate(f.modifiedAt || f.lastModified);
      // Show subfolder prefix if the name contains a path separator
      const parts = f.name.split("/");
      const displayName = parts.length > 1 ? parts[parts.length - 1] : f.name;
      const folderPrefix = parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "";
      return `<li class="file-sidebar-item${isActive ? " active" : ""}" data-filename="${escapeHtml(f.name)}" role="button" tabindex="0">
        ${folderPrefix ? `<span class="file-sidebar-path">${escapeHtml(folderPrefix)}</span>` : ""}
        <span class="file-sidebar-name">${escapeHtml(displayName)}</span>
        ${dateStr ? `<span class="file-sidebar-date">${escapeHtml(dateStr)}</span>` : ""}
      </li>`;
    })
    .join("");
}

function showSidebar() {
  if (!sidebarEl) return;
  sidebarEl.hidden = false;
  sidebarEl.classList.add("open");
  if (sidebarOverlay) sidebarOverlay.hidden = false;
  if (sidebarToggleBtn) {
    sidebarToggleBtn.setAttribute("aria-expanded", "true");
    sidebarToggleBtn.classList.add("shifted");
    const label = sidebarToggleBtn.querySelector("span");
    if (label) label.hidden = true;
  }
}

function hideSidebar() {
  if (!sidebarEl) return;
  sidebarEl.classList.remove("open");
  if (sidebarOverlay) sidebarOverlay.hidden = true;
  if (sidebarToggleBtn) {
    sidebarToggleBtn.setAttribute("aria-expanded", "false");
    sidebarToggleBtn.classList.remove("shifted");
    const label = sidebarToggleBtn.querySelector("span");
    if (label) label.hidden = false;
  }
}

function toggleSidebar() {
  if (!sidebarEl) return;
  if (sidebarEl.classList.contains("open")) {
    hideSidebar();
  } else {
    showSidebar();
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Populate the sidebar with a list of files and highlight the active one.
 * Only shows the sidebar + toggle when there are 2+ files (current + at least one sibling).
 * @param {Array<{name: string, modifiedAt?: string|Date, lastModified?: number, sizeBytes?: number}>} files
 * @param {string} currentFileName - The file name to highlight as active.
 */
export function populateSidebar(files, currentFileName) {
  currentFiles = Array.isArray(files) ? files : [];
  activeFileName = currentFileName || "";

  // Only show sidebar when there are sibling files (more than just the current one)
  if (currentFiles.length <= 1) return;

  if (sidebarFolderName) {
    sidebarFolderName.textContent = `${currentFiles.length} log file${currentFiles.length !== 1 ? "s" : ""}`;
  }

  renderFileList();

  // Show the toggle button (sidebar opens on click)
  if (sidebarEl) sidebarEl.hidden = false;
  if (sidebarToggleBtn) sidebarToggleBtn.hidden = false;
}

/**
 * Update the highlighted active file without re-rendering the full list.
 * @param {string} fileName
 */
export function setActiveSidebarFile(fileName) {
  activeFileName = fileName || "";
  if (!sidebarFileList) return;
  sidebarFileList.querySelectorAll(".file-sidebar-item").forEach((li) => {
    li.classList.toggle("active", li.dataset.filename === activeFileName);
  });
}

/**
 * Initialize the sidebar. Call once after DOM is ready.
 * @param {{ onFileClick: (fileName: string, fileEntry: object) => void }} options
 */
export function initSidebar(options = {}) {
  sidebarEl = document.getElementById("fileSidebar");
  sidebarFileList = document.getElementById("sidebarFileList");
  sidebarFolderName = document.getElementById("sidebarFolderName");
  sidebarToggleBtn = document.getElementById("sidebarToggleBtn");
  sidebarCloseBtn = document.getElementById("sidebarCloseBtn");
  sidebarRefreshBtn = document.getElementById("sidebarRefreshBtn");
  sidebarOverlay = document.getElementById("sidebarOverlay");

  onFileClick = options.onFileClick || null;

  // Refresh button
  if (sidebarRefreshBtn && options.onRefresh) {
    sidebarRefreshBtn.addEventListener("click", options.onRefresh);
  }

  // Toggle button
  if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener("click", toggleSidebar);
  }

  // Close button
  if (sidebarCloseBtn) {
    sidebarCloseBtn.addEventListener("click", hideSidebar);
  }

  // Overlay backdrop click closes sidebar
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener("click", hideSidebar);
  }

  // File click delegation
  if (sidebarFileList) {
    sidebarFileList.addEventListener("click", (e) => {
      const item = e.target.closest(".file-sidebar-item");
      if (!item) return;
      const fileName = item.dataset.filename;
      if (!fileName) return;
      const entry = currentFiles.find((f) => f.name === fileName);
      if (onFileClick) onFileClick(fileName, entry || { name: fileName });
    });
    // Keyboard support
    sidebarFileList.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const item = e.target.closest(".file-sidebar-item");
      if (!item) return;
      e.preventDefault();
      item.click();
    });
  }
}
