import { describe, expect, it } from "vitest";

import {
  installWorkerMessageHandler,
  processWorkerMessage,
} from "./worker-entry.js";

describe("CLI viewer parser worker protocol", () => {
  it("rejects unknown, empty, and malformed-file messages", async () => {
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
      processWorkerMessage({ type: "PARSE_LOG", logText: "valid", fileId: 7 }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("fileId"),
    });
  });

  it("returns a canonical report with exact file identity", async () => {
    await expect(
      processWorkerMessage({
        type: "PARSE_LOG",
        fileId: "cli-worker.log",
        logText: [
          "12:00:00.000 (1)|EXECUTION_STARTED",
          "12:00:00.001 (2)|EXECUTION_FINISHED",
        ].join("\n"),
      }),
    ).resolves.toMatchObject({
      type: "PARSE_RESULT",
      ok: true,
      report: {
        reportVersion: "3.0.0",
        source: { fileName: "cli-worker.log", sourceType: "file" },
      },
    });
  });

  it("installs a worker-scope adapter", async () => {
    const messages: unknown[] = [];
    const scope = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage: (message: unknown) => messages.push(message),
    };
    installWorkerMessageHandler(scope);

    await scope.onmessage?.({ data: { type: "UNKNOWN" } } as MessageEvent);
    expect(messages).toHaveLength(1);
  });
});
