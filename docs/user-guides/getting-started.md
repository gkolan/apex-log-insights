# Getting started

Apex Log Insights reads Salesforce Apex debug logs locally and turns them into a searchable report. Choose the interface that best fits where you already work.

## Choose an interface

| You want to…                           | Use               | Data behavior                                                |
| -------------------------------------- | ----------------- | ------------------------------------------------------------ |
| Open a log and investigate it visually | Browser extension | Parsed in your browser                                       |
| Analyze a log beside its source file   | VS Code extension | Parsed in the workspace extension host                       |
| Open local files from a terminal       | CLI               | Served and parsed locally                                    |
| Build parsing into an application      | Core library      | Controlled by your application                               |
| Ask an AI client to analyze a log      | MCP server        | Parsed locally; results are sent to the configured AI client |

## Browser extension

### Availability

Browser stores and repository builds can contain different versions. This guide describes the current source; check the store version before expecting a newly documented feature.

| Interface                         | Installation status checked on 2026-09-03                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Chrome and Firefox                | Public store listings are available; the listings retrieved showed Chrome 1.1.22 and Firefox 1.1.34.    |
| Edge                              | Public store listing is available; its current version was not exposed by the listing check.            |
| VS Code                           | A local 1.2.0 VSIX candidate can be built. The expected Marketplace listing was not available.          |
| CLI, core library, and MCP server | Available from source. The public npm registry did not return a latest release for these package names. |

The browser archives in this repository are 1.2.0 candidates, not proof of store publication. The Firefox candidate is unsigned and is for submission or temporary development loading. Browser users do not need Node.js or pnpm.

### Install and analyze

Install from [Chrome Web Store](https://chromewebstore.google.com/detail/apex-log-insights/mkgfpohljhagepglolcabmnhhiipicdp), [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/apex-log-insights/nkpcmmjdldolekgajklnllilkbobbian), or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/apex-log-insights/).

1. Open the extension.
2. Drop a `.log` file onto the page, or choose a previously generated `.apex-insights.json` report.
3. Start in **Triage Summary** to see the outcome and findings that need attention.
4. Use **Execution Story**, **Data & Limits**, and **Diagnostics** to investigate.
5. Follow an evidence link to verify a finding against the exact raw log line.

### Log lines and Apex source lines

These numbers describe different locations:

- **Log line 42** means row 42 in the debug-log file. It is clickable and opens Log Explorer.
- **Apex source line 87** means `[87]` in the Salesforce class or trigger that produced the event. It is context, not a raw-log destination.

When both are available, the UI shows both labels side by side. Only **Log line** is a link. Log Explorer also uses the explicit `log:42` search form; the older `line:42` form remains accepted for existing links.

The extension does not upload logs. Browser store update checks are handled by the browser, not by Apex Log Insights.

## VS Code extension

The VS Code extension is available as a local `1.2.0` release candidate. It has not been published to the Visual Studio Marketplace.

1. Follow [Build from source](#build-from-source), then run `pnpm --filter ./packages/vscode-ext package:vsix` from the repository root. This writes `packages/vscode-ext/apex-log-insights.vsix` without publishing it.
2. In VS Code, run **Extensions: Install from VSIX…**.
3. Open a Salesforce Apex debug log whose file name ends in `.log`.
4. Run **Apex Log Insights: Analyze Active Log**, select **Analyze with Apex Log Insights** above a detected log, or use the Explorer context menu.
5. Select a **Log line** in the report to reveal that exact line in the source editor.

If the source changes, select **Refresh Analysis** in the stale-report notice. Unsaved editor text is analyzed without saving it. Parsing occurs in the workspace extension host, so Remote SSH and Dev Containers process the log in that remote environment.

The five report views should open beside the selected log. If the command is missing, confirm the VSIX is installed and enabled in the current workspace, then reload VS Code. See the [VS Code package guide](../../packages/vscode-ext/README.md) for limits, privacy details, and the supported-host boundary.

## Build from source

Source builds require Git and the Node.js and pnpm prerequisites in [Contributing](../../CONTRIBUTING.md#prerequisites). Run these commands in a terminal; they download the repository and development dependencies, then create local build files. They do not publish packages or upload logs.

```bash
git clone https://github.com/gkolan/apex-log-insights.git
cd apex-log-insights
pnpm install --frozen-lockfile
pnpm build
```

Continue from this repository directory with the interface below. If installation fails, confirm the prerequisite versions and registry connectivity before retrying. If a build fails, preserve the error output and resolve it before using its artifacts.

## CLI

After [building from source](#build-from-source), run this from the repository root. Replace the example path with a readable local log:

```bash
node packages/cli/dist/bin.js /path/to/debug.log
```

For a directory of logs:

```bash
node packages/cli/dist/bin.js /path/to/logs
```

Use `node packages/cli/dist/bin.js --help` for supported options. The CLI prints a loopback URL and opens the viewer. Select a log and confirm **Triage Summary** appears. Stop the server with `Ctrl+C`. Quote paths containing spaces; on Windows use a path such as `"C:/logs/debug.log"`.

## Library

After [building from source](#build-from-source), import `packages/core/dist/index.js` using its actual path from your application. To create a local package, run `pnpm --dir packages/core pack --pack-destination .` from the repository root and install the resulting tarball into your application. This creates a local artifact, not a public npm release.

Continue with the [Core API reference](../reference/api/core.md).

## MCP server

The MCP server is appropriate when an AI client should call the parser as a tool. Read the [MCP setup and privacy guide](../../packages/mcp/README.md) before using it with production logs.

## Before sharing a report

Debug logs may contain record IDs, names, email addresses, query values, endpoints, and application debug messages. Read [Privacy and security](privacy.md) before attaching a log or report to an issue or AI conversation.

## Related

- [Troubleshooting](troubleshooting.md)
- [Privacy and security](privacy.md)
- [Documentation home](../README.md)
