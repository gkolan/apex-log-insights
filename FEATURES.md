# Apex Log Insights — Feature Reference

This document is the canonical feature inventory and prioritised backlog for the Apex Log Insights project.

---

## Table of Contents

1. [What's Already Built](#whats-already-built)
   - [CLI](#cli)
   - [Report Engine](#report-engine)
   - [Viewer (5 Views)](#viewer-5-views)
   - [Chrome Extension](#chrome-extension)
2. [What to Build Next](#what-to-build-next)
   - [High Priority](#high-priority) — 1. Virtual Scroll, 2. Unified Callout+NC Pairing
   - [Medium Priority](#medium-priority) — 3. Alternate Phase Models, 4. Aggregate SOQL Grouping, 5. Export CSV/PDF
   - [Low Priority](#low-priority) — 6. Phase 17 Disambiguation, 7. PWA, 8. Dark Mode, 9. Multi-Log Compare

---

## What's Already Built

### CLI

- Opens Apex debug logs in the browser for interactive analysis
- Point to a single `.log` file or a folder of `.log` files
- Logs are parsed locally in the browser — nothing is uploaded, nothing is written to disk
- `--port <number>` to specify a port, `--no-open` to prevent auto-opening the browser

---

### Report Engine

The report engine lives in `packages/core/src/` and is written in TypeScript. It produces structured JSON consumed by both the viewer and the Chrome extension.

#### Execution Model

- **20-phase Salesforce DML lifecycle** — maps every log event to one of 20 named phases, from "Load Original Record" through "Post-Commit Logic"
- **Execution context detection** — identifies the runtime context automatically:
  - `anonymous_apex`, `queueable`, `future_method`, `batch_execute`, `scheduled`, `platform_event`, `synchronous_trigger`, `apex_class`

#### Database Analysis

- **SOQL analysis** — captures query text, rows returned, duration, bind variables, explain plan (when available), and log line number
- **N+1 SOQL pattern detection** — identifies queries executing inside loops (`soqlPatterns`)
- **DML analysis** — operation type, sObject type, row count, and log line number
- **Named Credentials tracking** — structured records for `NAMED_CREDENTIAL_REQUEST` and `NAMED_CREDENTIAL_RESPONSE` events
- **Callout analysis** — URL, HTTP method, duration, HTTP status code, status text, and response line number
- **Savepoint tracking** — `SAVEPOINT_SET`, `SAVEPOINT_ROLLBACK`, and `ROLLBACK` events as structured records

#### Governor Limit Tracking

- **Governor limit burn rate** — per-phase consumption of: SOQL query count, SOQL rows, DML statement count, DML rows, CPU time, heap, and callout count
- **CPU attribution** — CPU time broken down by class and namespace
- **Heap analysis** — heap usage timeline and peak values

#### Diagnostics

- **Trigger cascade detection** — detects the same trigger firing multiple times (`recursiveTriggerAnalysis`)
- **Recursive trigger detection** — same trigger fires more than once; emits a `RECURSIVE_TRIGGER` warning
- **Mixed DML detection** — setup and non-setup DML in the same transaction (`mixedDmlAnalysis`); emits a `MIXED_DML_OPERATION` warning
- **Validation block analysis** — validation rule execution recorded per phase
- **Debug level quality assessment** — scores log completeness based on the debug levels present
- **Managed package impact** — overhead attributed to third-party namespaces
- **System mode transitions** — `SYSTEM_MODE_ENTER` / `SYSTEM_MODE_EXIT` events

#### Structural

- **Timeline** — structured chronological event timeline
- **Evidence index** — line-number to evidence-pointer map enabling O(1) evidence lookup
- **Schema version** — report schema is versioned for strict current-format validation

---

### Viewer (5 Views)

The viewer is zero-dependency vanilla JS ESM running directly from `viewer/`. No build step required.

#### Triage View

- Verdict card with severity level: `ok`, `info`, `warn`, `critical`, `error`
- Key metrics grid (SOQL count, DML count, CPU time, heap peak, callout count)
- Phase snapshot grid showing governor consumption across all 20 phases
- N+1 SOQL warning banner

#### Execution View

- 20-phase timeline with per-phase governor burn rates
- Execution story panel:
  - Events sorted by log line number
  - Salesforce phase labels applied to each event
  - Toggle to show/hide internal framework events
  - Event types displayed in `SCREAMING_SNAKE_CASE`

#### Data View

- SOQL table — top N longest queries with an expandable full list
- DML table — all DML operations
- Callouts table — with HTTP status code column
- Named Credentials section — separate from callouts
- Savepoints section

#### Diagnostics View

- Instrumentation quality card
- Execution context card
- Debug level badge with coverage indicator
- Trigger cascade list
- Managed package impact breakdown
- Mixed DML and recursive trigger warnings
- Validation rule outcomes
- CPU attribution bar chart

#### Evidence View

- Full raw log rendered with no line truncation
- Line-number anchoring — deep-linkable to any line
- Keyword search with match highlighting
- Context filter to narrow log event types
- Show-all toggle
- Copy highlighted / copy visible buttons

#### Cross-View Features

- **Evidence linking** — clicking any SOQL, DML, callout, or issue row in any view jumps to the corresponding line in the Evidence view
- **Expand/collapse** — all tables support show-more / show-fewer with configurable row defaults
- **Hash-based navigation** — `#triage`, `#execution`, `#data`, `#diagnostics`, `#evidence`

---

### MCP Server (AI Tool Integration)

- Exposes all parsing capabilities to Claude, Cursor, and other MCP-compatible AI tools
- Five tools: `parse_apex_log`, `analyze_performance`, `analyze_soql`, `analyze_governor_limits`, `summarize_log`
- All parsing runs locally via `@apex-log-insights/core` — the MCP server makes zero network requests
- **Privacy note:** Structured results are passed to the connected AI client via stdio. If the AI client uses a cloud API, the parsed report (including SOQL queries, class names, namespace info) will be transmitted through the AI's pipeline
- **Opt-in PII redaction:** Every tool accepts a `redact: true` parameter that masks Salesforce IDs, emails, phone numbers, and debug message content before returning results to the AI client
- Structural metadata (class names, field names, sObject types, governor limits, durations, counts) is preserved even when redaction is enabled

---

### Chrome Extension

- **In-browser log loading** — drag a `.log` file onto the extension or click to open; a Web Worker parses in the background so the UI stays responsive
- **JSON report loading** — load a pre-generated `.apex-insights.json` file directly
- **URL source loading** — load a log from a URL (e.g. directly from a Salesforce debug log page)
- **Storage persistence** — remembers the last loaded log across extension open/close cycles
- **File size advisory** — warns the user when the log exceeds 20 MB
- **Verdict panel** — extension-specific summary card displayed in Triage view
- **Extension loader panel** — drag-and-drop UI shown when no log is loaded
- **Loading placeholder** — animated state while the worker is parsing
- **Content script** — detects `.log` files open in browser tabs and auto-redirects to the analyzer

---

## What to Build Next

Items are grouped by priority. Each item includes enough context to act on without consulting other documents.

---

### High Priority

---

#### 1. Virtual Scroll for Evidence View

**Risk:** At 10,000+ log lines the DOM contains tens of thousands of row elements. Scrolling freezes and initial render time is unacceptable on large logs.

**Approach:**

- Render only the visible window of rows plus a small buffer above and below
- Recycle DOM nodes as the user scrolls (windowed rendering)
- Track the scroll position and swap content into recycled nodes
- The "show all" / copy operations must still work — when a copy action is triggered, materialise the full content into memory without inserting it all into the DOM, then write it to the clipboard
- Keyword search must scan the full data array, not just rendered nodes

**Reference:** `claude_plan/` plan/03 Sprint 4

---

#### 2. Unified Callout + Named Credential Pairing

**Problem:** Named credential requests and HTTP callouts are emitted as separate log events and are currently displayed in two separate tables. They represent the same integration operation and should be shown together.

**Approach:**

- After parsing, match each `NAMED_CREDENTIAL_REQUEST` record to its corresponding callout record using timestamp proximity and/or log line adjacency
- Produce a single `integrationOperations` array where each entry has both the named credential metadata and the HTTP callout details
- Fall back gracefully: unpaired callouts and unpaired named credential records remain visible as standalone entries
- Update `normalize-report.js` and `render-data.js` to consume the unified model

---

### Medium Priority

---

#### 3. Alternate Phase Models for Non-Synchronous Execution Contexts

**Problem:** The current 20-phase model is calibrated for synchronous DML triggers. Batch, anonymous Apex, Queueable, Future Method, and Scheduled Apex have structurally different lifecycles and map poorly onto the existing phases, producing misleading or empty phase slots.

**Approach:**

- Define alternative phase models (as separate arrays in `packages/core/src/`) for each non-synchronous context
- After execution context is determined, select the appropriate phase model before mapping events
- Ensure the viewer's Execution view renders phase labels from whichever model is active
- The Triage phase snapshot grid should adapt its column headers accordingly

---

#### 4. Aggregate SOQL Pattern Grouping

**Problem:** The SOQL table shows every query execution as a separate row, even when the same query runs hundreds of times with different bind variable values. This makes it hard to identify the most impactful query shapes.

**Approach:**

- Group rows by normalised query text (strip bind variable literal values, lowercase, trim whitespace)
- For each group, display: query text, execution count, total rows returned, total duration, average duration, and an expandable list of individual executions
- The existing top-N longest sort should work on per-execution duration; add a secondary sort by total group duration
- Update `normalize-report.js` to produce a `soqlGroups` array alongside the flat `soql` array

---

#### 5. Export to CSV or PDF

**Problem:** Users want to share SOQL or DML analysis results with colleagues who do not have the viewer open.

**Approach:**

- Add an "Export" button to the Data view toolbar
- CSV export: serialise the currently visible table (SOQL, DML, or callouts) to RFC 4180 CSV using a pure-JS serialiser; trigger a `data:` URI download
- PDF export: use the browser's built-in `window.print()` with a `@media print` stylesheet that hides the nav and renders the active table cleanly; no external library required
- Export scope: active table only (not the full report)

---

### Low Priority

---

#### 6. Phase 17 "Criteria Evaluation" Disambiguation

**Problem:** Phase 17 is currently labelled "Criteria Evaluation" but this label covers both Process Builder criteria evaluation and legacy Workflow Rule criteria evaluation. They are distinct operations that produce different log event patterns.

**Approach:**

- Examine the log event sequences that are currently bucketed into Phase 17
- Identify distinguishing events (e.g. `PROCESS_STARTED` vs. `WF_CRITERIA_BEGIN`) and split into two sub-phases or add a discriminated label
- Update phase label constants in the report engine and in the viewer's phase snapshot grid

---

#### 7. Offline Viewer PWA

**Problem:** The viewer already works fully offline, but there is no PWA manifest or service worker, so it cannot be installed to the desktop or home screen.

**Approach:**

- Add a `manifest.json` with name, icons, and `display: standalone`
- Register a minimal service worker that caches `viewer/`, `viewer/modules/`, and `viewer/styles.css` on install
- Cache strategy: cache-first for all viewer assets; network-first is unnecessary since the viewer is intentionally offline-only
- No change to the zero-dependency architecture; service worker is vanilla JS

---

#### 8. Dark Mode

**Problem:** The viewer has no dark mode support.

**Approach:**

- Audit `viewer/styles.css` for hardcoded colour values and replace them with CSS custom properties (`--color-bg`, `--color-surface`, `--color-text`, etc.)
- Add a `@media (prefers-color-scheme: dark)` block that overrides the custom properties
- Optionally add a manual toggle button that sets a `data-theme="dark"` attribute on `<html>` and stores the preference in `localStorage`

---

#### 9. Multi-Log Comparison View

**Problem:** Performance tuning requires comparing two runs of the same transaction — before and after a code change. Currently this requires opening two browser tabs and switching between them.

**Approach:**

- Add a sixth view: `#compare`
- Allow loading a second `.apex-insights.json` report alongside the primary one
- Side-by-side panels showing: governor limit totals, phase timing, SOQL count, DML count, callout count
- Delta indicators (arrows + percentage change) for each metric
- Evidence views remain per-report; comparison is summary-level only
- The Chrome extension and offline viewer both support this; the extension may need a second file-drop target

---

*Last updated: 2026-04-03*
