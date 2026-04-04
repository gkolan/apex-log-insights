# Apex Log Insights

**A free, offline toolkit that turns raw Apex debug logs into actionable insights. No servers, no uploads, no accounts — just answers.**

Parse any Apex debug log and explore execution timelines, SOQL/DML analysis, governor limit burn rates, diagnostics, and full evidence linking.

> **Privacy:** The CLI, browser extensions, and viewer process everything locally — your log data never leaves your machine. The MCP server also parses locally, but passes structured results to your AI client (Claude, Cursor, etc.), which may transmit data to cloud APIs. Use the `redact: true` option on any MCP tool to mask Salesforce IDs, emails, and other sensitive values before they reach the AI. See [MCP Privacy](#mcp-privacy) for details.

**[Chrome Extension](https://chromewebstore.google.com/detail/apex-log-insights)** · **[npm](https://www.npmjs.com/package/@apex-log-insights/cli)** · [Changelog](CHANGELOG.md) · [Releases](https://github.com/gkolan/apex-log-insights/releases) · [Report a bug](https://github.com/gkolan/apex-log-insights/issues)

---

## Packages

This is a TypeScript monorepo with four packages sharing a single parsing engine:

| Package | Description | Install |
|---------|-------------|---------|
| [`@apex-log-insights/core`](packages/core) | Shared parsing engine — zero runtime dependencies | `pnpm add @apex-log-insights/core` |
| [`@apex-log-insights/cli`](packages/cli) | Command-line interface for log analysis | `npm i -g @apex-log-insights/cli` |
| [`@apex-log-insights/mcp`](packages/mcp) | MCP server for Claude, Cursor, and AI tools | `npx @apex-log-insights/mcp` |
| [`@apex-log-insights/browser-ext`](packages/browser-ext) | Browser extension (Chrome, Edge, Firefox) | [Chrome Web Store](https://chromewebstore.google.com/detail/apex-log-insights) |

---

## Quick Start

### CLI

```bash
# Install globally
npm install -g @apex-log-insights/cli

# Or run without installing
npx @apex-log-insights/cli debug.log
```

### MCP Server (for AI tools)

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

### MCP Privacy

The MCP server runs locally and makes zero network requests itself. However, the structured analysis it returns (SOQL queries, class names, namespace info, governor limits) is sent to your AI client via stdio. If your AI client connects to a cloud service, that data will leave your machine through the AI's own pipeline.

To protect sensitive data, every MCP tool accepts an optional `redact` parameter:

```json
{ "logText": "...", "redact": true }
```

When enabled, Salesforce IDs, email addresses, phone numbers, and debug message content are replaced with `[REDACTED-ID]`, `[REDACTED-EMAIL]`, etc. Structural metadata (class names, field names, sObject types, governor limits, durations) is preserved so the AI can still provide meaningful analysis.

**Rule of thumb:** If your AI tool uses a cloud API, set `redact: true`. If it runs entirely on-device (local LLM), redaction is optional.

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

Requires **Node.js 18+** and **pnpm**. If you don't have pnpm:

```bash
npm install -g pnpm          # or: corepack enable && corepack prepare pnpm@9.15.4 --activate
```

Then:

```bash
git clone https://github.com/gkolan/apex-log-insights.git
cd apex-log-insights
pnpm install
pnpm build          # Sync versions → build all → export extension
pnpm test           # Run all tests
pnpm audit          # Security scan → audit/*.md
pnpm bugs           # Bug scan → bugs/*.md
pnpm dev:cli        # Watch mode for CLI development
pnpm dev:ext        # Watch mode for browser extension
```

To build a browser extension with a new version in one step:

```bash
pnpm --filter @apex-log-insights/browser-ext build:chrome -- --version 1.2.0
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development workflow, release process, and architecture guide.

### Project Structure

```
apex-log-insights/
├── packages/
│   ├── core/           # Shared parsing engine
│   ├── cli/            # CLI distribution
│   ├── mcp/            # MCP server distribution
│   └── browser-ext/    # Browser extension (Chrome/Edge/Firefox)
├── fixtures/           # Shared test log files
├── docs/               # Project website (GitHub Pages)
├── .github/workflows/  # CI/CD pipelines
└── scripts/            # Build & release utilities
```

### Dependency Graph

```
              @apex-log-insights/core
              (zero runtime dependencies)
                        │
           ┌────────────┼────────────┐
           │            │            │
       @cli         @mcp      @browser-ext
    (commander)   (@mcp/sdk)    (vite, esbuild)
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide — architecture, bug-fix workflows, build targets, version bumping, and release process.

## License

MIT - see [LICENSE](LICENSE) for details.
