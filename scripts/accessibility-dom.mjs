import axe from "axe-core";

export const axeSource = axe.source;

/** Runs in a rendered document, including real extension popup/webview documents. */
export async function auditDocument(selector) {
  await document.fonts.ready;
  await Promise.all(
    document
      .getAnimations()
      .map((animation) => animation.finished.catch(() => {})),
  );
  const result = await globalThis.axe.run(
    selector ? document.querySelector(selector) : document,
    {
      runOnly: {
        type: "tag",
        values: [
          "wcag2a",
          "wcag2aa",
          "wcag21a",
          "wcag21aa",
          "wcag22aa",
          "best-practice",
        ],
      },
    },
  );
  const summarize = (rules) =>
    rules.map(({ id, impact, help, helpUrl, nodes }) => ({
      id,
      impact,
      help,
      helpUrl,
      nodes: nodes.map(({ target, html, failureSummary, any, all, none }) => ({
        target,
        html,
        failureSummary,
        any,
        all,
        none,
      })),
    }));
  return {
    engine: result.testEngine,
    violations: summarize(result.violations),
    incomplete: summarize(result.incomplete),
    passes: result.passes.map(({ id }) => id),
  };
}

/** Computed foreground/background regression for the reported search and highlight defect. */
export function inspectLogContrast(extraSelectors = []) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const rgba = (color) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].map((n, i) =>
      i === 3 ? n / 255 : n,
    );
  };
  const over = (front, back) =>
    front
      .slice(0, 3)
      .map((n, i) => n * front[3] + back[i] * (1 - front[3]))
      .concat(1);
  const luminance = (rgb) =>
    rgb
      .slice(0, 3)
      .map((n) => {
        const s = n / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
  const selectors = [
    ...extraSelectors,
    "#rawSearchInput",
    ".rawLineMatch .rawLineText",
    ".rawLineMatch .rawLineNo",
    ".rawLineContext .rawLineText",
    ".rawLineContext .rawLineNo",
    ".rawLineError .rawLineText",
    ".rawLineError .rawLineNo",
    "textarea",
  ];
  const results = [];
  for (const selector of selectors) {
    for (const element of [...document.querySelectorAll(selector)].slice(
      0,
      20,
    )) {
      if (!element.getClientRects().length) continue;
      const chain = [];
      for (let parent = element; parent; parent = parent.parentElement)
        chain.unshift(parent);
      let background = [255, 255, 255, 1];
      let opacity = 1;
      for (const ancestor of chain) {
        const style = getComputedStyle(ancestor);
        background = over(rgba(style.backgroundColor), background);
        opacity *= Number(style.opacity);
      }
      const style = getComputedStyle(element);
      const text = rgba(style.color);
      text[3] *= opacity;
      const foreground = over(text, background);
      const a = luminance(foreground),
        b = luminance(background);
      results.push({
        selector,
        text: element.textContent?.slice(0, 80),
        foreground,
        background,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        opacity,
      });
    }
  }
  return results;
}

export async function auditPage(page, label, selector) {
  await page.evaluate(axeSource);
  return {
    label,
    scope: selector || "document",
    ...(await page.evaluate(auditDocument, selector)),
    contrast: await page.evaluate(inspectLogContrast),
  };
}
