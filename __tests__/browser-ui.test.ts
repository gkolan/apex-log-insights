import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();

describe("browser analysis UI", () => {
  it("rerenders SOQL rows when expanding or collapsing the query table", async () => {
    const sources = await Promise.all([
      readFile(resolve(root, "viewer/app.js"), "utf8"),
      readFile(
        resolve(root, "packages/browser-ext/shared/app-extension-only.js"),
        "utf8",
      ),
    ]);
    for (const source of sources) {
      const listenerStart = source.indexOf(
        'toggleAllQueriesBtn.addEventListener("click"',
      );
      const listenerEnd = source.indexOf("if (toggleAllDmlBtn)", listenerStart);
      const listener = source.slice(listenerStart, listenerEnd);
      expect(listener).toContain("queriesExpanded = !queriesExpanded");
      expect(listener).toContain(
        "render(currentReportData, currentRawLogLines)",
      );
      expect(listener).not.toContain(
        "problematicQueriesTable.hidden = queriesExpanded",
      );
    }
  });

  it("builds parser workers for the classic Worker constructor used by every host", async () => {
    const [cliPackage, browserPackage] = await Promise.all([
      readFile(resolve(root, "packages/cli/package.json"), "utf8"),
      readFile(resolve(root, "packages/browser-ext/package.json"), "utf8"),
    ]);
    for (const packageJson of [cliPackage, browserPackage]) {
      const scripts = JSON.parse(packageJson).scripts as Record<string, string>;
      expect(scripts["build:worker"]).toContain("--format=iife");
      expect(scripts["build:worker"]).not.toContain("--format=esm");
    }

    const cliScripts = JSON.parse(cliPackage).scripts as Record<string, string>;
    expect(cliScripts.build).toContain("rmSync('dist'");
    expect(cliScripts.build).toContain("recursive: true");
    expect(cliScripts.build).toContain("force: true");
  });

  it("keeps the same five investigation tabs in viewer and extension shells", async () => {
    const shells = await Promise.all([
      readFile(resolve(root, "viewer/index.html"), "utf8"),
      readFile(resolve(root, "packages/browser-ext/shared/app.html"), "utf8"),
    ]);
    const destinations = [
      ["triageSummaryTabLink", "#triage"],
      ["executionStoryTabLink", "#execution"],
      ["dataLimitsTabLink", "#data"],
      ["diagnosticsTabLink", "#diagnostics"],
      ["logExplorerTabLink", "#evidence"],
    ];
    for (const shell of shells) {
      for (const [id, href] of destinations) {
        expect(shell).toContain(`id="${id}"`);
        expect(shell).toContain(`href="${href}"`);
      }
      expect(shell).not.toContain('href="#compare"');
      expect(shell).not.toContain('href="#overview"');
      expect(shell).toContain('role="dialog"');
      expect(shell).toContain('aria-modal="true"');
      expect(shell).toContain('aria-label="Available log files"');
      expect(shell).toContain('id="executionStorySubheading"');
    }
  });

  it("keeps offline assets fresh and preserves an offline fallback", async () => {
    const serviceWorker = await readFile(resolve(root, "viewer/sw.js"), "utf8");
    expect(serviceWorker).toContain("fetch(e.request)");
    expect(serviceWorker).toContain("cache.put(e.request, copy)");
    expect(serviceWorker).toContain(".catch(() => caches.match(");
  });

  it("keeps the established five-view layout and responsive containment explicit", async () => {
    const [app, styles, sidebar] = await Promise.all([
      readFile(resolve(root, "viewer/app.js"), "utf8"),
      readFile(resolve(root, "viewer/styles.css"), "utf8"),
      readFile(resolve(root, "viewer/modules/sidebar.js"), "utf8"),
    ]);
    expect(app).toContain("function setViewModeFromHash()");
    expect(app).toContain("render(report, nextRawLines)");
    expect(app).toContain("executionStorySubheading.textContent");
    expect(app).not.toContain(
      '<p class="resultNotice">Showing the first ${EXECUTION_STORY_ROW_LIMIT}',
    );
    const offlineReport = app.slice(
      app.indexOf("function showOfflineReport("),
      app.indexOf("function showViewerLoadFailure("),
    );
    expect(offlineReport).not.toContain("createReportView");
    expect(offlineReport).not.toContain(
      'classList.add("canonical-renderer-active")',
    );
    expect(styles).toContain("#triageHighlightsPanel .reportSplit");
    expect(styles).toContain(".reportMetricCluster");
    expect(styles).toMatch(
      /\.findingAction\s*\{[\s\S]*?background: var\(--surface-subtle\);[\s\S]*?border: 0;[\s\S]*?border-radius: 12px;[\s\S]*?box-shadow: var\(--shadow-sm\);/,
    );
    const findingActionRule = styles.match(
      /\.findingAction\s*\{([^}]*)\}/,
    )?.[1];
    expect(findingActionRule).not.toContain("border-left");
    expect(styles).toMatch(
      /\.copyCell:hover\s*\{[\s\S]*?background: var\(--copy-hover-bg\);/,
    );
    expect(styles).toMatch(
      /tbody td:hover\s*\{[\s\S]*?background: var\(--copy-hover-bg\);/,
    );
    expect(styles).toMatch(
      /\.copyCell::after\s*\{[\s\S]*?background-color: var\(--copy-icon-bg\);[\s\S]*?border: 1px solid var\(--copy-icon-border\);/,
    );
    expect(styles).not.toMatch(
      /\.copyCell::after\s*\{[\s\S]*?stroke='%23(?:2563eb|3b82f6)'/,
    );
    expect(styles).not.toMatch(
      /\.copyCell\[data-icon="done"\]::after\s*\{[\s\S]*?stroke='%23(?:059669|34d399)'/,
    );
    expect(styles).not.toContain(
      ":where(a, button, input, select, textarea, summary, [tabindex]):focus-visible",
    );
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(sidebar).toContain('event.key === "Escape"');
    expect(sidebar).toContain("sidebarEl.inert = true");
  });

  it("uses the Cosmos semantic palette with Night as the default", async () => {
    const [viewerHtml, extensionHtml, styles] = await Promise.all([
      readFile(resolve(root, "viewer/index.html"), "utf8"),
      readFile(resolve(root, "packages/browser-ext/shared/app.html"), "utf8"),
      readFile(resolve(root, "viewer/styles.css"), "utf8"),
    ]);

    for (const shell of [viewerHtml, extensionHtml]) {
      expect(shell).toContain('<html lang="en" data-theme="dark">');
    }
    expect(styles).toContain("--bg: var(--slds-g-color-surface-2, #f3f3f3)");
    expect(styles).toContain("--accent: var(--slds-g-color-accent-1, #066afe)");
    expect(styles).toContain("--bg: var(--slds-g-color-surface-2, #181818)");
    expect(styles).toContain("--accent: var(--slds-g-color-accent-2, #7cb1fe)");
    expect(styles).toContain("--ok-text: var(--slds-g-color-success-1");
    expect(styles).toContain("--warn-accent: var(--slds-g-color-warning-1");
    expect(styles).toContain(
      "--error-accent: var(--slds-g-color-error-base-40",
    );
  });

  it("protects the large-log rendering limits and explicit evidence labels", async () => {
    const app = await readFile(resolve(root, "viewer/app.js"), "utf8");
    expect(app).toContain("EXECUTION_STORY_ROW_LIMIT = 200");
    expect(app).toContain("DEFAULT_RAW_PREVIEW_LINES = 200");
    expect(app).toContain(
      'renderRawLogSearchResults(rawSearchInput?.value || "")',
    );
    expect(app).toContain("of ${currentRawLogLines.length} log lines");
    expect(app).toContain("Transaction (default namespace)");
    expect(app).toContain("exceeded by");
    expect(app).not.toMatch(/buildRawLogHref\(`line:/);
    expect(app).toContain("Open raw debug-log line ${rawRow}");
    expect(app).toContain('title="Raw debug-log line ${lineNumber}"');
    expect(app).not.toContain(">Log ${lineNumber}</span>");
    expect(app).toContain("<th>Source line</th><th>Log line</th>");
  });

  it("bounds fetched logs and reports before materializing or parsing them", async () => {
    const [extension, launcher] = await Promise.all([
      readFile(
        resolve(root, "packages/browser-ext/shared/app-extension-only.js"),
        "utf8",
      ),
      readFile(
        resolve(
          root,
          "packages/browser-ext/shared/content/content-launcher.js",
        ),
        "utf8",
      ),
    ]);
    expect(extension).toContain("readBoundedResponseText(");
    expect(extension).toContain("response.body.getReader()");
    expect(extension).toContain("loaded > maxBytes");
    expect(extension).toContain("reader.cancel()");
    expect(extension).toMatch(
      /readBoundedResponseText\(\s*response,\s*EXTENSION_MAX_LOG_BYTES\s*\)/,
    );
    expect(extension).toContain("file.size > EXTENSION_MAX_LOG_BYTES");
    expect(extension).not.toContain("await response.text()");
    expect(extension).not.toContain("await response.json()");
    expect(extension).not.toContain("split(/\\r?\\n/)");
    expect(launcher).not.toContain("split(/\\r?\\n/)");
    expect(launcher).toContain("byteSize > MAX_LOG_BYTES");
    expect(launcher).toContain("did not cache or copy this oversized page");
  });

  it("constrains extension handoff URLs and storage keys", async () => {
    const extension = await readFile(
      resolve(root, "packages/browser-ext/shared/app-extension-only.js"),
      "utf8",
    );
    expect(extension).toContain('["https:", "http:", "file:"]');
    expect(extension).toMatch(/source\.username\s*\|\|\s*source\.password/);
    expect(extension).toContain("!/\\.log$/i.test(source.pathname)");
    expect(extension).toMatch(
      /fetchAndDisplayFromUrl\(sourceUrl\)[\s\S]*?normalizeExtensionLogUrl\(sourceUrl\)/,
    );
    expect(extension).toContain("apex-new-tab-state-\\d+");
    expect(extension).toContain("apex-log-\\d+");
  });

  it("keeps first-run copy aligned with the five-tab workflow", async () => {
    const welcome = await readFile(
      resolve(root, "packages/browser-ext/shared/welcome.html"),
      "utf8",
    );
    expect(welcome).toContain("Triage Summary");
    expect(welcome).toContain("Log Explorer");
    expect(welcome).not.toContain("local log comparison");
    expect(welcome).not.toContain("shareable Overview");
  });

  it("removes redundant line-number help and hides routine completeness success", async () => {
    const [viewer, app] = await Promise.all([
      readFile(resolve(root, "viewer/index.html"), "utf8"),
      readFile(resolve(root, "viewer/app.js"), "utf8"),
    ]);
    expect(viewer).not.toContain("About line numbers");
    expect(viewer).not.toContain('class="lineNumberLegend"');
    expect(app).toContain('status !== "complete"');
    expect(app).toContain('"Failure context"');
  });

  it("shows numeric log and source coordinates in separate table columns", async () => {
    const [app, styles] = await Promise.all([
      readFile(resolve(root, "viewer/app.js"), "utf8"),
      readFile(resolve(root, "viewer/styles.css"), "utf8"),
    ]);
    expect(app).toContain("<th>Source line</th><th>Log line</th>");
    expect(app).toContain(
      '["Name", "Rows", "Duration", "Source line", "Log line"]',
    );
    expect(app).toContain(
      '["Object", "Operation", "Rows", "Duration", "Source line", "Log line"]',
    );
    expect(app).toContain('class="sourceLineNumber"');
    expect(app).toMatch(/class="jumpRawFromQuery"[^>]*>\$\{line\}<\/a>/);
    expect(app).not.toMatch(/<a[^>]*>Apex source line/);
    expect(styles).toMatch(
      /\.executionStoryDetailTable th:nth-last-child\(-n \+ 2\)[\s\S]*?width: 1%;[\s\S]*?text-align: right;/,
    );
    expect(styles).toContain("tr:not(.storyPhaseHeaderRow)");
    expect(styles).toMatch(
      /\.executionStoryDetailTable th:last-child[\s\S]*?padding-right: 16px;/,
    );
  });
});
