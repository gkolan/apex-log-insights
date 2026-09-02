import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { resolveLogInput } from "../src/tools/resolveLogInput.js";
import {
  initialReadCapacity,
  MAX_LOG_BYTES,
  readLogFile,
} from "../src/tools/readLogFile.js";

const originalWorkingDirectory = process.cwd();
const temporaryDirectories = new Set<string>();

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "apex-log-mcp-"));
  temporaryDirectories.add(directory);
  return directory;
}

afterEach(async () => {
  process.chdir(originalWorkingDirectory);
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  temporaryDirectories.clear();
});

describe("resolveLogInput", () => {
  it("accepts inline text and records clipboard provenance", async () => {
    await expect(
      resolveLogInput({ logText: "EXECUTION_STARTED" }),
    ).resolves.toEqual({
      text: "EXECUTION_STARTED",
      sourceName: "inline.log",
      sourceType: "clipboard",
    });
  });

  it("rejects missing, empty, and ambiguous inputs", async () => {
    await expect(resolveLogInput(undefined)).rejects.toThrow(
      "Provide exactly one",
    );
    await expect(resolveLogInput({ logText: "" })).rejects.toThrow(
      "Provide exactly one",
    );
    await expect(
      resolveLogInput({ logText: "log", filePath: "other.log" }),
    ).rejects.toThrow("Provide exactly one");
  });

  it("rejects inline logs larger than the bounded input limit", async () => {
    await expect(
      resolveLogInput({ logText: "x".repeat(25 * 1024 * 1024 + 1) }),
    ).rejects.toThrow("25 MB input limit");
  });

  it("reads a relative log under the server working directory", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(join(directory, "sample.log"), "EXECUTION_STARTED", "utf8");
    process.chdir(directory);

    await expect(readLogFile("sample.log")).resolves.toBe("EXECUTION_STARTED");
  });

  it("allocates in proportion to observed file size within the hard limit", () => {
    expect(initialReadCapacity(0)).toBe(64 * 1024);
    expect(initialReadCapacity(1)).toBe(64 * 1024);
    expect(initialReadCapacity(64 * 1024)).toBe(64 * 1024 + 1);
    expect(initialReadCapacity(MAX_LOG_BYTES)).toBe(MAX_LOG_BYTES + 1);
  });

  it.skipIf(process.platform === "win32")(
    "rejects a named pipe without blocking for a writer",
    async () => {
      const directory = await createTemporaryDirectory();
      execFileSync("mkfifo", [join(directory, "stream.log")]);
      process.chdir(directory);

      await expect(readLogFile("stream.log")).rejects.toThrow(
        "Path is not a file",
      );
    },
  );

  it("rejects a relative symlink that resolves outside the working directory", async () => {
    const base = await createTemporaryDirectory();
    const workingDirectory = join(base, "workspace");
    await mkdir(workingDirectory, { recursive: true });
    await writeFile(join(base, "outside.log"), "sensitive", "utf8");
    await symlink(
      join(base, "outside.log"),
      join(workingDirectory, "link.log"),
    );
    process.chdir(workingDirectory);

    await expect(readLogFile("link.log")).rejects.toThrow(
      "must stay within the server working directory",
    );
  });

  it("rejects an oversized file before reading its contents", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(
      join(directory, "large.log"),
      Buffer.alloc(25 * 1024 * 1024 + 1),
    );
    process.chdir(directory);

    await expect(readLogFile("large.log")).rejects.toThrow("25 MB input limit");
  });
});
