import { describe, expect, it } from "vitest";

import { processWorkerRequest } from "../src/process-worker-request.js";

describe("VS Code parser worker request processing", () => {
  it("ignores an envelope that cannot be correlated", async () => {
    await expect(
      processWorkerRequest({ type: "PARSE_LOG", requestId: 7 }),
    ).resolves.toBeNull();
  });

  it("returns a correlated protocol error for a malformed request", async () => {
    await expect(
      processWorkerRequest({
        type: "PARSE_LOG",
        requestId: "request-1",
        fileName: "debug.log",
        logText: {},
      }),
    ).resolves.toEqual({
      type: "PARSE_RESULT",
      requestId: "request-1",
      ok: false,
      error: {
        code: "PARSE_FAILED",
        message: "Parser worker received a malformed parse request.",
      },
    });
  });

  it("returns bounded parse errors through the normal response envelope", async () => {
    await expect(
      processWorkerRequest({
        type: "PARSE_LOG",
        requestId: "request-2",
        fileName: "empty.log",
        logText: "",
      }),
    ).resolves.toMatchObject({
      type: "PARSE_RESULT",
      requestId: "request-2",
      ok: false,
      error: { code: "PARSE_FAILED", message: "The selected log is empty." },
    });
  });

  it("returns a canonical report for a valid request", async () => {
    const response = await processWorkerRequest({
      type: "PARSE_LOG",
      requestId: "request-3",
      fileName: "debug.log",
      logText: [
        "12:00:00.000 (1)|EXECUTION_STARTED",
        "12:00:00.001 (2)|EXECUTION_FINISHED",
      ].join("\n"),
    });

    expect(response).toMatchObject({
      type: "PARSE_RESULT",
      requestId: "request-3",
      ok: true,
      report: { reportVersion: "3.0.0" },
    });
  });
});
