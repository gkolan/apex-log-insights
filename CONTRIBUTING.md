# Contributing & Bug-Fix Process

This document is the canonical guide for fixing bugs, adding features, and building
all distribution targets. It is written for Claude, Codex, and human engineers.

---

## Architecture in One Sentence

**TypeScript parses → report builder structures → viewer renders.**
Fix bugs at the lowest layer where they actually originate.

---

## Monorepo Layout

```
packages/
  core/                    ← shared parsing engine (zero runtime dependencies)
    src/
      certinia/            ← vendored Certinia parser (ApexLogParser, LogEvents, etc.)
      insights/            ← analysis modules (governor, execution, database, etc.)
      parserCore.ts        ← wraps Certinia parser; builds NormalizedParseResult
      insightsReport.ts    ← entry point: imports from insights/* + buildInsightsReport
      offlineReport.ts     ← final OfflineReportV2 assembly (the 20-phase model)
      phases.ts            ← phase IDs + definitions
      report.ts            ← shared types + deterministic report builder
      index.ts             ← barrel export (public API for all other packages)

  cli/                     ← command-line interface
    src/
      bin.ts               ← CLI entry — file I/O only, imports from @apex-log-insights/core

  mcp/                     ← MCP server for AI tools (Claude, Cursor, etc.)
    src/
      server.ts            ← stdio MCP server entry
      tools/               ← one file per MCP tool (parseLog, analyzeSoql, etc.)

  browser-ext/             ← browser extension (Chrome, Edge, Firefox)
    src/
      worker-entry.ts      ← Web Worker entry (calls parseLog → buildOfflineReport)
      perf-shim.ts         ← node:perf_hooks polyfill for browser builds
    manifests/             ← per-browser manifest.json files
    scripts/               ← per-browser build scripts

viewer/                    ← offline HTML viewer (vanilla JS, no build step)
  modules/
    normalize-report.js    ← single place that handles format differences
    render-*.js            ← one module per view (never add format checks here)
    load-report.js         ← loads JSON report file
    shared-*.js            ← utilities

fixtures/                  ← shared test log files used across packages
scripts/                   ← repo-level build utilities
  sync-versions.mjs        ← propagates root version to all packages/manifests
  assemble-extension-ui.ts ← merges viewer sources into extension shared/ assets
  export-extension.ts      ← full release pipeline (bump + build + zip all browsers)
  check-version-sync.ts    ← CI check that all versions match
```

---

## The Three-Layer Rule

Before touching any code, identify which layer owns the bug:

```
Layer 1 — Parser      packages/core/src/certinia/LogEvents.ts, ApexLogParser.ts
           "Is the raw event data captured in the parse result?"

Layer 2 — Report      packages/core/src/insights/*.ts, insightsReport.ts, offlineReport.ts
           "Is the data structured and exposed in the report JSON?"

Layer 3 — Renderer    viewer/modules/render-*.js, packages/browser-ext/app.js
           "Is the data displayed correctly once it arrives?"
```

**Diagnostic sequence — always follow this order:**

1. Open a sample `.log` file in a text editor. Confirm the raw event line exists.
2. Run `pnpm dev:cli -- parse fixtures/simple.log --pretty` and inspect the JSON.
   - Is the field present? If not → Layer 2 bug (report builder).
   - Is the field absent from the raw log itself? → Layer 1 bug (parser).
3. Open the viewer with the JSON report loaded.
   - Is the field in the JSON but not shown? → Layer 3 bug (renderer).

**Never patch the renderer to work around a parser gap.
Never add format checks in a render module — that belongs in `normalize-report.js`.**

---

## Bug Fix Workflows

### Workflow A — Parser bug (Layer 1)

*Symptom: parse output is missing a field, or a field has the wrong value.*

1. Find the event class in `packages/core/src/certinia/LogEvents.ts`.
2. Fix the field extraction in the constructor.
3. If the event type is new, register it in `packages/core/src/certinia/LogLineMapping.ts`.
4. Run `pnpm typecheck` → must pass.
5. Run `pnpm test` → must pass.
6. Rebuild the extension worker: `pnpm --filter @apex-log-insights/browser-ext build:worker`.

### Workflow B — Report builder bug (Layer 2)

*Symptom: Field is in parse result but absent from the report JSON.*

