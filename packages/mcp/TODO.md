# MCP Server — Roadmap & Vision

## Why This Matters

Today, debugging Salesforce Apex is a fragmented, manual process: open Developer Console, trigger the operation, copy the log, scroll through thousands of lines, and try to piece together what went wrong. Apex Log Insights already solves the parsing half — turning raw logs into structured, analyzable reports. The MCP server is how we close the loop.

The end state is an AI agent that can connect to your Salesforce org, watch what's happening in real time, and proactively surface problems. A developer says "I just deployed my trigger fix — run the same flow and tell me if it's better." The agent sets up trace flags, monitors the streaming API, captures the log the moment it's generated, runs it through the parser, compares it against the previous run, and reports back: "SOQL queries dropped from 47 to 3, CPU time down 60%, governor headroom is healthy." No file juggling, no context switching, no manual analysis.

The core parser, report engine, and viewer are the hard parts — they're already built. What follows is the last-mile plumbing that turns this from a tool people use after the fact into an AI-powered development companion that works alongside them.

---

## Architecture

### Current State

The MCP server is offline-only. It takes a log file or raw text and returns structured analysis via stdio.

```
┌──────────────────────────────────────────────────────────────────────┐
│  AI Agent (Claude / Cursor / etc.)                                   │
│                                                                      │
│  "Analyze this log file"                                             │
└──────────────┬───────────────────────────────────────────────────────┘
               │ MCP (stdio)
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  MCP Server (packages/mcp)                                           │
│                                                                      │
│  Tools:                                                              │
│    parse_apex_log         → full structured report                   │
│    analyze_performance    → CPU, phases, hotspots                    │
│    analyze_soql           → queries, duplicates, patterns            │
│    analyze_governor_limits → limits, burn rate, heap                 │
│    summarize_log          → quick overview                           │
│                                                                      │
│  Input: logText (string) OR filePath (string)                        │
└──────────────┬───────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Core Parser Engine (packages/core)                                  │
│                                                                      │
│  Layer 1 — Parser    (certinia/)   → raw event extraction            │
│  Layer 2 — Report    (insights/)   → structured report JSON          │
└──────────────────────────────────────────────────────────────────────┘
```

### Target State

A live connection to Salesforce turns the entire pipeline real-time.

```
┌──────────────────────────────────────────────────────────────────────┐
│  AI Agent                                                            │
│                                                                      │
│  "Connect to my dev org, run the flow, and tell me what happened"    │
└──────────────┬───────────────────────────────────────────────────────┘
               │ MCP (stdio)
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  MCP Server (packages/mcp)                                           │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  Connection Layer (NEW)                                         │ │
│  │                                                                 │ │
│  │  connect_to_org    → OAuth / SF CLI auth                        │ │
│  │  disconnect_org    → tear down session                          │ │
│  │  list_orgs         → show authenticated orgs                    │ │
│  └────────┬────────────────────────────────────────────────────────┘ │
│           │                                                          │
│  ┌────────▼────────────────────────────────────────────────────────┐ │
│  │  Log Retrieval Layer (NEW)                                      │ │
│  │                                                                 │ │
│  │  list_recent_logs  → Tooling API query                          │ │
│  │  fetch_log         → GET /sobjects/ApexLog/{id}/Body            │ │
│  │  fetch_latest_log  → convenience shortcut                       │ │
│  └────────┬────────────────────────────────────────────────────────┘ │
│           │                                                          │
│  ┌────────▼────────────────────────────────────────────────────────┐ │
│  │  Streaming Layer (NEW)                                          │ │
│  │                                                                 │ │
│  │  stream_logs       → subscribe /systemTopic/Logging             │ │
│  │  stop_stream       → unsubscribe                                │ │
│  │  set_debug_level   → configure trace flags                      │ │
│  │                                                                 │ │
│  │  CometD/Bayeux ◄───── Salesforce Streaming API                  │ │
│  │       │                                                         │ │
│  │       ▼ LogCreatedEvent (log ID)                                │ │
│  │       │                                                         │ │
│  │  Auto-fetch log body ──► Parse ──► Structured report            │ │
│  └────────┬────────────────────────────────────────────────────────┘ │
│           │                                                          │
│  ┌────────▼────────────────────────────────────────────────────────┐ │
│  │  Analysis Layer (existing + NEW)                                │ │
│  │                                                                 │ │
│  │  parse_apex_log          ← exists                               │ │
│  │  analyze_performance     ← exists                               │ │
│  │  analyze_soql            ← exists                               │ │
│  │  analyze_governor_limits ← exists                               │ │
│  │  summarize_log           ← exists                               │ │
│  │  compare_logs            ← NEW: diff two reports                │ │
│  │  org_limits              ← NEW: Limits API overlay              │ │
│  └────────┬────────────────────────────────────────────────────────┘ │
│           │                                                          │
│  ┌────────▼────────────────────────────────────────────────────────┐ │
│  │  Safety Layer                                                   │ │
│  │                                                                 │ │
│  │  PII redaction (redact-pii) ──► applied before returning data   │ │
│  │  Rate limiting ──► respect Salesforce API limits                 │ │
│  │  Token security ──► encrypted storage, never logged             │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────┬───────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Core Parser Engine (packages/core) — no changes needed              │
│                                                                      │
│  Layer 1 — Parser    (certinia/)   → raw event extraction            │
│  Layer 2 — Report    (insights/)   → structured report JSON          │
└──────────────────────────────────────────────────────────────────────┘

               ▲
               │ same report JSON
               │
┌──────────────┴───────────────────────────────────────────────────────┐
│  Viewer / Browser Extension                                          │
│                                                                      │
│  Layer 3 — Renderer  (viewer/modules/)  → UI display                 │
│            Browser Extension (packages/browser-ext/)                  │
└──────────────────────────────────────────────────────────────────────┘
```

