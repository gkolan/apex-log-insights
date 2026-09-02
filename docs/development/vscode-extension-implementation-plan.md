# VS Code extension implementation plan

Status: implemented as a release candidate on 2026-08-17. This document retains the verification sequence used to implement the [VS Code extension specification](vscode-extension-spec.md).

Use this plan as a sequence of independently reviewable changes. Complete the verification gate at the end of a step before starting the next step. If a gate fails, fix or revert that step rather than carrying an unexplained failure forward.

## How to use this plan

For every step:

1. record the starting commit and the files already modified in the worktree;
2. change only the files named by that step unless the implementation exposes a documented dependency;
3. add the test that proves the behavior in the same change;
4. update the documentation named by the step;
5. run the focused checks first, then the step gate;
6. save the commands and results in the pull-request description;
7. do not start the next step until every required result is observable.

An implementation commit should use the lowest affected prefix defined in `CONTRIBUTING.md`. A viewer-bootstrap extraction uses `viewer:`; package scaffolding and VS Code integration use `extension:`; documentation-only refinements use `docs:`.

## Definition of a passed gate

A gate passes only when all of these conditions are true:

- the required automated commands exit with status 0;
- no test is skipped to bypass the new behavior;
- generated files were created only by their owning build script;
- the documented manual observation matches the implementation;
- `git diff --check` reports no whitespace errors;
- `git status --short` contains no unexpected generated, downloaded, or temporary files;
- pre-existing unrelated worktree changes are still present and unmodified;
- the reviewer can identify the test or artifact that proves each acceptance item.

“Build succeeded” is not enough when a step also requires a user interaction, privacy boundary, package-content check, or cleanup behavior.

## Step 0: Establish the implementation baseline

### Purpose

Prevent VS Code work from being mixed with unrelated changes and confirm that the repository is healthy before changing shared viewer code.

### Preconditions

- The product scope in `vscode-extension-spec.md` has been reviewed.
- The contributor has read the required repository guidance listed in `AGENTS.md`.
- No Marketplace publication or Salesforce integration is implied by this implementation.

### Work

1. Record:
   - current branch and commit;
   - Node.js and pnpm versions;
   - `git status --short`;
   - whether dependencies are already installed.
2. Separate or explicitly inventory pre-existing changes. Do not clean, reset, overwrite, or reformat unrelated files.
3. Run the existing health gate without changing generated files:

   ```bash
   pnpm validate
   ```

4. If the gate fails before implementation, record every existing failure. Fix it only if it is in scope; otherwise stop and get the worktree owner to decide whether the VS Code work may proceed on that baseline.
5. Confirm that the current browser UI tests cover the five view labels and that viewer/extension compatibility tests cover generated browser assets. These will protect the bootstrap extraction in Step 2.

### Evidence to retain

- the baseline commit ID;
- the original worktree status;
- complete `pnpm validate` result;
- names of the existing browser UI and viewer compatibility tests.

### Verification gate 0

Do not start Step 1 until:

- the baseline is either fully green or its unrelated failures are explicitly accepted by the repository owner;
- no files changed merely from running validation;
- the intended implementation branch or worktree is known;
- the contributor can restore or compare against the recorded starting state without using a destructive command.

## Step 1: Resolve release identity and platform decisions

### Purpose

Set the public identifiers and compatibility targets that become difficult to change after a `.vsix` is distributed.

### Decisions

Record these values in the specification before scaffolding the package:

| Decision                 | Required outcome                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Package directory        | `packages/vscode-ext/`                                                                                          |
| Workspace package name   | `@apex-log-insights/vscode-ext` unless npm publication needs a different private name                           |
| VS Code extension `name` | Stable Marketplace slug, proposed `apex-log-insights`                                                           |
| VS Code `publisher`      | Confirmed Marketplace publisher ID; do not use a placeholder in a releasable manifest                           |
| Command prefix           | `apexLogInsights`                                                                                               |
| View type                | Stable internal ID, proposed `apexLogInsights.analysis`                                                         |
| Minimum VS Code version  | Oldest version exercised in CI and supporting every stable API used                                             |
| Runtime target           | Desktop extension host, including Remote SSH and Dev Containers; browser-hosted VS Code remains unsupported     |
| Workspace trust behavior | Analysis is available in restricted mode because it only reads a user-selected file and executes packaged code  |
| Extension kind           | Decide `workspace` or ordered `workspace`/`ui` behavior after testing where parsing runs in remote environments |
| Licensing                | MIT, matching the repository                                                                                    |
| Version source           | Root `package.json`; package and manifest versions are synchronized                                             |

### Best-practice checks

1. Search the repository and Marketplace for collisions before fixing the slug and publisher-qualified identifier.
2. Verify that command IDs, view type, storage keys, and context keys all share the same stable `apexLogInsights` namespace.
3. Keep user-facing titles separate from internal identifiers so copy can improve without breaking commands.
4. Do not target a VS Code version merely because it is current. Tie the minimum to APIs used and an automated test version.
5. Document restricted-mode support accurately. Do not declare broad workspace-trust capability before verifying every code path avoids task execution, shell commands, and workspace-provided scripts.
6. Review every public label against the coexistence contract in `vscode-extension-spec.md`. Do not use Certinia's generic **Log:** command prefix or its `lana.*` identifiers.

### Files

- `docs/development/vscode-extension-spec.md`
- this plan, if a decision changes later steps
- an architecture decision record if the repository adopts an ADR directory before implementation

### Verification gate 1

Do not start Step 2 until:

