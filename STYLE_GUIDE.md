# Apex Log Insights — Style Guide

Use this guide when changing TypeScript, viewer JavaScript, styles, tests, or public report fields. A conforming change belongs to the correct layer, uses stable project terms, preserves security boundaries, and includes tests that demonstrate its observable behavior.

## Quick reference

| Topic                                   | Rule                                                          |
| --------------------------------------- | ------------------------------------------------------------- |
| Report field access                     | Read canonical v3 fields directly; no compatibility fallbacks |
| Array fields from report                | Always wrap in `toArray(value)`                               |
| Items without line numbers              | Always filter with `hasValidLineNumber()` before rendering    |
| Format normalization                    | Only in `normalize-report.js` — never in render modules       |
| User-visible strings in HTML            | Always pass through `escapeHtml()` before `innerHTML`         |
| CSS colours                             | Always use `var(--token-name)`, never hard-code hex           |
| New report field                        | Bump schema metadata in `packages/core/src/insightsReport.ts` |
| Renaming a report field                 | Remove old name and update all consumers in the same change   |
| Viewer modules                          | ESM only (`export`/`import`)                                  |
| `viewer/app.js`, extension-only overlay | Plain script (IIFE-compatible) — no `import`/`export`         |
| Extension hooks                         | Guard with `typeof` before calling                            |
| Commit prefix                           | `parser:`, `report:`, `viewer:`, or `extension:`              |
| Tests must pass                         | All tests green before any commit                             |
| Public names and labels                 | Follow `docs/reference/terminology.md`; one term per concept  |

---

## 1. Architecture overview

```
Layer 1 — Parser      packages/core/src/certinia/  (LogEvents.ts, ApexLogParser.ts, LogLineMapping.ts)
Layer 2 — Report      packages/core/src/insights/*.ts  +  insightsReport.ts  +  offlineReport.ts
Layer 3 — Viewer      viewer/app.js + viewer/index.html + viewer/styles.css
           Extension  generated from viewer sources + extension-only overlay
```

Fix bugs at the lowest layer where they originate. Never patch the renderer to work around a parser gap. Never add parsing logic in `app.js`.

`viewer/app.js` owns live five-view routing and hydrates the established panel shell in `viewer/index.html`. Keep shared layout and interaction behavior there so the standalone viewer, CLI, browser extension, and VS Code extension present the same hierarchy. Host adapters may add environment-specific controls but must not replace the shared report layout.

---

## 2. TypeScript (`packages/`)

### 2.1 File roles

| File                                           | Responsibility                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `packages/core/src/certinia/LogEvents.ts`      | One class per Salesforce event type; token extraction only            |
| `packages/core/src/certinia/LogLineMapping.ts` | Maps event-type strings to class constructors                         |
| `packages/core/src/certinia/ApexLogParser.ts`  | Tokenises raw log lines into an `ApexLog` tree                        |
| `packages/core/src/parserCore.ts`              | Wraps vendor parser; produces `NormalizedParseResult`                 |
| `packages/core/src/insights/types.ts`          | All shared interfaces and type aliases for the analysis layer         |
| `packages/core/src/insights/utils.ts`          | Utility helpers and text parsers (`flattenEvents`, `first`, etc.)     |
| `packages/core/src/insights/parsing.ts`        | Salesforce ID resolution, record graph, cumulative profiling          |
| `packages/core/src/insights/governor.ts`       | Limit timeline, burn rate, heap, CPU, packages, debug quality         |
| `packages/core/src/insights/execution.ts`      | Execution phases, context detection, triggers, mixed DML              |
| `packages/core/src/insights/database.ts`       | SOQL patterns, savepoints, named credentials                          |
| `packages/core/src/insightsReport.ts`          | Entry point: imports from `insights/*`; exports `buildInsightsReport` |
| `packages/core/src/offlineReport.ts`           | Assembles the final `OfflineReportV2` shape                           |
| `packages/core/src/phases.ts`                  | Phase IDs and definitions                                             |
| `packages/core/src/report.ts`                  | Shared types + deterministic report builder                           |
| `packages/core/src/workerProtocol.ts`          | Host-neutral parser-worker message validation and report construction |
| `packages/cli/src/bin.ts`                      | CLI entry — file I/O only, imports from `@apex-log-insights/core`     |
| `packages/browser-ext/src/worker-entry.ts`     | Web Worker entry for the browser extension                            |
| `packages/browser-ext/src/perf-shim.ts`        | Browser polyfill for `node:perf_hooks`                                |
| `packages/vscode-ext/src/extension.ts`         | VS Code activation and extension-owned lifecycle                      |

