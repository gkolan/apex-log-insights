import { buildOfflineReport } from "./offlineReport.js";
import { parseLog, type ParseSourceType } from "./parserCore.js";
import { MAX_LOG_BYTES, utf8ByteLength } from "./utf8.js";

export interface WorkerParseOptions {
  sourceType: ParseSourceType;
}

export type WorkerParseResponse =
  | {
      type: "PARSE_RESULT";
      ok: true;
      report: ReturnType<typeof buildOfflineReport>;
    }
  | {
      type: "PARSE_RESULT";
      ok: false;
      error: string;
    };

/**
 * Validate a host-neutral parser-worker message and build its canonical report.
 * Worker lifecycle and message delivery remain the responsibility of each host.
 */
export async function processWorkerParseMessage(
  message: unknown,
  options: WorkerParseOptions,
): Promise<WorkerParseResponse> {
  try {
    const request = (message ?? {}) as {
      type?: string;
      logText?: string;
      fileId?: string;
    };

    if (request.type !== "PARSE_LOG") {
      return {
        type: "PARSE_RESULT",
        ok: false,
        error: `Unknown message type: ${String(request.type)}`,
      };
    }

    if (typeof request.logText !== "string" || request.logText.length === 0) {
      return {
        type: "PARSE_RESULT",
        ok: false,
        error: "PARSE_LOG requires non-empty logText.",
      };
    }
    if (
      request.fileId !== undefined &&
      (typeof request.fileId !== "string" || request.fileId.length === 0)
    ) {
      return {
        type: "PARSE_RESULT",
        ok: false,
        error: "PARSE_LOG fileId must be a non-empty string when provided.",
      };
    }

    const logText = request.logText;
    const logBytes = utf8ByteLength(logText);
    if (logBytes > MAX_LOG_BYTES) {
      return {
        type: "PARSE_RESULT",
        ok: false,
        error: "Log exceeds the 25 MiB worker input limit.",
      };
    }

    const fileName = request.fileId ?? "debug.log";
    const parseResult = await parseLog(logText, {
      sourceName: fileName,
      sourceType: options.sourceType,
      includeRawLines: true,
      enablePhaseInference: true,
    });
    const report = buildOfflineReport({
      source: {
        fileName,
        bytes: logBytes,
        generatedAt: new Date().toISOString(),
      },
      parseResult,
      rawLogText: logText,
    });

    return { type: "PARSE_RESULT", ok: true, report };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { type: "PARSE_RESULT", ok: false, error: message };
  }
}
