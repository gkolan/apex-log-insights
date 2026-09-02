# Store release notes

Use this page to copy version-specific text into the Chrome Web Store “What's new” field. Select the section whose version matches the submitted manifest; do not combine notes from different releases.

## Version 1.2.0

```text
Updated the five-view investigation workflow with a Salesforce Cosmos-inspired Night theme, resource and heap charts, execution waterfalls, lifecycle steps, record drill-downs, and Apex database cursor analysis. Triage shows log-quality warnings only when missing evidence can affect a conclusion and provides failure context for captured exceptions. Log Explorer has clearer evidence links and bounded large-log rendering. Files remain local.
```

## Version 1.1.34

```text
Added an optional Chrome and Edge file sidebar for opening sibling .log files. CLI directory mode now provides the same file navigation. Fixed analyzer restoration after refresh, including Firefox storage behavior. Updated the welcome-page permission status and Firefox packaging declarations.
```

## Version 1.1.17

```text
Corrected execution durations, N+1 SOQL detection, Visualforce namespace parsing, and timestamp parsing. Fixed unsafe HTML rendering, CLI path traversal, and MCP error handling. Added repository security and static-analysis commands.
```

## Initial release

```text
Added local Apex debug-log analysis with Triage Summary, Execution Story, Data & Limits, Diagnostics, and Log Explorer. Findings link to supporting raw lines. Analysis includes SOQL, DML, governor limits, execution context, trigger behavior, callouts, and instrumentation quality when the source log contains the required events.
```

## Add a release

1. Copy the user-visible changes from `CHANGELOG.md`.
2. Keep only behavior included in the submitted extension.
3. State the corrected or added behavior; omit claims about importance or quality.
4. Use exact view labels from `docs/reference/terminology.md`.
5. Confirm the version matches the source manifest and upload archive.