- publisher ID, extension slug, command prefix, view type, minimum VS Code version, and extension-kind policy have concrete values;
- the identifiers contain no placeholders such as `TODO`, `example`, or a personal test publisher;
- restricted-mode behavior has a one-paragraph threat assessment;
- `pnpm format:check` and `pnpm check:docs` pass;
- a maintainer has approved the public identity values.

## Step 2: Extract a reusable viewer bootstrap

### Purpose

Create one supported way to render an already-built offline report. This is the highest-risk shared change, so it must be completed and proven before VS Code-specific code depends on it.

### Design contract

Add a canonical bootstrap with a contract equivalent to:

```javascript
export async function showOfflineReport({
  report,
  rawLines,
  sourceLabel,
  host,
}) {}
```

`host` is a narrow optional adapter for environment-specific operations. It must not expose VS Code APIs to canonical render modules. Define only operations required by an existing interaction, such as requesting evidence navigation or refresh. Browser and CLI adapters may omit it and retain their current behavior.

The extraction must preserve:

- report normalization in `normalize-report.js` and its focused modules;
- the five current view labels and routes;
- existing CLI file loading and Web Worker parsing;
- existing browser-extension loading, persistence, and parsing;
- renderer escaping and evidence filtering;
- viewer preference behavior outside VS Code.

### Work

1. Identify all mutable viewer state initialized by `initializeViewer()`, `render()`, Log Explorer setup, navigation setup, and preference setup.
2. Separate three responsibilities:
   - environment initialization performed once per page;
   - report hydration and rendering performed once per analysis request;
   - source acquisition performed by CLI, browser extension, or future VS Code adapters.
3. Add an explicit report-display entry point under `viewer/modules/`. Use a precise name; do not add format handling outside normalization.
4. Change CLI initialization to fetch and parse the selected file, then call the entry point.
5. Change browser-extension initialization to restore, fetch, or parse its source, then call the same entry point.
6. Keep the viewer's generated-worker and browser-extension generated-file rules unchanged.
7. Add cleanup or reset behavior needed to display a replacement report without stale arrays, caches, searches, or DOM state.
8. Avoid a global `window` function as the public integration contract when an imported module function can express the same boundary.

### Likely files

- `viewer/app.js`
- one new or existing file under `viewer/modules/`
- `packages/browser-ext/shared/app-extension-only.js`
- `scripts/assemble-extension-ui.ts`
- focused tests under `__tests__/`

Do not edit generated `packages/browser-ext/shared/app.js`, `packages/browser-ext/shared/styles.css`, `viewer/apex-parser-worker.js`, or `packages/browser-ext/shared/content/apex-parser-worker.js` directly.

### Tests

Add or update tests that prove:

- an injected committed fixture renders every canonical destination;
- rendering two reports sequentially does not retain the first source name, counts, raw lines, search result, or selected evidence;
- CLI and browser adapters call the shared entry point;
- the browser UI assembly includes the new module in dependency order;
- generated JavaScript remains syntactically valid;
- no render module performs report-version fallback logic.

### Manual verification

1. Run the CLI against a synthetic fixture and exercise all five views.
2. Build one browser extension and load the same fixture.
3. Check a valid **Log line** link in both interfaces.
4. Change theme and supported preferences, reload, and confirm existing persistence behavior.

### Documentation

- update `docs/development/architecture.md` with the source-acquisition versus report-display seam;
- update `CONTRIBUTING.md` and `STYLE_GUIDE.md` if the entry point creates a new maintained invariant;
- update every agent configuration file if architecture or generated-file ownership changes;
- add a `CHANGELOG.md` entry describing the internal preparation without claiming the VS Code extension ships.

### Verification gate 2

Do not start Step 3 until:

- focused viewer, browser UI, and compatibility tests pass;
- `pnpm validate` passes;
- `pnpm build` regenerates valid browser assets;
- CLI and one unpacked browser extension manually render the same fixture through all five views;
- a second report can replace the first without stale state;
- the diff contains no direct edit to a generated file unless the owning build regenerated it;
- architecture and generated-file documentation match the implemented ownership.

## Step 3: Scaffold the VS Code workspace package

### Purpose

Create a minimal installable extension package with no analysis behavior yet. This isolates manifest, build, and packaging decisions from parser and UI work.

### Work

1. Add `packages/vscode-ext/` to the existing `packages/*` workspace pattern.
2. Create its manifest with:
   - approved `name`, `displayName`, `publisher`, version, description, license, repository, bugs, and categories;
   - the approved `engines.vscode` minimum;
   - a bundled `main` entry;
   - `extensionKind` and `capabilities.untrustedWorkspaces` matching Step 1;
   - no activation on startup or wildcard activation;
   - no commands or menus until their handlers exist;
   - a narrow `files` allowlist or `.vscodeignore` for the eventual `.vsix`.
3. Add `src/extension.ts` with `activate()` and `deactivate()` and an output channel disposed through `context.subscriptions`.
4. Add esbuild configuration that outputs one extension-host bundle with source maps for development and a minified production bundle.
5. Mark `vscode` external. Bundle runtime dependencies needed by the host; do not ship the monorepo or depend on workspace symlinks at runtime.
6. Add TypeScript configuration extending `tsconfig.base.json` while including VS Code types only in this package.
7. Add package scripts for typecheck, development build, production build, and package-content inspection. Add `.vsix` packaging only after the publisher value is real.
8. Add the package entry point to `knip.json`, lint inputs, typecheck recursion, root build behavior, and version-sync checks.
9. Add a package README describing the package as under development until analysis works.

### Dependency policy