### Data Flow: Real-Time Streaming Session

```
Developer                AI Agent               MCP Server            Salesforce Org
    │                        │                       │                       │
    │  "connect to my        │                       │                       │
    │   dev org"             │                       │                       │
    │───────────────────────►│                       │                       │
    │                        │  connect_to_org       │                       │
    │                        │──────────────────────►│                       │
    │                        │                       │  OAuth 2.0            │
    │                        │                       │──────────────────────►│
    │                        │                       │◄──────────────────────│
    │                        │  ✓ connected          │  access token         │
    │                        │◄──────────────────────│                       │
    │                        │                       │                       │
    │  "watch for logs       │                       │                       │
    │   from my user"        │                       │                       │
    │───────────────────────►│                       │                       │
    │                        │  set_debug_level      │                       │
    │                        │──────────────────────►│  create TraceFlag     │
    │                        │                       │──────────────────────►│
    │                        │  stream_logs          │                       │
    │                        │──────────────────────►│  subscribe            │
    │                        │                       │  /systemTopic/Logging │
    │                        │                       │──────────────────────►│
    │                        │  ✓ streaming          │                       │
    │                        │◄──────────────────────│                       │
    │                        │                       │                       │
    │  (triggers a flow      │                       │                       │
    │   in the org)          │                       │                       │
    │──────────────────────────────────────────────────────────────────────►│
    │                        │                       │                       │
    │                        │                       │  LogCreatedEvent      │
    │                        │                       │◄──────────────────────│
    │                        │                       │                       │
    │                        │                       │  GET ApexLog body     │
    │                        │                       │──────────────────────►│
    │                        │                       │◄──────────────────────│
    │                        │                       │                       │
    │                        │                       │  ┌─────────────────┐  │
    │                        │                       │  │ Parse log       │  │
    │                        │                       │  │ Redact PII      │  │
    │                        │                       │  │ Build report    │  │
    │                        │                       │  └─────────────────┘  │
    │                        │                       │                       │
    │                        │  structured report    │                       │
    │                        │◄──────────────────────│                       │
    │                        │                       │                       │
    │  "3 errors found:      │                       │                       │
    │   N+1 SOQL in trigger, │                       │                       │
    │   CPU at 87%,          │                       │                       │
    │   recursive cascade"   │                       │                       │
    │◄───────────────────────│                       │                       │
    │                        │                       │                       │
```

---

## How Each Viewer Tab Gets Leveraged

The viewer has five tabs. Each one maps to specific data in the structured report, and each becomes more powerful with a live Salesforce connection. Understanding this mapping is essential for contributors — it shows how new MCP tools feed existing UI.