### 2.2 Canonical field access

Read canonical v3 report fields directly. Do not add backward-compat field fallbacks.

```typescript
const limits = report?.governorLimits ?? null;
const blocks = Array.isArray(report?.execution?.blocks)
  ? report.execution.blocks
  : [];
```

Rule: **when renaming a report field, update producers and consumers atomically** (report builder, viewer normalization, extension path, and tests) and keep only the new canonical path.

### 2.3 The `toArray()` helper

Every array field read from a report must be wrapped:

```typescript
const soqlItems = toArray(report?.database?.soql);
```

`toArray` is defined as:

```typescript
function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
```

### 2.4 The `hasValidLineNumber()` filter

Any item (SOQL query, DML operation, callout, named credential, issue) without a valid line number must be filtered before rendering. "Valid" means `evidence.lineNumber > 0`.

```typescript
const rendered = soqlItems.filter(hasValidLineNumber);
```

Never render items that fail this check. This rule is enforced centrally in `normalize-report.js` and must not be duplicated or relaxed in render modules.

### 2.5 Schema versioning

Bump the schema metadata in `packages/core/src/insightsReport.ts` whenever output structure changes. Do not bump for internal refactors that produce no output change.

```typescript
schema: {
  name: 'apex-insights-offline-report',
  version: '3.0.0',
}
```

### 2.6 Types

Use `JsonValue` from `packages/core/src/report.ts` for dynamic report data that has no fixed shape:

```typescript
import type { JsonValue } from './report.js';

function readDynamic(value: JsonValue): string { ... }
```

Use `Record<string, unknown>` (aliased as `UnknownRecord` in several files) for intermediate objects before narrowing.

### 2.7 Event class conventions (`packages/core/src/certinia/LogEvents.ts`)

Each Salesforce log event maps to one class. Parts are pipe-split:

- `parts[0]` — timestamp
- `parts[1]` — event type string
- `parts[2]` — line reference
- `parts[3+]` — payload fields (event-specific)

Prefer defensive extraction from canonical token positions:

```typescript
this.ruleName = parts[4] || parts[3] || "";
```

When adding a new event type, register it in `packages/core/src/certinia/LogLineMapping.ts`:

```typescript
MY_NEW_EVENT: MyNewEventLine,
```

### 2.8 Naming

- Functions: `camelCase`, verb-first, descriptive — `buildInsightsReport`, `collectPhases`, `normalizeCallouts`
- Interfaces: `PascalCase` — `FlatEvent`, `ParsedExplainPlan`
- Type aliases: `PascalCase` — `UnknownRecord`, `JsonValue`
- Constants: `UPPER_SNAKE_CASE` for module-level constants, `camelCase` for local constants
- Booleans: start with `is`, `has`, `can`, or `should` and express a positive state
- Collections: use plural nouns; name maps `<values>By<key>` and ID sets `<concept>Ids`
- Units: include the unit when it is not clear from the type, such as `timeoutSeconds` or `fileSizeBytes`
- Public labels and terms: use the exact form in `docs/reference/terminology.md`

Use a noun for stored information and a verb for an operation. Avoid new names containing `data`, `info`, `manager`, `helper`, `util`, `misc`, `new`, or `temp` when a specific concept is available. Existing internal names do not justify repeating a vague name in a new public API.

### 2.9 Imports

Use the `.js` extension on all relative imports, even from `.ts` source files. This is required for both the Node.js ESM loader and the esbuild bundler:

```typescript
import { buildInsightsReport } from "./insightsReport.js";
import type { JsonValue } from "./report.js";
```

Use `node:` prefix for all Node built-ins:

```typescript
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
```

---

## 3. Viewer modules (`viewer/modules/*.js`)

### 3.1 Module format

All files in `viewer/modules/` are ESM. Use `export function` and `import { } from`:

```js
// shared-format.js
export function escapeHtml(value) { ... }
export function formatMs(value) { ... }

// render-triage.js
import { escapeHtml, formatMs } from './shared-format.js';
export function renderTriageView(data) { ... }
```

Never add `require()`, CommonJS exports, or Node built-in imports. The viewer runs directly in the browser with no build step.

### 3.2 Module responsibilities

