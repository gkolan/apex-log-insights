/**
 * Chrome Extension — Web Worker Entry Point
 *
 * This is the TypeScript source for apex-parser-worker.js.
 * It is bundled by `npm run export:extension` using esbuild.
 *
 * Message protocol:
 *   IN:  { type: 'PARSE_LOG', logText: string, fileId?: string }
 *   OUT: { type: 'PARSE_RESULT', ok: true,  report: OfflineReportV2 }
 *   OUT: { type: 'PARSE_RESULT', ok: false, error: string }
 *
 * app.js requires `payload.report?.reportVersion === '3.0.0'` and uses the
 * report directly. The legacy adapter path has been removed from the active
 * extension runtime.
 */

import {
  MAX_LOG_BYTES,
  processWorkerParseMessage,
} from "@apex-log-insights/core";

export const MAX_WORKER_LOG_BYTES = MAX_LOG_BYTES;

// Self reference typed for a Web Worker global scope
const workerSelf = (typeof self === "undefined" ? null : self) as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(data: unknown): void;
} | null;

export async function processWorkerMessage(data: unknown): Promise<unknown> {
  return processWorkerParseMessage(data, { sourceType: "salesforce-page" });
}

export function installWorkerMessageHandler(
  scope: NonNullable<typeof workerSelf>,
): void {
  scope.onmessage = async (event: MessageEvent) => {
    const response = await processWorkerMessage(event.data);
    scope.postMessage(response);
  };
}

if (workerSelf) installWorkerMessageHandler(workerSelf);
