import { TextDecoder } from "node:util";

import { utf8ByteLength } from "@apex-log-insights/core";

import {
  FileType,
  window,
  workspace,
  type TextDocument,
  type Uri,
} from "vscode";

import { detectApexLogPrefix, hasLogSuffix } from "./log-detection.js";
import { logSizeError, MAX_LOG_BYTES } from "./source-limits.js";

export interface AnalysisSource {
  uri: Uri;
  fileName: string;
  logText: string;
  bytes: number;
  isDirty: boolean;
  documentVersion: number | null;
  lastModified: number | null;
  detectedAsApexLog: boolean;
}

function openDocumentFor(uri: Uri): TextDocument | undefined {
  const key = uri.toString();
  return workspace.textDocuments.find(
    (document) => document.uri.toString() === key,
  );
}

function basename(uri: Uri): string {
  const parts = uri.path.split("/").filter(Boolean);
  return parts.at(-1) || "debug.log";
}

export async function readAnalysisSource(uri: Uri): Promise<AnalysisSource> {
  if (!hasLogSuffix(uri.path)) {
    throw new Error("Select a file whose name ends in .log.");
  }

  const openDocument = openDocumentFor(uri);
  let logText: string;
  let bytes: number;
  let isDirty = false;
  let documentVersion: number | null = null;
  let lastModified: number | null = null;

  if (openDocument) {
    logText = openDocument.getText();
    bytes = utf8ByteLength(logText);
    isDirty = openDocument.isDirty;
    documentVersion = openDocument.version;
  } else {
    const stat = await workspace.fs.stat(uri);
    lastModified = stat.mtime;
    if ((stat.type & FileType.File) === 0) {
      throw new Error("Select a .log file, not a directory.");
    }
    if (stat.size > MAX_LOG_BYTES) {
      throw new Error(logSizeError(stat.size));
    }
    const content = await workspace.fs.readFile(uri);
    bytes = content.byteLength;
    try {
      logText = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw new Error("The selected log is not valid UTF-8 text.");
    }
  }

  if (bytes > MAX_LOG_BYTES) {
    throw new Error(logSizeError(bytes));
  }

  return {
    uri,
    fileName: basename(uri),
    logText,
    bytes,
    isDirty,
    documentVersion,
    lastModified,
    detectedAsApexLog: detectApexLogPrefix(logText).isApexLog,
  };
}

export async function isAnalysisSourceCurrent(
  source: AnalysisSource,
): Promise<boolean> {
  const openDocument = openDocumentFor(source.uri);
  if (openDocument) return openDocument.version === source.documentVersion;
  if (source.lastModified === null) return false;
  try {
    return (await workspace.fs.stat(source.uri)).mtime === source.lastModified;
  } catch {
    return false;
  }
}

export async function chooseLogUri(): Promise<Uri | undefined> {
  const selected = await window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { "Apex debug logs": ["log"] },
    title: "Analyze an Apex debug log with Apex Log Insights",
  });
  return selected?.[0];
}

export function activeLogUri(): Uri | undefined {
  return window.activeTextEditor?.document.uri;
}