1. Find the relevant builder in `packages/core/src/insights/` (e.g. `database.ts` for SOQL/DML).
2. In `packages/core/src/offlineReport.ts`, include the new field in the returned object.
3. Run `pnpm typecheck` + `pnpm test` → must pass.
4. Rebuild the extension worker.

### Workflow C — Renderer bug (Layer 3)

*Symptom: Field is correct in the JSON report but the UI shows blank or wrong value.*

**For the standalone viewer (`viewer/`):**
- All report-shape normalization goes in `viewer/modules/normalize-report.js` only.
- Each view is rendered by one `render-*.js` module.

**For the browser extension (`packages/browser-ext/app.js`):**
- Fix field resolution inside accessor functions, not at each call-site.

---

## Building & Releasing

### Prerequisites

This project uses **pnpm** workspaces. If you don't have pnpm installed:

```bash
# Option 1: Install via npm
npm install -g pnpm

# Option 2: Use corepack (bundled with Node 16+)
corepack enable
corepack prepare pnpm@9.15.4 --activate
```

Then set up the project:

```bash
pnpm install       # Install all dependencies
pnpm build         # Sync versions → build all → export extension
pnpm test          # Run all tests
pnpm typecheck     # Type check all packages
pnpm audit         # Security scan (deps + secrets + eslint-security)
pnpm bugs          # Bug scan (knip + tsc strict + attw + madge)
```

### Building Individual Targets

| Target | Command | Output |
|--------|---------|--------|
| Core library | `pnpm --filter @apex-log-insights/core build` | `packages/core/dist/` (CJS + ESM) |
| CLI | `pnpm --filter @apex-log-insights/cli build` | `packages/cli/dist/bin.js` |
| MCP server | `pnpm --filter @apex-log-insights/mcp build` | `packages/mcp/dist/server.js` |
| Chrome extension | `pnpm --filter @apex-log-insights/browser-ext build:chrome` | `packages/browser-ext/dist/chrome-extension-v*.zip` |
| Edge extension | `pnpm --filter @apex-log-insights/browser-ext build:edge` | `packages/browser-ext/dist/edge-extension-v*.zip` |
| Firefox extension | `pnpm --filter @apex-log-insights/browser-ext build:firefox` | `packages/browser-ext/dist/firefox-extension-v*.xpi` |

### Extension UI Assembly

Running `pnpm build` (the full project build) automatically assembles the extension UI
as part of the `browser-ext` build step. The `scripts/assemble-extension-ui.ts` script
merges `viewer/app.js` (up to the `VIEWER_INIT_START` marker) with
`shared/app-extension-only.js` to produce `shared/app.js`, and merges `viewer/styles.css`
with `shared/styles-extension-only.css` to produce `shared/styles.css`.

This means any changes to the viewer's `app.js` or `styles.css` are propagated to the
extension on every `pnpm build`, not just when running per-browser build scripts.

The per-browser scripts (`build:chrome`, `build:edge`, `build:firefox`) also run this
assembly step before copying shared assets into the dist folder.

### Build Artifacts & Minification

All shipped code is minified via esbuild or tsup. Source maps are handled per package:

| Package | Minified | Source Maps | Reason |
|---------|----------|-------------|--------|
| `core` | Yes | Yes | Library consumers need to debug through the code |
| `cli` | Yes | No | End-user binary — no debugging needed |
| `mcp` | Yes | No | End-user binary — no debugging needed |
| `browser-ext` | Yes | No | Extensions run in the browser — no debugging needed |

Source code in `packages/*/src/` is always readable with full comments. Minification only affects the build output in `dist/`. Contributors read the source on GitHub; users get optimized bundles.

### Version Bumping

All packages share a single version number managed from the root `package.json`.

**Option 1 — Manual bump and sync:**

```bash
# 1. Edit "version" in the root package.json (e.g. 1.1.0 → 1.2.0)
# 2. Sync the version into all packages and manifests
node scripts/sync-versions.mjs
# 3. Build
pnpm build
```

**Option 2 — Bump and build an extension in one step:**

The browser extension build scripts accept a `--version` flag that bumps the version
everywhere and then builds:

```bash
# Bump to 1.2.0 and build Chrome extension
pnpm --filter @apex-log-insights/browser-ext build:chrome -- --version 1.2.0

# Same for Edge and Firefox
pnpm --filter @apex-log-insights/browser-ext build:edge -- --version 1.2.0
pnpm --filter @apex-log-insights/browser-ext build:firefox -- --version 1.2.0

# Short form with -v
pnpm --filter @apex-log-insights/browser-ext build:chrome -- -v 1.2.0
```

