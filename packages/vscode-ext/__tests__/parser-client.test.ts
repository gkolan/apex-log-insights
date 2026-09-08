import { EventEmitter } from "node:events";
import type { Worker } from "node:worker_threads";

import { describe, expect, it } from "vitest";

import { ParseCanceledError, ParserClient } from "../src/parser-client.js";
import type { AnalysisSource } from "../src/source.js";

class ControlledWorker extends EventEmitter {
  posted: unknown[] = [];
  terminateCount = 0;
  postError: unknown;

  postMessage(message: unknown): void {
    if (this.postError !== undefined) throw this.postError;
    this.posted.push(message);
  }

  async terminate(): Promise<number> {
    this.terminateCount += 1;
    return 0;
  }
}

const source = {
  fileName: "cancel.log",
  logText: "12:00:00.000 (1)|EXECUTION_STARTED",
  bytes: 40,
} as AnalysisSource;

describe("ParserClient", () => {
  it("sends text without a caller-controlled report byte count", async () => {
    const worker = new ControlledWorker();
    const client = new ParserClient(() => worker as unknown as Worker);
    const pending = client.parse(source);

    expect(worker.posted[0]).toMatchObject({
      type: "PARSE_LOG",
      fileName: source.fileName,
      logText: source.logText,
    });
    expect(worker.posted[0]).not.toHaveProperty("bytes");
    client.cancel();
    await expect(pending).rejects.toBeInstanceOf(ParseCanceledError);
  });

  it("settles an explicitly canceled parse even when worker termination exits cleanly", async () => {
    const worker = new ControlledWorker();
    const client = new ParserClient(() => worker as unknown as Worker);
    const pending = client.parse(source);

    client.cancel();

    await expect(pending).rejects.toBeInstanceOf(ParseCanceledError);
    expect(worker.terminateCount).toBe(1);
  });

  it("cancels a superseded request before starting its replacement", async () => {
    const workers = [new ControlledWorker(), new ControlledWorker()];
    const client = new ParserClient(
      () => workers.shift()! as unknown as Worker,
    );
    const first = client.parse(source);
    const second = client.parse({ ...source, fileName: "replacement.log" });

    await expect(first).rejects.toBeInstanceOf(ParseCanceledError);
    client.cancel();
    await expect(second).rejects.toBeInstanceOf(ParseCanceledError);
    expect(workers).toHaveLength(0);
  });

  it("terminates and rejects a worker that exceeds the parse timeout", async () => {
    const worker = new ControlledWorker();
    const client = new ParserClient(() => worker as unknown as Worker, 1);

    await expect(client.parse(source)).rejects.toThrow(
      "Parse timed out after 0 seconds.",
    );
    expect(worker.terminateCount).toBe(1);
  });

  it.each([
    [0, "Parser worker exited before returning a result."],
    [7, "Parser worker exited with code 7."],
  ])(
    "rejects an unsettled parse when its worker exits with code %i",
    async (code, message) => {
      const worker = new ControlledWorker();
      const client = new ParserClient(() => worker as unknown as Worker);
      const pending = client.parse(source);

      worker.emit("exit", code);

      await expect(pending).rejects.toThrow(message);
      expect(worker.terminateCount).toBe(1);
    },
  );

  it("cleans up when dispatching the request to the worker fails", async () => {
    const worker = new ControlledWorker();
    worker.postError = new Error("worker is unavailable");
    const client = new ParserClient(() => worker as unknown as Worker);

    await expect(client.parse(source)).rejects.toThrow("worker is unavailable");
    expect(worker.terminateCount).toBe(1);
  });

  it("rejects a malformed response for the active request immediately", async () => {
    const worker = new ControlledWorker();
    const client = new ParserClient(() => worker as unknown as Worker);
    const pending = client.parse(source);
    const request = worker.posted[0] as { requestId: string };

    worker.emit("message", {
      type: "PARSE_RESULT",
      requestId: request.requestId,
      ok: true,
      report: [],
    });

    await expect(pending).rejects.toThrow(
      "Parser worker returned a malformed response.",
    );
    expect(worker.terminateCount).toBe(1);
  });

  it("ignores responses belonging to another request", async () => {
    const worker = new ControlledWorker();
    const client = new ParserClient(() => worker as unknown as Worker);
    const pending = client.parse(source);

    worker.emit("message", {
      type: "PARSE_RESULT",
      requestId: "different-request",
      ok: false,
      error: { code: "PARSE_FAILED", message: "unrelated" },
    });
    client.cancel();

    await expect(pending).rejects.toBeInstanceOf(ParseCanceledError);
  });

  it("disposes a cancellation listener that fires during registration", async () => {
    const worker = new ControlledWorker();
    let disposed = false;
    const client = new ParserClient(() => worker as unknown as Worker);
    const cancellation = {
      isCancellationRequested: false,
      onCancellationRequested(listener: () => void) {
        listener();
        return { dispose: () => (disposed = true) };
      },
    };

    await expect(client.parse(source, cancellation)).rejects.toBeInstanceOf(
      ParseCanceledError,
    );
    expect(disposed).toBe(true);
    expect(worker.terminateCount).toBe(1);
  });
});
