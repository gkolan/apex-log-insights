# @apex-log-insights/mcp

Use this package to let an MCP client request focused Apex debug-log analysis. After setup, the client can call six read-only tools; the server parses locally and returns results through MCP standard input/output.

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

| Client                        | Config path                                                        |
| ----------------------------- | ------------------------------------------------------------------ |
| Claude Desktop (macOS)        | `~/Library/Application Support/Claude/claude_desktop_config.json`  |
| Claude Desktop (Windows)      | `%APPDATA%\Claude\claude_desktop_config.json`                      |
| Claude Code and other clients | Follow the current MCP configuration documentation for that client |

## Available tools

| Tool                      | Description                                                      |
| ------------------------- | ---------------------------------------------------------------- |
| `parse_apex_log`          | Full parse of a log file or raw text into structured analysis    |
| `analyze_performance`     | CPU attribution, execution phases, timing hotspots               |
| `analyze_soql`            | SOQL query analysis — duplicates, expensive patterns, row counts |
| `analyze_governor_limits` | Governor limit usage, burn rates, managed package impact         |
| `summarize_log`           | Quick one-line overview of a log file                            |
| `compare_logs`            | Candidate-minus-baseline deltas across two logs                  |

Single-log tools accept either `logText` (raw log content) or `filePath` (a relative `.log` path readable from the MCP server's working directory). Provide exactly one source. `compare_logs` accepts `baseline` and `candidate` objects; each object follows the same one-source rule. Inputs are limited to 25 MB. Absolute paths, `..` path segments, non-log extensions, null bytes, symbolic links that resolve outside the working directory, and non-regular files such as named pipes are rejected. Files are opened without blocking on special-file producers, and the server reads no more than 25 MB even if a regular file grows while it is being read. Small logs use a bounded initial buffer that expands only with observed content. Inline source sizes and generated report metadata use the core allocation-free UTF-8 byte counter, including `TextEncoder`-compatible surrogate handling, so large Unicode logs are not duplicated merely to measure them. A trusted client can still request readable relative logs, so start the server in a deliberately scoped working directory.

All tools also accept an optional `redact` boolean parameter — see [Privacy](#privacy) below.

### Input contract

| Field      | Type    | Required            | Meaning                                                   |
| ---------- | ------- | ------------------- | --------------------------------------------------------- |
| `logText`  | string  | One source required | Complete raw Apex debug log                               |
| `filePath` | string  | One source required | Relative `.log` path under the server working directory   |
| `redact`   | boolean | No                  | Mask recognized sensitive values before returning content |

Tools return MCP text content containing JSON. `parse_apex_log` returns the broadest report. The focused tools preserve the canonical report names: `analyze_performance` returns `cpuAttribution`, `executionPhases`, and `hotspots`; `analyze_soql` returns `database` and `soqlPatterns`; `analyze_governor_limits` returns `limits`, `governorBurnRate`, `managedPackageImpact`, and `heapAnalysis`; and `summarize_log` returns a compact summary with `executionContext`, `schema`, and `source`. `compare_logs` reports the baseline and candidate metrics plus candidate-minus-baseline deltas; a positive delta means the candidate used more of that metric. Malformed input, unreadable paths, or conflicting/missing source arguments are returned as tool errors.

Tool JSON serialization is iterative and preserves complete deeply nested report values without relying on the JavaScript call stack. Circular references at a defensive boundary become `null`. Pretty indentation is capped after 20 nesting levels so adversarial depth cannot create quadratic whitespace, while shallower output retains standard two-space formatting.

## Privacy

### How data flows

```
Your .log file
    → MCP server parses locally (zero network calls)
    → Structured JSON report
    → Sent to your AI client via stdio
    → AI client may transmit to cloud API
```

The MCP server itself makes **zero network requests**. All parsing is done locally by `@apex-log-insights/core`. However, the structured report can contain SOQL queries, class names, namespace prefixes, callout endpoints, and debug messages. It is passed to your AI client and may leave your machine through that client's model pipeline.

### PII redaction

Every tool accepts an optional `redact` parameter:

```json
{ "logText": "...", "redact": true }
```

When `redact: true`, the following are masked before results reach your AI client:

| Data type                                         | Replacement        |
| ------------------------------------------------- | ------------------ |
| Salesforce IDs (15/18 char)                       | `[REDACTED-ID]`    |
| Email addresses                                   | `[REDACTED-EMAIL]` |
| Phone numbers                                     | `[REDACTED-PHONE]` |
| Debug message content                             | `[REDACTED]`       |
| Named credential names                            | `[REDACTED]`       |
| Labeled authorization values                      | `[REDACTED]`       |
| Variable and record values                        | `[REDACTED]`       |
| Quoted SOQL and SOSL literals                     | `[REDACTED]`       |
| Raw evidence lines                                | `[REDACTED]`       |
| Callout text, bodies, payloads, and header values | `[REDACTED]`       |
| Callout URL query parameters                      | `[REDACTED]`       |

Redaction treats every report key as untrusted data. Prototype-named keys such as `__proto__` and `constructor` remain serializable own properties, and their descendants receive the same masking as ordinary report content. Traversal is iterative rather than call-stack-dependent; circular references become `null`, and repeated objects are reused only within the same masking policy so a fully sensitive field cannot inherit a weaker copy.

**Preserved** (needed for meaningful AI analysis): class names, method names, field names, sObject types, governor limit values, durations, row counts, phase labels, event types.

Redaction traverses nested report sections, including `database` and `executionContext`; these container names do not exempt their descendants. URL authority credentials and every query-parameter value are masked while the host and path remain available for analysis.

Query redaction preserves clauses, object and field names, and bind-variable names, but masks quoted literal content. Variable assignments and reconstructed record values mask every string at their report boundary while retaining numeric values used by analysis. Raw evidence lines—including paired end records, recursive-trigger line arrays, and parser-diagnostic samples—and structured callout text, body, payload, header, and status values are fully masked because their free-form content cannot be classified reliably. Legacy reports that store a raw line directly in `evidence` receive the same treatment. Structural strings such as file names and paths still undergo recognized ID, email, and phone masking.

Redaction is best-effort pattern masking, not a guarantee of anonymity. Review results before sharing them outside your trust boundary. See the repository [Privacy and security guide](../../docs/user-guides/privacy.md).

### When to use redaction

- **Cloud AI tools** (Claude Desktop, Cursor with cloud models): Use `redact: true`
- **Local AI tools** (Ollama, local LLMs): Redaction is optional
- **Highly sensitive orgs** (healthcare, finance): Always use `redact: true`

### Comparison with other packages

| Package                          | Data stays local?                         | Network calls?                           |
| -------------------------------- | ----------------------------------------- | ---------------------------------------- |
| `@apex-log-insights/core`        | Yes                                       | None                                     |
| `@apex-log-insights/cli`         | Yes                                       | None                                     |
| `@apex-log-insights/browser-ext` | Yes                                       | None                                     |
| `@apex-log-insights/mcp`         | Parsed locally, results sent to AI client | None from MCP; AI client may use network |

## Example prompts

Once configured, you can ask your AI tool things like:

- "Parse this Apex debug log and tell me what's slow"
- "Are there any N+1 SOQL queries in this log?"
- "How close is this transaction to hitting governor limits?"
- "Summarize what this Apex log is doing"
- "Compare these two logs and show which measured limits increased"

## Build

```bash
pnpm --filter @apex-log-insights/mcp build
```