- Add `@types/vscode` at the same API version as `engines.vscode`.
- Add `@vscode/vsce` as a development dependency only.
- Add `@vscode/test-electron` only when Step 10 introduces extension-host tests.
- Reuse the repository's esbuild and TypeScript versions where compatible.
- Explain every new dependency in the root dependency graph and package README.

### Tests

- import the built extension bundle in a controlled stub and verify it exports `activate` and `deactivate`;
- verify the manifest contains the approved identity and no wildcard activation;
- verify version-sync tooling detects a deliberately mismatched manifest version in a fixture or isolated unit test;
- inspect the production output for unresolved workspace imports.

### Documentation

- `packages/vscode-ext/README.md`
- `README.md` package/interface list and dependency graph
- `CONTRIBUTING.md` repository map and commands
- `docs/development/architecture.md`
- `docs/development/releasing.md`
- all agent configuration files because package structure and commands change
- `CHANGELOG.md`

### Verification gate 3

Do not start Step 4 until:

- package typecheck and production build pass from a clean package `dist/`;
- the built host bundle has no unresolved `@apex-log-insights/*` import;
- the extension manifest has no wildcard activation and contains the approved stable identity;
- version synchronization includes the new manifest and its mismatch test passes;
- package-content inspection contains only intended manifest, README, license, icon, and `dist/` files;
- `pnpm validate` and `pnpm build` pass;
- installing the skeletal `.vsix` in a clean Extension Development Host produces no activation error.

## Step 4: Implement source selection and validation

### Purpose

Make the three entry paths resolve exactly one eligible source without parsing or opening a webview.

### Source precedence

Use one resolver with this precedence:

1. an explicit resource URI passed by the Explorer context menu;
2. the active text editor's document URI and in-memory text;
3. a URI returned by the explicit file-picker command.

Never let an Explorer invocation silently analyze the active editor instead of the selected file.

### Work

1. Add command contributions only when registering their handlers:
   - `apexLogInsights.analyzeActiveLog`;
   - `apexLogInsights.analyzeLogFile`.
2. Add precise `when` clauses for editor-title and Explorer context menus. Treat these as discoverability filters, not security checks.
3. Validate again in the handler:
   - URI identifies a file, not a directory;
   - path ends with `.log`, case-insensitively;
   - scheme is supported by `workspace.fs` or corresponds to an open text document;
   - byte size is at most 25 MiB (`25 * 1024 * 1024`), with the unit stated consistently in UI and docs;
   - text is read as UTF-8 with a documented policy for malformed bytes.
4. For an open text document, use `document.getText()` and `document.isDirty`; do not save automatically.
5. For a URI without an open document, use `workspace.fs.stat()` and `workspace.fs.readFile()` rather than Node `fs` so remote file systems work.
6. Return a normalized source object containing URI, base file name, encoded byte length, text, version or modification marker, and dirty state.
7. Zero or release large byte buffers as soon as practical after decoding; do not cache raw text globally.
8. Show actionable messages for wrong suffix, directory, unreadable URI, malformed content, and oversize input. Do not log the text.
9. Add an independently implemented bounded Apex debug-log detector:
   - inspect at most 100 lines or 64 KiB;
   - measure exact UTF-8 content bytes and the source's actual LF, CRLF, or CR separators, without charging a separator to an unterminated final line;
   - stop scanning within the byte budget even when the first line is pathologically large;
   - recognize strong structural markers such as the debug-level header, `EXECUTION_STARTED`, or `USER_INFO`;
   - use detection to control contextual discoverability, not as a replacement for handler validation;
   - allow an explicit picker/Command Palette invocation to continue after a warning when a `.log` file lacks a recognized prefix.
10. Register a top-of-file **Analyze with Apex Log Insights** CodeLens for detected logs. CodeLens resolution must not parse the full file or start analysis.

### Tests

- explicit Explorer URI wins over the active editor;
- dirty active document text wins over on-disk bytes;
- mixed-case `.LOG` is accepted;
- `.log.txt`, directories, unsupported schemes, and missing files are rejected;
- exact 25 MiB is accepted and one byte over is rejected;
- multibyte UTF-8 is measured by encoded bytes rather than JavaScript character count;
- the report worker recomputes bytes from its actual text, rejects empty input, and does not accept caller-controlled size metadata;
- malformed worker requests with a usable request ID return a correlated typed error without coercing fields or waiting for timeout; envelopes without a usable ID are ignored;
- canceling the file picker produces no message and no state change;
- remote-style URIs are read through the VS Code file-system abstraction.
- content detection stops at its line/byte bound and does not parse the full file;
- detection boundary tests cover LF, CRLF, CR, an unterminated final line, multibyte Unicode, and a single line that crosses the byte cap;
- contextual menus and CodeLens stay hidden for an unrelated `.log` file;
- explicit analysis can continue after the unrecognized-content warning;
- CodeLens invokes the command with the document URI rather than relying on whichever editor is active.
- manifest and UI-label tests require **Apex Log Insights** in every public command, CodeLens, panel, progress, and output-channel label;
- no contributed command, context key, view type, setting, or storage key begins with `lana.` or uses the generic **Log:** prefix.

### Verification gate 4

Do not start Step 5 until:

- all source-resolver tests pass;
- bounded detector and CodeLens tests pass;
- parser-client tests prove that clean and nonzero worker exits plus malformed active-request responses settle an unanswered request immediately, while responses for unrelated request IDs remain isolated;
- the two commands appear only in their intended locations;
- manual tests select the correct file when another `.log` editor is active;
- an unsaved editor returns its in-memory content without saving;
- boundary-size tests prove the exact byte contract;
- diagnostics contain no raw text;
- package typecheck, lint, and `pnpm validate` pass.

