/**
 * Chrome Extension — Web Worker Entry Point
 *
 * This is the TypeScript source for apex-parser-worker.js.
 * It is bundled by `npm run export:extension` using esbuild.
 *
 * Message protocol:
 *   IN:  { type: 'SET_CONFIG', limits?: ReportLimits }
 *   IN:  { type: 'PARSE_LOG', logText: string, fileId?: string }
 *   OUT: { type: 'PARSE_RESULT', ok: true,  report: OfflineReportV2 }
 *   OUT: { type: 'PARSE_RESULT', ok: false, error: string }
 *
 * app.js requires `payload.report?.reportVersion === '3.0.0'` and uses the
 * report directly. The legacy adapter path has been removed from the active
 * extension runtime.
 */

import { parseLog, buildOfflineReport, type ReportLimits } from '@apex-log-insights/core';

// Self reference typed for a Web Worker global scope
const workerSelf = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(data: unknown): void;
};

// Module-level config that persists across parse calls
const workerConfig: { limits?: ReportLimits } = {};

workerSelf.onmessage = async (e: MessageEvent) => {
  try {
    const msg = (e.data ?? {}) as {
      type?: string;
      logText?: string;
      fileId?: string;
      limits?: ReportLimits;
    };

    // Handle config updates
    if (msg.type === 'SET_CONFIG') {
      if (msg.limits) {
        workerConfig.limits = { ...workerConfig.limits, ...msg.limits };
      }
      return;
    }

    if (msg.type !== 'PARSE_LOG') {
      workerSelf.postMessage({ type: 'PARSE_RESULT', ok: false, error: `Unknown message type: ${String(msg.type)}` });
      return;
    }

    const logText = msg.logText ?? '';
    // fileId is the filename sent by app.js (e.g. "MyLog.log")
    const fileName = msg.fileId ?? 'debug.log';

    // Full TypeScript parsing pipeline — same path as the Node CLI
    const parsed = await parseLog(logText, {
      sourceName: fileName,
      sourceType: 'salesforce-page',
      includeRawLines: true,
      enablePhaseInference: true,
    });

    const report = buildOfflineReport({
      source: {
        fileName,
        bytes: new TextEncoder().encode(logText).length,
        generatedAt: new Date().toISOString(),
      },
      parseResult: parsed,
      rawLogText: logText,
      limits: workerConfig.limits,
    });

    workerSelf.postMessage({ type: 'PARSE_RESULT', ok: true, report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    workerSelf.postMessage({ type: 'PARSE_RESULT', ok: false, error: message });
  }
};
