/**
 * Local HTTP server for the Apex Log Insights viewer.
 *
 * Serves the viewer assets and raw .log files.
 * Supports two modes:
 *   - Single file:  apex-log view my-debug.log
 *   - Folder:       apex-log view ./logs/
 *
 * In folder mode, GET / returns a landing page listing all .log files.
 * Each file opens the viewer in a new tab with ?log=<filename>.
 *
 * The viewer parses the raw log client-side in a Web Worker — no JSON
 * intermediate files are generated or served.
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { constants, existsSync } from "node:fs";
import {
  open as openFile,
  readFile,
  readdir,
  stat,
  lstat,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { resolve, join, extname, basename, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_LOG_BYTES } from "@apex-log-insights/core";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const INITIAL_LOG_READ_BYTES = 64 * 1024;

class LogInputTooLargeError extends RangeError {}

/** @internal Exported for deterministic allocation-boundary tests. */
export function initialLogReadCapacity(fileSize: number): number {
  return Math.min(
    MAX_LOG_BYTES + 1,
    Math.max(INITIAL_LOG_READ_BYTES, fileSize + 1),
  );
}

/** @internal Exported for deterministic stale-size and growth tests. */
export async function readBoundedLog(
  fileHandle: FileHandle,
  observedSize: number,
): Promise<Buffer> {
  let bytes = Buffer.allocUnsafe(initialLogReadCapacity(observedSize));
  let offset = 0;
  while (true) {
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
  if (offset > MAX_LOG_BYTES) throw new LogInputTooLargeError();
  return bytes.subarray(0, offset);
}

export interface ViewServerOptions {
  /** Absolute path to a single .log file or a directory of .log files. */
  target: string;
  /** Port to listen on. 0 means auto-assign. */
  port: number;
  /** Whether to open the browser automatically. */
  open: boolean;
}

export interface ViewServerHandle {
  /** Loopback URL for the running viewer. */
  url: string;
  /** Actual bound port, including the assigned port when zero was requested. */
  port: number;
  /** Stops accepting requests and waits for existing connections to close. */
  close(): Promise<void>;
}

interface LogEntry {
  name: string;
  sizeBytes: number;
  modifiedAt: Date;
}

export async function startViewServer(
  options: ViewServerOptions,
): Promise<ViewServerHandle> {
  const { target, port, open } = options;

  const targetStat = await stat(target);
  const isFolder = targetStat.isDirectory();
  const logDir = isFolder ? target : resolve(target, "..");
  const singleFile = isFolder ? null : basename(target);
  const singleLogEntry: LogEntry | null = singleFile
    ? {
        name: singleFile,
        sizeBytes: targetStat.size,
        modifiedAt: targetStat.mtime,
      }
    : null;

  // A published CLI keeps viewer assets under dist/viewer. Source execution
  // falls back to the repository's canonical viewer directory.
  const srcDir = dirname(fileURLToPath(import.meta.url));
  const packagedViewerDir = resolve(srcDir, "viewer");
  const viewerDir = existsSync(packagedViewerDir)
    ? packagedViewerDir
    : resolve(srcDir, "..", "..", "..", "viewer");

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      try {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        );

        if (req.method !== "GET" && req.method !== "HEAD") {
          res.setHeader("Allow", "GET, HEAD");
          res.writeHead(405);
          res.end("Method not allowed");
          return;
        }

        const url = new URL(req.url || "/", "http://127.0.0.1");
        let pathname: string;
        try {
          pathname = decodeURIComponent(url.pathname);
        } catch {
          res.writeHead(400);
          res.end("Malformed URL");
          return;
        }

        // Landing page (folder mode only)
        if (pathname === "/" && isFolder && !url.searchParams.has("log")) {
          const html = await buildLandingPage(logDir);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(req.method === "HEAD" ? undefined : html);
          return;
        }

        // Serve raw .log files from the target directory
        if (pathname.startsWith("/logs/")) {
          const fileName = pathname.slice(6); // strip '/logs/'
          if (!fileName.toLowerCase().endsWith(".log")) {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          if (singleFile !== null && fileName !== singleFile) {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          const filePath = resolve(logDir, fileName);
          // Prevent path traversal: resolve symlinks, then ensure the real path
          // stays inside logDir. Prevents symlink-based escapes.
          const realLogDir = await realpath(logDir);
          let realFilePath: string;
          try {
            realFilePath = await realpath(filePath);
          } catch {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          if (
            !realFilePath.startsWith(realLogDir + sep) &&
            realFilePath !== realLogDir
          ) {
            res.writeHead(403);
            res.end("Forbidden");
            return;
          }
          let fileHandle: FileHandle;
          try {
            fileHandle = await openFile(
              realFilePath,
              constants.O_RDONLY |
                (constants.O_NOFOLLOW ?? 0) |
                (constants.O_NONBLOCK ?? 0),
            );
          } catch (error: unknown) {
            const code = (error as NodeJS.ErrnoException).code;
            res.writeHead(code === "ELOOP" ? 403 : 404);
            res.end(code === "ELOOP" ? "Forbidden" : "Not found");
            return;
          }
          try {
            const fileStat = await fileHandle.stat();
            if (!fileStat.isFile()) {
              res.writeHead(400);
              res.end("Not a file");
              return;
            }
            if (fileStat.size > MAX_LOG_BYTES) {
              res.writeHead(413, {
                "Content-Type": "text/plain; charset=utf-8",
              });
              res.end("Log exceeds the 25 MiB input limit");
              return;
            }
            if (req.method === "HEAD") {
              res.writeHead(200, {
                "Content-Type": "text/plain; charset=utf-8",
                "Content-Length": fileStat.size,
                "Cache-Control": "no-store",
              });
              res.end();
              return;
            }
            let content: Buffer;
            try {
              content = await readBoundedLog(fileHandle, fileStat.size);
            } catch (error: unknown) {
              if (error instanceof LogInputTooLargeError) {
                res.writeHead(413, {
                  "Content-Type": "text/plain; charset=utf-8",
                });
                res.end("Log exceeds the 25 MiB input limit");
                return;
              }
              throw error;
            }
            res.writeHead(200, {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-store",
            });
            res.end(content);
          } finally {
            await fileHandle.close();
          }
          return;
        }

        // API: list available .log files
        if (pathname === "/api/health") {
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          });
          const health = {
            status: "ok",
            mode: isFolder ? "folder" : "single-file",
            capabilities: {
              listLogs: true,
              readLogs: true,
              serverSideParsing: false,
            },
          };
          res.end(req.method === "HEAD" ? undefined : JSON.stringify(health));
          return;
        }

        // API: list available .log files
        if (pathname === "/api/logs") {
          const entries = singleLogEntry
            ? [singleLogEntry]
            : await listLogFiles(logDir);
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(req.method === "HEAD" ? undefined : JSON.stringify(entries));
          return;
        }

        // Serve viewer assets
        const assetPath = pathname === "/" ? "/index.html" : pathname;
        const safePath = assetPath.replace(/\.\./g, "");
        const filePath = resolve(viewerDir, safePath.replace(/^\/+/, ""));
        // Prevent path traversal: resolve symlinks, then validate.
        const realViewerDir = await realpath(viewerDir);
        let realAssetPath: string;
        try {
          realAssetPath = await realpath(filePath);
        } catch {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        if (
          !realAssetPath.startsWith(realViewerDir + sep) &&
          realAssetPath !== realViewerDir
        ) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }
        if (req.method === "HEAD") {
          const assetStat = await stat(realAssetPath);
          if (!assetStat.isFile()) {
            res.writeHead(400);
            res.end("Not a file");
            return;
          }
          const ext = extname(filePath);
          res.writeHead(200, {
            "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
            "Content-Length": assetStat.size,
            "Cache-Control": ext === ".html" ? "no-store" : "max-age=3600",
          });
          res.end();
          return;
        }
        const content = await readFile(realAssetPath);
        const ext = extname(filePath);
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
          "Cache-Control": ext === ".html" ? "no-store" : "max-age=3600",
        });
        res.end(content);
      } catch (err: unknown) {
        const errnoErr = err as NodeJS.ErrnoException;
        const code = errnoErr.code;
        if (code === "ENOENT") {
          res.writeHead(404);
          res.end("Not found");
        } else if (code === "EACCES") {
          console.error(`Permission denied: ${errnoErr.message}`);
          res.writeHead(403);
          res.end("Permission denied");
        } else if (code === "EISDIR") {
          res.writeHead(400);
          res.end("Is a directory");
        } else {
          console.error(
            `Server error [${code ?? "unknown"}]: ${errnoErr.message}`,
          );
          res.writeHead(500);
          res.end("Internal server error");
        }
      }
    },
  );

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const onListenError = (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        rejectPromise(
          new Error(
            `Port ${port} is already in use. Try a different port with --port.`,
          ),
        );
      } else if (err.code === "EACCES") {
        rejectPromise(
          new Error(
            `Permission denied for port ${port}. Try a port above 1024.`,
          ),
        );
      } else {
        rejectPromise(new Error(`Server error: ${err.message}`));
      }
    };
    server.once("error", onListenError);

    server.listen(port, "127.0.0.1", () => {
      server.off("error", onListenError);
      resolvePromise();
    });
  });
  server.on("error", (error) => {
    console.error(`Local server error: ${error.message}`);
  });

  const addr = server.address();
  const assignedPort = typeof addr === "object" && addr ? addr.port : port;
  const viewerUrl = singleFile
    ? `http://127.0.0.1:${assignedPort}/?log=${encodeURIComponent(singleFile)}`
    : `http://127.0.0.1:${assignedPort}/`;

  console.warn(`\n  Apex Log Insights — local viewer`);
  console.warn(`  ${isFolder ? "Folder" : "File"}:  ${target}`);
  console.warn(`  URL:     ${viewerUrl}`);
  console.warn(`  Press Ctrl+C to stop.\n`);

  if (open) {
    void openBrowser(viewerUrl).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Could not open browser:", msg);
    });
  }

  let closePromise: Promise<void> | null = null;
  return {
    url: viewerUrl,
    port: assignedPort,
    close: () => {
      closePromise ??= new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) rejectClose(error);
          else resolveClose();
        });
      });
      return closePromise;
    },
  };
}