## Step 5: Add the parser worker and cancellation contract

### Purpose

Generate the canonical offline report without blocking the extension-host event loop.

### Worker protocol

Define discriminated messages in one shared TypeScript module:

```typescript
type ParseRequest = {
  type: "PARSE_LOG";
  requestId: string;
  fileName: string;
  logText: string;
};

type ParseResponse =
  | {
      type: "PARSE_RESULT";
      requestId: string;
      ok: true;
      report: OfflineReportV2;
    }
  | {
      type: "PARSE_RESULT";
      requestId: string;
      ok: false;
      error: { code: string; message: string };
    };
```

Do not include a source URI in messages returned by the worker. The controller already owns the trusted URI association.

### Work

1. Bundle a separate Node worker entry that imports public exports from `@apex-log-insights/core`.
2. Call `parseLog()` with:
   - `sourceName: fileName`;
   - `sourceType: "file"`;
   - `includeRawLines: true`;
   - `enablePhaseInference: true`.
3. Call `buildOfflineReport()` with the same source name, encoded byte length, generation timestamp, parse result, and raw text.
4. Add a controller that owns exactly one active worker per panel/request.
5. Generate opaque request IDs in the host. Accept a response only when it matches the current request.
6. Wire cancellation from `window.withProgress()` to worker termination.
7. Terminate at 120 seconds and distinguish timeout, cancellation, worker crash, parser failure, and stale response.
8. Make cleanup idempotent: completion, cancellation, timeout, panel disposal, and extension deactivation may race.
9. Keep error messages content-free. A parser stack may go to the development channel only when it cannot contain input text; otherwise log the error class and code.

### Tests

- committed synthetic fixture produces `reportVersion: "3.0.0"` and expected source metadata;
- a timer/heartbeat proves parsing does not execute on the host event loop;
- cancellation terminates the worker and resolves as canceled;
- timeout terminates the worker exactly once;
- a stale response cannot replace a newer result;
- worker crash and parser error produce different stable error codes;
- dispose during parse releases listeners and worker references;
- report output matches direct core invocation for the same fixture after excluding generated timestamps and measured parse duration.

### Verification gate 5

Do not start Step 6 until:

- worker and controller tests pass under fake-timer and real-worker coverage where appropriate;
- a synthetic log produces the canonical report without blocking a host responsiveness probe;
- cancellation, timeout, stale-response, and dispose tests prove cleanup;
- the production package contains the worker bundle at the URI resolved by the host bundle;
- the worker bundle has no unresolved workspace dependency;
- `pnpm validate` and a clean package build pass.

## Step 6: Build the secure webview shell

### Purpose

Open an empty analysis panel whose resources and communication boundary are secure before sending any report content into it.

### Work

1. Add a panel registry keyed by canonical source URI string. Reuse and reveal an existing panel for the same source; allow separate panels for separate sources.
2. Create the panel only after source validation succeeds. Open it beside the source editor when possible.
3. Configure:
   - `enableScripts: true`;
   - `enableCommandUris: false` or omit it;
   - `localResourceRoots` containing only `dist/webview/`;
   - `retainContextWhenHidden: false` unless measurement proves it necessary.
4. Generate a cryptographically strong nonce for each HTML document.
5. Add a Content Security Policy with:
   - `default-src 'none'`;
   - scripts restricted to the nonce;
   - styles restricted to the webview source, with inline style allowed only if canonical viewer behavior demonstrably requires it and the exception is documented;
   - images restricted to packaged resources and necessary `data:` images only;
   - `connect-src 'none'`;
   - `frame-src 'none'`, `object-src 'none'`, and `base-uri 'none'`.
6. Convert every packaged URI with `webview.asWebviewUri()`; do not hard-code legacy `vscode-resource:` URIs.
7. Add a minimal adapter that calls `acquireVsCodeApi()` once, posts `READY`, and handles no report yet.
8. Register message listeners before setting HTML or before any host post. Queue the latest host state until `READY` avoids a startup race.
9. Dispose panel, listeners, source watchers, worker, and registry entry together.
10. Render the panel shell immediately after source validation. Show a textual **Analyzing log…** status and layout skeleton while parsing; the skeleton must respect reduced-motion preferences.
11. For request/response bridge operations, keep a bounded pending-request map and remove each entry on success, failure, cancellation, timeout, reload, and disposal.

### Tests

- CSP parser test confirms all required directives and rejects `http:`, `https:`, wildcard sources, `unsafe-eval`, and unrestricted inline scripts;
- each script tag has the current nonce;
- local resource roots contain only packaged webview assets;
- generated HTML contains no raw filesystem path;
- adapter acquires the VS Code API exactly once;
- host waits for `READY` before posting state;
- same URI reuses one panel; different URIs create different panels;
- dispose is idempotent and empties the registry.
- loading status is announced and skeleton controls are not interactive;
- every pending bridge request is removed in each terminal state.

### Manual security review

Open the webview developer tools and confirm:

- no network request is made;
- no CSP violation occurs during normal initialization;
- no resource is loaded from the workspace or source-log directory;
- copying a crafted source name containing markup displays text rather than creating markup.

### Verification gate 6

Do not start Step 7 until:

- all CSP, HTML, panel-registry, startup-race, and disposal tests pass;
- manual developer-tools inspection shows zero network requests and zero unexplained CSP violations;
- the shell loads from a packaged `.vsix`, not only from the repository;
- the panel opens only after an explicit command;
- the panel displays its loading shell before a deliberately delayed parser completes;
- closing it releases the registry entry and subscriptions;
- `pnpm validate` passes.

