# VS Code extension specification

Status: implemented as the `1.2.0` local release candidate. Marketplace publication has not occurred.

This specification records the product and engineering contract for developers who maintain the Visual Studio Code interface. Use it to understand why the candidate behaves as it does and which acceptance criteria future changes must preserve.

The [gated implementation record](vscode-extension-implementation-plan.md) preserves the sequence used to build and verify this specification. For installation and current usage, read the [VS Code package guide](../../packages/vscode-ext/README.md).

The [Certinia Apex Log Analyzer review](vscode-certinia-review.md) records interaction and engineering ideas from an established VS Code log analyzer, along with patterns this project should not copy.

## Product decision

Build a desktop and remote-workspace VS Code extension as a new workspace package, `packages/vscode-ext/`. The extension should reuse `@apex-log-insights/core` for parsing and report creation and reuse the canonical viewer sources for report display.

The first release should use an ordinary webview panel opened by an explicit command. It should not register `.log` as a custom editor. Apex debug logs remain editable text documents, and users choose when to open an analysis beside the source file.

The editor integration that distinguishes this interface from the CLI and browser extension is evidence navigation: selecting a **Log line** in the report opens the analyzed document, reveals the corresponding 1-based line, and places the cursor there.

## Goals

The first release must:

- analyze the active `.log` editor, a `.log` file selected in Explorer, or a file chosen through the VS Code file picker;
- run parsing and report generation locally in the VS Code extension environment;
- show Triage Summary, Execution Story, Data & Limits, Diagnostics, and Log Explorer in an editor-area webview;
- preserve the canonical offline-report contract and viewer normalization boundary;
- open exact raw-log evidence in the text editor;
- work in local folders, Remote SSH, Dev Containers, and Codespaces desktop clients when the extension host can read the selected URI;
- package as a `.vsix` without requiring the CLI, a local HTTP server, Salesforce authentication, or network access.

For detected Apex debug logs, the first release should also expose a top-of-file **Analyze with Apex Log Insights** CodeLens. Detection must inspect only a bounded prefix and must not parse the complete log merely to decide whether to show the CodeLens.

## Non-goals for the first release

The first release will not:

- download logs from a Salesforce org;
- tail a log or re-run analysis on every keystroke;
- replace VS Code's text editor for `.log` files;
- add diagnostics to the Problems panel or decorate Apex source files;
- compare multiple logs;
- expose MCP tools;
- support virtual workspaces or `vscode.dev` as a guaranteed target;
- create a second report schema or a VS Code-specific analysis layer.

These boundaries keep the first release focused on local file analysis and exact evidence navigation. Salesforce log retrieval, source mapping, comparison, and browser-host support require separate product and security decisions.

## User workflows

### Analyze the active log

1. The user opens an Apex debug log in VS Code.
2. They run **Apex Log Insights: Analyze Active Log** from the Command Palette or the editor title menu.
3. The extension validates the document, reads its current in-memory text, and opens **Apex Log Insights — `<file-name>`** beside the editor.
4. A cancellable progress notification reports that analysis is running.
5. The webview opens on Triage Summary. Selecting a **Log line** opens the original text document at that line.

Using the in-memory document text is intentional: the report reflects unsaved edits visible in the editor. The webview must label such a report **Unsaved content** and must not write the document.

### Analyze from Explorer

The Explorer context menu shows **Analyze Apex Debug Log** for file resources whose path ends in `.log`, case-insensitively. The extension reads the selected URI through the VS Code file-system API and opens the same analysis panel.

### Choose a log

**Apex Log Insights: Analyze Log File…** opens a single-file picker restricted to `.log` files. Canceling the picker has no side effects.

### Re-run analysis

The analysis-panel toolbar exposes **Refresh Analysis**. If the source is open and dirty, refresh uses the document's current text; otherwise it reads the URI again. The extension does not automatically reparse after every edit. When the source changes after a report was generated, the panel shows **Source changed — refresh analysis**.

## Command and menu contract

| Command ID                         | User-facing title                     | Availability                                           |
| ---------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| `apexLogInsights.analyzeActiveLog` | Apex Log Insights: Analyze Active Log | Active file has a `.log` path                          |
| `apexLogInsights.analyzeLogFile`   | Apex Log Insights: Analyze Log File…  | Command Palette                                        |
| `apexLogInsights.refreshAnalysis`  | Apex Log Insights: Refresh Analysis   | An Apex Log Insights panel is active                   |
| `apexLogInsights.revealLogLine`    | Apex Log Insights: Reveal Log Line    | Internal command invoked by validated webview messages |