### Triage Summary (default tab)

Renders the top-level verdict: OK, WARN, or ERROR. Shows error/warning counts, the dominant cost snapshot (runtime, CPU, SOQL/DML totals), transaction identity (entry point, request type, namespaces), and evidence-backed highlights with jump links to deeper tabs.

**With a live connection:** This is what the AI agent reads first. It can immediately tell the developer "your last operation hit 3 warnings" without them opening anything. The `summarize_log` MCP tool already returns this data — the streaming layer just feeds it automatically.

### Execution Story

Shows what ran and in what order: the call chain (expandable, up to 8 top-level blocks), lifecycle phases (trigger, batch, async, scheduled), phase details with confidence and event counts, hotspots weighted by duration, trigger cascade patterns, and managed package impact.

**With a live connection:** The `compare_logs` tool (Phase 4) diffs this tab's data between two runs. A developer deploys a fix, reruns the flow, and the agent reports "the recursive trigger cascade is gone, call depth dropped from 5 to 2." The `analyze_performance` MCP tool already returns execution phases and hotspots.

### Data and Limits

Shows everything that touched the database: SOQL queries (with explain plan data, row counts, duration, group-by-query toggle, N+1 detection), DML operations (object, rows, duration), external callouts (method, host, status code, named credentials), governor limit usage table (used/max/status), savepoints, and phase headroom analysis. Includes CSV export for SOQL and DML.

**With a live connection:** The `org_limits` tool (Phase 4) overlays org-wide daily limits from the Limits API on top of per-transaction governor data. Instead of just "you used 150/100 SOQL queries in this transaction," the agent can say "you used 150 SOQL queries, and your org has consumed 82% of its daily API call limit — this batch job is risky to run again today." The `analyze_soql` and `analyze_governor_limits` MCP tools already return this tab's data.

### Diagnostics

Surfaces errors, warnings, and structural issues with severity and confidence levels. Shows instrumentation quality (debug level completeness, system mode transitions, heap analysis availability), debug events, parser warnings, and caveats about what the parser could not determine from the available log level.

**With a live connection:** The `set_debug_level` tool (Phase 3) auto-fixes instrumentation gaps. If diagnostics reports "confidence is low because SYSTEM_DEBUG is not captured," the agent creates a trace flag with the right debug level and asks the user to rerun. The `fetch_latest_log` tool then captures the improved log automatically.

### Log Explorer

The raw proof layer. Every claim made by the other tabs links back here with exact line numbers. Has free-text search with regex support, line-range targeting (`line:42`, `lines:42-90`, `lines:all`), case-sensitive toggle, and copy buttons for visible/matched lines. Also shows evidence pointers and a structured index.

**With a live connection:** PII redaction (`redact-pii` module) becomes critical here — this is the only tab where raw log text is visible, and logs from live orgs contain real customer names, emails, and record IDs. The redaction must run before the report reaches the AI model or the viewer. The `parse_apex_log` MCP tool returns the full report that feeds this tab.

### Tab-to-MCP-Tool Mapping

| Viewer Tab | Primary MCP Tool(s) | New Tools Needed |
|---|---|---|
| Triage Summary | `summarize_log` | — |
| Execution Story | `analyze_performance` | `compare_logs` (Phase 4) |
| Data and Limits | `analyze_soql`, `analyze_governor_limits` | `org_limits` (Phase 4) |
| Diagnostics | `parse_apex_log` (diagnostics section) | `set_debug_level` (Phase 3) |
| Log Explorer | `parse_apex_log` (evidence section) | PII redaction integration |

---

## Implementation Phases

### Phase 1 — Salesforce Authentication

Connect to a Salesforce org. This is the foundation everything else depends on.

- [ ] Add `@salesforce/core` or `jsforce` dependency
- [ ] Implement OAuth 2.0 JWT bearer flow for headless/CI auth
- [ ] Implement OAuth 2.0 web server flow for interactive auth
- [ ] Support session token / access token pass-through (for users already authenticated)
- [ ] Store and refresh tokens securely (encrypted file or OS keychain via `@salesforce/core`)
- [ ] New MCP tool: `connect_to_org` — authenticate to a Salesforce org by alias, username, or instance URL
- [ ] New MCP tool: `disconnect_org` — tear down the active connection and clean up tokens
- [ ] New MCP tool: `list_orgs` — show authenticated orgs with status (like `sf org list`)
- [ ] Handle expired sessions gracefully (auto-refresh, clear error messages)
- [ ] Unit tests for auth flows with mocked Salesforce responses

