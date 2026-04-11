# Apex Log Insights

A TypeScript monorepo that parses Salesforce Apex debug logs into structured, analyzable data. Ships as an npm library, CLI, MCP server, and browser extensions (Chrome, Edge, Firefox).

Everything runs locally — your log data never leaves your machine.

[Changelog](CHANGELOG.md) · [Releases](https://github.com/gkolan/apex-log-insights/releases) · [Report a bug](https://github.com/gkolan/apex-log-insights/issues)

---

## What It Does

Takes a raw Apex debug log and produces a structured report covering:

- 20-phase DML lifecycle mapping (Load Original Record → Post-Commit Logic) with governor limit burn rates per phase
- SOQL analysis — query text, rows, duration, bind variables, explain plans, N+1 loop detection
- DML analysis — operation type, sObject, row count, log line reference
- Callout and Named Credential tracking — HTTP method, URL, status, duration
- CPU attribution by class and namespace, heap timeline, governor limit trajectory
- Trigger cascade detection, recursive trigger warnings, mixed DML detection
- Execution context identification (trigger, batch, future, queueable, scheduled, platform event, anonymous)
- Evidence linking — every finding traces back to the exact raw log line

The core parser has zero runtime dependencies.

---

## Packages

| Package | Description | Install |
|---------|-------------|---------|
| [`@apex-log-insights/core`](packages/core) | Shared parsing engine | `pnpm add @apex-log-insights/core` |
| [`@apex-log-insights/cli`](packages/cli) | CLI — serves a local viewer in the browser | `pnpm add -g @apex-log-insights/cli` |
| [`@apex-log-insights/mcp`](packages/mcp) | MCP server for Claude, Cursor, and AI tools | `npx @apex-log-insights/mcp` |
| [`@apex-log-insights/browser-ext`](packages/browser-ext) | Browser extension (Chrome, Edge, Firefox) | See below |

---

## Quick Start

### CLI

```bash
pnpm add -g @apex-log-insights/cli

apex-log debug.log          # opens the viewer in your browser
apex-log ./logs/            # folder mode — sortable file listing
```

Parsing happens client-side in a Web Worker. Nothing is written to disk.

### MCP Server

Add to your Claude Desktop or Claude Code config:

```json
{
  "mcpServers": {
    "apex-log-insights": {
      "command": "npx",
      "args": ["-y", "@apex-log-insights/mcp"]
    }
  }
}
```

Exposes 5 tools: `parse_apex_log`, `analyze_performance`, `analyze_soql`, `analyze_governor_limits`, `summarize_log`. The server runs locally and makes zero network requests. Structured results are passed to your AI client via stdio — if it uses a cloud API, that data leaves your machine through the AI's pipeline.

Every tool accepts an optional `redact: true` parameter that masks Salesforce IDs, emails, phone numbers, and debug message content before results reach the AI.

### Browser Extension

Works on Chrome, Edge, and Firefox (all Manifest V3). Drag a `.log` file onto the extension or load a pre-generated `.apex-insights.json` report. The content script auto-detects debug logs open in browser tabs and offers to redirect them to the analyzer. Store listings are pending — you can load the unpacked extension from `packages/browser-ext/dist/` in the meantime.

### As a Library

```typescript
import { parseLog, buildInsightsReport } from '@apex-log-insights/core';

const parsed = await parseLog(logText, { enablePhaseInference: true });
const report = buildInsightsReport({
  filePath: 'debug.log',
  fileBytes: logText.length,
  generatedAt: new Date().toISOString(),
  parseTimeMs: parsed.parseTimeMs,
  parserResult: parsed.parserResult,
});
```

---

## Development

Requires **Node.js 18+** and **pnpm**.

```bash
git clone https://github.com/gkolan/apex-log-insights.git
cd apex-log-insights
pnpm install
pnpm build          # sync versions → build all → export extension
pnpm test           # run all tests
pnpm dev:cli        # watch mode for CLI
pnpm dev:ext        # watch mode for browser extension
```

```bash
pnpm audit          # security scan → audit/*.md
pnpm bugs           # bug scan → bugs/*.md
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development workflow, architecture guide, and release process.

### Project Structure

```
packages/core/         → shared parsing engine (zero runtime deps)
packages/cli/          → CLI distribution
packages/mcp/          → MCP server
packages/browser-ext/  → browser extension
viewer/                → offline HTML viewer (vanilla JS, no build step)
fixtures/              → shared test log files
scripts/               → build & release utilities
```

### Dependency Graph

```
            @apex-log-insights/core
            (zero runtime dependencies)
                      │
         ┌────────────┼────────────┐
         │            │            │
     @cli          @mcp      @browser-ext
  (commander)   (@mcp/sdk)   (vite, esbuild)
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
