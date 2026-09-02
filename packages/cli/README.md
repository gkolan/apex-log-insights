# `@apex-log-insights/cli`

Use this package when you want to open a local Apex debug log or directory from a terminal. The CLI starts a local HTTP server, opens the Apex Log Insights viewer, and parses the selected log in a browser Web Worker without uploading it.

## Requirements and installation

Requires Node.js 18 or later. The published package bundles its parser, so installing it pulls in no runtime dependencies.

```bash
npm install --global @apex-log-insights/cli
```

Run without a global installation:

```bash
npx --yes @apex-log-insights/cli debug.log
```

## Usage

```bash
apex-log debug.log
apex-log ./directory-of-logs
apex-log debug.log --port 3000
apex-log debug.log --no-open
```

| Option            | Behavior                                            |
| ----------------- | --------------------------------------------------- |
| `--port <number>` | Bind a specific port; `0` selects an available port |
| `--no-open`       | Print the local URL without opening a browser       |
| `--debug`         | Include a stack trace when startup fails            |
| `--help`, `-h`    | Show supported usage                                |

The positional path must exist and be a readable `.log` file or directory containing logs. Stop the server with `Ctrl+C`.

Raw logs are limited to 25 MiB. The server validates and reads each request through one nonblocking, no-follow file handle, rejects non-regular files, and remains bounded if a file grows after its initial size check. Small responses begin with a 64 KiB allocation and grow only with observed content. The parser worker independently enforces the same boundary without allocating a second encoded copy of the complete log. The worker accepts only `PARSE_LOG` messages with non-empty text and an optional non-empty string file identifier, so malformed direct messages cannot corrupt report source metadata.

## Privacy

The server listens only on `127.0.0.1`, and log parsing occurs in the browser. In single-file mode, HTTP requests can read only the selected `.log` file. In folder mode, requests can read only regular `.log` files inside the selected directory; symbolic links and special files such as named pipes are not followed or served. Treat the printed URL as local access to that scope. See the repository [Privacy and security guide](../../docs/user-guides/privacy.md).

## Development

From the repository root:

```bash
pnpm dev:cli
pnpm --filter @apex-log-insights/cli build
pnpm validate
```

The CLI serves the canonical files under `viewer/`; it does not own a separate UI implementation.

Parser workers are emitted as classic IIFEs because the viewer creates them with the classic `Worker` API. Load and parse failures stay in the document as retryable status panels; the CLI does not use blocking browser alerts.

### Local server endpoints

| Endpoint       | Purpose                                              |
| -------------- | ---------------------------------------------------- |
| `/api/health`  | Reports server mode and supported local capabilities |
| `/api/logs`    | Lists accessible `.log` files                        |
| `/logs/<name>` | Reads an accessible log for client-side parsing      |

Only `GET` and `HEAD` are accepted. In single-file mode, `/api/logs` returns only the selected file. Responses include restrictive content, framing, and referrer headers.

The exported `startViewServer()` function returns the bound loopback URL, assigned port, and an asynchronous, idempotent `close()` method. Applications embedding the server retain ownership of signal handling and process shutdown.
