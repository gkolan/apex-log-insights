# Chrome Web Store listing

Use this page when creating or updating the Chrome Web Store listing for Apex Log Insights. Copy the field values exactly, then verify them against the submitted extension and the current [privacy policy](privacy-policy.md).

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
Apex Log Insights analyzes Salesforce Apex debug logs in Chrome. Open a .log file to inspect the transaction through five linked views. Log parsing runs in a Web Worker inside the extension.

TRIAGE SUMMARY
See the transaction status, errors, warnings, governor-limit use, and findings that need attention first.

EXECUTION STORY
Follow execution blocks and lifecycle phases in order. Phase entries distinguish direct evidence from derived or inferred results.

DATA & LIMITS
Review SOQL queries, DML operations, callouts, Named Credentials, savepoints, query patterns, and governor-limit use.

DIAGNOSTICS
Check execution context, instrumentation quality, trigger cascades, recursion, mixed DML, managed-package activity, and parser warnings.

LOG EXPLORER
Search the full raw log and follow evidence links from a supported finding to its source line.

PRIVACY
Parsing does not send log content to the developer or a third-party service. The extension stores preferences and keeps no more than the five most recently opened log payloads in browser extension storage so analyzer tabs can survive a refresh. Opening more logs removes the oldest cached payloads. Clear the extension's stored data or uninstall the extension to remove all retained extension data.

REDACTION
Before copying raw lines, you can mask recognized email addresses, Salesforce IDs, phone numbers, and names that you provide. Redaction is pattern-based and may not find every sensitive value. Review copied text before sharing it.

FILE NAVIGATION
Chrome and Edge users can enable a file sidebar that lists sibling .log files from a local directory page. This feature briefly reads that directory listing after the user enables it. Firefox does not provide this sidebar.

SUPPORTED INPUT
Use a Salesforce Apex debug-log file or a compatible Apex Log Insights report. Report accuracy depends on the events and debug levels present in the source log.

Apex Log Insights is open source. Report bugs with a small synthetic or sanitized log; do not post an unreviewed production log.
```

## Permission justifications

### `tabs`

Detects a tab whose URL points to a `.log` file, opens the analyzer, and supports local-file navigation initiated by the user.

### `storage`

Stores theme, redaction, Log Explorer, and sidebar preferences. It may also store the active log or report, source URL, and sibling-file state so the analyzer can restore its current state after refresh. Storage remains in the local browser profile and is not sent to the developer.

### `scripting`

Reads links from a local directory-listing tab only when the user enables sibling-log discovery. The extension uses those links to populate the file sidebar.

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

## Submission checks

Before copying this listing:

1. Compare permissions with all three source manifests.
2. Verify storage statements against extension code and the privacy policy.
3. Confirm every named view and feature exists in the submitted build.
4. Recount the short description if it changes.
5. Remove claims that cannot be reproduced with a tracked synthetic fixture.