| Module                  | Responsibility                                                      |
| ----------------------- | ------------------------------------------------------------------- |
| `normalize-report.js`   | Only place that resolves format differences between report versions |
| `render-triage.js`      | Renders the Triage view                                             |
| `render-data.js`        | Renders the Data (SOQL/DML/Callouts) view                           |
| `render-execution.js`   | Renders the Execution view                                          |
| `render-diagnostics.js` | Renders the Diagnostics view                                        |
| `render-evidence.js`    | Renders the Evidence Explorer — never truncate lines                |
| `render-report.js`      | Renders the Report view                                             |
| `render-shell.js`       | Renders the app shell (nav, header)                                 |
| `load-report.js`        | Loads the JSON report file                                          |
| `shared-format.js`      | Formatting utilities (`escapeHtml`, `formatMs`, `num`, etc.)        |
| `shared-dom.js`         | DOM utilities (`qs`, `qsa`, `createFragment`)                       |
| `shared-evidence.js`    | Evidence linking helpers (`evidenceButton`, `evidenceSummary`)      |

### 3.3 Render function signature

All view renderers follow this pattern:

```js
export function renderTriageView(data) { ... }
export function renderDataView(data) { ... }
export function renderExecutionView(data) { ... }
```

`data` is the normalized view model produced by `normalizeReport()`. Render functions return an HTML string or a DOM node. They do not read the raw report directly.

### 3.4 Normalization rules (`normalize-report.js`)

This module is the single source of truth for canonical view-model shaping. Rules:

1. Read canonical report fields only.
2. Always wrap array fields with `toArray()`.
3. Always filter items through `hasValidLineNumber()` before placing them in the view model.
4. Never expose report-version branching in render modules.

```js
const limits = report?.governorLimits ?? null;
const phases = toArray(report?.phases);
const soql = toArray(report?.database?.soql).filter(hasValidLineNumber);
```

When adding support for a new report field, add a normalizer function in this file:

```js
function normalizeMyNewField(report) {
  return toArray(report?.myNewField);
}
```

Wire it into `normalizeData()` or `normalizeDiagnostics()` as appropriate, then add a test in `tests/viewer-modules.test.ts`.

### 3.5 HTML safety

Every user-controlled or report-derived string must go through `escapeHtml()` before being inserted into `innerHTML`:

```js
// Correct
cell.innerHTML = `<span>${escapeHtml(item.soqlText)}</span>`;

// Wrong — XSS risk
cell.innerHTML = `<span>${item.soqlText}</span>`;
```

`escapeHtml` is exported from `shared-format.js` and escapes `<`, `>`, `&`, and `"`.

### 3.6 Formatting helpers (use these, do not reimplement)

| Helper                   | Use for                                                 |
| ------------------------ | ------------------------------------------------------- |
| `escapeHtml(value)`      | Any string going into `innerHTML`                       |
| `formatMs(value)`        | Millisecond durations                                   |
| `formatNsAsMs(value)`    | Nanosecond durations converted to ms                    |
| `formatPercent(value)`   | Percentage values                                       |
| `formatList(arr)`        | Array of strings joined to a readable list              |
| `num(value, fallback)`   | Numeric values (returns `"-"` for null/undefined)       |
| `truncate(value, max)`   | Long strings for display — do NOT use on Evidence lines |
| `byNumberDesc(selector)` | Sort comparator for numeric fields                      |
| `qs(root, selector)`     | `root.querySelector(selector)`                          |
| `qsa(root, selector)`    | `Array.from(root.querySelectorAll(selector))`           |
| `createFragment(html)`   | Parse HTML string into a `DocumentFragment`             |

---

## 4. Plain scripts (`viewer/app.js`, `packages/browser-ext/shared/app-extension-only.js`)

### 4.1 No ESM

These files are loaded as plain `<script>` tags, not `<script type="module">`. Do not use `import` or `export`. All functions are global or IIFE-scoped.

### 4.2 Extension hook guards

The standalone viewer and the Chrome extension share `app.js`. Extension-only functions are injected by `app-extension-only.js`. Always guard calls with `typeof`:

```js
if (
  typeof buildVerdict === "function" &&
  typeof verdictPanel !== "undefined" &&
  verdictPanel
) {
  buildVerdict(report);
}
```

### 4.3 DOM element references

Declare all element references at the top of the file, matching the element's `id` in camelCase:

```js
const verdictPanel = document.getElementById("verdictPanel");
const governorLimitsGrid = document.getElementById("governorLimitsGrid");
const rawSearchInput = document.getElementById("rawSearchInput");
```

### 4.4 Accessor functions

Use dedicated accessor functions for field resolution. Fix resolution inside the accessor — not at every call site:

```js
function getReportExecution(report) {
  return report?.execution ?? null;
}

function getReportGovernorLimits(report) {
  return report?.governorLimits ?? null;
}
```

### 4.5 Event listeners

Set up event listeners inline in the init section, not as named functions exported elsewhere:

