import { execFileSync } from "node:child_process";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { MAX_LOG_BYTES } from "@apex-log-insights/core";

import {
  initialLogReadCapacity,
  readBoundedLog,
  startViewServer,
} from "./server.js";

const fixture = resolve(process.cwd(), "fixtures/simple.log");

describe("startViewServer", () => {
  it("allocates log responses in proportion to observed file size", () => {
    expect(initialLogReadCapacity(0)).toBe(64 * 1024);
    expect(initialLogReadCapacity(1)).toBe(64 * 1024);
    expect(initialLogReadCapacity(64 * 1024)).toBe(64 * 1024 + 1);
    expect(initialLogReadCapacity(MAX_LOG_BYTES)).toBe(MAX_LOG_BYTES + 1);
  });

  it("expands from a stale small size without truncating the opened file", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "apex-log-cli-"));
    const logPath = resolve(directory, "grown.log");
    const expected = Buffer.alloc(128 * 1024, 0x61);
    await writeFile(logPath, expected);
    const file = await open(logPath, "r");
    try {
      const content = await readBoundedLog(file, 0);
      expect(content.byteLength).toBe(expected.byteLength);
      expect(content.equals(expected)).toBe(true);
    } finally {
      await file.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns an idempotent close handle without owning process signals", async () => {
    const sigintListeners = process.listenerCount("SIGINT");
    const sigtermListeners = process.listenerCount("SIGTERM");
    const server = await startViewServer({
      target: fixture,
      port: 0,
      open: false,
    });

    try {
      expect(server.url).toMatch(
        new RegExp(
          `^http://127\\.0\\.0\\.1:${server.port}/\\?log=simple\\.log$`,
        ),
      );
      expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);

      const expectedBytes = (await readFile(fixture)).byteLength;
      const logHead = await fetch(
        `${server.url.split("/?")[0]}/logs/simple.log`,
        {
          method: "HEAD",
        },
      );
      expect(logHead.status).toBe(200);
      expect(logHead.headers.get("content-length")).toBe(String(expectedBytes));
      expect(await logHead.text()).toBe("");

      const assetHead = await fetch(`${server.url.split("/?")[0]}/index.html`, {
        method: "HEAD",
      });
      expect(assetHead.status).toBe(200);
      expect(Number(assetHead.headers.get("content-length"))).toBeGreaterThan(
        0,
      );
      expect(await assetHead.text()).toBe("");
    } finally {
      await Promise.all([server.close(), server.close()]);
    }
  });

  it("opens a selected directory log in the viewer shell", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "apex-log-cli-"));
    await writeFile(resolve(directory, "selected.log"), "EXECUTION_STARTED\n");
    const server = await startViewServer({
      target: directory,
      port: 0,
      open: false,
    });

    try {
      const landingResponse = await fetch(server.url);
      const landingHtml = await landingResponse.text();
      expect(landingResponse.status).toBe(200);
      expect(landingHtml).toContain('href="/?log=selected.log"');
      expect(landingHtml).not.toContain('target="_blank"');

      const reportResponse = await fetch(`${server.url}?log=selected.log`);
      const reportHtml = await reportResponse.text();
      expect(reportResponse.status).toBe(200);
      expect(reportHtml).toContain('id="triageSummaryTabLink"');
      expect(reportHtml).not.toContain("Apex debug logs in this folder");
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an oversized log before serving it to the browser", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "apex-log-cli-"));
    const logPath = resolve(directory, "oversized.log");
    const file = await open(logPath, "w");
    await file.truncate(25 * 1024 * 1024 + 1);
    await file.close();
    const server = await startViewServer({
      target: logPath,
      port: 0,
      open: false,
    });

    try {
      const response = await fetch(
        `${server.url.split("/?")[0]}/logs/oversized.log`,
      );
      expect(response.status).toBe(413);
      expect(await response.text()).toContain("25 MiB");
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects a named pipe without blocking for a writer",
    async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "apex-log-cli-"));
      execFileSync("mkfifo", [resolve(directory, "stream.log")]);
      const server = await startViewServer({
        target: directory,
        port: 0,
        open: false,
      });

      try {
        const response = await fetch(`${server.url}logs/stream.log`, {
          signal: AbortSignal.timeout(2_000),
        });
        expect(response.status).toBe(400);
        expect(await response.text()).toBe("Not a file");
      } finally {
        await server.close();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
