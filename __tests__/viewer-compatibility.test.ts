import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseLog } from "../packages/core/src/parserCore.js";
import { buildOfflineReport } from "../packages/core/src/offlineReport.js";
import { parseDirectoryListing } from "../viewer/modules/load-report.js";
import { normalizeReport } from "../viewer/modules/normalize-report.js";
import { renderTriage } from "../viewer/modules/render-triage.js";
import { renderExecution } from "../viewer/modules/render-execution.js";
import { renderData } from "../viewer/modules/render-data.js";
import { renderDiagnostics } from "../viewer/modules/render-diagnostics.js";
import { renderEvidence } from "../viewer/modules/render-evidence.js";

it("extension and viewer version markers stay in sync with package metadata", async () => {
  const root = process.cwd();
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const manifest = JSON.parse(
    await readFile(
      resolve(root, "packages/browser-ext/manifests/chrome/manifest.json"),
      "utf8",
    ),
  );
  const viewerApp = await readFile(resolve(root, "viewer/app.js"), "utf8");
  const extensionApp = await readFile(
    resolve(root, "packages/browser-ext/shared/app.js"),
    "utf8",
  );

  const version = String(pkg.version);
  const viewerVersion =
    viewerApp.match(/^const APP_VERSION = "([^"]+)";/m)?.[1] ?? null;
  const extensionVersion =
    extensionApp.match(/^const APP_VERSION = "([^"]+)";/m)?.[1] ?? null;
  const extensionHeaderVersion =
    extensionApp.match(/^\s*\* Version: ([^\s]+)$/m)?.[1] ?? null;

  expect(String(manifest.version)).toBe(version);
  expect(viewerVersion).toBe(version);
  expect(extensionVersion).toBe(version);
  expect(extensionHeaderVersion).toBe(version);
});

it("viewer and extension keep Log Explorer controls concise and consistent", async () => {
  const root = process.cwd();
  const [viewerHtml, extensionHtml] = await Promise.all([
    readFile(resolve(root, "viewer/index.html"), "utf8"),
    readFile(resolve(root, "packages/browser-ext/shared/app.html"), "utf8"),
  ]);
  for (const html of [viewerHtml, extensionHtml]) {
    expect(html).not.toContain("About line numbers");
    expect(html).not.toContain('class="lineNumberLegend"');
    expect(html).toContain('placeholder="Search text, log:1857');
    expect(html).toContain('aria-label="Search raw debug-log lines"');
  }
});

it("the standalone viewer imports every shared DOM helper it calls", async () => {
  const viewerApp = await readFile(
    resolve(process.cwd(), "viewer/app.js"),
    "utf8",
  );
  expect(viewerApp).toMatch(
    /import \{ copyText, createFragment \} from "\.\/modules\/shared-dom\.js";/,
  );
});

it("the CLI build uses exactly one executable shebang", async () => {
  const root = process.cwd();
  const [source, packageJsonText] = await Promise.all([
    readFile(resolve(root, "packages/cli/src/bin.ts"), "utf8"),
    readFile(resolve(root, "packages/cli/package.json"), "utf8"),
  ]);
  const cliPackage = JSON.parse(packageJsonText);
  expect(source.startsWith("#!/usr/bin/env node\n")).toBe(true);
  expect(String(cliPackage.scripts.build)).not.toContain("--banner:js");
});

it("parseDirectoryListing keeps every json report link and ignores non-report entries", () => {
  const html = `
    <html><body>
      <a href="../">../</a>
      <a href="apex-1.apex-insights.json">apex-1.apex-insights.json</a>
      <a href="apex-1.apex-insights.json?download=1">duplicate</a>
      <a href="apex-2.apex-insights.json">apex-2.apex-insights.json</a>
      <a href="notes.txt">notes.txt</a>
    </body></html>
  `;

  expect(parseDirectoryListing(html)).toEqual([
    "../reports/apex-1.apex-insights.json",
    "../reports/apex-2.apex-insights.json",
  ]);
});

it("parseDirectoryListing matches single-quoted hrefs and case-insensitive HREF", () => {
  const html = `
    <a href='apex-single-quoted.apex-insights.json'>single</a>
    <a HREF="apex-uppercase.apex-insights.json">uppercase</a>
    <a Href="apex-mixed.apex-insights.json">mixed case</a>
    <a href="../">parent dir — should be ignored</a>
    <a href="notes.txt">non-json — should be ignored</a>
  `;
  expect(parseDirectoryListing(html)).toEqual([
    "../reports/apex-single-quoted.apex-insights.json",
    "../reports/apex-uppercase.apex-insights.json",
    "../reports/apex-mixed.apex-insights.json",
  ]);
});

it("committed fixture logs normalize and render across the rewritten views", async () => {
  // Use committed fixture logs instead of gitignored reports/ directory.
  // This makes the test deterministic in CI and fresh clones.
  const fixtureDir = resolve(process.cwd(), "fixtures");
  const fixtureNames = (await readdir(fixtureDir))
    .filter((name) => name.endsWith(".log"))
    .sort();

  expect(fixtureNames.length).toBeGreaterThan(0);

  for (const name of fixtureNames) {
    const fixturePath = resolve(fixtureDir, name);
    const rawLogText = await readFile(fixturePath, "utf8");
    const parseResult = await parseLog(rawLogText, {
      sourceName: fixturePath,
      sourceType: "file",
      includeRawLines: true,
      enablePhaseInference: true,
    });

    const report = buildOfflineReport({
      source: { fileName: fixturePath, bytes: Buffer.byteLength(rawLogText) },
      parseResult,
      rawLogText,
    });

    const rawLines = parseResult.rawLines ?? [];

    const viewModel = normalizeReport({ report, rawLines });

    const triageHtml = renderTriage(viewModel);
    const executionHtml = renderExecution(viewModel);
    const dataHtml = renderData(viewModel);
    const diagnosticsHtml = renderDiagnostics(viewModel);
    const evidenceHtml = renderEvidence(viewModel, { query: "" });

    expect(triageHtml, `${name}: triage render failed`).toMatch(
      /What happened/,
    );
    expect(executionHtml, `${name}: execution render failed`).toMatch(
      /What ran, in what order/,
    );
    expect(dataHtml, `${name}: data render failed`).toMatch(
      /What touched the database/,
    );
    expect(diagnosticsHtml, `${name}: diagnostics render failed`).toMatch(
      /What is suspicious/,
    );
    expect(evidenceHtml, `${name}: evidence render failed`).toMatch(
      /Log Explorer/,
    );
  }
});

