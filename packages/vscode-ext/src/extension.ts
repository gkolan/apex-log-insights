import {
  commands,
  ProgressLocation,
  window,
  workspace,
  type ExtensionContext,
  type Uri,
} from "vscode";

import { registerAnalyzeLogCodeLens } from "./code-lens.js";
import { AnalysisPanel } from "./analysis-panel.js";
import { ParseCanceledError, ParserClient } from "./parser-client.js";
import {
  activeLogUri,
  chooseLogUri,
  isAnalysisSourceCurrent,
  readAnalysisSource,
} from "./source.js";

let outputChannel: ReturnType<typeof window.createOutputChannel> | undefined;
const parserClients = new Map<string, ParserClient>();
let analysisPanel: AnalysisPanel | undefined;

function parserFor(uri: Uri): ParserClient {
  const key = uri.toString();
  const existing = parserClients.get(key);
  if (existing) return existing;
  const client = new ParserClient();
  parserClients.set(key, client);
  return client;
}

/** Activate the VS Code host adapter. User-facing commands are added only with their handlers. */
export function activate(context: ExtensionContext): void {
  outputChannel = window.createOutputChannel("Apex Log Insights", {
    log: true,
  });
  context.subscriptions.push(outputChannel);
  outputChannel.debug("Apex Log Insights activated.");
  const validateSource = async (
    uri: Uri | undefined,
    allowUnknown: boolean,
  ) => {
    if (!uri) {
      const action = await window.showInformationMessage(
        "Open an Apex debug log or choose one to analyze.",
        "Choose Log File…",
      );
      if (action === "Choose Log File…") {
        await commands.executeCommand("apexLogInsights.analyzeLogFile");
      }
      return;
    }

    try {
      const source = await readAnalysisSource(uri);
      if (!source.detectedAsApexLog) {
        if (!allowUnknown) {
          await window.showWarningMessage(
            `${source.fileName} does not look like a Salesforce Apex debug log.`,
          );
          return;
        }
        const action = await window.showWarningMessage(
          `${source.fileName} does not look like a Salesforce Apex debug log.`,
          { modal: true },
          "Analyze Anyway",
        );
        if (action !== "Analyze Anyway") return;
      }

      outputChannel?.info(
        `Analyzing ${source.fileName} (${source.bytes} bytes${source.isDirty ? ", unsaved content" : ""}).`,
      );
      await analysisPanel?.showLoading(source);
      const report = await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: `Apex Log Insights: Analyzing ${source.fileName}…`,
          cancellable: true,
        },
        (_progress, token) => parserFor(source.uri).parse(source, token),
      );
      const displayed = await analysisPanel?.showReport(source, report);
      if (!displayed) {
        outputChannel?.info(
          `Analysis result discarded because the panel for ${source.fileName} was closed.`,
        );
        return;
      }
      outputChannel?.info(`Analysis completed for ${source.fileName}.`);
      if (!(await isAnalysisSourceCurrent(source))) {
        analysisPanel?.markStale(source.uri);
      }
    } catch (error) {
      if (error instanceof ParseCanceledError) {
        outputChannel?.info("Analysis canceled.");
        if (uri) analysisPanel?.showCanceled(uri);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      outputChannel?.error(`Source validation failed: ${message}`);
      if (uri) analysisPanel?.showError(uri, message);
      await window.showErrorMessage(`Apex Log Insights: ${message}`);
    }
  };

  analysisPanel = new AnalysisPanel(
    context,
    (uri) => validateSource(uri, true),
    (uri) => {
      const key = uri.toString();
      parserClients.get(key)?.cancel();
      parserClients.delete(key);
    },
  );
  context.subscriptions.push(
    { dispose: () => analysisPanel?.dispose() },
    workspace.onDidChangeTextDocument((event) =>
      analysisPanel?.markStale(event.document.uri),
    ),
    workspace.onDidSaveTextDocument((document) =>
      analysisPanel?.markStale(document.uri),
    ),
  );
  const watcher = workspace.createFileSystemWatcher("**/*.log");
  context.subscriptions.push(
    watcher,
    watcher.onDidChange((uri) => analysisPanel?.markStale(uri)),
    watcher.onDidDelete((uri) => analysisPanel?.markMissing(uri)),
  );

  context.subscriptions.push(
    commands.registerCommand(
      "apexLogInsights.analyzeActiveLog",
      (resource?: Uri) => validateSource(resource ?? activeLogUri(), false),
    ),
    commands.registerCommand("apexLogInsights.analyzeLogFile", async () => {
      const uri = await chooseLogUri();
      if (uri) await validateSource(uri, true);
    }),
    commands.registerCommand("apexLogInsights.refreshAnalysis", async () => {
      const uri = analysisPanel?.getActiveUri();
      if (uri) await validateSource(uri, true);
    }),
  );
  registerAnalyzeLogCodeLens(context);
}

/** Release extension-owned references when the extension host stops. */
export function deactivate(): void {
  for (const client of parserClients.values()) client.dispose();
  parserClients.clear();
  analysisPanel?.dispose();
  analysisPanel = undefined;
  outputChannel = undefined;
}
