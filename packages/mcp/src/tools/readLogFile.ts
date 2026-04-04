import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

const READ_TIMEOUT_MS = 30_000;

/**
 * Reads a log file with timeout and path validation.
 * Rejects after 30 seconds to prevent the MCP server from hanging indefinitely.
 */
export async function readLogFile(filePath: string): Promise<string> {
  // Path validation: reject traversal patterns
  if (filePath.includes('..')) {
    throw new Error('File path must not contain ".." segments.');
  }

  // Reject absolute paths to prevent arbitrary file reads
  if (isAbsolute(filePath)) {
    throw new Error('File path must be relative, not absolute.');
  }

  // Reject paths containing null bytes
  if (filePath.includes('\0')) {
    throw new Error('File path must not contain null bytes.');
  }

  // Ensure the file has a .log extension
  if (!filePath.toLowerCase().endsWith('.log')) {
    throw new Error('Only .log files can be read.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);

  try {
    return await readFile(filePath, { encoding: 'utf-8', signal: controller.signal });
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`File read timed out after ${READ_TIMEOUT_MS / 1000}s: ${filePath}`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Error reading file: ${msg}`);
  } finally {
    clearTimeout(timeout);
  }
}
