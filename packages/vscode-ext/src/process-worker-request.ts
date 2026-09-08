import { parseOfflineReport } from "./parse-report.js";
import {
  isParseRequest,
  parseRequestId,
  type ParseResponse,
} from "./worker-messages.js";

export async function processWorkerRequest(
  request: unknown,
): Promise<ParseResponse | null> {
  const requestId = parseRequestId(request);
  if (!requestId) return null;
  if (!isParseRequest(request)) {
    return {
      type: "PARSE_RESULT",
      requestId,
      ok: false,
      error: {
        code: "PARSE_FAILED",
        message: "Parser worker received a malformed parse request.",
      },
    };
  }

  try {
    const report = await parseOfflineReport(request.logText, request.fileName);
    return { type: "PARSE_RESULT", requestId, ok: true, report };
  } catch (error) {
    return {
      type: "PARSE_RESULT",
      requestId,
      ok: false,
      error: {
        code: "PARSE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
