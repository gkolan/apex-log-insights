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

Install from [Chrome Web Store](https://chromewebstore.google.com/detail/apex-log-insights/mkgfpohljhagepglolcabmnhhiipicdp), [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/apex-log-insights/nkpcmmjdldolekgajklnllilkbobbian), or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/apex-log-insights/).

1. Open the extension.
2. Drop a `.log` file onto the page, or choose a previously generated `.apex-insights.json` report.
3. Start in **Triage** to see the outcome and highest-impact findings.
4. Use **Execution**, **Data**, and **Diagnostics** to investigate.
5. Follow an evidence link to verify a finding against the exact raw log line.

### Log lines and Apex source lines

These numbers describe different locations:

- **Log line 42** means row 42 in the debug-log file. It is clickable and opens Log Explorer.
- **Apex source line 87** means `[87]` in the Salesforce class or trigger that produced the event. It is context, not a raw-log destination.

When both are available, the UI shows both labels side by side. Only **Log line** is a link. Log Explorer also uses the explicit `log:42` search form; the older `line:42` form remains accepted for existing links.

The extension does not upload logs. Browser store update checks are handled by the browser, not by Apex Log Insights.

## VS Code extension

The VS Code extension is available as a local `1.2.0` release candidate. It has not been published to the Visual Studio Marketplace.

1. Build or obtain the reviewed `apex-log-insights.vsix` candidate.
2. In VS Code, run **Extensions: Install from VSIX…**.
3. Open a Salesforce Apex debug log whose file name ends in `.log`.
4. Run **Apex Log Insights: Analyze Active Log**, select **Analyze with Apex Log Insights** above a detected log, or use the Explorer context menu.
5. Select a **Log line** in the report to reveal that exact line in the source editor.

If the source changes, select **Refresh Analysis** in the stale-report notice. Unsaved editor text is analyzed without saving it. Parsing occurs in the workspace extension host, so Remote SSH and Dev Containers process the log in that remote environment.

See the [VS Code package guide](../../packages/vscode-ext/README.md) for development commands, limits, privacy details, and the supported-host boundary.

## CLI

Requires Node.js 18 or later.

```bash
npm install --global @apex-log-insights/cli
apex-log debug.log
```

For a directory of logs:

```bash
apex-log ./logs
```

Use `apex-log --help` for the complete supported options. The CLI starts a local HTTP server and opens the viewer. Stop it with `Ctrl+C`.

## Library

```bash
pnpm add @apex-log-insights/core
```

Continue with the [Core API reference](../reference/api/core.md).

## MCP server

The MCP server is appropriate when an AI client should call the parser as a tool. Read the [MCP setup and privacy guide](../../packages/mcp/README.md) before using it with production logs.

## Before sharing a report

Debug logs may contain record IDs, names, email addresses, query values, endpoints, and application debug messages. Read [Privacy and security](privacy.md) before attaching a log or report to an issue or AI conversation.

## Related

- [Troubleshooting](troubleshooting.md)
- [Privacy and security](privacy.md)
- [Documentation home](../README.md)