## Step 7: Assemble and render the canonical viewer

### Purpose

Display the worker-produced report through the shared report-display entry point without introducing a VS Code renderer fork.

### Work

1. Add a VS Code webview assembly script that:
   - reads canonical viewer HTML, JavaScript modules, and styles from their maintained locations;
   - excludes CLI/browser source-acquisition initialization;
   - adds `vscode-adapter.js` and `vscode.css` last;
   - writes generated output only to `packages/vscode-ext/dist/webview/`;
   - fails on a missing source marker, duplicate declaration, unresolved import, or invalid JavaScript.
2. Prefer an ESM webview bundle if it preserves canonical module boundaries. Do not duplicate the browser extension's plain-script transformation unless a measured constraint requires it.
3. Send `SHOW_REPORT` only after `READY`. Include the report and display-only source metadata; do not include a URI.
4. In the adapter, validate the message shape, call the canonical report-display entry point, and retain only state needed by the current panel.
5. Replace browser-specific loading, file sidebar, upload, comparison, service-worker, and local-server behaviors with absent or disabled states rather than dead controls.
6. Keep all five views, normalization, Log Explorer search/filtering, redaction-before-copy behavior, and evidence buttons.
7. Add VS Code theme overrides using documented `--vscode-*` variables. Remove the viewer theme toggle in this host and respond to theme changes without reloading the report.
8. Preserve accessibility roles, labels, tab order, visible focus, high-contrast boundaries, and zoom.
9. If a canonical viewer change is needed, make it host-capability based; do not test `window.location` or VS Code-specific globals in render modules.
10. Preserve current lazy/capped rendering and add a near-limit measurement. If Log Explorer or another view creates DOM proportional to the complete log, virtualize that view before release.

### Tests

- assembly includes every canonical module imported by the report-display entry point;
- assembly includes exactly the five canonical labels and omits disabled CLI/browser controls;
- generated assets parse successfully and contain no unresolved relative imports;
- a committed report fixture renders the same key values in standalone viewer and VS Code webview DOM tests;
- rendering a hostile file name, SOQL string, exception, and raw line does not create an element or event handler;
- changing theme classes/variables changes presentation without mutating report state;
- first render and replacement render leave no stale content;
- package-content test confirms every referenced URI exists with matching case.
- near-limit DOM counts and interaction latency remain within the performance budget declared before measurement.

### Manual verification

Exercise all five views with a small synthetic fixture and a large synthetic fixture. Verify keyboard-only navigation, 200% zoom, dark, light, high-contrast, narrow editor column, search, filtering, and redaction copy.

Install Certinia Apex Log Analyzer alongside the development build. Open one detected Apex debug log and verify that Command Palette, CodeLens, context menu, editor-title tooltips, panel titles, output channels, and progress notifications identify which product will handle each action. Invoking either extension must not reveal, replace, focus, or mutate the other extension's panel.

### Verification gate 7

Do not start Step 8 until:

- canonical parity, hostile-content, asset-graph, theme, and replacement-render tests pass;
- the assembled webview contains no parsing or report-shape compatibility logic;
- all five views work from a packaged `.vsix` without a local server;
- keyboard-only, zoom, and high-contrast manual checks have recorded results;
- CLI and browser interfaces still pass their focused compatibility tests;
- the two-extension coexistence check shows distinct labels and independent panels;
- `pnpm validate` and `pnpm build` pass.

## Step 8: Implement exact Log line navigation

### Purpose

Deliver the editor-native value of the extension while keeping the source URI under host control.

### Work

1. Add a host capability to canonical evidence controls so the VS Code adapter posts `OPEN_LOG_LINE` instead of performing browser hash navigation when appropriate.
2. Keep the message payload to `{ type, lineNumber }`. Do not accept a path, URI, column, selection, or command from the webview.
3. Validate that `lineNumber` is a finite positive integer.
4. Resolve the source exclusively from the panel controller.
5. Reopen the source with `workspace.openTextDocument(panel.sourceUri)` if needed.
6. Recheck the line against the current document:
   - if the exact 1-based line exists, convert to VS Code's 0-based `Position`;
   - if it does not exist, show a non-modal warning and do not clamp to a different line.
7. Show the document beside the analysis panel where layout permits, set a zero-width selection at the line's first non-whitespace character or column zero, reveal it in the center, and preserve focus semantics that work with keyboard activation.
8. Treat **Apex source line** as non-clickable unless a separate source-mapping feature is later specified.
9. If the source was deleted, keep the report visible and disable further navigation with an explanatory status.

Keep reverse raw-log-to-analysis navigation out of the MVP implementation, but reserve a host message and selection-synchronization design that can add it without changing the report schema. Use a line-number identity and an echo guard; do not adopt timestamp-based whole-file rescanning.

### Tests

- line 1 and final line open exactly;
- line 0, negative, fractional, `NaN`, infinite, string, and beyond-end values are rejected;
- the webview cannot navigate to a URI embedded in a forged message;
- a valid line opens the controller-owned source even when another editor is active;
- deletion produces the documented disabled state;
- **Apex source line** does not emit `OPEN_LOG_LINE`;
- activation by Enter and Space follows the same path as pointer activation.

### Manual verification

Use a fixture containing an item with both an Apex source line and raw-log evidence. Confirm the two columns remain distinct and only **Log line** opens the raw log at the exact matching text.

### Verification gate 8

Do not start Step 9 until:

- all navigation and forged-message tests pass;
- manual verification confirms the revealed text exactly matches the evidence text in the report;
- invalid lines never open a nearby line;
- another active editor cannot redirect navigation;
- source deletion leaves the report usable and explains the limitation;
- `pnpm validate` passes.

