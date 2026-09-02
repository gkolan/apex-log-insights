import { randomBytes } from "node:crypto";

import type { OfflineReportV2 } from "@apex-log-insights/core";
import {
  env,
  Selection,
  Uri,
  ViewColumn,
  window,
  workspace,
  type ExtensionContext,
  type WebviewPanel,
} from "vscode";

import type { AnalysisSource } from "./source.js";
import { isHostMessage, toZeroBasedLine } from "./webview-protocol.js";

export class AnalysisPanel {
  private readonly panels = new Map<string, WebviewPanel>();
  private readonly latest = new Map<
    string,
    { source: AnalysisSource; report: OfflineReportV2 }
  >();
  private readonly statuses = new Map<string, "stale" | string>();
  private activeUri: Uri | undefined;

  constructor(
    private readonly context: ExtensionContext,
    private readonly refresh: (uri: Uri) => Promise<void>,
    private readonly panelDisposed: (uri: Uri) => void = () => undefined,
  ) {}

  async showLoading(source: AnalysisSource): Promise<void> {
    this.activeUri = source.uri;
    const panel = await this.panelFor(source);
    panel.title = `Apex Log Insights — ${source.fileName}`;
    panel.reveal(ViewColumn.Beside, true);
  }

  getActiveUri(): Uri | undefined {
    return this.activeUri;
  }

  async showReport(
    source: AnalysisSource,
    report: OfflineReportV2,
  ): Promise<boolean> {
    const key = source.uri.toString();
    const panel = this.panels.get(key);
    if (!panel) return false;
    this.latest.set(key, { source, report });
    this.statuses.delete(key);
    await panel.webview.postMessage({
      type: "SHOW_REPORT",
      report,
      rawLines: source.logText.split(/\r\n|\r|\n/),
      sourceLabel: source.fileName,
      isDirty: source.isDirty,
    });
    return true;
  }

  markStale(uri: Uri): void {
    const key = uri.toString();
    if (!this.latest.has(key)) return;
    if (this.statuses.get(key) === "stale") return;
    this.statuses.set(key, "stale");
    void this.panels.get(key)?.webview.postMessage({ type: "SOURCE_CHANGED" });
  }

  showError(uri: Uri, message: string): void {
    this.statuses.set(uri.toString(), message);
    void this.panels.get(uri.toString())?.webview.postMessage({
      type: "ANALYSIS_ERROR",
      message,
    });
  }

  showCanceled(uri: Uri): void {
    void this.panels.get(uri.toString())?.webview.postMessage({
      type: "ANALYSIS_CANCELED",
    });
  }

  markMissing(uri: Uri): void {
    const key = uri.toString();
    if (!this.latest.has(key)) return;
    const message =
      "Source file is unavailable. Evidence navigation is disabled.";
    this.statuses.set(key, message);
    void this.panels.get(key)?.webview.postMessage({
      type: "SOURCE_UNAVAILABLE",
      message,
    });
  }

  dispose(): void {
    for (const panel of this.panels.values()) panel.dispose();
    this.panels.clear();
    this.latest.clear();
    this.statuses.clear();
  }

  private async panelFor(source: AnalysisSource): Promise<WebviewPanel> {
    const key = source.uri.toString();
    const existing = this.panels.get(key);
    if (existing) return existing;

    const webviewRoot = Uri.joinPath(
      this.context.extensionUri,
      "dist",
      "webview",
    );
    const panel = window.createWebviewPanel(
      "apexLogInsights.analysis",
      `Apex Log Insights — ${source.fileName}`,
      { viewColumn: ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [webviewRoot],
      },
    );
    panel.webview.html = await this.htmlFor(panel, webviewRoot);
    this.panels.set(key, panel);
    panel.onDidDispose(() => {
      this.panels.delete(key);
      this.latest.delete(key);
      this.statuses.delete(key);
      if (this.activeUri?.toString() === key) this.activeUri = undefined;
      this.panelDisposed(source.uri);
    });
    panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.active) this.activeUri = source.uri;
    });
    panel.webview.onDidReceiveMessage(async (value: unknown) => {
      if (!isHostMessage(value)) return;
      const current = this.latest.get(key);
      if (value.type === "READY") {
        const status = this.statuses.get(key);
        if (current) await this.showReport(current.source, current.report);
        if (status === "stale") {
          await panel.webview.postMessage({ type: "SOURCE_CHANGED" });
        } else if (status) {
          await panel.webview.postMessage({
            type: "ANALYSIS_ERROR",
            message: status,
          });
        }
      } else if (value.type === "REFRESH") {
        await this.refresh(source.uri);
      } else if (value.type === "OPEN_LOG_LINE") {
        await this.openLine(source.uri, value.lineNumber);
      } else {
        await env.openExternal(Uri.parse(value.href));
      }
    });
    return panel;
  }

  private async htmlFor(panel: WebviewPanel, root: Uri): Promise<string> {
    const bytes = await workspace.fs.readFile(Uri.joinPath(root, "index.html"));
    const nonce = randomBytes(18).toString("base64");
    const source = panel.webview.cspSource;
    const csp = `default-src 'none'; img-src ${source} data:; style-src ${source} 'unsafe-inline'; script-src 'nonce-${nonce}' ${source}; connect-src 'none'; font-src ${source}; object-src 'none'; frame-src 'none'; base-uri 'none'`;
    return Buffer.from(bytes)
      .toString("utf8")
      .replaceAll("{{NONCE}}", nonce)
      .replaceAll("{{CSP}}", csp)
      .replaceAll(
        "{{STYLE_URI}}",
        panel.webview.asWebviewUri(Uri.joinPath(root, "styles.css")).toString(),
      )
      .replaceAll(
        "{{SCRIPT_URI}}",
        panel.webview
          .asWebviewUri(Uri.joinPath(root, "vscode-adapter.js"))
          .toString(),
      )
      .replaceAll(
        "{{VSCODE_STYLE_URI}}",
        panel.webview.asWebviewUri(Uri.joinPath(root, "vscode.css")).toString(),
      )
      .replaceAll(
        "{{ICON_URI}}",
        panel.webview
          .asWebviewUri(Uri.joinPath(root, "icons", "icon-active.svg"))
          .toString(),
      );
  }

  private async openLine(uri: Uri, lineNumber: number): Promise<void> {
    try {
      const document = await workspace.openTextDocument(uri);
      const line = toZeroBasedLine(lineNumber, document.lineCount);
      if (line === undefined) {
        await window.showWarningMessage(
          `Log line ${lineNumber} is unavailable in the current source. Refresh the analysis before opening evidence.`,
        );
        return;
      }
      const editor = await window.showTextDocument(document, {
        preview: false,
        preserveFocus: false,
      });
      const range = document.lineAt(line).range;
      editor.selection = new Selection(range.start, range.end);
      editor.revealRange(range);
    } catch {
      await window.showWarningMessage(
        "The analyzed source is unavailable. Restore the file or choose another Apex debug log.",
      );
    }
  }
}
