# Feature reference

This page describes shipped capabilities. Proposed work belongs in GitHub issues so roadmap statements do not become stale documentation.

## Interfaces

| Interface         | Shipped behavior                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| Browser extension | Chrome, Edge, and Firefox; drag-and-drop logs and reports; browser-tab log detection; local parsing |
| CLI               | Opens one log or a directory of logs in a locally served viewer                                     |
| Core library      | ESM/CommonJS parser and report API with TypeScript declarations and zero runtime dependencies       |
| MCP server        | Six focused tools, including two-log metric comparison, with optional sensitive-value redaction     |
| VS Code extension | Local worker analysis, canonical five-view panel, exact source navigation, and refresh              |

## Analysis

### Triage and context

- outcome, errors, warnings, and top metrics;
- entry-point and execution-context detection for triggers, classes, anonymous Apex, Batch, Queueable, Future, Scheduled, and Platform Event activity;
- instrumentation-quality diagnostics when the source log cannot support a confident conclusion.

### Execution

- ordered event and execution-block data with measured, partial, and unbounded timing distinguished;
- current upstream Salesforce event-name coverage with payload retention for generic records and measured Formula evaluation and Revenue Lifecycle Management spans;
- 20-phase synchronous DML lifecycle model with direct, derived, and inferred confidence;
- trigger cascades, recursive-trigger warnings, mixed DML detection, hotspots, and managed-package attribution;
- CPU attribution and heap timeline where the necessary events exist.

### Data and limits

- SOQL text, rows, duration, bind context, explain-plan details, repeated patterns, and loop-suspect detection;
- Apex cursor creation and fetch operations, including query IDs, offsets, row counts, durations, and paired raw evidence;
- DML operation, object, rows, duration, and evidence;
- HTTP callouts and modern or legacy Named Credential metadata, status, payload sizes, and timing;
- governor-limit usage, snapshots, trajectory, burn rate, and phase headroom;
- CSV export for SOQL, DML, and callout tables.

### Evidence and diagnostics

- exact raw-line evidence links;
- per-record malformed-event isolation with explicit inferred-timestamp provenance;
- full log explorer with text and line/range search;
- parser warnings, Apex and DataWeave debug events, system-mode transitions, validation details, savepoints, and confidence caveats;
- bounded record tokenization that retains opaque pipe-delimited payload evidence;
- optional browser-side redaction controls before copying sensitive content.
- silent log-quality checks for missing execution markers, Salesforce size-limit messages, skipped sections, and parser-detected gaps; Triage warns only when the evidence is incomplete or uncertain;
- failure context trails that link the events immediately preceding captured exceptions back to the raw log.

## Viewer experience

- Triage, Execution, Data, Diagnostics, and Evidence views;
- Cosmos-inspired Night and Day report themes built from semantic SLDS 2 styling hooks, with Night as the report default; extension setup defaults to white with grey text and saves its theme separately, while the log-page launcher uses a fixed white and grey palette;
- installable offline viewer assets with web manifest and service worker;
- one canonical five-view interface across the standalone viewer, CLI, browser extension, and VS Code, with execution waterfalls, lifecycle phases, CPU and heap trajectories, record and automation drill-downs, bounded evidence paging, CSV export, responsive layouts, and keyboard-complete navigation;
- responsive navigation, file sidebar support, and background parsing in a Web Worker.

## MCP tools

| Tool                      | Scope                                     |
| ------------------------- | ----------------------------------------- |
| `parse_apex_log`          | Broad structured parse and analysis       |
| `analyze_performance`     | Timing, execution, and hotspot projection |
| `analyze_soql`            | Query-focused analysis                    |
| `analyze_governor_limits` | Limit-focused analysis                    |
| `summarize_log`           | Compact overview                          |
| `compare_logs`            | Candidate-minus-baseline metric deltas    |

Read [MCP setup and privacy](packages/mcp/README.md) before using production data.

## Known boundaries

- A debug log is a partial observation controlled by Salesforce debug levels and truncation limits.
- The 20-phase model is most useful for synchronous DML and may contain unobserved phases in asynchronous contexts.
- Redaction is best-effort and does not guarantee anonymity.
- Comparison reports describe numeric differences; they do not decide whether a transaction is better or worse.

For planned enhancements and prioritization, use the repository's [GitHub issues](https://github.com/gkolan/apex-log-insights/issues).

Last reviewed: 2026-08-17.