## Step 9: Add freshness, refresh, and error recovery

### Purpose

Keep a report understandable when its source changes and make reparsing explicit, cancellable, and race-safe.

### Freshness contract

Capture a source revision when parsing begins:

- for an open document, use URI plus `document.version` and dirty state;
- for a closed resource, use URI plus `FileStat.mtime` and size, recognizing that these are a change hint rather than a content identity.

The panel becomes stale when the open document version changes or a watched file event affects the source. It does not automatically parse.

### Work

1. Subscribe only to changes relevant to panels that currently exist.
2. Send `SOURCE_CHANGED` once per transition from current to stale.
3. Show **Source changed — refresh analysis** without removing the last successful report.
4. Add `apexLogInsights.refreshAnalysis` and a webview refresh action.
5. On refresh:
   - acquire the source again using Step 4 rules;
   - cancel any active request;
   - start a new request ID;
   - keep the previous report visible with an analyzing status;
   - replace it only after success;
   - clear the stale state only if the completed request matches the latest source revision.
6. On refresh failure, retain the prior report, label it stale, and show an inline error plus a retry action.
7. On initial failure before any report exists, show a VS Code error notification and a content-free empty state.
8. Dispose document and file watchers with the panel.
9. Ensure deactivation terminates all active workers and disposes every controller.

### Tests

- edit marks a panel stale but does not invoke the parser;
- repeated edits send one stale transition rather than repeated UI messages;
- refresh uses dirty in-memory content;
- refresh of a closed document rereads through `workspace.fs`;
- successful refresh clears stale state;
- failed refresh retains the previous report and exposes retry;
- change during refresh leaves the completed report marked stale;
- two rapid refreshes show only the second result;
- panel disposal removes change watchers;
- extension deactivation cancels all workers.

### Verification gate 9

Do not start Step 10 until:

- all freshness, retry, race, watcher, and deactivation tests pass;
- manual editing shows a stale notice without automatic CPU activity;
- refresh of an unsaved document visibly changes the report and never saves the file;
- refresh failure preserves the previous report;
- output-channel inspection contains no raw lines or report JSON;
- `pnpm validate` passes.

## Step 10: Build the full automated test pyramid

### Purpose

Prove behavior at the cheapest responsible layer and reserve Extension Host tests for VS Code integration that cannot be verified in ordinary unit tests.

### Unit and component tests

Cover:

- source resolution and size rules;
- message narrowing and hostile inputs;
- worker lifecycle and request races;
- panel registry and disposal;
- CSP and resource generation;
- viewer assembly and DOM parity;
- source revision and stale-state transitions;
- content-free diagnostic formatting.

Keep VS Code API calls behind narrow adapters so most controller behavior runs with small fakes rather than a full Electron host.

### Extension Host tests

Add `@vscode/test-electron` and test against the minimum supported VS Code version plus the current stable version in CI where practical.

Required scenarios:

1. Activate by invoking a contributed command, not by importing private modules.
2. Analyze the active synthetic `.log` document.
3. Analyze an Explorer-provided URI while another log is active.
4. Analyze unsaved text and display **Unsaved content**.
5. Open exact evidence at the correct 1-based line.
6. Mark the report stale after an edit without reparsing.
7. Refresh and consume the changed in-memory text.
8. Cancel a deliberately delayed worker and observe no late report.
9. Close during parsing and observe resource cleanup.
10. Reject an oversize fixture generated during the test without committing a 25 MB file.
11. Inspect all contributed UI labels and verify that they contain the Apex Log Insights product name where the coexistence contract requires it.

### Cross-platform and remote coverage

- Run unit, type, lint, and package-content tests on Linux in the normal health gate.
- Run Extension Host smoke tests on at least Linux; add Windows and macOS before Marketplace release if release infrastructure supports them.
- Perform one documented Remote SSH or Dev Container smoke test before release because local Extension Host tests do not prove remote placement and URI behavior.
- Do not claim Codespaces support until the exact desktop-client flow is exercised.

### Test hygiene

- use synthetic fixtures only;
- isolate VS Code user data and extensions directories;
- close editors and panels created by each test;
- terminate child Electron processes on failure;
- avoid real timeouts when fake timers or injectable clocks prove the same branch;
- retain screenshots only for a failed UI test and keep them out of version control;
- never skip a platform test silently; identify the missing runner or tracked issue.

### Documentation

Update `docs/development/testing.md` with focused commands, test ownership, supported platforms, and the difference between unit, DOM, Extension Host, package, and manual remote checks.

### Verification gate 10

Do not start Step 11 until:

- every required Extension Host scenario passes from a clean test profile;
- unit tests cover every message variant and lifecycle terminal state;
- tests leave no Electron process, temp fixture, panel, or generated file behind;
- the minimum and current VS Code versions used by CI are recorded;
- one remote-environment smoke result is recorded before claiming remote support;
- coverage remains above repository floors;
- `pnpm validate` and the new VS Code-specific test command pass independently.

## Step 11: Complete privacy, accessibility, and performance reviews

### Purpose

Verify qualities that individual feature tests cannot fully establish.

### Privacy review

Trace one raw log from selection through disposal and document every memory/process boundary:

1. VS Code document or `workspace.fs` bytes;
2. normalized source object;
3. parser worker message;
4. core parse result and offline report;
5. host-to-webview message;
6. webview state and copy operation;
7. disposal and garbage-collection eligibility.

Confirm there is no network request, telemetry, persistence, temp file, clipboard write without a user action, or raw-content logging. Repeat in one remote environment and state where the extension host runs.

