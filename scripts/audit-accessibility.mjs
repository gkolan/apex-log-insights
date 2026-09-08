import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import {
  auditPage,
  axeSource,
  auditDocument,
  inspectLogContrast,
} from "./accessibility-dom.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const channel =
  process.argv.find((arg) => arg.startsWith("--browser="))?.split("=")[1] ||
  "chrome";
assert.ok(
  ["chrome", "msedge"].includes(channel),
  "Use --browser=chrome or --browser=msedge",
);
const reportPath =
  process.argv.find((arg) => arg.startsWith("--report="))?.slice(9) ||
  resolve(tmpdir(), `apex-a11y-${channel}.json`);
const capturePath = process.argv
  .find((arg) => arg.startsWith("--screenshots="))
  ?.slice(14);
const checks = [];
const capture = async (page, theme, name) => {
  if (!capturePath) return;
  await mkdir(resolve(capturePath, theme), { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(capturePath, theme, name + ".png"),
    animations: "disabled",
  });
};
const profile = await mkdtemp(resolve(tmpdir(), "apex-a11y-"));
const extensionPath = resolve(
  root,
  `packages/browser-ext/dist/${channel === "chrome" ? "chrome" : "edge"}`,
);
const context = await chromium.launchPersistentContext(profile, {
  channel,
  headless: false,
  ignoreDefaultArgs: ["--disable-extensions"],
  viewport: { width: 1280, height: 800 },
  args: [
    "--enable-unsafe-extension-debugging",
    ...(channel === "msedge"
      ? [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ]
      : []),
  ],
});
const results = [];
let browserSession;
const record = (result) => {
  results.push(result);
  console.log(
    JSON.stringify({
      label: result.label,
      violations: result.violations.map((v) => ({
        id: v.id,
        count: v.nodes.length,
        examples: v.nodes
          .slice(0, 3)
          .map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
      contrastFailures: result.contrast.filter((c) => c.ratio < 4.5),
      incomplete: result.incomplete.map((v) => ({
        id: v.id,
        count: v.nodes.length,
      })),
    }),
  );
};
try {
  browserSession = await context.browser().newBrowserCDPSession();
  let origin;
  if (channel === "chrome") {
    const extension = await browserSession.send("Extensions.loadUnpacked", {
      path: extensionPath,
    });
    origin = `chrome-extension://${extension.id}`;
  } else {
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    origin = worker.url().replace(/\/background\.js$/, "");
  }
  const id = new URL(origin).host;
  const settings = await context.newPage();
  await settings.goto(
    `${channel === "chrome" ? "chrome" : "edge"}://extensions/?id=${id}`,
  );
  const fileToggle =
    channel === "chrome"
      ? settings.locator("#allow-on-file-urls cr-toggle")
      : settings.locator("fluent-switch#checkbox-3");
  await fileToggle.waitFor();
  const setFileAccess = async (enabled) => {
    const current = await fileToggle.evaluate(
      (element) =>
        Boolean(element.checked) || element.getAttribute("checked") === "true",
    );
    if (current !== enabled) {
      await fileToggle.click();
    }
  };
  const setup = async (enabled) => {
    await setFileAccess(enabled);
    const page = await context.newPage();
    await page.goto(origin + "/welcome.html");
    await page
      .getByRole("heading", {
        name: enabled ? "You’re all set!" : "Allow access to local debug logs",
        exact: true,
      })
      .waitFor();
    for (const theme of ["light", "dark"]) {
      await page
        .locator(theme === "light" ? "#themeLightBtn" : "#themeDarkBtn")
        .click();
      await page.waitForFunction(
        (value) => document.documentElement.dataset.theme === value,
        theme,
      );
      record(
        await auditPage(
          page,
          `${channel}/setup-${enabled ? "complete" : "required"}/${theme}`,
        ),
      );
      await capture(
        page,
        theme,
        enabled ? "setup-complete" : "setup-verification",
      );
    }
    await page.setViewportSize({ width: 320, height: 800 });
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    );
    assert.ok(fits, "Setup reflows at 320 CSS pixels");
    checks.push({ name: `setup-${enabled}/320px-reflow`, passed: fits });
    await page.close();
  };
  if (channel === "msedge") await setup(false);
  else
    checks.push({
      name: "permission-required",
      status: "not-run",
      reason:
        "Chrome disables its debug-loaded extension when file access changes; Edge exercises the same packaged permission UI.",
    });
  // Popup documents are opened by the browser action, not by navigation to popup.html.
  const targetPage = await context.newPage();
  await targetPage.goto("about:blank");
  const targetId = (
    await browserSession.send("Target.getTargets", { filter: [{}] })
  ).targetInfos.find(
    (t) => t.type === "tab" && t.url === "about:blank",
  ).targetId;
  const popup = async (state) => {
    await browserSession.send("Extensions.triggerAction", { id, targetId });
    let target;
    for (let i = 0; i < 50; i++) {
      target = (
        await browserSession.send("Target.getTargets", { filter: [{}] })
      ).targetInfos.find(
        (t) => t.type === "page" && t.url === origin + "/popup.html",
      );
      if (target) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(target, "Browser action popup opened");
    const { sessionId } = await browserSession.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: false,
    });
    let sequence = 0;
    const pending = new Map();
    const listener = (event) => {
      if (event.sessionId !== sessionId) return;
      const message = JSON.parse(event.message),
        callback = pending.get(message.id);
      if (callback) {
        pending.delete(message.id);
        message.error
          ? callback.reject(message.error)
          : callback.resolve(message.result);
      }
    };
    browserSession.on("Target.receivedMessageFromTarget", listener);
    const send = (method, params = {}) =>
      new Promise((resolveResult, reject) => {
        const request = ++sequence;
        pending.set(request, { resolve: resolveResult, reject });
        browserSession
          .send("Target.sendMessageToTarget", {
            sessionId,
            message: JSON.stringify({ id: request, method, params }),
          })
          .catch(reject);
      });
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails)
        throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    for (const theme of ["light", "dark"]) {
      for (let i = 0; i < 30; i++) {
        await evaluate(
          `document.getElementById('theme${theme === "light" ? "Light" : "Dark"}Btn')?.click()`,
        );
        if (
          await evaluate(
            `document.documentElement.dataset.theme === '${theme}' && document.getElementById('theme${theme === "light" ? "Light" : "Dark"}Btn').classList.contains('active')`,
          )
        )
          break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (state === "redaction")
        await evaluate(
          "if(!document.getElementById('redactEnabled').checked)document.getElementById('redactEnabled').click()",
        );
      await evaluate(axeSource);
      record({
        label: `${channel}/popup-${state}/${theme}`,
        ...(await evaluate(`(${auditDocument.toString()})()`)),
        contrast: await evaluate(`(${inspectLogContrast.toString()})()`),
      });
    }
    if (capturePath) {
      for (const theme of ["light", "dark"]) {
        await evaluate(
          `document.getElementById('theme${theme === "light" ? "Light" : "Dark"}Btn').click()`,
        );
        await evaluate("document.scrollingElement.scrollTop=0");
        let shot = await send("Page.captureScreenshot", { format: "png" });
        await mkdir(resolve(capturePath, theme), { recursive: true });
        await writeFile(
          resolve(
            capturePath,
            theme,
            `toolbar-popup-${state === "required" ? "verification" : state}.png`,
          ),
          Buffer.from(shot.data, "base64"),
        );
        if (state !== "required") {
          await evaluate(
            "document.scrollingElement.scrollTop=document.scrollingElement.scrollHeight",
          );
          shot = await send("Page.captureScreenshot", { format: "png" });
          await writeFile(
            resolve(capturePath, theme, `toolbar-popup-${state}-bottom.png`),
            Buffer.from(shot.data, "base64"),
          );
        }
      }
    }
    await evaluate("window.close()");
    browserSession.off("Target.receivedMessageFromTarget", listener);
  };
  if (channel === "msedge") await popup("required");
  await setup(true);
  await popup("ready");
  await popup("redaction");
  const start = await context.newPage();
  await start.goto(origin + "/app.html");
  for (const theme of ["light", "dark"]) {
    await start.evaluate(
      (theme) => chrome.storage.local.set({ "apex-log-insights-theme": theme }),
      theme,
    );
    await start.reload();
    record(await auditPage(start, `${channel}/analyzer-start/${theme}`));
    await capture(start, theme, "analyzer-start");
  }
  await start.close();
  const page = await context.newPage();
  await page.goto(
    "file://" + resolve(root, "fixtures/webstore-demo-opportunity-trigger.log"),
  );
  await page.locator("#apex-open-launcher").waitFor();
  record(
    await auditPage(page, `${channel}/log-launcher`, "#apex-open-launcher"),
  );
  if (capturePath)
    await page
      .locator("#apex-open-launcher")
      .screenshot({ path: resolve(capturePath, "log-launcher.png") });
  await page
    .getByRole("button", { name: "Open Apex Log Insights", exact: true })
    .click();
  await page.getByText("What happened", { exact: true }).waitFor();
  const views = [
    ["triageSummaryTabLink", "triage"],
    ["executionStoryTabLink", "execution"],
    ["dataLimitsTabLink", "data"],
    ["diagnosticsTabLink", "diagnostics"],
    ["logExplorerTabLink", "log"],
  ];
  for (const theme of ["light", "dark"]) {
    await page
      .locator(theme === "light" ? "#themeLightBtn" : "#themeDarkBtn")
      .click();
    for (const [nav, name] of views) {
      await page.locator("#" + nav).click();
      if (name === "log") {
        await page.locator("#rawSearchInput").fill("0068Z0000A00027QAH");
        await page.locator("#rawSearchBtn").click();
        await page.locator("#rawContextSelect").selectOption("2");
      }
      record(await auditPage(page, `${channel}/${name}/${theme}`));
      await page.locator(".top-banner-label").click();
      await capture(
        page,
        theme,
        {
          triage: "triage-summary",
          execution: "execution-story",
          data: "data-and-limits",
          diagnostics: "diagnostics",
          log: "log-explorer-id",
        }[name],
      );
    }
    await page.locator("#rawSearchInput").fill("Read timed out");
    await page.locator("#rawSearchBtn").click();
    await page.locator("#rawContextSelect").selectOption("2");
    record(await auditPage(page, `${channel}/log-errors/${theme}`));
    await page.locator(".top-banner-label").click();
    await capture(page, theme, "log-explorer");
    await page.locator("#rawSearchInput").focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "rawSearchBtn",
    );
    const focus = await page.locator("#rawSearchBtn").evaluate((e) => ({
      style: getComputedStyle(e).outlineStyle,
      width: getComputedStyle(e).outlineWidth,
    }));
    assert.ok(
      focus.style !== "none" && parseFloat(focus.width) >= 2,
      "Keyboard focus is visible",
    );
    await page.keyboard.press("Enter");
    assert.ok(
      (await page.locator(".rawLineMatch").count()) > 0,
      "Search works with the keyboard",
    );
    checks.push({ name: `${theme}/keyboard-search-and-focus`, passed: true });
    const redaction = page.locator("#redactionSettingsBtn");
    if (await redaction.isVisible()) {
      await redaction.click();
      await page.locator("#redactEnabled").check();
      record(await auditPage(page, `${channel}/redaction/${theme}`));
      await redaction.click();
    }
  }
  await page.locator("#dataLimitsTabLink").click();
  const copy = page.locator(".copyCellButton").first();
  await copy.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    document
      .querySelector(".copyCellButton")
      ?.getAttribute("aria-label")
      ?.startsWith("Copied "),
  );
  checks.push({ name: "keyboard-copy-table-value", passed: true });
  for (const [nav, name] of views) {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.locator("#" + nav).click();
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    );
    checks.push({ name: `${name}/320px-reflow`, passed: fits });
    assert.ok(fits, `${name} reflows at 320 CSS pixels`);
    const visibleLinks = await page
      .locator(".controls a")
      .evaluateAll((links) =>
        links.every((link) => {
          const rect = link.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth;
        }),
      );
    assert.ok(
      visibleLinks,
      "Every view link remains visible at 320 CSS pixels",
    );
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.locator("#rawSearchInput").focus();
  checks.push({
    name: "forced-colors",
    colors: await page.locator("#rawSearchInput").evaluate((e) => ({
      foreground: getComputedStyle(e).color,
      background: getComputedStyle(e).backgroundColor,
      active: matchMedia("(forced-colors: active)").matches,
    })),
  });
  record(await auditPage(page, `${channel}/forced-colors/log`));
  await mkdir(resolve(reportPath, ".."), { recursive: true });
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        browser: context.browser().version(),
        axe: results[0]?.engine,
        checks,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`Saved ${results.length} state audits to ${reportPath}`);
  assert.equal(
    results.reduce(
      (n, r) =>
        n +
        r.violations.length +
        r.contrast.filter((c) => c.ratio < 4.5).length,
      0,
    ),
    0,
    "Accessibility violations remain; inspect the JSON report",
  );
} finally {
  await mkdir(resolve(reportPath, ".."), { recursive: true });
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        browser: context.browser().version(),
        axe: results[0]?.engine,
        checks,
        results,
      },
      null,
      2,
    ),
  );
  await context.close();
}