async function listLogFiles(dir: string): Promise<LogEntry[]> {
  const entries: LogEntry[] = [];
  await scanDir(dir, dir, entries);
  // Sort by most recently modified first
  entries.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return entries;
}

/** Recursively scan a directory for .log files, collecting relative paths. */
async function scanDir(
  baseDir: string,
  currentDir: string,
  entries: LogEntry[],
): Promise<void> {
  let items: string[];
  try {
    items = await readdir(currentDir);
  } catch {
    return; // skip unreadable directories
  }
  for (const item of items) {
    const fullPath = join(currentDir, item);
    try {
      const itemStat = await lstat(fullPath);
      if (itemStat.isSymbolicLink()) continue;
      if (itemStat.isDirectory()) {
        // Recurse into subdirectories (skip hidden dirs like .git)
        if (!item.startsWith(".")) {
          await scanDir(baseDir, fullPath, entries);
        }
      } else if (itemStat.isFile() && item.toLowerCase().endsWith(".log")) {
        // Use path relative to baseDir so the viewer can fetch via /logs/<relativePath>
        const relativePath = fullPath.slice(baseDir.length + 1);
        entries.push({
          name: relativePath,
          sizeBytes: itemStat.size,
          modifiedAt: itemStat.mtime,
        });
      }
    } catch {
      // skip unreadable items
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function buildLandingPage(logDir: string): Promise<string> {
  const entries = await listLogFiles(logDir);
  const rows = entries
    .map(
      (entry) => `
    <tr>
      <td><a href="/?log=${encodeURIComponent(entry.name)}">${escapeHtml(entry.name)}</a></td>
      <td>${formatSize(entry.sizeBytes)}</td>
      <td>${formatDate(entry.modifiedAt)}</td>
    </tr>
  `,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Apex Log Insights</title>
  <style>
    :root {
      --bg: #f8fafc;
      --surface: #ffffff;
      --ink: #0f172a;
      --muted: #64748b;
      --line: #e2e8f0;
      --accent: #2563eb;
      --font-sans: "SF Pro Display", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #171e2e;
        --surface: #243044;
        --ink: #f8fafc;
        --muted: #94a3b8;
        --line: #3b4d66;
        --accent: #3b82f6;
      }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--font-sans);
      background: var(--bg);
      color: var(--ink);
      padding: 48px 24px;
      max-width: 900px;
      margin: 0 auto;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .subtitle {
      color: var(--muted);
      font-size: 14px;
      margin-bottom: 32px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--surface);
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid var(--line);
    }
    th, td {
      padding: 12px 16px;
      text-align: left;
      font-size: 14px;
    }
    th {
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      border-bottom: 1px solid var(--line);
    }
    tr:not(:last-child) td { border-bottom: 1px solid var(--line); }
    td:nth-child(2), td:nth-child(3) { color: var(--muted); white-space: nowrap; }
    a { color: var(--accent); text-decoration: none; font-weight: 500; }
    a:hover { text-decoration: underline; }
    .empty {
      text-align: center;
      padding: 48px;
      color: var(--muted);
      font-size: 15px;
    }
  </style>
</head>
<body>
  <h1>Apex Log Insights</h1>
  <p class="subtitle">${entries.length} log file${entries.length !== 1 ? "s" : ""} found &mdash; each opens in a new tab</p>
  ${
    entries.length > 0
      ? `
  <table>
    <thead>
      <tr>
        <th>Log File</th>
        <th>Size</th>
        <th>Modified</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  `
      : `<div class="empty">No .log files found in this directory.</div>`
  }
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] || c,
  );
}

async function openBrowser(url: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const platform = process.platform;

  return new Promise<void>((resolvePromise) => {
    const onResult = (err: Error | null) => {
      if (err) {
        console.error(
          "Could not open browser automatically. Open this URL manually:",
          url,
        );
      }
      resolvePromise();
    };

    if (platform === "darwin") {
      execFile("open", [url], onResult);
    } else if (platform === "win32") {
      execFile("cmd", ["/c", "start", "", url], onResult);
    } else {
      execFile("xdg-open", [url], onResult);
    }
  });
}