The Explorer and editor-title menu entries should invoke `analyzeActiveLog`. Do not assign a default keyboard shortcut in the first release.

## Coexistence with other log extensions

Users may install Apex Log Insights alongside Certinia Apex Log Analyzer, Salesforce extensions, or another `.log` viewer. Every Apex Log Insights entry point must identify this product without requiring the user to recognize an icon.

Use these exact labels:

| Location                    | Apex Log Insights label                         |
| --------------------------- | ----------------------------------------------- |
| Command Palette             | **Apex Log Insights: Analyze Active Log**       |
| File-picker command         | **Apex Log Insights: Analyze Log File…**        |
| Editor and Explorer menus   | **Analyze with Apex Log Insights**              |
| CodeLens                    | **Analyze with Apex Log Insights**              |
| Editor panel title          | **Apex Log Insights — `<file-name>`**           |
| Output channel              | **Apex Log Insights**                           |
| Progress notification       | **Apex Log Insights: Analyzing `<file-name>`…** |
| Refresh action tooltip      | **Refresh Apex Log Insights analysis**          |
| Raw-log hover action, later | **Show in Apex Log Insights**                   |

Do not publish generic user-facing commands beginning with **Log:**, **Apex Log:**, **Analyze Log**, or **Show Analysis**. Certinia currently uses **Log: Show Apex Log Analysis**; our product-qualified wording must remain visibly distinct.

The extension must also:

- use the `apexLogInsights.*` command, context-key, and storage namespaces;
- use its own panel view type and a distinct product icon with accessible text labels;
- avoid assigning a default keyboard shortcut that could collide with another analyzer;
- avoid contributing or taking ownership of Certinia's `apexlog` language ID in the first release;
- avoid changing a document's language mode solely to enable Apex Log Insights;
- show contextual actions only after its own bounded content detection succeeds;
- operate correctly when Certinia Apex Log Analyzer is enabled, without depending on or modifying that extension.

If both extensions contribute an editor-title icon, the icon tooltip must contain the full product name. The primary discovery path remains the product-qualified CodeLens and context-menu text because icons alone are not sufficient identification.

## Architecture

```text
VS Code file or TextDocument
        |
        v
extension host adapter
  validate URI, size, and document state
        |
        v
parser worker
  @apex-log-insights/core
  parseLog() -> buildOfflineReport()
        |
        v
canonical offline report (reportVersion 3.0.0)
        |
        v
VS Code webview adapter
  canonical viewer normalization and render modules
        |
        +---- OPEN_LOG_LINE ----> VS Code text editor
```

The existing three-layer rule remains unchanged:

1. parser behavior stays in `packages/core/src/certinia/`;
2. report behavior stays in `packages/core/src/insights/` and the report assemblers;
3. display behavior stays in canonical viewer sources.

`packages/vscode-ext/` owns only VS Code activation, file access, worker lifecycle, webview assembly, message validation, and editor navigation. It must not interpret raw log events or add report-format fallbacks.

### Package ownership layout

```text
packages/vscode-ext/
  package.json                 VS Code manifest and contribution points
  README.md                    installation, commands, privacy, development
  src/
    extension.ts               activation and command registration
    analysis-panel.ts          panel lifecycle and evidence navigation
    code-lens.ts               bounded contextual discovery
    source.ts                  source selection and validation
    parser-client.ts           worker lifecycle and cancellation
    parser-worker.ts           parseLog/buildOfflineReport worker entry
    worker-messages.ts         narrowed worker message contracts
    webview-protocol.ts        narrowed host/webview message contracts
  webview/
    vscode-adapter.js          report injection and host message bridge
    vscode.css                 VS Code token and layout overrides
  scripts/
    assemble-webview.mjs       canonical webview asset assembly
  __tests__/
```

The build assembles canonical viewer files into `dist/webview/`. Generated files under `dist/` must not be edited. A build-time parity test fails if the packaged webview omits a canonical renderer module or one of the five view labels.

### Parsing process

Parsing must not run synchronously on the extension-host event loop. A worker receives `{ type, requestId, fileName, logText }`, validates the complete envelope, calls `parseLog()` with phase inference enabled, and passes its result to `buildOfflineReport()`. The source URI remains in the host. The host terminates the worker when the user cancels, the panel closes during parsing, or the 120-second timeout expires.

