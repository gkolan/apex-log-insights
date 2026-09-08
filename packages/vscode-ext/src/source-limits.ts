import { MAX_LOG_BYTES } from "@apex-log-insights/core";

export { MAX_LOG_BYTES };

export function logSizeError(bytes: number): string | undefined {
  if (bytes <= MAX_LOG_BYTES) return undefined;
  return `The selected log is ${formatBytes(bytes)}; the limit is ${formatBytes(MAX_LOG_BYTES)}.`;
}

export function formatBytes(value: number): string {
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}
