import { describe, expect, it } from "vitest";

import {
  installWorkerMessageHandler,
  MAX_WORKER_LOG_BYTES,
  processWorkerMessage,
} from "./worker-entry.js";

type WorkerResponse = {
  type: string;
  ok: boolean;
  error?: string;
  report?: {
    reportVersion?: string;
    source?: { fileName?: string; sourceType?: string };
  };
};

describe("browser parser worker protocol", () => {
  it("rejects unknown, empty, and oversized messages", async () => {
    await expect(processWorkerMessage({ type: "UNKNOWN" })).resolves.toEqual({
      type: "PARSE_RESULT",
      ok: false,
      error: "Unknown message type: UNKNOWN",
    });
    await expect(
      processWorkerMessage({ type: "PARSE_LOG", logText: "" }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("non-empty"),
    });
    await expect(
      processWorkerMessage({
        type: "PARSE_LOG",
        logText: "valid",
        fileId: {},
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("fileId"),
    });
    await expect(
      processWorkerMessage({
        type: "PARSE_LOG",
        logText: "valid",
        fileId: "",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("fileId"),
    });
    await expect(
      processWorkerMessage({
        type: "PARSE_LOG",
        logText: "x".repeat(MAX_WORKER_LOG_BYTES + 1),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("25 MiB"),
    });
    await expect(
      processWorkerMessage({
        type: "PARSE_LOG",
        logText: "é".repeat(Math.floor(MAX_WORKER_LOG_BYTES / 2) + 1),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("25 MiB"),
    });
  }, 15_000);

  it("returns a canonical offline report for a valid parse request", async () => {
    const response = (await processWorkerMessage({
      type: "PARSE_LOG",
      fileId: "worker.log",
      logText: [
        "12:00:00.000 (1)|EXECUTION_STARTED",
        "12:00:00.001 (2)|EXECUTION_FINISHED",
      ].join("\n"),
    })) as WorkerResponse;

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

  it("installs a worker-scope adapter that posts protocol responses", async () => {
    const messages: unknown[] = [];
    const scope = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: (message: unknown) => messages.push(message),
    };
    installWorkerMessageHandler(scope);

    await scope.onmessage?.({ data: { type: "UNKNOWN" } } as MessageEvent);
    expect(messages).toEqual([
      {
        type: "PARSE_RESULT",
        ok: false,
        error: "Unknown message type: UNKNOWN",
      },
    ]);
  });
});