This updates the root `package.json`, runs `sync-versions.mjs` (which updates all
4 package.json files and all 3 browser manifests), then builds. The output zip is
named with the version: `chrome-extension-v1.2.0.zip`.

Without `--version`, the scripts just rebuild with the current version.

The `sync-versions.mjs` script updates: every `packages/*/package.json` and
every `manifests/*/manifest.json`.

### Extension Build Output

Each browser build produces two things:

- **Unpacked folder** (e.g. `dist/chrome/`) — for development. Load in the browser via
  "Load unpacked" in developer mode.
- **Versioned zip** (e.g. `dist/chrome-extension-v1.2.0.zip`) — for distribution. Upload to
  the browser store or attach to a GitHub Release.

Old versioned zips are cleaned up automatically on each build.

### Security Audit

CI runs `pnpm audit --audit-level=high` on every push and pull request. The same check
runs before any npm publish in the release workflow. If a dependency has a known
high-severity vulnerability, the build fails.

To run the full security audit locally (dependency vulnerabilities + secret detection + eslint-security):

```bash
pnpm audit                    # Writes each finding to audit/*.md
```

### Bug Detection

To run static bug detection (unused code, unsafe index access, type export issues, circular deps):

```bash
pnpm bugs                     # Writes each finding to bugs/*.md
```

### Release Flow (GitHub Actions)

1. Bump version in root `package.json` (subpackages sync automatically on `pnpm build`)
2. Update `CHANGELOG.md` with the new version's changes (follow Keep a Changelog format)
3. Commit and tag: `git tag v1.2.0`
4. Push the tag — GitHub Actions will:
   - Audit dependencies for known vulnerabilities
   - Build and test all packages
   - Publish `@apex-log-insights/core`, `@apex-log-insights/cli`, `@apex-log-insights/mcp` to npm
   - Build Chrome, Edge, and Firefox extension zips (versioned filenames)
   - Create a GitHub Release with notes pulled from CHANGELOG.md
   - Attach extension zips/xpi to the GitHub Release as downloadable assets

**Important:** The release workflow reads the matching version section from `CHANGELOG.md`
and uses it as the GitHub Release body. If you skip updating the changelog, the release
will have empty notes.

---

## Adding a New Report Field

1. **Extract** the raw token in `packages/core/src/certinia/LogEvents.ts` (if new).
2. **Group/aggregate** in `packages/core/src/insightsReport.ts`.
3. **Expose** in `packages/core/src/offlineReport.ts`.
4. **Surface** in the viewer: update `normalize-report.js` then the relevant `render-*.js`.
5. **Surface** in the extension: update the relevant accessor in `packages/browser-ext/app.js`.
6. **Add a test fixture** in `fixtures/` and a test assertion.
7. Run `pnpm test` + `pnpm typecheck` → pass.
8. Rebuild the extension worker.

---

## Adding a New Event Type

1. Create a new class in `packages/core/src/certinia/LogEvents.ts`.
2. Register it in `packages/core/src/certinia/LogLineMapping.ts`.
3. Follow steps 2–8 from "Adding a New Report Field" above.

---

## Test Commands

```bash
pnpm test                  # all tests (vitest)
pnpm typecheck             # TypeScript check for all packages
pnpm dev:cli               # watch mode for CLI development
pnpm dev:ext               # watch mode for browser extension
```

---

## Critical Rules — Never Break These

1. **`normalize-report.js` is the only place that handles format differences.**
2. **Evidence Explorer must never truncate lines.**
3. **No build step for the viewer.** It is zero-dependency vanilla JS ESM by design.
4. **`apex-parser-worker.js` is a build artifact.** Never edit it directly.
5. **The extension runtime is TS-only.** The canonical data path is
   `packages/browser-ext/src/worker-entry.ts` → `OfflineReportV2` → `app.js`.
6. **When renaming a report field, update all runtime readers immediately.**
7. **Parser bugs → fix in `packages/core/src/certinia/`.
   Report bugs → fix in `packages/core/src/insights/*.ts` or `insightsReport.ts`.
   Display bugs → fix in the viewer or extension `app.js`.
   Never cross layers.**
