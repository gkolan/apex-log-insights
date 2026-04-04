/**
 * Web Worker Entry Point for CLI Viewer
 *
 * Bundled by esbuild and served alongside the viewer.
 * Same protocol as the browser extension worker.
 *
 * Message protocol:
 *   IN:  { type: 'SET_CONFIG', limits?: ReportLimits }
 *   IN:  { type: 'PARSE_LOG', logText: string, fileId?: string }
 *   OUT: { type: 'PARSE_RESULT', ok: true,  report: OfflineReportV2 }
 *   OUT: { type: 'PARSE_RESULT', ok: false, error: string }
 */

import { parseLog, buildOfflineReport, type ReportLimits } from '@apex-log-insights/core';

const workerSelf = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(data: unknown): void;
};

const workerConfig: { limits?: ReportLimits } = {};

workerSelf.onmessage = async (e: MessageEvent) => {
  try {
    const msg = (e.data ?? {}) as {
      type?: string;
      logText?: string;
      fileId?: string;
      limits?: ReportLimits;
    };

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
    const fileName = msg.fileId ?? 'debug.log';

    const parsed = await parseLog(logText, {
      sourceName: fileName,
      sourceType: 'file',
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
