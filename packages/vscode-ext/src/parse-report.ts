import {
  buildOfflineReport,
  parseLog,
  utf8ByteLength,
  type OfflineReportV2,
} from "@apex-log-insights/core";

import { logSizeError } from "./source-limits.js";

export async function parseOfflineReport(
  logText: string,
  fileName: string,
): Promise<OfflineReportV2> {
  const bytes = utf8ByteLength(logText);
  if (bytes === 0) throw new Error("The selected log is empty.");
  const sizeError = logSizeError(bytes);
  if (sizeError) throw new Error(sizeError);

  const parseResult = await parseLog(logText, {
    sourceName: fileName,
    sourceType: "file",
    includeRawLines: true,
    enablePhaseInference: true,
  });

  return buildOfflineReport({
    source: {
      fileName,
      bytes,
      generatedAt: new Date().toISOString(),
    },
    parseResult,
    rawLogText: logText,
  });
}
