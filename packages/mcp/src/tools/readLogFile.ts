import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { MAX_LOG_BYTES } from "@apex-log-insights/core";

export { MAX_LOG_BYTES };

const READ_TIMEOUT_MS = 30_000;
const INITIAL_READ_BYTES = 64 * 1024;

/** @internal Exported for deterministic allocation-boundary tests. */
export function initialReadCapacity(fileSize: number): number {
  return Math.min(
    MAX_LOG_BYTES + 1,
    Math.max(INITIAL_READ_BYTES, fileSize + 1),
  );
}

/**
 * Reads a log file with timeout and path validation.
 * Rejects after 30 seconds to prevent the MCP server from hanging indefinitely.
 */
export async function readLogFile(filePath: string): Promise<string> {
  // Path validation: reject traversal patterns
  if (normalize(filePath).split(sep).includes("..")) {
    throw new Error('File path must not contain ".." segments.');
  }

  // Reject absolute paths to prevent arbitrary file reads
  if (isAbsolute(filePath)) {
    throw new Error("File path must be relative, not absolute.");
  }

  // Reject paths containing null bytes
  if (filePath.includes("\0")) {
    throw new Error("File path must not contain null bytes.");
  }

  // Ensure the file has a .log extension
  if (!filePath.toLowerCase().endsWith(".log")) {
    throw new Error("Only .log files can be read.");
  }

  const workingDirectory = await realpath(process.cwd());
  const requestedPath = resolve(workingDirectory, filePath);
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(requestedPath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Error reading file: ${msg}`);
  }

  const relativePath = relative(workingDirectory, resolvedPath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("File path must stay within the server working directory.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);

  try {
    // Open the resolved target once and perform both validation and reading
    // through that handle. O_NOFOLLOW prevents a final-component symlink swap
    // between realpath() and open().
    const fileHandle = await open(
      resolvedPath,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    try {
      const fileStat = await fileHandle.stat();
      if (!fileStat.isFile()) throw new Error("Path is not a file.");
      if (fileStat.size > MAX_LOG_BYTES) {
        throw new Error(
          `Log exceeds the ${MAX_LOG_BYTES / (1024 * 1024)} MB input limit.`,
        );
      }

      // Read at most one byte beyond the limit. Small logs begin with a bounded
      // allocation and grow geometrically; near-limit logs allocate only once.
      // Rechecking the bytes read keeps a file that grows after stat() from
      // creating an unbounded allocation or being silently truncated.
      let bytes = Buffer.allocUnsafe(initialReadCapacity(fileStat.size));
      let offset = 0;
      while (true) {
        if (controller.signal.aborted) {
          throw new DOMException("The operation was aborted", "AbortError");
        }
        if (offset === bytes.length) {
          if (bytes.length === MAX_LOG_BYTES + 1) break;
          const expanded = Buffer.allocUnsafe(
            Math.min(MAX_LOG_BYTES + 1, bytes.length * 2),
          );
          bytes.copy(expanded, 0, 0, offset);
          bytes = expanded;
        }
        const { bytesRead } = await fileHandle.read(
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset > MAX_LOG_BYTES) {
        throw new Error(
          `Log exceeds the ${MAX_LOG_BYTES / (1024 * 1024)} MB input limit.`,
        );
      }
      return bytes.toString("utf8", 0, offset);
    } finally {
      await fileHandle.close();
    }
  } catch (err: unknown) {
    if ((err as Error).name === "AbortError") {
      throw new Error(
        `File read timed out after ${READ_TIMEOUT_MS / 1000}s: ${filePath}`,
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Error reading file: ${msg}`);
  } finally {
    clearTimeout(timeout);
  }
}
