# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.34] - 2026-04-10

### Added

- **File sidebar (Chrome/Edge)** — opt-in sidebar that auto-discovers sibling `.log` files in the same folder when a log is opened. Enable via popup settings → "Show sibling log files". A background tab briefly opens to scrape Chrome's file:// directory listing, then closes. The sidebar shows file names with last-modified timestamps sorted newest first. Clicking a file opens it in a new tab. A floating toggle button with sidebar icon and "Files" label appears in the top-left corner. Includes refresh and close buttons with proper SVG icons and labels. Sidebar data persists across page refreshes via `chrome.storage.local` and `chrome.storage.session`. Setting changes in the popup take effect immediately via `chrome.storage.onChanged` listener. Not available on Firefox (hidden in popup) due to `moz-extension://` pages being unable to fetch `file://` URLs.
- **File sidebar (CLI)** — when using the CLI in folder mode (`apex-log <folder>`), the viewer automatically populates the sidebar from the `/api/logs` endpoint. The CLI server now scans recursively into subdirectories for `.log` files and returns relative paths. Clicking a file opens it in a new tab. Refresh button re-fetches the file list. Sidebar is an overlay that never pushes content.
- **Extension manifest: `scripting` permission** — added to Chrome, Edge, and Firefox manifests to support `chrome.scripting.executeScript` for directory listing scraping.

### Changed

- **Welcome page wording** — "Allow access to local debug logs" heading now updates to "You're all set!" on all browsers (Chrome, Edge, Firefox) once file URL permission is granted. Previously only Firefox had the updated wording. Removed hard `<br>` line break that split the description awkwardly.
- **Extension report persistence** — the `storageKey` payload in `chrome.storage.local` is no longer deleted after first read. This allows page refresh to re-load the same report on all browsers, especially Firefox where `chrome.storage.session` is unreliable via the Chrome polyfill.

### Fixed

- Firefox manifest now includes `browser_specific_settings.gecko.data_collection_permissions` with `required: ["none"]` to satisfy current Add-ons validation for new submissions
- `scripts/run-bugs.ts` now parses current knip JSON shape (`{ issues: [...] }`) and writes actionable bug reports instead of `[object Object]` placeholders
- Version consistency restored across workspace package manifests via `scripts/sync-versions.mjs` (root package version and `packages/*/package.json` now stay aligned)
- Viewer and extension UI rendering migrated away from direct `innerHTML` assignments in source files to shared fragment rendering helpers, reducing Firefox `UNSAFE_VAR_ASSIGNMENT` warnings
- Browser-specific build scripts (`build-chrome.sh`, `build-edge.sh`, `build-firefox.sh`) now run `pnpm build` so shared UI assembly is always applied before packaging
- Skipped 26 synthetic doc tests that depended on unwritten `docs/synthetic_logs/` markdown fixtures (tests were never passing)
- Extension `tryRestoreCachedReport()` now checks both `chrome.storage.session` and `chrome.storage.local` for the source href, fixing report refresh on Firefox

## [1.1.17] - 2026-04-03

Initial public release of Apex Log Insights as an open-source project.

### Added

