import { utf8ByteLength } from "@apex-log-insights/core";

import {
  CodeLens,
  EndOfLine,
  Range,
  languages,
  type CodeLensProvider,
  type ExtensionContext,
  type TextDocument,
} from "vscode";

import { detectApexLogPrefix } from "./log-detection.js";
import { MAX_DETECTION_BYTES, MAX_DETECTION_LINES } from "./log-detection.js";

function detectionPrefix(document: TextDocument): string {
  const lines: string[] = [];
  let bytes = 0;
  const count = Math.min(document.lineCount, MAX_DETECTION_LINES);
  for (let index = 0; index < count; index += 1) {
    const text = document.lineAt(index).text;
    const lineBytes = utf8ByteLength(text);
    if (bytes + lineBytes > MAX_DETECTION_BYTES) break;
    lines.push(text);
    bytes += lineBytes;
    const separatorBytes =
      index < document.lineCount - 1
        ? document.eol === EndOfLine.CRLF
          ? 2
          : 1
        : 0;
    if (bytes + separatorBytes > MAX_DETECTION_BYTES) break;
    bytes += separatorBytes;
  }
  return lines.join("\n");
}

class AnalyzeLogCodeLensProvider implements CodeLensProvider {
  provideCodeLenses(document: TextDocument): CodeLens[] {
    const detection = detectApexLogPrefix(detectionPrefix(document));
    if (!detection.isApexLog) return [];

    return [
      new CodeLens(new Range(0, 0, 0, 0), {
        command: "apexLogInsights.analyzeActiveLog",
        title: "Analyze with Apex Log Insights",
        arguments: [document.uri],
      }),
    ];
  }
}

export function registerAnalyzeLogCodeLens(context: ExtensionContext): void {
  context.subscriptions.push(
    languages.registerCodeLensProvider(
      [{ pattern: "**/*.log" }, { pattern: "**/*.LOG" }],
      new AnalyzeLogCodeLensProvider(),
    ),
  );
}
