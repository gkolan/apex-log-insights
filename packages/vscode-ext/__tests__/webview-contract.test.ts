import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

describe("VS Code webview contract", () => {
  it("assembles the canonical viewer without its service worker", async () => {
    const script = await readFile(
      resolve(root, "packages/vscode-ext/scripts/assemble-webview.mjs"),
      "utf8",
    );
    expect(script).toContain('resolve(viewerRoot, "modules")');
    expect(script).toContain('"{{CSP}}"');
    expect(script).toContain('"{{SCRIPT_URI}}"');
    expect(script).toContain('"serviceWorker"');
  });

  it("acquires the VS Code API once and validates host actions", async () => {
    const adapter = await readFile(
      resolve(root, "packages/vscode-ext/webview/vscode-adapter.js"),
      "utf8",
    );
    expect(adapter.match(/acquireVsCodeApi\(\)/g)).toHaveLength(1);
    expect(adapter).toContain('type: "OPEN_LOG_LINE"');
    expect(adapter).toContain('type: "REFRESH"');
    expect(adapter).toContain('classList.remove("initializing")');
    expect(adapter).toContain('message.isDirty ? "Unsaved content"');
    expect(adapter).not.toMatch(/fetch\s*\(/);
  });

  it("keeps network access disabled in the panel CSP", async () => {
    const panel = await readFile(
      resolve(root, "packages/vscode-ext/src/analysis-panel.ts"),
      "utf8",
    );
    expect(panel).toContain("default-src 'none'");
    expect(panel).toContain("connect-src 'none'");
    expect(panel).toContain("object-src 'none'");
    expect(panel).not.toContain("unsafe-eval");
  });

  it("uses the shared report entry point instead of a renderer fork", async () => {
    const adapter = await readFile(
      resolve(root, "packages/vscode-ext/webview/vscode-adapter.js"),
      "utf8",
    );
    expect(adapter).toContain('import("./app.js")');
    expect(adapter).toContain("showOfflineReport({");
  });
});
