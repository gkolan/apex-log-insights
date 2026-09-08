import { describe, expect, it } from "vitest";

import { MAX_LOG_BYTES } from "./utf8.js";
import { processWorkerParseMessage } from "./workerProtocol.js";

describe("processWorkerParseMessage", () => {
  it("rejects malformed requests and oversized UTF-8 input", async () => {
    await expect(
      processWorkerParseMessage({ type: "UNKNOWN" }, { sourceType: "file" }),
    ).resolves.toEqual({
      type: "PARSE_RESULT",
      ok: false,
      error: "Unknown message type: UNKNOWN",
    });
    await expect(
      processWorkerParseMessage(
        { type: "PARSE_LOG", logText: "" },
        { sourceType: "file" },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("non-empty"),
    });
    await expect(
      processWorkerParseMessage(
        { type: "PARSE_LOG", logText: "valid", fileId: "" },
        { sourceType: "file" },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("fileId"),
    });
    await expect(
      processWorkerParseMessage(
        {
          type: "PARSE_LOG",
          logText: "é".repeat(Math.floor(MAX_LOG_BYTES / 2) + 1),
        },
        { sourceType: "file" },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("25 MiB"),
    });
  }, 15_000);

  it("builds a canonical report with host-selected source attribution", async () => {
    const response = await processWorkerParseMessage(
      {
        type: "PARSE_LOG",
        fileId: "worker.log",
        logText: [
          "12:00:00.000 (1)|EXECUTION_STARTED",
          "12:00:00.001 (2)|EXECUTION_FINISHED",
        ].join("\n"),
      },
      { sourceType: "salesforce-page" },
    );

    expect(response).toMatchObject({
      type: "PARSE_RESULT",
      ok: true,
      report: {
        reportVersion: "3.0.0",
        source: {
          fileName: "worker.log",
          sourceType: "salesforce-page",
        },
      },
    });
  });
});