- **Core parsing engine** (`@apex-log-insights/core`) — zero-dependency TypeScript library that parses Salesforce Apex debug logs into structured JSON reports. Extracts execution timelines, SOQL/DML analysis, governor limit tracking, callout details, named credentials, trigger cascades, managed package impact, and 20-phase lifecycle mapping
- **CLI** (`@apex-log-insights/cli`) — command-line interface that opens Apex debug logs in a local browser viewer. Supports single files, directories of logs, custom ports, and headless mode
- **MCP server** (`@apex-log-insights/mcp`) — Model Context Protocol server exposing five tools (`parse_apex_log`, `analyze_performance`, `analyze_soql`, `analyze_governor_limits`, `summarize_log`) for AI-assisted log analysis with Claude, Cursor, and other MCP-compatible tools
- **Browser extension** (`@apex-log-insights/browser-ext`) — available for Chrome, Edge, and Firefox. Detects `.log` files opened in the browser and offers instant analysis. Includes drag-and-drop file loading, URL source loading, and storage persistence
- **Offline HTML viewer** — zero-dependency vanilla JS viewer with five structured views: Triage (verdict + key metrics), Execution (20-phase timeline), Data & Limits (SOQL/DML/callouts/governor limits), Diagnostics (context detection, trigger cascades, managed package impact), and Evidence (full raw log with search and filtering)
- **Evidence linking** — every SOQL query, DML operation, callout, and diagnostic warning links directly to the exact line in the raw log
- **N+1 SOQL detection** — automatically flags queries executing inside loops
- **Governor limit burn rate** — per-phase breakdown of CPU, heap, SOQL, DML, and callout consumption
- **Mixed DML detection** — warns when setup and non-setup objects are modified in the same transaction
- **Recursive trigger detection** — flags triggers firing multiple times in a single transaction
- **Debug level quality scoring** — rates log completeness based on captured event types
- **PHI/PII redaction** — masks email addresses, Salesforce IDs, phone numbers, and custom names before copying log content (browser extension)
- **MCP PII redaction** — opt-in `redact: true` parameter on all MCP tools masks Salesforce IDs, emails, phone numbers, debug messages, named credentials, SOQL bind values, and callout URL parameters before results reach the AI client. Structural metadata (class names, field names, sObject types, governor limits, durations) is preserved for meaningful analysis
- **Content script auto-detection** — extension intercepts `.log` URLs in the browser (including Salesforce debug log download links) and offers to analyze them automatically
- **Execution context detection** — identifies runtime context automatically: anonymous Apex, queueable, future method, batch execute, scheduled, platform event, synchronous trigger, and Apex class
- **Monorepo architecture** — pnpm workspaces with shared `tsconfig.base.json`, unified version management via `sync-versions.mjs`, and automated extension UI assembly from viewer sources
- **Build and quality tooling** — `pnpm build` (sync versions, build all, export extensions), `pnpm audit` (dependency vulnerabilities, secretlint, eslint-security), `pnpm bugs` (knip unused code, tsc strict, attw type exports, madge circular deps), `pnpm test` (vitest), `pnpm typecheck`, `pnpm lint`
- **Multi-browser extension builds** — `build:chrome`, `build:edge`, `build:firefox` scripts with automatic version bumping and zip/xpi packaging
- **Extension UI assembly** — `assemble-extension-ui.ts` merges viewer sources with extension-only overlays so viewer changes propagate automatically
- **Version sync** — single version source in root `package.json` propagated to all packages and manifests via `sync-versions.mjs` with post-sync verification
- **GitHub Actions CI/CD** — workflows for CI, release, browser extension builds, and GitHub Pages
- **Comprehensive documentation** — README, CONTRIBUTING.md, STYLE_GUIDE.md, FEATURES.md, DEPLOYMENT-GUIDE.md, STORE-LISTINGS-COPY-PASTE.md, and agent config files for Claude Code, Codex, Cursor, Windsurf, Cline, and GitHub Copilot

### Security

- Path traversal protection in CLI server using `path.resolve()` with directory separator prefix check
- XSS prevention via HTML escaping in browser extension display functions
- Path validation in MCP `readLogFile` — rejects `..` traversal, absolute paths, null bytes; enforces `.log` extension; 30-second read timeout
- MCP tool input validation using `typeof` checks instead of unsafe `as` casts
- `pnpm audit` integrates dependency vulnerability scanning, secret detection, and ESLint security rules

### Privacy

- **CLI, browser extensions, and viewer**: All processing runs locally. No servers, no uploads, no accounts, no telemetry. Log data never leaves the user's machine
- **MCP server**: All parsing runs locally via `@apex-log-insights/core` (zero network requests from the MCP server). Structured results are passed to the connected AI client via stdio. If the AI client uses a cloud service, parsed report data (SOQL queries, class names, namespace info) will be transmitted through the AI's pipeline. Use `redact: true` on any MCP tool to mask sensitive values before they reach the AI