```js
// In the init/boot section
toggleAllQueriesBtn.addEventListener("click", () => {
  allQueriesWrap.classList.toggle("hidden");
});
```

### 4.6 `escapeHtml()` applies here too

`app.js` and `app-extension-only.js` define their own local `escapeHtml()` (they cannot import from `shared-format.js`). Use it on every report-derived string inserted into `innerHTML`. Do not add a second implementation — use the one already present in the file.

---

## 5. CSS (`viewer/styles.css`, `packages/browser-ext/shared/styles-extension-only.css`)

### 5.1 Design tokens

All colours, spacing, shadows, typography, and layout values are defined as CSS custom properties in `:root`. Never hard-code a hex value or pixel count outside `:root`.

```css
/* Correct */
background: var(--surface);
color: var(--error-text);
border-radius: var(--panel-radius);

/* Wrong */
background: #ffffff;
color: #991b1b;
border-radius: 10px;
```

Key tokens:

| Token                         | Value             | Use for                    |
| ----------------------------- | ----------------- | -------------------------- |
| `--bg`                        | `#f3f4f6`         | Page background            |
| `--surface`                   | `#ffffff`         | Card / panel surface       |
| `--ink`                       | `#111827`         | Primary text               |
| `--ink-secondary`             | `#374151`         | Secondary text             |
| `--muted`                     | `#6b7280`         | Muted / helper text        |
| `--accent`                    | `#2563eb`         | Links, buttons, highlights |
| `--accent-hover`              | `#1d4ed8`         | Hover state for accent     |
| `--error-bg` / `--error-text` |                   | Error states               |
| `--warn-bg` / `--warn-text`   |                   | Warning states             |
| `--ok-bg` / `--ok-text`       |                   | Success/ok states          |
| `--panel-radius`              | `10px`            | Card border radius         |
| `--max-width`                 | `1180px`          | Main content max-width     |
| `--font-sans`                 | system font stack | Body text                  |
| `--font-mono`                 | monospace stack   | Code, log lines            |

### 5.2 BEM-style class names

Use BEM naming for component classes:

```
Block:     .verdict-card
Element:   .verdict-card__icon     (double underscore)
Modifier:  .verdict-card--ok       (double dash)
```

Examples from the codebase:

```css
.listCard {
}
.listTitle {
}
.statusPill {
}
.statusPill.status-error {
}
.sectionCard {
}
.sectionHead {
}
.sectionTitle {
}
.sectionCopy {
}
```

Utility classes (single-purpose, broadly reused) are acceptable: `.hidden`, `.stack`, `.grid2`, `.actionRow`, `.smallCopy`.

### 5.3 Section comments

Divide the stylesheet into named sections with a standard comment format:

```css
/* --- Design Tokens --- */
/* --- Reset & Base --- */
/* --- Layout --- */
/* --- Navigation --- */
/* --- Cards & Panels --- */
/* --- Tables --- */
/* --- Evidence Explorer --- */
/* --- Severity Palette --- */
```

### 5.4 No inline styles

Never add `style="..."` attributes to HTML. All visual state must come from CSS classes. Toggle classes from JavaScript; do not write `element.style.color = ...`.

### 5.5 Responsive and layout

- Main content is constrained to `var(--max-width)` (1180px).
- Use CSS Grid and Flexbox for layout. Do not use floats.
- `box-sizing: border-box` is applied globally via `* { box-sizing: border-box; }`.

---

## 6. Testing

### 6.1 Framework and location

Tests use Vitest. Test files live in `packages/*/__tests__/`, `packages/*/src/`, and the root `__tests__/` directory and are named `*.test.ts`.

```typescript
import { describe, it, expect } from "vitest";
```

### 6.2 Test coverage requirements

- Every new report field must have a normalization test.
- Every new parser event type must have a parse-result assertion.
- Test log fixtures live in `fixtures/` at the repo root.

### 6.3 Test baseline

All tests must pass before any commit. Run the full suite with:

```bash
pnpm test
pnpm typecheck
```

When adding tests, do not remove or disable existing assertions.

---

## 7. Naming conventions

### 7.1 Functions

| Context             | Pattern                  | Example                                        |
| ------------------- | ------------------------ | ---------------------------------------------- |
| Report normalizers  | `normalize` + noun       | `normalizeCallouts()`, `normalizeSavepoints()` |
| Report collectors   | `collect` + noun         | `collectPhases()`, `collectIssueState()`       |
| View renderers      | `render` + noun + `View` | `renderTriageView()`, `renderDataView()`       |
| Extension accessors | descriptive, no prefix   | `getReportExecution()`, `buildVerdict()`       |
| Format helpers      | `format` + noun          | `formatMs()`, `formatPercent()`                |
| Boolean predicates  | `has` / `is` + noun      | `hasValidLineNumber()`, `isExtensionContext()` |

