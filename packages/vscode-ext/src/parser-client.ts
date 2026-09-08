import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";

import type { OfflineReportV2 } from "@apex-log-insights/core";

import type { AnalysisSource } from "./source.js";
import {
  isParseResponse,
  parseResponseRequestId,
  type ParseRequest,
} from "./worker-messages.js";

const PARSE_TIMEOUT_MS = 120_000;

export interface CancellationLike {
  isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export class ParseCanceledError extends Error {
  constructor() {
    super("Parsing was canceled.");
    this.name = "ParseCanceledError";
  }
}

export class ParserClient {
  private activeWorker: Worker | undefined;
  private activeRequestId: string | undefined;
  private activeCancel: (() => void) | undefined;

  constructor(
    private readonly createWorker: () => Worker = () =>
      new Worker(resolve(__dirname, "parser-worker.cjs")),
    private readonly parseTimeoutMs = PARSE_TIMEOUT_MS,
  ) {}

  async parse(
    source: AnalysisSource,
    cancellation?: CancellationLike,
  ): Promise<OfflineReportV2> {
    this.cancel();
    if (cancellation?.isCancellationRequested) throw new ParseCanceledError();

    const requestId = randomUUID();
    const worker = this.createWorker();
    this.activeWorker = worker;
    this.activeRequestId = requestId;

    return new Promise<OfflineReportV2>((resolveReport, reject) => {
      let settled = false;
      const cancellationState: {
        disposable?: { dispose(): void };
      } = {};
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cancellationState.disposable?.dispose();
        if (this.activeRequestId === requestId) {
          this.activeRequestId = undefined;
          this.activeWorker = undefined;
          this.activeCancel = undefined;
        }
        void worker.terminate();
        action();
      };

      const timeout = setTimeout(() => {
        finish(() =>
          reject(
            new Error(
              `Parse timed out after ${Math.round(this.parseTimeoutMs / 1000)} seconds.`,
            ),
          ),
        );
      }, this.parseTimeoutMs);
      this.activeCancel = () => {
        finish(() => reject(new ParseCanceledError()));
      };
      const registeredCancellation = cancellation?.onCancellationRequested(
        () => {
          finish(() => reject(new ParseCanceledError()));
        },
      );
      if (settled) registeredCancellation?.dispose();
      else cancellationState.disposable = registeredCancellation;

      worker.once("error", (error) => finish(() => reject(error)));
      worker.once("exit", (code) => {
        if (!settled) {
          finish(() =>
            reject(
              new Error(
                code === 0
                  ? "Parser worker exited before returning a result."
                  : `Parser worker exited with code ${code}.`,
              ),
            ),
          );
        }
      });
      worker.on("message", (message: unknown) => {
        if (parseResponseRequestId(message) !== requestId) return;
        if (!isParseResponse(message)) {
          finish(() =>
            reject(new Error("Parser worker returned a malformed response.")),
          );
          return;
        }
        if (message.ok) {
          finish(() => resolveReport(message.report));
        } else {
          finish(() => reject(new Error(message.error.message)));
        }
      });

      const request: ParseRequest = {
        type: "PARSE_LOG",
        requestId,
        fileName: source.fileName,
        logText: source.logText,
      };
      try {
        worker.postMessage(request);
      } catch (error) {
        finish(() =>
          reject(
            error instanceof Error
              ? error
              : new Error("Parser worker rejected the parse request."),
          ),
        );
      }
    });
  }

  cancel(): void {
    const cancelActive = this.activeCancel;
    if (cancelActive) {
      cancelActive();
      return;
    }
    if (this.activeWorker) void this.activeWorker.terminate();
    this.activeWorker = undefined;
    this.activeRequestId = undefined;
    this.activeCancel = undefined;
  }

  dispose(): void {
    this.cancel();
  }
}
