# Apex Log Insights for VS Code

The VS Code extension analyzes a user-selected Apex debug log with the shared `@apex-log-insights/core` engine and displays the canonical five-view report in an editor panel. It does not require a local server, Salesforce credentials, or network access.

## Use

1. Install `apex-log-insights.vsix` with **Extensions: Install from VSIX…**.
2. Open a Salesforce Apex debug log whose file name ends in `.log`.
3. Run **Apex Log Insights: Analyze Active Log**, use **Analyze with Apex Log Insights** above a detected log, or use the Explorer context menu.
4. Select a **Log line** in the report to reveal that exact line in the source editor.
5. If the source changes, select **Refresh Analysis** in the stale-report notice. Unsaved editor text is analyzed without saving it.

The extension has its own product-qualified commands and panel title, so it remains distinguishable when Certinia Apex Log Analyzer is also installed. Certinia commands begin with **Log:**; this extension consistently uses **Apex Log Insights:**.

## Development

From the repository root:

```bash
pnpm --filter ./packages/vscode-ext build
pnpm --filter ./packages/vscode-ext typecheck
pnpm --filter ./packages/vscode-ext package:vsix
```

The production build writes the extension host, parser worker, and generated canonical webview under `dist/`. The package command writes `packages/vscode-ext/apex-log-insights.vsix` outside that runtime directory, without changing the selected root version.

Marketplace copy and candidate release notes are maintained under [`store/`](store/). Publication is a separate authorized action and is not performed by the build.

The extension exposes:

- **Apex Log Insights: Analyze Active Log**;
- **Apex Log Insights: Analyze Log File…**;
- **Apex Log Insights: Refresh Analysis**;
- **Analyze with Apex Log Insights** CodeLens for a detected `.log` file.

These entry points validate the selected source and 25 MiB limit, then build a canonical report in a cancellable worker with a 120-second timeout. UTF-8 sizing does not allocate a second encoded copy of an open document. The worker validates the complete request envelope, independently derives report bytes from the actual text, and rejects malformed, empty, or oversized input before parsing; request metadata cannot override the recorded size. Cancellation, timeout, request supersession, malformed active-request responses, and any worker exit before a response explicitly settle the pending parse before terminating its worker and disposing the cancellation subscription. Responses for other request IDs are ignored. One report panel is reused per source URI. Closing a panel releases its report and raw-log references.

The panel never recreates itself after disposal. Closing it cancels active parsing, unsaved input is labeled explicitly, deleted sources remain visible as unavailable, and stale source coordinates warn instead of opening a different line.

Contextual menus and CodeLens use a lightweight detector that inspects at most the first 100 lines or 64 KiB, whichever comes first. The bound is measured in exact UTF-8 bytes with the source's actual LF, CRLF, or CR separators; contextual discovery never parses the complete log.

## Privacy and support boundary

Parsing runs in the workspace extension host and report display runs in a restricted webview. The extension makes no network request and writes no log or report to disk. In Remote SSH and Dev Containers, the workspace extension host—and therefore parsing—runs in that remote environment. Virtual workspaces and browser-hosted VS Code are not supported.
