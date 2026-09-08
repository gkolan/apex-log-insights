# Browser store listing

Use this page when creating or updating the Chrome, Edge, or Firefox listing for Apex Log Insights. The long description is browser-neutral. Adapt store-specific fields and permission explanations to the submitted manifest, and verify the [privacy policy](privacy-policy.md) before submission.

## Extension name

Apex Log Insights

## Short description

The store permits up to 132 characters.

> Analyze Apex debug logs locally with execution, SOQL, DML, governor-limit, diagnostic, and raw-line views.

## Category and language

- Category: Developer Tools
- Language: English
- Pricing: Free

## Single-purpose statement

> Analyzes Salesforce Apex debug logs locally in the browser and presents the results as linked, searchable views.

## Long description

The store field accepts plain text. Do not paste Markdown formatting.

```text
Apex Log Insights analyzes Salesforce Apex debug logs locally in your browser. Open a .log file to inspect the transaction through five linked views. Log parsing runs in a Web Worker inside the extension. Browser users do not need Node.js or pnpm.

TRIAGE SUMMARY
See the transaction status, errors, warnings, governor-limit use, and findings that need attention first.

EXECUTION STORY
Follow execution blocks and lifecycle phases in order. Phase entries distinguish direct evidence from derived or inferred results.

DATA & LIMITS
Review SOQL queries, DML operations, callouts, Named Credentials, savepoints, query patterns, and governor-limit use.

DIAGNOSTICS
Check execution context, instrumentation quality, trigger cascades, recursion, mixed DML, managed-package activity, and parser warnings.

LOG EXPLORER
Search the full raw log and follow evidence links from a supported finding to its exact raw-log line.

PRIVACY
Parsing does not send log content to the developer or a third-party service. The extension stores preferences and keeps no more than the five most recently opened log payloads in browser extension storage so analyzer tabs can survive a refresh. Opening more logs removes the oldest cached payloads. Select Clear cached logs in the extension popup to remove cached log payloads while keeping preferences. Clear all extension data or uninstall the extension to remove all retained extension data.

REDACTION
Before copying raw lines, you can mask recognized email addresses, Salesforce IDs, phone numbers, and names that you provide. Redaction is pattern-based and may not find every sensitive value. Review copied text before sharing it.

FILE NAVIGATION
Chrome and Edge users can enable a file sidebar that lists sibling .log files from a local directory page. This feature briefly reads that directory listing after the user enables it. Firefox does not provide this sidebar.

SUPPORTED INPUT
Use a Salesforce Apex debug-log file or a compatible Apex Log Insights report. Report accuracy depends on the events and debug levels present in the source log.

OTHER INSTALLATION OPTIONS
Browser extensions are available for Chrome, Microsoft Edge, and Firefox. The project also includes a VS Code release candidate, a command-line tool, a Node.js/TypeScript library, and an MCP server available from source. Current installation options and store links: https://github.com/gkolan/apex-log-insights/blob/main/docs/user-guides/getting-started.md#availability

The optional MCP server parses locally and passes results to your AI client, which may send them to a cloud model. Redaction is best-effort masking, not a guarantee of anonymity.

FEEDBACK AND SUPPORT
Send questions, suggestions, or bug reports to feedback@apexloginsights.com. Include your browser and extension version and steps to reproduce the problem. Apex Log Insights is open source. Attach only a small synthetic or sanitized log; do not send an unreviewed production log.
```

## Permission justifications

### `tabs`

Detects a tab whose URL points to a `.log` file, opens the analyzer, and supports local-file navigation initiated by the user.

### `storage`

Stores theme, redaction, Log Explorer, and sidebar preferences. It may also store the active log or report, source URL, and sibling-file state so the analyzer can restore its current state after refresh. Storage remains in the local browser profile and is not sent to the developer.

### `scripting`

Chrome and Edge only. Reads links from a local directory-listing tab only when the user enables sibling-log discovery. The extension uses those links to populate the file sidebar. Firefox does not request this permission because it does not provide the sidebar.

### Host access: `*://*/*.log` and `file:///*`

Lets the content script recognize web and local `.log` URLs and transfer the selected log to the local analyzer. Parsing occurs inside the extension.

## Search terms

Use these only where the store provides a search-term field:

- Salesforce
- Apex
- debug log
- governor limits
- SOQL
- DML
- log analysis
- trigger
- Apex profiling

## Firefox reviewer notes

Attach `firefox-source-v1.2.0.zip` as the source-code submission. Its included `FIREFOX-SOURCE-README.md` lists the locked environment and exact reproduction commands. Use the following functional-testing notes in the Firefox Add-ons submission:

```text
Build environment: Node.js 24 and pnpm 10.27.0. The attached source archive includes pnpm-lock.yaml and complete build instructions. Build the core package before the Firefox package as documented in FIREFOX-SOURCE-README.md. The generated XPI should contain the same 27 file contents as the submitted extension; ZIP timestamps and entry order may differ.

Functional test:
1. Install the extension in Firefox.
2. Open the toolbar popup and select Open analyzer.
3. Choose or drop a Salesforce Apex debug log whose file name ends in .log. A synthetic sample is available in the repository fixtures directory.
4. Confirm Triage Summary appears, navigate through the five report views, and follow a Log line link to Log Explorer.
5. Refresh the analyzer tab and confirm the current report is restored.

No account or Salesforce credentials are required. Parsing is local and the extension does not transmit log content. Firefox intentionally omits the Chrome/Edge sibling-file sidebar and does not request the scripting permission.

Mozilla web-ext lint reports no errors. Its four UNSAFE_VAR_ASSIGNMENT warnings are known and reviewed: three assign fixed packaged SVG icon constants to copy buttons; the other renders file-list markup after every source-derived value is passed through escapeHtml. No remote value is inserted as executable code.
```

## Submission checks

Before copying this listing:

1. Compare permissions with all three source manifests.
2. Verify storage statements against extension code and the privacy policy.
3. Confirm every named view and feature exists in the submitted build.
4. Recount the short description if it changes.
5. Remove claims that cannot be reproduced with a tracked synthetic fixture.