The initial file-size limit is 25 MB, matching the MCP input boundary. Validate the encoded byte length, not JavaScript string length. Reject a larger input before starting the parser and include the measured and allowed sizes in the error.

Only one parse runs per panel. Starting a refresh cancels the previous worker. A late worker response must be ignored by comparing an analysis request ID.

### Webview integration

The canonical viewer bootstrap accepts an offline report and raw lines. CLI and browser-extension loading remain adapters around that bootstrap; the VS Code adapter supplies the report through message passing.

The webview sends `READY` after its listeners are installed. The host then sends one `SHOW_REPORT` message. Evidence controls send `OPEN_LOG_LINE`; the host owns all editor access.

```typescript
type HostToWebview =
  | {
      type: "SHOW_REPORT";
      report: OfflineReportV2;
      rawLines: string[];
      sourceLabel: string;
      isDirty: boolean;
    }
  | { type: "SOURCE_CHANGED" }
  | { type: "SOURCE_UNAVAILABLE"; message: string }
  | { type: "ANALYSIS_ERROR"; message: string }
  | { type: "ANALYSIS_CANCELED" };

type WebviewToHost =
  | { type: "READY" }
  | { type: "OPEN_LOG_LINE"; lineNumber: number }
  | { type: "REFRESH" }
  | { type: "OPEN_EXTERNAL"; href: string };
```

Every incoming message is untrusted. The host accepts only known message types, requires `lineNumber` to be a finite positive integer, and rejects it if the current document does not contain that line. The sole external-link message is restricted to the repository issue URL. The webview cannot supply or change the source URI.

### Panel lifecycle

Use one panel per source URI and reveal the existing panel when the same source is analyzed again. Different files may have separate panels. The candidate does not serialize panels across a window reload and does not store raw logs or complete reports in extension global state.

The panel title contains only the base file name. Tooltip or accessible description text may include the full URI. Closing a panel releases its report, worker, document listeners, and message subscriptions.

## Security and privacy

The extension does not make network requests and does not require Salesforce credentials. It reads only the URI selected by a command and passes the raw text to the parser worker. The report and raw lines exist in extension and webview memory until the panel is disposed or VS Code closes.

In Remote SSH, Dev Containers, or Codespaces, parsing occurs where the workspace extension host runs. VS Code transports the report to the webview for display. Documentation must state this boundary instead of claiming that the bytes always remain on the physical computer running the VS Code window.

The webview must:

- use a per-render nonce for scripts;
- set a Content Security Policy that denies network connections, frames, objects, inline scripts, and unapproved resource origins;
- load packaged resources through `webview.asWebviewUri()`;
- set `localResourceRoots` to the packaged webview asset directory only;
- escape report-derived text through the existing renderer helpers;
- disable command URIs and avoid `enableCommandUris`;
- validate all messages on both sides of the bridge.

No raw log or report is written to `globalState`, `workspaceState`, secrets storage, telemetry, an output channel, or a temporary file. Error logging may include the file name and parser error but must not include raw log lines.

