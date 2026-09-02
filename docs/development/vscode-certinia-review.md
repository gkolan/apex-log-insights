# Certinia Apex Log Analyzer review

Reviewed: 2026-08-17. The review used Certinia's public `main` branch, product documentation, and Marketplace-facing feature descriptions. This is a design comparison, not a dependency proposal. Do not copy Certinia source code; use independently implemented patterns that fit Apex Log Insights' architecture and license.

## Why this project matters

Certinia's [Apex Log Analyzer](https://github.com/certinia/debug-log-analyzer) is an established VS Code extension for the same source material. It has already exercised editor entry points, large-log interaction, bidirectional navigation, packaging, and VS Code-specific raw-log features. Its product scope is performance exploration through flame charts and call trees, while Apex Log Insights is organized around a canonical report and five investigation views. We should reuse interaction lessons without replacing our parser, report, terminology, or shared viewer.

The public [getting-started guide](https://certinia.github.io/debug-log-analyzer/docs/gettingstarted) documents five ways to analyze an open log: Command Palette, CodeLens, editor context menu, editor toolbar, and editor-tab context menu. Its [feature guide](https://certinia.github.io/debug-log-analyzer/docs/features) documents timeline and call-tree navigation, global search, raw-log navigation, folding, line decorations, hover details, and CSV export.

## Source architecture observed

The repository is split into three relevant workspaces:

| Certinia location  | Responsibility                                      | Apex Log Insights analogue                 |
| ------------------ | --------------------------------------------------- | ------------------------------------------ |
| `apex-log-parser/` | Apex debug-log parsing and event tree               | `packages/core/`                           |
| `log-viewer/`      | Bundled VS Code webview                             | canonical `viewer/` plus a VS Code adapter |
| `lana/`            | VS Code activation, commands, providers, and bridge | proposed `packages/vscode-ext/`            |

That separation supports our existing decision to keep VS Code APIs out of parser/report code and keep editor integration in its own package.

## Ideas to adopt in the first release

### Detect content, not only the suffix

Certinia checks a bounded prefix for characteristic Apex debug-log lines, including a debug-level header, `EXECUTION_STARTED`, and `USER_INFO`. It checks at most the first 100 lines and limits unopened-file probing to a small byte prefix.

Adopt the bounded-detection pattern with our own independently written detector:

- keep `.log` as the supported MVP suffix;
- inspect at most the first 100 lines or 64 KiB, whichever comes first;
- accept a file when at least one strong marker is present;
- let an explicit Command Palette/file-picker action analyze a `.log` with an unrecognized header after warning that it may not be an Apex debug log;
- hide contextual menu and CodeLens entry points when content detection fails;
- test CRLF, a debug-level header before events, leading blank lines, truncated logs, and files whose first event appears near the detection boundary.

This avoids presenting the command on unrelated application logs while preserving an escape hatch for unusual Salesforce output.

### Add a top-of-file CodeLens

Certinia places **Show Apex Log Analysis** at the top of a detected log. This is useful because it appears at the place developers already inspect, without opening a view automatically.

Add **Analyze with Apex Log Insights** as an MVP CodeLens when:

- the document is detected as an Apex debug log;
- the document scheme is supported;
- no analysis is triggered merely by providing the lens.

CodeLens resolution must remain cheap. It may use bounded content detection, but it must not parse the complete log. The Command Palette, editor title, Explorer context menu, and file picker remain available as specified.

### Show the panel immediately with a loading skeleton

Certinia renders skeleton states while a log is retrieved or parsed. Our original plan created the panel after validation but did not require a meaningful analysis shell before parsing completed.

Adopt this sequence:

1. validate and read the selected source;
2. open or reveal its panel;
3. render the five-view shell with an **Analyzing log…** status and non-interactive skeletons;
4. run the parser worker;
5. atomically replace skeleton state with the report;
6. replace it with a retryable empty state on initial failure.

The skeleton should approximate final layout, respect reduced motion, and expose a textual live status. Do not animate a full-screen spinner indefinitely.

### Use request IDs for bridge calls

Certinia's webview messenger assigns a random request ID to request/response calls and deletes its listener after resolution. Our plan already uses analysis request IDs; extend the idea to every bridge operation that expects a response.

The Apex Log Insights bridge should:

- use discriminated messages plus request IDs;
- keep one pending-map entry per request;
- delete entries on success, failure, cancellation, timeout, panel disposal, and webview reload;
- reject duplicate or unknown response IDs;
- apply a bounded timeout so a missing host response cannot leave a promise pending forever;
- accept unsolicited state messages only from a separate enumerated set.

### Preserve bidirectional context

Certinia supports analysis-to-log and log-to-analysis navigation. Exact analysis-to-log navigation remains an MVP requirement for Apex Log Insights. Add the reverse direction as the first post-MVP editor enhancement:

- a hover or editor action on a recognized raw-log line offers **Show in Apex Log Insights**;
- the host maps the line to the canonical report's evidence index;
- the existing panel is revealed or analysis starts if no current report exists;
- the webview opens Log Explorer and selects the exact raw-log line;
- an echo guard prevents analysis selection and editor selection from repeatedly triggering each other.

Use raw-log line numbers as the primary identity. Certinia often navigates by timestamp because its parser model is timestamp-centered; Apex Log Insights already has canonical 1-based evidence coordinates, which are more direct and also cover non-timestamp lines.

### Use VS Code providers as progressive enhancement

Certinia adds folding ranges, document symbols, hover metrics, CodeLens, and inline duration decorations. These features make a raw `.log` document useful even when the analysis panel is not visible.

Adopt them after the MVP in this order:

1. CodeLens, because bounded detection is cheap and it improves discovery;
2. document symbols and folding ranges, because both can reuse paired execution evidence;
3. hover details and **Show in Apex Log Insights**;
4. optional duration decorations, after measuring editor cost.

Every provider must:

- honor its VS Code cancellation token;
- avoid synchronous full-file reads or parsing;
- return no result until a current analysis index is available, or schedule one bounded background parse with clear ownership;
- invalidate its cache on document change, close, rename, delete, and refresh;
- degrade to no result for very large files rather than blocking editor services.

### Keep UI preferences separate from report content

Certinia persists table layouts and inspector state separately from log content and pushes configuration changes only when the resolved configuration actually changes. Adopt this separation if Apex Log Insights later adds VS Code-only preferences:

- use settings for choices users should edit or sync;
- use `globalState` only for small UI-layout preferences;
- never store raw logs, reports, evidence text, source paths, or recent-file lists;
- send configuration changes only when the normalized value differs;
- version stored preference shapes and tolerate removal of old fields.

### Package from an allowlist and test the artifact

Certinia's `.vscodeignore` excludes everything and re-includes the extension's runtime files, while CI runs a real `vsce package`. Our plan should retain the stronger form already proposed:

- define an allowlisted package surface;
- build host and webview bundles before packaging;
- package with no runtime workspace symlinks;
- inspect the `.vsix` contents automatically;
- install the exact candidate `.vsix` in a clean profile;
- split parser, viewer, and extension tests so a failure identifies the owning layer.

### Treat large-log rendering as its own engineering problem

Certinia uses virtual table rendering, bounded DOM windows, resize observers, request-animation-frame scheduling, and an optimized timeline for very large logs. Apex Log Insights does not need to reproduce its flame chart, but it should copy the performance discipline:

- never render one DOM node per raw-log line or timeline event at startup;
- keep the existing capped initial Execution Story and lazy table expansion;
- virtualize Log Explorer if near-limit tests show DOM or search latency outside the declared budget;
- debounce resize-driven work and cancel obsolete animation frames;
- test zero-overlap jumps, resize while scrolled, search-to-result navigation, and panel reveal after being hidden;
- measure before enabling `retainContextWhenHidden` as a shortcut for expensive reconstruction.

## Ideas to defer

### Retrieve logs from a Salesforce org

Certinia exposes **Retrieve Apex Log And Show Analysis**. This is useful, but it introduces Salesforce authentication, CLI/plugin dependencies, org selection, network behavior, file placement, and error contracts. It remains outside the first release. A later proposal should decide whether to integrate with Salesforce CLI commands or another installed extension rather than shipping a second authentication stack.

### Apex source navigation

Certinia resolves method symbols into an SFDX project and can navigate from call-tree entries to Apex source. Apex Log Insights currently distinguishes **Apex source line** from **Log line** and does not have a canonical source-file identity for every event. Do not guess by class name or open the first matching file.

A future source-navigation feature needs:

- a documented mapping from report component identity to workspace file URI;
- namespace and inner-class handling;
- duplicate-class disambiguation;
- tests for triggers, classes, managed packages, and missing sources;
- a non-clickable fallback when confidence is insufficient.

### Automatic language assignment for `.txt`

Certinia detects both `.log` and `.txt` and assigns an `apexlog` language ID. This improves syntax highlighting and provider targeting, but changing a user's language mode is visible editor behavior. Keep `.txt` out of the MVP. Consider an `apexlog` language contribution after validating that it coexists with Salesforce extensions and does not claim unrelated text files.

### Global search across visualizations

Certinia synchronizes search across timeline, call tree, analysis, and database views. Apex Log Insights views answer different investigation questions and already provide Log Explorer and focused table controls. A cross-view search should be specified separately rather than added as an implicit VS Code requirement.

## Patterns not to copy

The following observations are reasons to keep the stricter boundaries in our specification. They are not claims that Certinia's extension is unsafe in its own context; they reflect different architecture and risk choices.

| Observed pattern in reviewed source                                 | Apex Log Insights decision                                                                                             |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Activation on `onStartupFinished`                                   | Activate only for contributed commands, CodeLens/provider demand, or detected log language                             |
| One static current panel and current log path                       | Maintain one controller per source URI and never use the active editor as hidden panel state                           |
| `retainContextWhenHidden: true`                                     | Default to `false`; restore a small route/UI state and re-render unless measurements justify retention                 |
| `enableCommandUris: true` and trusted Markdown command links        | Keep command URIs disabled; route enumerated actions through validated messages                                        |
| Source-log directory included in `localResourceRoots`               | Limit roots to packaged webview assets; send report content through the bridge                                         |
| Filesystem path and source URI sent to the webview                  | Keep the source URI exclusively in the host controller                                                                 |
| Message payloads narrowed with TypeScript casts inside a switch     | Perform runtime schema guards before using every payload                                                               |
| Synchronous `fs` probing for contextual detection                   | Use open-document text or asynchronous `workspace.fs`; keep detection bounded                                          |
| Raw log reparsed and cached by file path for editor providers       | Reuse a revision-keyed analysis index, bound memory, and invalidate on every source revision                           |
| Timestamp search reads and scans the whole file for each navigation | Navigate through canonical evidence line numbers in O(1), then verify the current line exists                          |
| Panel receives arbitrary HTTPS URLs to open                         | Prefer fixed documentation URLs owned by host code; never let report or webview content choose an external destination |
| Webview persists broad UI layout in global state                    | Persist only explicitly approved, non-sensitive UI preferences with a documented schema                                |

## Changes to the Apex Log Insights plan

The gated implementation plan incorporates these conclusions:

- Step 4 adds bounded content detection and a cheap CodeLens.
- Step 6 requires an immediate loading shell and request-map cleanup.
- Step 7 adds near-limit rendering checks and keeps `retainContextWhenHidden` disabled by default.
- Step 8 keeps exact line-number navigation rather than timestamp rescanning.
- Step 9 prepares selection synchronization without implementing automatic reparse.
- Step 10 adds provider-cancellation and reverse-navigation tests to the post-MVP queue.
- Step 11 measures virtual rendering triggers instead of assuming current caps are sufficient.
- Step 12 retains allowlisted packaging and real `.vsix` inspection.
- Public labels always use **Apex Log Insights** rather than Certinia's **Log:** prefix, and the release candidate is tested with both extensions enabled.

## Coexistence contract

Certinia's extension ID is `financialforce.lana`, its internal command namespace is `lana.*`, and its primary command is **Log: Show Apex Log Analysis**. Apex Log Insights must remain distinguishable at three levels:

1. Marketplace identity: different extension name, publisher-qualified ID, icon, description, and screenshots.
2. VS Code identity: `apexLogInsights.*` commands and context keys, `apexLogInsights.analysis` panel type, and an **Apex Log Insights** output channel.
3. User-visible identity: **Analyze with Apex Log Insights** on menus and CodeLens, and **Apex Log Insights — `<file-name>`** on panels.

Do not compete for Certinia's `apexlog` language ID in the first release. Both extensions may independently detect `.log` content and show their own actions. The user should see two clearly named choices rather than one extension suppressing, replacing, or invoking the other.

Coexistence is part of release verification, not merely a naming review. Test with both extensions enabled and confirm that each command opens its own panel, each output channel has a distinct name, no default shortcut collides, and disabling either extension leaves the other functional.

The first release remains intentionally smaller than Certinia's mature extension. Its purpose is to put the existing Apex Log Insights report inside VS Code with exact evidence navigation. Code folding, document symbols, hover metrics, reverse navigation, org retrieval, and Apex source mapping should be added only after the base extension passes its release gates.

## Follow-up backlog

| Priority | Candidate                               | Entry criterion                                                                                   |
| -------- | --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| P1       | Reverse raw-log-to-analysis navigation  | MVP panel registry and evidence navigation are stable                                             |
| P1       | Document symbols and folding            | Revision-keyed analysis index is available without an extra synchronous parse                     |
| P2       | Hover metrics                           | Hover latency and cancellation budget is defined                                                  |
| P2       | Optional inline duration decorations    | Decorations can be updated without scanning the whole document on every edit                      |
| P2       | Log Explorer virtualization             | Near-limit performance measurements show current lazy/capped rendering misses its declared budget |
| P3       | Apex source navigation                  | Canonical component-to-workspace mapping is specified                                             |
| P3       | Salesforce org log retrieval            | Authentication, dependency, privacy, and destination-file contracts are approved                  |
| P3       | `.txt` detection and `apexlog` language | Compatibility with Salesforce extensions and false-positive behavior is tested                    |

Do not use this backlog as shipped documentation. Promote one item at a time into its own acceptance criteria and gated implementation steps.

## Related

- [VS Code extension specification](vscode-extension-spec.md)
- [VS Code implementation record](vscode-extension-implementation-plan.md)
- [VS Code release review](vscode-extension-release-review.md)
