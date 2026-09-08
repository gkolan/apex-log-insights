export type HostMessage =
  | { type: "READY" }
  | { type: "REFRESH" }
  | { type: "OPEN_LOG_LINE"; lineNumber: number }
  | { type: "OPEN_EXTERNAL"; href: string };

function isAllowedExternalHref(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/gkolan/apex-log-insights/issues"
    );
  } catch {
    return false;
  }
}

export function isHostMessage(value: unknown): value is HostMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.type === "READY" || message.type === "REFRESH") return true;
  if (message.type === "OPEN_LOG_LINE") {
    return (
      Number.isInteger(message.lineNumber) && Number(message.lineNumber) > 0
    );
  }
  if (message.type === "OPEN_EXTERNAL") {
    return isAllowedExternalHref(message.href);
  }
  return false;
}

export function toZeroBasedLine(
  oneBasedLine: number,
  documentLineCount: number,
): number | undefined {
  if (
    !Number.isInteger(oneBasedLine) ||
    oneBasedLine < 1 ||
    oneBasedLine > documentLineCount
  ) {
    return undefined;
  }
  return oneBasedLine - 1;
}