### 7.2 Files

| Layer                   | Pattern                | Example                                   |
| ----------------------- | ---------------------- | ----------------------------------------- |
| Viewer render modules   | `render-` + kebab-noun | `render-data.js`, `render-diagnostics.js` |
| Viewer shared utilities | `shared-` + kebab-noun | `shared-format.js`, `shared-dom.js`       |
| TypeScript source       | camelCase              | `insightsReport.ts`, `offlineReport.ts`   |
| Test files              | `*.test.ts`            | `viewer-modules.test.ts`                  |

### 7.3 Report fields

New fields in `OfflineReportV2` use camelCase. Group by domain:

```
database.soql          — SOQL queries
database.dml           — DML operations
database.callouts      — HTTP callouts
database.namedCredentials — Named credential calls
execution.blocks       — Execution blocks / spans
context.executionContext — Execution context type
governorLimits         — Governor limit usage
issues                 — Issues / errors / warnings
```

When a field is renamed, remove the old field and update all reads to the new canonical path in the same change.

---

## 8. Git and versioning

### 8.1 Commit message prefix

Prefix every commit message with the layer changed:

```
parser: extract ruleName from parts[4] for VALIDATION_RULE events
report: add mixedDmlAnalysis field to OfflineReportV2 (v0.13.0)
viewer: render Named Credentials section in Data view
extension: surface statusCode on callout rows in verdict panel
```

A commit that touches multiple layers gets the highest-layer prefix and lists the others in the body.

### 8.2 Version management

All packages share a single version from the root `package.json`. Run `node scripts/sync-versions.mjs` to propagate it into all `packages/*/package.json` files and browser extension manifests.

```bash
# 1. Edit version in root package.json
# 2. Sync everywhere:
node scripts/sync-versions.mjs
# 3. Build and publish:
pnpm build
```

### 8.3 Build artifacts

`apex-parser-worker.js` is a build artifact. Never edit it directly. It is rebuilt by the build scripts from `packages/browser-ext/src/worker-entry.ts`.

---

## 9. Architecture invariants

These rules encode decisions that have caused regressions when broken. They are non-negotiable.

1. **`normalize-report.js` is the only place that handles format differences.** Never add `if (reportVersion === '2.0.0')` checks in render modules.

2. **Evidence Explorer must never truncate lines.** The 800-line regression was a hard-won fix. If performance is a problem at 10K+ lines, implement virtual scroll — do not add a cap.

3. **`reports/` artifacts are trusted baselines.** Do not delete them.

4. **Dead files and historical snapshots should not live in active paths.** Remove stale backups and archive artifacts from the repository root tree.

5. **The viewer has no build step.** It is zero-dependency vanilla JS ESM by design. Do not introduce a bundler, transpiler, or npm dependency into `viewer/`.

6. **`apex-parser-worker.js` is a build artifact.** Edit `packages/browser-ext/src/worker-entry.ts`, then rebuild.

7. **The extension has no bespoke parsing logic.** If you find yourself writing log-line parsing code in `app.js`, stop — that belongs in `packages/core/src/certinia/`.

8. **Items without a valid line number are not rendered.** The `hasValidLineNumber()` filter in `normalize-report.js` is authoritative. Do not bypass it.

9. **No backward-compat field fallbacks in runtime code.** Use one canonical schema path and update all consumers together.

---

## 10. Checklist for adding a report field

1. Extract the raw token in `packages/core/src/certinia/LogEvents.ts` (if it is a new event type, register it in `LogLineMapping.ts`).
2. Group / aggregate in `packages/core/src/insightsReport.ts`.
3. Expose in `packages/core/src/offlineReport.ts` in the returned object.
4. Bump schema metadata in `packages/core/src/insightsReport.ts`.
5. Add a normalizer in `viewer/modules/normalize-report.js`; wire it into `normalizeData()` or `normalizeDiagnostics()`.
6. Render in the relevant `render-*.js` module.
7. Surface shared UI through viewer sources; use `packages/browser-ext/shared/app-extension-only.js` only for extension-only behavior.
8. Add a test fixture in `fixtures/` and a test assertion.
9. Run `pnpm test` and `pnpm typecheck` — all must pass.
10. Rebuild the extension worker: `pnpm --filter @apex-log-insights/browser-ext build:worker`.
