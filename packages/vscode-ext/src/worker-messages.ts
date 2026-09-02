import type { OfflineReportV2 } from "@apex-log-insights/core";

export interface ParseRequest {
  type: "PARSE_LOG";
  requestId: string;
  fileName: string;
  logText: string;
}

export function parseRequestId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const requestId = (value as Record<string, unknown>).requestId;
  return typeof requestId === "string" && requestId.length > 0
    ? requestId
    : undefined;
}

export function isParseRequest(value: unknown): value is ParseRequest {
  if (parseRequestId(value) === undefined) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === "PARSE_LOG" &&
    typeof candidate.fileName === "string" &&
    candidate.fileName.length > 0 &&
    typeof candidate.logText === "string"
  );
}

export type ParseResponse =
  | {
      type: "PARSE_RESULT";
      requestId: string;
      ok: true;
      report: OfflineReportV2;
    }
  | {
      type: "PARSE_RESULT";
      requestId: string;
      ok: false;
      error: { code: "PARSE_FAILED"; message: string };
    };

export function parseResponseRequestId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const requestId = (value as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? requestId : undefined;
}

export function isParseResponse(value: unknown): value is ParseResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.type !== "PARSE_RESULT" ||
    typeof candidate.requestId !== "string" ||
    typeof candidate.ok !== "boolean"
  ) {
    return false;
  }
  if (candidate.ok) {
    const report = candidate.report;
    return (
      !!report &&
      typeof report === "object" &&
      !Array.isArray(report) &&
      (report as Record<string, unknown>).reportVersion === "3.0.0"
    );
  }
  const error = candidate.error as Record<string, unknown> | undefined;
  return error?.code === "PARSE_FAILED" && typeof error.message === "string";
}
