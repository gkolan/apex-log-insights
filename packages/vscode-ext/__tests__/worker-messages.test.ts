import { describe, expect, it } from "vitest";

import {
  isParseRequest,
  isParseResponse,
  parseRequestId,
  parseResponseRequestId,
} from "../src/worker-messages.js";

describe("VS Code parser worker requests", () => {
  const valid = {
    type: "PARSE_LOG",
    requestId: "request-1",
    fileName: "debug.log",
    logText: "12:00:00.000 (1)|EXECUTION_STARTED",
  };

  it("accepts only the typed parse envelope", () => {
    expect(isParseRequest(valid)).toBe(true);
    for (const request of [
      null,
      [],
      { ...valid, type: "OTHER" },
      { ...valid, requestId: "" },
      { ...valid, fileName: "" },
      { ...valid, fileName: 7 },
      { ...valid, logText: {} },
    ]) {
      expect(isParseRequest(request)).toBe(false);
    }
  });

  it("extracts only a non-empty string request ID from object envelopes", () => {
    expect(parseRequestId(valid)).toBe("request-1");
    expect(parseRequestId({ requestId: "" })).toBeUndefined();
    expect(parseRequestId({ requestId: 1 })).toBeUndefined();
    expect(parseRequestId([])).toBeUndefined();
  });
});

describe("VS Code parser worker responses", () => {
  it("accepts canonical success and error envelopes", () => {
    expect(
      isParseResponse({
        type: "PARSE_RESULT",
        requestId: "request-1",
        ok: true,
        report: { reportVersion: "3.0.0" },
      }),
    ).toBe(true);
    expect(
      isParseResponse({
        type: "PARSE_RESULT",
        requestId: "request-1",
        ok: false,
        error: { code: "PARSE_FAILED", message: "failed" },
      }),
    ).toBe(true);
  });

  it.each([
    null,
    [],
    { type: "PARSE_RESULT", requestId: "request-1", ok: "true" },
    { type: "PARSE_RESULT", requestId: "request-1", ok: true, report: [] },
    {
      type: "PARSE_RESULT",
      requestId: "request-1",
      ok: false,
      error: { code: "OTHER", message: "failed" },
    },
  ])("rejects malformed response %#", (response) => {
    expect(isParseResponse(response)).toBe(false);
  });

  it("extracts only an object envelope's string request ID", () => {
    expect(parseResponseRequestId({ requestId: "request-1" })).toBe(
      "request-1",
    );
    expect(parseResponseRequestId({ requestId: 1 })).toBeUndefined();
    expect(parseResponseRequestId([])).toBeUndefined();
  });
});