The implementation should follow the official VS Code guidance for [webview resource restrictions and Content Security Policy](https://code.visualstudio.com/api/extension-guides/webview) and [remote extension webviews](https://code.visualstudio.com/api/advanced-topics/remote-extensions).

## Visual and accessibility behavior

The webview keeps the canonical five-view information architecture. VS Code-specific CSS maps surfaces, text, borders, focus rings, links, and buttons to VS Code theme variables. The existing light/dark theme toggle should be omitted in this interface; the webview follows the active VS Code theme.

The extension must preserve:

- keyboard access to tabs, buttons, search, filters, and evidence links;
- visible focus indicators;
- semantic headings, tables, and status messages;
- zoom and high-contrast behavior;
- exact **Log line** and **Apex source line** terminology.

The analysis panel opens only after a user command. It must not open on activation, installation, update, or every `.log` file open. This follows the VS Code [webview UX guidance](https://code.visualstudio.com/api/ux-guidelines/webviews).

## Errors and diagnostics

User-facing errors use VS Code notifications for conditions that prevent analysis and an inline panel status for refresh failures when an older report remains usable.

| Condition                              | Required behavior                                                        |
| -------------------------------------- | ------------------------------------------------------------------------ |
| No active `.log` file                  | Offer **Choose Log File…**                                               |
| File cannot be read                    | Show the file name and file-system error without raw content             |
| File exceeds 25 MB                     | Show measured size and 25 MB limit                                       |
| Parser exceeds 120 seconds             | Terminate worker and report the timeout                                  |
| User cancels                           | Terminate worker without an error notification                           |
| Source deleted after analysis          | Keep the report open; disable evidence navigation and explain why        |
| Requested evidence line is unavailable | Show a non-modal warning; do not open a different line                   |
| Webview fails to initialize            | Show a reload action and record a content-free diagnostic in the channel |

Create one **Apex Log Insights** output channel for extension lifecycle diagnostics. It is off-screen by default and never receives raw log text or report JSON.

## Testing and acceptance criteria

### Unit tests

- URI and `.log` validation accepts mixed-case `.log` suffixes and rejects directories and other files.
- byte-size validation enforces 25 MB at the boundary;
- message guards reject unknown types, non-integer lines, negative lines, and source-URI injection;
- panel registry returns one panel per source URI and disposes listeners;
- request IDs prevent canceled or stale workers from replacing the current report;
- CSP generation contains a nonce and no network-capable `connect-src`;
- webview asset assembly contains the five canonical view labels and renderer modules.

### Extension-host tests

Use the VS Code extension test runner for these scenarios:

1. Analyze a synthetic `.log` fixture from an active text editor.
2. Analyze an unsaved modification and confirm the panel identifies unsaved content.
3. Invoke an evidence link and verify the text editor reveals the expected 1-based raw-log line.
4. Change the source and verify the stale-report notice appears without automatic parsing.
5. Refresh and verify the notice clears and the report changes.
6. Cancel a parse and verify no error notification or late report appears.
7. Close a panel during parsing and verify its worker and subscriptions are released.

The test suite must use synthetic or sanitized logs already permitted by the repository. The official VS Code guidance identifies `@vscode/test-electron` as the integration-test harness for desktop extensions; see [Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration).

### Release acceptance

The first release is ready when:

- all three entry paths analyze the same synthetic log into the same canonical report fields as the core package;
- Triage Summary, Execution Story, Data & Limits, Diagnostics, and Log Explorer render from assembled canonical viewer sources;
- every rendered evidence link with a valid raw-log coordinate opens the correct file and line;
- a 25 MB boundary test and a cancellation test pass;
- the packaged `.vsix` installs in a clean VS Code profile and runs without `node_modules` or a local server;
- `pnpm validate`, the VS Code extension-host tests, and a clean `.vsix` smoke test pass;
- the package README and shared privacy, architecture, feature, release, and changelog documents are updated with the shipped behavior.

## Build and release contract

The repository provides `dev:vscode`, package build, typecheck, Extension Host test, and `.vsix` packaging commands. The build bundles the extension host and parser worker with esbuild, assembles the canonical viewer assets, and excludes source, tests, and unrelated monorepo files from the `.vsix`.

Use `@vscode/vsce` to produce the installable package. Marketplace publication is a separate release action and requires a confirmed publisher ID, listing copy, icon assets, privacy text, and release credentials. The official packaging workflow is documented in [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

The root package version remains the single version source. `node scripts/sync-versions.mjs` must propagate it to the VS Code extension manifest before the first release.

## Delivery slices

1. Extract an injectable canonical viewer bootstrap and prove existing CLI/browser behavior remains unchanged.
2. Scaffold `packages/vscode-ext/`, commands, validation, worker parsing, and one panel per source.
3. Assemble the viewer into a nonce-protected webview and implement report injection.
4. Add exact Log line navigation, source-change detection, refresh, cancellation, and errors.
5. Add unit and extension-host tests, packaging, documentation, and release checks.

Each slice must leave the repository passing `pnpm validate`. Implementation changes must update `CHANGELOG.md`; the completed feature must also update `FEATURES.md` and the relevant user, privacy, architecture, testing, and release documentation.

## Resolved identity and compatibility decisions

The Marketplace publisher ID is `apex-log-insights`, the extension slug is `apex-log-insights`, and the publisher-qualified extension ID is `apex-log-insights.apex-log-insights`. The command namespace remains `apexLogInsights` and the analysis view type is `apexLogInsights.analysis`.

The minimum supported VS Code version is `1.96.0`, which is declared in the package and exercised by the Extension Host test workflow. Browser-hosted VS Code remains unsupported because its worker, file-system, bundling, and test boundaries differ from the desktop and remote-workspace candidate.

## Related

- [VS Code package guide](../../packages/vscode-ext/README.md)
- [VS Code implementation record](vscode-extension-implementation-plan.md)
- [VS Code release review](vscode-extension-release-review.md)