**Acceptance criteria:** An AI agent can say `connect_to_org({ alias: "my-dev-sandbox" })` and get back a confirmed connection, reusing existing SF CLI credentials where available.

### Phase 2 — Log Retrieval

Pull existing logs from a connected org on demand.

- [ ] New MCP tool: `list_recent_logs` — query `ApexLog` via Tooling API, return metadata (id, operation, user, size, duration, timestamp)
- [ ] New MCP tool: `fetch_log` — download a specific log body by ID via `GET /sobjects/ApexLog/{id}/Body`, run through the parser, return structured report
- [ ] New MCP tool: `fetch_latest_log` — convenience shortcut: fetch the most recent log for the connected user and parse it
- [ ] Handle large log bodies (chunked download, configurable size limit, warning for truncated logs)
- [ ] Support filtering by user, operation type, time range, minimum duration
- [ ] Apply PII redaction before returning parsed results
- [ ] Unit tests with fixture logs served from mocked API responses

**Acceptance criteria:** An AI agent can say `list_recent_logs({ user: "admin@dev.org", limit: 5 })` and then `fetch_log({ id: "07L..." })` to get a fully parsed, PII-redacted report.

### Phase 3 — Real-Time Log Streaming

Tail logs as they're generated. This is the core of the real-time vision.

- [ ] Subscribe to `/systemTopic/Logging` via Streaming API (CometD/Bayeux protocol)
- [ ] New MCP tool: `stream_logs` — start tailing logs from a connected org (optional user/operation filter)
- [ ] New MCP tool: `stop_stream` — stop the active log stream and unsubscribe
- [ ] New MCP tool: `set_debug_level` — create or update debug levels and trace flags on the org
- [ ] Auto-fetch and parse each new log body as `LogCreatedEvent` notifications arrive
- [ ] Set up trace flags automatically (debug level, traced entity, expiration)
- [ ] Handle trace flag expiration (warn the user, auto-renew if permitted)
- [ ] Manage connection lifecycle (reconnect on CometD timeout, clean shutdown on SIGTERM)
- [ ] Buffer multiple rapid log events (debounce to avoid flooding the agent)
- [ ] Unit tests with mocked CometD event stream

**Acceptance criteria:** An AI agent can say `stream_logs()`, the developer triggers a flow in their org, and the agent receives a fully parsed report within seconds — without the developer touching a log file.

### Phase 4 — Org-Aware Analysis

Cross-reference transaction-level insights with org-wide context.

- [ ] New MCP tool: `compare_logs` — accept two log IDs or report objects, diff the structured reports, highlight regressions and improvements across all tabs
- [ ] New MCP tool: `org_limits` — fetch org-wide governor limits from the REST Limits API (`/services/data/vXX.0/limits`)
- [ ] Correlate per-transaction governor usage with org daily limits (e.g., "this trigger used 80% of the daily async Apex limit")
- [ ] Detect when a transaction's resource usage is disproportionate to org capacity
- [ ] Support comparison output that maps to each viewer tab (execution diff, data diff, diagnostics diff)
- [ ] Unit tests for diff logic with paired fixture reports

**Acceptance criteria:** A developer deploys a fix, reruns a flow, and the AI agent says "compared to the previous run: SOQL queries dropped from 47 to 3, CPU time down 60%, the N+1 pattern is resolved, and your org has 94% of daily API calls remaining."

---

## Architecture Notes

### Directory Structure (Target)