### Security review

- inspect the final CSP and packaged HTML;
- send forged webview messages for every rejected shape;
- render markup, script, event-handler, URL, and CSS payloads in file names and report strings;
- inspect dependency audit results;
- inspect the `.vsix` for secrets, source maps, fixtures, archives, and unrelated repository files;
- confirm no workspace script, executable, task, shell, or command URI is invoked.

### Accessibility review

- keyboard-only navigation through every interactive control;
- screen-reader name and role checks for tabs, status, refresh, errors, and evidence links;
- 200% and 400% zoom checks;
- light, dark, high-contrast dark, and high-contrast light themes;
- reduced-width editor and long unbroken log lines;
- focus restoration after refresh and after returning from a revealed log line;
- no color-only stale, warning, or error state.

### Performance review

Use at least small, representative, and near-limit synthetic or sanitized inputs. Record:

- extension activation time before a command;
- source-read time;
- parse and report time;
- time from report receipt to interactive webview;
- peak extension-host and worker memory when observable;
- time to cancel and worker exit;
- Log Explorer search responsiveness;
- panel reopen and refresh behavior.

Do not invent pass thresholds after observing results. Before measuring, set budgets based on existing parser behavior and user tolerance. At minimum, activation must remain lazy, the host must remain responsive during parse, cancellation must terminate promptly, and the near-limit input must either complete inside 120 seconds or fail with the documented timeout.

### Verification gate 11

Do not start Step 12 until:

- the privacy trace has no unexplained storage or transmission;
- the final `.vsix` makes no network request during install, activation, analysis, navigation, or refresh;
- hostile-content and forged-message checks pass;
- keyboard, screen-reader, zoom, and high-contrast results are recorded with no release-blocking defect;
- performance measurements meet the predeclared budgets or the product limit is adjusted and documented;
- dependency audit reports no release-blocking vulnerability;
- all discovered defects are fixed or explicitly removed from the claimed release scope.

## Step 12: Integrate build, version, and package verification

### Purpose

Make a reproducible `.vsix` from the monorepo without changing the selected version during a normal build.

### Work

1. Add root commands with one responsibility each, for example:
   - `dev:vscode` for watch builds;
   - package-local `build` for host, worker, and webview assembly;
   - package-local `test:extension` for Extension Host tests;
   - package-local `package:vsix` for a version-preserving `.vsix`;
   - a package-content verification command.
2. Ensure root `pnpm build` builds the VS Code package at the current root version and never increments it.
3. Extend `scripts/sync-versions.mjs` and `scripts/check-version-sync.ts` to cover the VS Code manifest and any displayed version marker.
4. Make `.vsix` output deterministic where the tooling permits and name it with the package version.
5. Verify package contents after creation:
   - no `node_modules` unless a deliberate runtime dependency cannot be bundled;
   - no source maps in the release artifact unless intentionally published;
   - no tests, fixtures, logs, reports, browser archives, audit output, or repository metadata;
   - all webview resources referenced by the HTML exist;
   - host and worker bundles contain their required code;
   - license, README, icon, and manifest are present.
6. Install the exact generated `.vsix` into a clean profile and repeat the critical user path.
7. Add artifact cleanup that targets the explicit package output directory and does not delete unrelated release files.

### Documentation

- `CONTRIBUTING.md`
- `README.md`
- `packages/vscode-ext/README.md`
- `docs/development/releasing.md`
- relevant agent configuration files
- `CHANGELOG.md`

### Verification gate 12

Do not start Step 13 until:

- two clean builds at the same version produce equivalent package contents, allowing documented archive metadata differences;
- `pnpm build` does not change any version;
- version mismatch is detected and version synchronization fixes it;
- package inspection finds only allowlisted content;
- the exact `.vsix` installs and analyzes a fixture in a clean profile;
- uninstalling removes extension files and no log/report persistence remains in VS Code storage;
- all documented build commands exist and match observed output;
- `pnpm validate`, full build, VS Code tests, audit, and bug report pass.

## Step 13: Finish user and maintainer documentation

### Purpose

Describe only behavior proven by the packaged extension and keep one source of truth per topic.

### User documentation

Update:

- root `README.md` interface and installation overview;
- `docs/user-guides/getting-started.md` with installation and the three entry paths;
- `docs/user-guides/privacy.md` with local and remote process boundaries, in-memory retention, copy behavior, and no-network claim;
- `docs/user-guides/troubleshooting.md` with file eligibility, size, timeout, stale source, webview reload, and output-channel guidance;
- `packages/vscode-ext/README.md` with commands, supported environments, limitations, development, and packaging;
- `FEATURES.md` with the shipped VS Code capability;
- `CHANGELOG.md` in Keep a Changelog format.

### Maintainer documentation

Update:

- `CONTRIBUTING.md` repository map, commands, package ownership, and test gate;
- `STYLE_GUIDE.md` only for new enduring conventions;
- `docs/development/architecture.md` for host, worker, report, webview, and evidence-navigation boundaries;
- `docs/development/testing.md` for VS Code test classes;
- `docs/development/releasing.md` for `.vsix` build, inspection, smoke test, and publication prerequisites;
- `docs/reference/terminology.md` with **VS Code extension** as an interface name and any new user-visible status labels;
- every agent configuration file if package structure, commands, or critical ownership rules changed.

### Documentation verification

For every command, run it from the documented directory. For every local link, use the documentation checker. For every privacy statement, compare it against the Step 11 trace. Mark Marketplace publication as unavailable until it actually occurs.

### Verification gate 13

Do not start Step 14 until:

