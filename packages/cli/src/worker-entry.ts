/**
 * Web Worker Entry Point for CLI Viewer
 *
 * Bundled by esbuild and served alongside the viewer.
 * Same protocol as the browser extension worker.
 *
 * Message protocol:
 *   IN:  { type: 'PARSE_LOG', logText: string, fileId?: string }
 *   OUT: { type: 'PARSE_RESULT', ok: true,  report: OfflineReportV2 }
 *   OUT: { type: 'PARSE_RESULT', ok: false, error: string }
 */

import {
  MAX_LOG_BYTES,
  processWorkerParseMessage,
} from "@apex-log-insights/core";

export const MAX_WORKER_LOG_BYTES = MAX_LOG_BYTES;

const workerSelf = (typeof self === "undefined" ? null : self) as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(data: unknown): void;
} | null;

export async function processWorkerMessage(data: unknown): Promise<unknown> {
  return processWorkerParseMessage(data, { sourceType: "file" });
}

export function installWorkerMessageHandler(
  scope: NonNullable<typeof workerSelf>,
): void {
  scope.onmessage = async (event: MessageEvent) => {
    scope.postMessage(await processWorkerMessage(event.data));
  };
}

if (workerSelf) installWorkerMessageHandler(workerSelf);
