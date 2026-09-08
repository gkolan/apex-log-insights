import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();

describe("browser analysis UI", () => {
  it("includes the complete third-party notice in every browser build", async () => {
    const [notice, ...buildScripts] = await Promise.all([
      readFile(resolve(root, "THIRD-PARTY-NOTICES.md"), "utf8"),
      ...["chrome", "edge", "firefox"].map((browser) =>
        readFile(
          resolve(root, `packages/browser-ext/scripts/build-${browser}.sh`),
          "utf8",
        ),
      ),
    ]);
    expect(notice).toContain("Redistributions in binary form");
    expect(notice).toContain(
      "EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE",
    );
    for (const script of buildScripts) {
      expect(script).toContain('THIRD-PARTY-NOTICES.md" "$OUT_DIR');
    }
  });

  it("keeps required browser-store review materials in the release pipeline", async () => {
    const [exportScript, sourceScript, sourceReadme, promoTile] =
      await Promise.all([
        readFile(resolve(root, "scripts/export-extension.ts"), "utf8"),
        readFile(resolve(root, "scripts/build-firefox-source.mjs"), "utf8"),
        readFile(
          resolve(root, "packages/browser-ext/FIREFOX-SOURCE-README.md"),
          "utf8",
        ),
        readFile(resolve(root, "assets/images/chrome-promo-tile.png")),
      ]);

    expect(exportScript).toContain("scripts/build-firefox-source.mjs");
    expect(exportScript).toContain("firefox-source-v${newVersion}.zip");
    expect(sourceScript).toContain("pnpm-lock.yaml");
    expect(sourceScript).toContain("packages/browser-ext/shared/app.js");
    expect(sourceReadme).toContain("pnpm install --frozen-lockfile");
    expect(sourceReadme).toContain("compare the extracted directories");
    expect(promoTile.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(promoTile.readUInt32BE(16)).toBe(440);
    expect(promoTile.readUInt32BE(20)).toBe(280);
  });

  it("requests the sidebar scripting permission only where the sidebar is available", async () => {
    const [chrome, edge, firefox] = await Promise.all(
      ["chrome", "edge", "firefox"].map(async (browser) =>
        JSON.parse(
          await readFile(
            resolve(
              root,
              `packages/browser-ext/manifests/${browser}/manifest.json`,
            ),
            "utf8",
          ),
        ),
      ),
    );

    expect(chrome.permissions).toContain("scripting");
    expect(edge.permissions).toContain("scripting");
    expect(firefox.permissions).not.toContain("scripting");
  });

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

  it("labels DML entry totals as operations rather than row totals", async () => {
    const [shell, extensionShell, renderer] = await Promise.all([
      readFile(resolve(root, "viewer/index.html"), "utf8"),
      readFile(resolve(root, "packages/browser-ext/shared/app.html"), "utf8"),
      readFile(resolve(root, "viewer/modules/render-report.js"), "utf8"),
    ]);
    for (const source of [shell, extensionShell, renderer]) {
      expect(source).toContain("DML Operations");
      expect(source).not.toContain("DML Rows");
    }
    expect(renderer).toContain("operations</span>");
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

  it("uses neutral surfaces and accessible blue accents with Night as the default", async () => {
    const [viewerHtml, extensionHtml, styles] = await Promise.all([
      readFile(resolve(root, "viewer/index.html"), "utf8"),
      readFile(resolve(root, "packages/browser-ext/shared/app.html"), "utf8"),
      readFile(resolve(root, "viewer/styles.css"), "utf8"),
    ]);

    for (const shell of [viewerHtml, extensionHtml]) {
      expect(shell).toContain('<html lang="en" data-theme="dark">');
    }
    expect(styles).toContain("--bg: var(--slds-g-color-surface-2, #f3f3f3)");
    expect(styles).toContain("--accent: var(--slds-g-color-accent-1, #0066cc)");
    expect(styles).toContain("--bg: var(--slds-g-color-surface-2, #181818)");
    expect(styles).toContain("--accent: var(--slds-g-color-accent-2, #66b3ff)");
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
    const [extension, launcher, popup] = await Promise.all([
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
      readFile(resolve(root, "packages/browser-ext/shared/popup.js"), "utf8"),
    ]);
    expect(extension).toContain('["https:", "http:", "file:"]');
    expect(extension).toMatch(/source\.username\s*\|\|\s*source\.password/);
    expect(extension).toContain("!/\\.log$/i.test(source.pathname)");
    expect(extension).toMatch(
      /fetchAndDisplayFromUrl\(sourceUrl\)[\s\S]*?normalizeExtensionLogUrl\(sourceUrl\)/,
    );
    expect(extension).toContain("apex-new-tab-state-\\d+");
    expect(extension).toContain("apex-log-\\d+");
    expect(launcher).toContain("^apex-log-\\d+(?:-[a-z0-9]{6})?$");
    expect(launcher).toContain("MAX_CACHED_LOG_PAYLOADS - 1");
    expect(popup).toContain("log-\\d+(?:-[a-z0-9]{6})?");
    expect(popup).toContain("new-tab-state-\\d+(?:-[a-z0-9]{8})?");
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

  it("keeps failure context in the established triage line items", async () => {
    const [viewer, extension, app, extensionOverlay] = await Promise.all([
      readFile(resolve(root, "viewer/index.html"), "utf8"),
      readFile(resolve(root, "packages/browser-ext/shared/app.html"), "utf8"),
      readFile(resolve(root, "viewer/app.js"), "utf8"),
      readFile(
        resolve(root, "packages/browser-ext/shared/app-extension-only.js"),
        "utf8",
      ),
    ]);
    expect(viewer).not.toContain("About line numbers");
    expect(viewer).not.toContain('class="lineNumberLegend"');
    expect(app).toContain('completenessStatus === "complete"');
    expect(app).toContain("matching exception events");
    expect(app).toContain("renderFailureContextDetails(failureGroup)");
    for (const shell of [viewer, extension]) {
      expect(shell).not.toContain('id="logCompletenessPanel"');
      expect(shell).not.toContain('id="logCompletenessContent"');
      expect(shell).not.toContain('id="issuesPanel"');
      expect(shell).not.toContain('id="errorsPanel"');
      expect(shell).not.toContain('id="warningsPanel"');
      expect(shell).not.toContain('id="evidencePointersPanel"');
    }
    expect(app).not.toContain("toggleIssuesExpanded");
    expect(extensionOverlay).not.toContain("toggleAllErrorsBtn");
    expect(extensionOverlay).not.toContain("toggleAllWarningsBtn");
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