- every user-facing label matches the installed extension;
- every command and path in documentation has been exercised;
- privacy text distinguishes local, remote, webview, clipboard, and AI/MCP boundaries;
- planned browser-host and Salesforce-download behavior is clearly marked as out of scope;
- no page claims Marketplace availability before publication;
- `pnpm format:check`, `pnpm check:docs`, and `pnpm validate` pass;
- a contributor unfamiliar with the implementation can follow the README to build, install, analyze, navigate, refresh, and uninstall.

## Step 14: Run the release candidate gate

### Purpose

Evaluate one immutable candidate artifact rather than rebuilding different artifacts during review.

### Candidate procedure

1. Confirm the worktree contains only intended release changes and expected generated artifacts.
2. Select the semantic version in root `package.json` and synchronize it.
3. Run, in order:

   ```bash
   pnpm validate
   pnpm test:coverage
   pnpm audit
   pnpm build
   pnpm bugs:report
   ```

4. Run the maintained-source Salesforce Code Analyzer scan when available, following `docs/development/releasing.md`.
5. Run the VS Code Extension Host test command against the built extension.
6. Create the `.vsix` once and record its path, size, and SHA-256 digest.
7. Inspect its contents and install that exact digest in clean profiles on the release platforms.
8. Exercise:
   - active editor analysis;
   - Explorer analysis with a different active file;
   - file picker analysis;
   - all five views;
   - exact Log line navigation;
   - unsaved-content label;
   - stale state and refresh;
   - cancellation;
   - oversize rejection;
   - source deletion behavior;
   - uninstall and storage inspection.
9. Perform one remote-environment smoke test using the same `.vsix`.
10. Review README, changelog, privacy text, icon, display name, categories, and Marketplace copy against the candidate.
11. Install Certinia Apex Log Analyzer in the clean coexistence profile and verify distinct commands, CodeLens text, menu labels, tooltips, panels, and output channels.

### Stop conditions

Reject the candidate if:

- any required command fails;
- packaging changes the version or source tree unexpectedly;
- the installed artifact differs from the recorded digest;
- a raw log or report appears in storage, logs, telemetry, temp files, or network traffic;
- exact evidence navigation opens the wrong line;
- the extension blocks the host during parse;
- cancel, timeout, close, or deactivate leaves a worker running;
- the packaged webview depends on a repository file or local server;
- documentation claims more platform support than was tested.

### Verification gate 14

The implementation is release-ready only when:

- every candidate command and manual scenario passes against the recorded `.vsix` digest;
- all audit, analyzer, test, package, privacy, accessibility, and performance evidence is attached to the release review;
- no open release-blocking defect remains;
- a maintainer approves the candidate for distribution.

Marketplace publication is a separate authorized action. Do not publish merely because this gate passes.

## Step 15: Publish and verify distribution

### Purpose

Publish only after explicit maintainer authorization and verify the public artifact without assuming that a successful upload means a usable release.

### Work

1. Confirm the publisher account, authentication method, listing, privacy disclosure, support link, and release notes.
2. Publish the already-approved version through the repository's documented release workflow. Do not rebuild source between candidate approval and publication.
3. Record the Marketplace item URL, version, publication timestamp, and returned artifact identity.
4. Install from the Marketplace into a clean profile and repeat the smallest successful path plus exact evidence navigation.
5. Compare the installed Marketplace version and package contents with the approved candidate to the degree supported by the distribution tooling.
6. Create the GitHub release or attach the `.vsix` only if the release procedure calls for it.
7. Update documentation from “planned” or manual `.vsix` installation to Marketplace installation only after the listing is publicly reachable.
8. Monitor installation and activation failures without collecting log content. If a critical defect affects privacy, data integrity, host stability, or evidence correctness, stop promotion and follow the documented rollback or replacement-release procedure.

### Verification gate 15

The release is complete only when:

- the public listing resolves and shows the intended version and publisher;
- Marketplace installation succeeds in a clean profile;
- the installed extension analyzes a synthetic log and opens exact evidence;
- public documentation links to the correct listing and version-neutral instructions;
- release notes and changelog match the shipped artifact;
- any credentials used for publication remain only in approved secret storage.

## Cross-step review checklist

Apply this checklist at every gate, not only before release.

### Architecture

- Is the defect or behavior implemented at the lowest owning layer?
- Does the VS Code package avoid parsing, analysis, and report-format forks?
- Does one maintained viewer source still feed every browser-like interface?
- Are generated files clearly marked and produced only by scripts?

### Lifecycle

- Who owns each worker, listener, panel, buffer, report, and timer?
- What happens on success, failure, cancellation, timeout, refresh, close, reload, and deactivation?
- Can a late asynchronous result overwrite newer state?

### Security and privacy

- Is every webview message treated as untrusted?
- Can the webview select a URI or execute a command?
- Is raw content absent from storage, logs, network requests, and errors?
- Does the CSP allow only what the packaged UI demonstrably needs?
- Are remote-environment claims precise about where processing occurs?

### User experience

- Is analysis always user-initiated?
- Does the UI state whether content is unsaved or stale?
- Does a failed refresh preserve a useful previous report?
- Does **Log line** always mean a clickable raw-file coordinate?
- Can every action be completed by keyboard and understood without color?

### Verification

- Does each behavior have a focused automated test at the correct layer?
- Was the packaged artifact, rather than only source mode, exercised?
- Did the step update all mandatory documentation?
- Are test output, manual observations, and artifact identifiers recorded?

## Related

- [VS Code extension specification](vscode-extension-spec.md)
- [VS Code release review](vscode-extension-release-review.md)
- [Testing and quality gates](testing.md)