it("execution story timeline source remains trace.events (not span row synthesis)", async () => {
  const appJs = await readFile(resolve(process.cwd(), "viewer/app.js"), "utf8");
  expect(appJs).toMatch(
    /const traceEvents = Array\.isArray\(execution\?\.trace\?\.events\)/,
  );
  const start = appJs.indexOf("const executionTimelineRows =");
  const end = appJs.indexOf("const availableEventCategories =", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const block = appJs.slice(start, end);
  expect(block).not.toMatch(/\.\.\.\(spans\s*\|\|\s*\[\]\)/);
});

it("extension enforces a strict report schema guard for worker payload", async () => {
  const extensionOverlay = await readFile(
    resolve(process.cwd(), "packages/browser-ext/shared/app-extension-only.js"),
    "utf8",
  );
  expect(extensionOverlay).toMatch(
    /payload\.report\?\.reportVersion === "3\.0\.0"/,
  );
});

it("shares one offline-report display boundary across CLI and extension hosts", async () => {
  const root = process.cwd();
  const [viewerApp, extensionOverlay, assembler] = await Promise.all([
    readFile(resolve(root, "viewer/app.js"), "utf8"),
    readFile(
      resolve(root, "packages/browser-ext/shared/app-extension-only.js"),
      "utf8",
    ),
    readFile(resolve(root, "scripts/assemble-extension-ui.ts"), "utf8"),
  ]);

  expect(viewerApp).toMatch(/export function showOfflineReport\(/);
  expect(viewerApp).toMatch(
    /showOfflineReport\(\{[\s\S]*sourceLabel: logFileName/,
  );
  expect(extensionOverlay).toMatch(
    /showOfflineReport\(\{[\s\S]*report: hydrated,[\s\S]*sourceLabel: fileName/,
  );
  expect(assembler).toContain('.replace(/^export\\s+/gm, "")');
  expect(viewerApp).toContain("render(report, nextRawLines)");
  expect(viewerApp).toContain(
    'document.body.classList.remove("canonical-renderer-active")',
  );
  expect(viewerApp).not.toContain('from "./modules/render-live-view.js"');
  expect(assembler).toContain('"normalize-report.js"');
});

it("extension popup can clear cached logs without deleting preferences", async () => {
  const root = process.cwd();
  const popupHtml = await readFile(
    resolve(root, "packages/browser-ext/shared/popup.html"),
    "utf8",
  );
  const popupJs = await readFile(
    resolve(root, "packages/browser-ext/shared/popup.js"),
    "utf8",
  );

  expect(popupHtml).toMatch(/id="clearCachedLogsBtn"/);
  expect(popupJs).toContain("log-\\d+(?:-[a-z0-9]{6})?");
  expect(popupJs).toContain("new-tab-state-\\d+(?:-[a-z0-9]{8})?");
  expect(popupJs).not.toMatch(/key\.startsWith\("apex-log-"\)/);
  expect(popupJs).toMatch(/chrome\.storage\.local\.remove\(cachedKeys\)/);
  expect(popupJs).not.toMatch(/chrome\.storage\.local\.clear\(/);
  for (const preferenceKey of [
    "apex-log-explorer-settings",
    "apex-log-insights-theme",
  ]) {
    expect(
      new RegExp(
        "^apex-(?:log-\\d+(?:-[a-z0-9]{6})?|new-tab-state-\\d+(?:-[a-z0-9]{8})?)$",
      ).test(preferenceKey),
    ).toBe(false);
  }
});

it("viewer and extension expose the same five-tab workflow", async () => {
  const root = process.cwd();
  const viewerHtml = await readFile(resolve(root, "viewer/index.html"), "utf8");
  const extensionHtml = await readFile(
    resolve(root, "packages/browser-ext/shared/app.html"),
    "utf8",
  );
  for (const id of [
    "triageSummaryTabLink",
    "executionStoryTabLink",
    "dataLimitsTabLink",
    "diagnosticsTabLink",
    "logExplorerTabLink",
  ]) {
    expect(viewerHtml).toContain(`id="${id}"`);
    expect(extensionHtml).toContain(`id="${id}"`);
  }
  for (const html of [viewerHtml, extensionHtml]) {
    expect(html).not.toContain('href="#compare"');
    expect(html).not.toContain('href="#overview"');
  }
});

it("offline service worker caches every viewer module and the current version", async () => {
  const root = process.cwd();
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const worker = await readFile(resolve(root, "viewer/sw.js"), "utf8");
  const moduleFiles = (await readdir(resolve(root, "viewer/modules"))).filter(
    (file) => file.endsWith(".js"),
  );
  expect(worker).toContain(`apex-log-insights-v${pkg.version}`);
  for (const file of moduleFiles) {
    expect(worker, `service worker is missing ${file}`).toContain(
      `./modules/${file}`,
    );
  }
});
