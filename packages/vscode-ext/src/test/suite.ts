import assert from "node:assert/strict";
import { resolve } from "node:path";

import { commands, extensions, Uri, window, workspace } from "vscode";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export async function run(): Promise<void> {
  const extension = extensions.getExtension(
    "apex-log-insights.apex-log-insights",
  );
  assert(extension, "The development extension must be discoverable.");
  const activationEvents = extension.packageJSON.activationEvents as string[];
  assert(!activationEvents.includes("*"), "It must not use eager activation.");
  assert(
    !activationEvents.includes("onStartupFinished"),
    "It must not activate after every startup.",
  );

  const packageRoot = resolve(extension.extensionPath, "../..");
  const logUri = Uri.file(resolve(packageRoot, "fixtures/simple.log"));
  const document = await workspace.openTextDocument(logUri);
  await window.showTextDocument(document);
  await commands.executeCommand("apexLogInsights.analyzeActiveLog", logUri);
  assert.equal(
    extension.isActive,
    true,
    "The command must leave the extension active.",
  );

  await delay(100);
  const panel = window.tabGroups.all
    .flatMap((group) => group.tabs)
    .find((tab) => tab.label.includes("Apex Log Insights"));
  assert(panel, "Analysis must open a product-qualified editor panel.");

  const editor = window.visibleTextEditors.find(
    (candidate) => candidate.document.uri.toString() === logUri.toString(),
  );
  assert(editor, "The source editor must remain open.");
  await editor.edit((builder) =>
    builder.insert(document.positionAt(document.getText().length), "\n"),
  );
  assert.equal(document.isDirty, true, "The test must exercise unsaved text.");
  await commands.executeCommand("apexLogInsights.refreshAnalysis");

  const publicCommands = extension.packageJSON.contributes.commands as Array<{
    command: string;
    title: string;
  }>;
  for (const command of publicCommands) {
    assert.match(command.command, /^apexLogInsights\./);
    assert.match(command.title, /^Apex Log Insights:/);
  }

  await commands.executeCommand("workbench.action.closeAllEditors");
}
