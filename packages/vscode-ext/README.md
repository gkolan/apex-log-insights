# Apex Log Insights for VS Code

Analyze a Salesforce Apex debug log beside its source file. Apex Log Insights opens five linked report views and lets you select a finding's **Log line** to reveal the corresponding raw text in the editor.

## Before you start

Use desktop VS Code 1.96 or later and a readable `.log` file no larger than 25 MiB. Browser-hosted VS Code and virtual workspaces are not supported. No Salesforce credentials or separate local server are required.

The extension is a source-build release candidate, not a verified Marketplace release. See [installation availability and source-build steps](https://github.com/gkolan/apex-log-insights/blob/main/docs/user-guides/getting-started.md#vs-code-extension) to obtain a local VSIX. Installing an existing VSIX does not require Node.js or pnpm.

The packaged VSIX includes `THIRD-PARTY-NOTICES.md` with the license terms for
the vendored parser code.

## Analyze a log

1. Install the candidate with **Extensions: Install from VSIX…**.
2. Open a Salesforce Apex debug log whose file name ends in `.log`.
3. Run **Apex Log Insights: Analyze Active Log** from the command palette. You can also select **Analyze with Apex Log Insights** above a detected log or from the Explorer context menu.
4. Start in **Triage Summary**, then investigate with **Execution Story**, **Data & Limits**, **Diagnostics**, and **Log Explorer**.
5. Select a **Log line** in the report. The source editor should reveal that exact raw-log line, not an Apex class line with the same number.

Use **Apex Log Insights: Analyze Log File…** to choose a file without opening it first. The report follows the active editor theme, including theme changes while the panel is open. See the [Light and Dark screenshots](https://github.com/gkolan/apex-log-insights/blob/main/assets/images/README.md#vs-code-screenshots).

## Refresh or recover

If the source changes, the report remains visible and shows a stale-source notice. Select **Refresh Analysis** to analyze the current content. Unsaved editor text is analyzed without saving it. Deleting the source makes it unavailable; choose another existing log to continue.

If commands are missing, confirm the extension is installed and enabled in the current workspace, then reload VS Code. A file over 25 MiB is rejected; capture a smaller log or reduce the input before retrying. Parsing can be cancelled and stops after 120 seconds if it does not finish.

Commands use the **Apex Log Insights:** prefix to distinguish them from other Salesforce extensions.

## Privacy

Parsing runs in a worker in the workspace extension host. Log processing makes no network request, starts no server, and writes no log or report to disk. Source and report content remain in memory while the panel is open. Closing the panel releases its references.

In Remote SSH and Dev Containers, the workspace extension host is remote, so processing occurs there rather than on the desktop. Those environments were not included in the recorded candidate runtime checks. Read the [privacy guide](https://github.com/gkolan/apex-log-insights/blob/main/docs/user-guides/privacy.md) before sharing a log or report.

## Other ways to analyze logs

Apex Log Insights also has Chrome, Edge, and Firefox extensions, a command-line tool, a Node.js/TypeScript library, and an MCP server for AI clients. See [current availability](https://github.com/gkolan/apex-log-insights/blob/main/docs/user-guides/getting-started.md#availability) for installation options. MCP results pass to the configured AI client, which may send them to a cloud model.

## Feedback and support

Send questions, suggestions, or bug reports to [feedback@apexloginsights.com](mailto:feedback@apexloginsights.com). Include your VS Code and extension versions and the steps to reproduce the problem. Attach only a small synthetic or sanitized log.

## Related

- [Troubleshooting](https://github.com/gkolan/apex-log-insights/blob/main/docs/user-guides/troubleshooting.md)
- [Report a problem using a synthetic or sanitized log](https://github.com/gkolan/apex-log-insights/issues)
- [Contribute to Apex Log Insights](https://github.com/gkolan/apex-log-insights/blob/main/CONTRIBUTING.md)
