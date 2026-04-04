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

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { resolve, join, extname, basename, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export interface ViewServerOptions {
  /** Absolute path to a single .log file or a directory of .log files. */
  target: string;
  /** Port to listen on. 0 means auto-assign. */
  port: number;
  /** Whether to open the browser automatically. */
  open: boolean;
}

interface LogEntry {
  name: string;
  sizeBytes: number;
  modifiedAt: Date;
}

export async function startViewServer(options: ViewServerOptions): Promise<void> {
  const { target, port, open } = options;

  const targetStat = await stat(target);
  const isFolder = targetStat.isDirectory();
  const logDir = isFolder ? target : resolve(target, '..');
  const singleFile = isFolder ? null : basename(target);

  // Resolve the viewer directory: packages/cli/src/server.ts → root/packages/cli/src → root
  const srcDir = dirname(fileURLToPath(import.meta.url));
  const pkgRoot = resolve(srcDir, '..');
  const repoRoot = resolve(pkgRoot, '..');
  const viewerDir = resolve(repoRoot, 'viewer');

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost`);
    const pathname = decodeURIComponent(url.pathname);

    try {
      // Landing page (folder mode only)
      if (pathname === '/' && isFolder) {
        const html = await buildLandingPage(logDir);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      // Serve raw .log files from the target directory
      if (pathname.startsWith('/logs/')) {
        const fileName = pathname.slice(6); // strip '/logs/'
        const filePath = resolve(logDir, fileName);
        // Prevent path traversal: resolve symlinks, then ensure the real path
        // stays inside logDir. Prevents symlink-based escapes.
        const realLogDir = await realpath(logDir);
        let realFilePath: string;
        try {
          realFilePath = await realpath(filePath);
        } catch {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        if (!realFilePath.startsWith(realLogDir + sep) && realFilePath !== realLogDir) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }
        // Ensure the path points to a file, not a directory
        const fileStat = await stat(realFilePath);
        if (!fileStat.isFile()) {
          res.writeHead(400);
          res.end('Not a file');
          return;
        }
        const content = await readFile(realFilePath, 'utf-8');
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(content);
        return;
      }

      // API: list available .log files
      if (pathname === '/api/logs') {
        const entries = await listLogFiles(logDir);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(entries));
        return;
      }

      // Serve viewer assets
      const assetPath = pathname === '/' ? '/index.html' : pathname;
      const safePath = assetPath.replace(/\.\./g, '');
      const filePath = resolve(viewerDir, safePath.replace(/^\/+/, ''));
      // Prevent path traversal: resolve symlinks, then validate.
      const realViewerDir = await realpath(viewerDir);
      let realAssetPath: string;
      try {
        realAssetPath = await realpath(filePath);
      } catch {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      if (!realAssetPath.startsWith(realViewerDir + sep) && realAssetPath !== realViewerDir) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const content = await readFile(realAssetPath);
      const ext = extname(filePath);
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-store' : 'max-age=3600',
      });
      res.end(content);
    } catch (err: unknown) {
      const errnoErr = err as NodeJS.ErrnoException;
      const code = errnoErr.code;
      if (code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not found');
      } else if (code === 'EACCES') {
        console.error(`Permission denied: ${errnoErr.message}`);
        res.writeHead(403);
        res.end('Permission denied');
      } else if (code === 'EISDIR') {
        res.writeHead(400);
        res.end('Is a directory');
      } else {
        console.error(`Server error [${code ?? 'unknown'}]: ${errnoErr.message}`);
        res.writeHead(500);
        res.end('Internal server error');
      }
    }
  });

  return new Promise<void>((resolvePromise, rejectPromise) => {
    // Handle port-in-use and other binding errors
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        rejectPromise(new Error(`Port ${port} is already in use. Try a different port with --port.`));
      } else if (err.code === 'EACCES') {
        rejectPromise(new Error(`Permission denied for port ${port}. Try a port above 1024.`));
      } else {
        rejectPromise(new Error(`Server error: ${err.message}`));
      }
    });

    server.listen(port, () => {
      const addr = server.address();
      const assignedPort = typeof addr === 'object' && addr ? addr.port : port;

      // Build the URL to open
      let viewerUrl: string;
      if (singleFile) {
        viewerUrl = `http://localhost:${assignedPort}/?log=${encodeURIComponent(singleFile)}`;
      } else {
        viewerUrl = `http://localhost:${assignedPort}/`;
      }

      console.warn(`\n  Apex Log Insights — local viewer`);
      console.warn(`  ${isFolder ? 'Folder' : 'File'}:  ${target}`);
      console.warn(`  URL:     ${viewerUrl}`);
      console.warn(`  Press Ctrl+C to stop.\n`);

      if (open) {
        openBrowser(viewerUrl).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('Could not open browser:', msg);
        });
      }
    });

    // Graceful shutdown
    const shutdown = () => {
      console.warn('\nShutting down...');
      server.close(() => {
        resolvePromise();
        process.exit(0);
      });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}

async function listLogFiles(dir: string): Promise<LogEntry[]> {
  const files = await readdir(dir);
  const entries: LogEntry[] = [];
  for (const name of files) {
    if (!name.toLowerCase().endsWith('.log')) continue;
    try {
      const fileStat = await stat(join(dir, name));
      if (!fileStat.isFile()) continue;
      entries.push({
        name,
        sizeBytes: fileStat.size,
        modifiedAt: fileStat.mtime,
      });
    } catch {
      // skip unreadable files
    }
  }
  // Sort by most recently modified first
  entries.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return entries;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function buildLandingPage(logDir: string): Promise<string> {
  const entries = await listLogFiles(logDir);
  const rows = entries.map((entry) => `
    <tr>
      <td><a href="/?log=${encodeURIComponent(entry.name)}" target="_blank" rel="noopener">${escapeHtml(entry.name)}</a></td>
      <td>${formatSize(entry.sizeBytes)}</td>
      <td>${formatDate(entry.modifiedAt)}</td>
    </tr>
  `).join('');

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
  <p class="subtitle">${entries.length} log file${entries.length !== 1 ? 's' : ''} found &mdash; each opens in a new tab</p>
  ${entries.length > 0 ? `
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
  ` : `<div class="empty">No .log files found in this directory.</div>`}
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] || c),
  );
}

async function openBrowser(url: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const platform = process.platform;

  return new Promise<void>((resolvePromise) => {
    const onResult = (err: Error | null) => {
      if (err) {
        console.error('Could not open browser automatically. Open this URL manually:', url);
      }
      resolvePromise();
    };

    if (platform === 'darwin') {
      execFile('open', [url], onResult);
    } else if (platform === 'win32') {
      execFile('cmd', ['/c', 'start', '', url], onResult);
    } else {
      execFile('xdg-open', [url], onResult);
    }
  });
}
