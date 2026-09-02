import { MAX_LOG_BYTES, readLogFile } from "./readLogFile.js";

export interface ResolvedLogInput {
  text: string;
  sourceName: string;
  sourceType: "file" | "clipboard";
}

/** Validates the mutually exclusive MCP log inputs and returns their content. */
export async function resolveLogInput(
  args: Record<string, unknown> | undefined,
): Promise<ResolvedLogInput> {
  const logText =
    typeof args?.logText === "string" && args.logText.length > 0
      ? args.logText
      : undefined;
  const filePath =
    typeof args?.filePath === "string" && args.filePath.trim().length > 0
      ? args.filePath
      : undefined;

  if ((logText === undefined) === (filePath === undefined)) {
    throw new Error("Provide exactly one of logText or filePath.");
  }

  if (logText !== undefined) {
    const sizeBytes = new TextEncoder().encode(logText).length;
    if (sizeBytes > MAX_LOG_BYTES) {
      throw new Error(
        `Log exceeds the ${MAX_LOG_BYTES / (1024 * 1024)} MB input limit.`,
      );
    }
    return {
      text: logText,
      sourceName: "inline.log",
      sourceType: "clipboard",
    };
  }

  return {
    text: await readLogFile(filePath!),
    sourceName: filePath!,
    sourceType: "file",
  };
}
