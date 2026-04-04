# @apex-log-insights/mcp

MCP (Model Context Protocol) server for Apex Log Insights — Apex debug log analysis with Claude Desktop, Claude Code, Cursor, and other AI tools.

## Setup

Add to your MCP client config:

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

### Config file locations

| Client | Config path |
|--------|-------------|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code | `~/.claude/claude_code_config.json` |

## Available Tools

| Tool | Description |
|------|-------------|
| `parse_apex_log` | Full parse of a log file or raw text into structured analysis |
| `analyze_performance` | CPU attribution, execution phases, timing hotspots |
| `analyze_soql` | SOQL query analysis — duplicates, expensive patterns, row counts |
| `analyze_governor_limits` | Governor limit usage, burn rates, managed package impact |
| `summarize_log` | Quick one-line overview of a log file |

All tools accept either `logText` (raw log content) or `filePath` (path to a .log file on disk).

All tools also accept an optional `redact` boolean parameter — see [Privacy](#privacy) below.

## Privacy

### How data flows

```
Your .log file
    → MCP server parses locally (zero network calls)
    → Structured JSON report
    → Sent to your AI client via stdio
    → AI client may transmit to cloud API
```

The MCP server itself makes **zero network requests**. All parsing is done locally by `@apex-log-insights/core` (which has zero runtime dependencies). However, the structured report it returns contains sensitive Salesforce metadata — SOQL queries, class names, namespace prefixes, callout endpoints, debug messages — and this data is passed to your AI client. If your AI client uses a cloud service (Claude, ChatGPT, etc.), that data will leave your machine through the AI's pipeline.

### PII redaction

Every tool accepts an optional `redact` parameter:

```json
{ "logText": "...", "redact": true }
```

When `redact: true`, the following are masked before results reach your AI client:

| Data type | Replacement |
|-----------|-------------|
| Salesforce IDs (15/18 char) | `[REDACTED-ID]` |
| Email addresses | `[REDACTED-EMAIL]` |
| Phone numbers | `[REDACTED-PHONE]` |
| Debug message content | `[REDACTED]` |
| Named credential names | `[REDACTED]` |
| SOQL bind variable values | `[REDACTED]` |
| Callout URL query parameters | `[REDACTED]` |

**Preserved** (needed for meaningful AI analysis): class names, method names, field names, sObject types, governor limit values, durations, row counts, phase labels, event types.

### When to use redaction

- **Cloud AI tools** (Claude Desktop, Cursor with cloud models): Use `redact: true`
- **Local AI tools** (Ollama, local LLMs): Redaction is optional
- **Highly sensitive orgs** (healthcare, finance): Always use `redact: true`

### Comparison with other packages

| Package | Data stays local? | Network calls? |
|---------|-------------------|----------------|
| `@apex-log-insights/core` | Yes | None |
| `@apex-log-insights/cli` | Yes | None |
| `@apex-log-insights/browser-ext` | Yes | None |
| `@apex-log-insights/mcp` | Parsed locally, results sent to AI client | None from MCP; AI client may use network |

## Example prompts

Once configured, you can ask your AI tool things like:

- "Parse this Apex debug log and tell me what's slow"
- "Are there any N+1 SOQL queries in this log?"
- "How close is this transaction to hitting governor limits?"
- "Summarize what this Apex log is doing"

## Build

```bash
pnpm --filter @apex-log-insights/mcp build
```