```
packages/mcp/src/
├── server.ts                    ← entry point (exists)
├── tools/
│   ├── parseLog.ts              ← exists
│   ├── analyzePerformance.ts    ← exists
│   ├── analyzeSoql.ts           ← exists
│   ├── analyzeGovernorLimits.ts ← exists
│   ├── summarize.ts             ← exists
│   ├── readLogFile.ts           ← exists
│   ├── connectOrg.ts            ← Phase 1
│   ├── disconnectOrg.ts         ← Phase 1
│   ├── listOrgs.ts              ← Phase 1
│   ├── listRecentLogs.ts        ← Phase 2
│   ├── fetchLog.ts              ← Phase 2
│   ├── fetchLatestLog.ts        ← Phase 2
│   ├── streamLogs.ts            ← Phase 3
│   ├── stopStream.ts            ← Phase 3
│   ├── setDebugLevel.ts         ← Phase 3
│   ├── compareLogs.ts           ← Phase 4
│   └── orgLimits.ts             ← Phase 4
├── connection/                   ← Phase 1 (NEW directory)
│   ├── auth.ts                  ← OAuth flows, token management
│   ├── client.ts                ← Salesforce REST/Tooling API client
│   └── streaming.ts             ← CometD subscription manager
└── safety/                       ← Phase 2 (NEW directory)
    ├── redact.ts                ← PII redaction integration
    └── rateLimit.ts             ← API rate limit tracking
```

### Auth Strategy

Prefer `@salesforce/core` (the same auth layer the Salesforce CLI uses) so users can reuse their existing `sf` CLI credentials without re-authenticating. This gives us encrypted token storage, automatic refresh, and multi-org management for free. Fall back to raw OAuth 2.0 (via `jsforce`) for environments without the SF CLI.

### Streaming Approach

Salesforce Streaming API uses CometD (long-polling over HTTP). The `/systemTopic/Logging` system topic pushes `LogCreatedEvent` notifications containing the log ID. On each event:

1. Fetch the log body via `GET /sobjects/ApexLog/{id}/Body`
2. Run it through the Certinia parser (packages/core)
3. Apply PII redaction
4. Return the structured report to the AI agent

The streaming connection must handle reconnects (CometD advice), trace flag expiration (default 1 hour), and clean shutdown.

### Three-Layer Rule

New tools follow the existing architecture. The parser and report layers (packages/core) require no changes — all new work is in the MCP tool layer and the new connection layer.

| Layer | Location | Changes |
|---|---|---|
| Parser | `packages/core/src/certinia/` | None |
| Report | `packages/core/src/insights/` | None |
| MCP Tools | `packages/mcp/src/tools/` | New tools for auth, fetch, stream, compare |
| Connection | `packages/mcp/src/connection/` | **New** — Salesforce auth and API client |
| Safety | `packages/mcp/src/safety/` | **New** — PII redaction, rate limiting |

### Security Considerations

- Never store credentials in plain text — use `@salesforce/core`'s encrypted token storage or OS keychain
- Respect Salesforce API rate limits (concurrent API calls, streaming clients per org)
- Log bodies can contain PII — apply the existing `redact-pii` module before returning results to the AI model
- Session tokens passed via MCP args must not be logged or persisted
- Trace flags created by the tool should be cleaned up on disconnect

### Dependencies to Evaluate

| Package | Purpose | Trade-offs |
|---|---|---|
| `@salesforce/core` | Auth, connection management, config | Heavy (~50MB), but reuses SF CLI credentials. Battle-tested. |
| `jsforce` | Lighter Salesforce client | Good Streaming API support, smaller footprint, but separate auth from SF CLI. |
| `faye` | Standalone CometD client | Only needed if not using jsforce streaming. |

### Zero Runtime Dependencies Rule

The core parser (`packages/core`) must remain zero-dependency. All Salesforce dependencies live exclusively in `packages/mcp`. The connection layer imports from core for parsing but core never imports from the connection layer.

---

## Contributing

Pick a phase and start with the first unchecked item. Each phase builds on the previous one, so Phase 1 must be complete before Phase 2 work begins. Within a phase, items can generally be worked in parallel.

Before starting, read:
- `CONTRIBUTING.md` — development workflow, build targets, commit conventions
- `STYLE_GUIDE.md` — TypeScript conventions, architecture invariants
- `packages/mcp/src/server.ts` — existing MCP server setup
- `packages/mcp/src/tools/parseLog.ts` — example of a well-structured MCP tool

All new tools should follow the same pattern: export a tool definition object and a handler function, register both in `server.ts`.
