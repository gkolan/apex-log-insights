# Apex Log Insights — Marketplace listing

## Short description

Analyze Salesforce Apex debug logs locally in VS Code with evidence-linked execution, database, limit, and diagnostic views.

## Description

Apex Log Insights turns a Salesforce Apex debug log into five investigation views without sending the log to a service:

- **Triage Summary** highlights the outcome, failures, warnings, and top resource signals.
- **Execution Story** reconstructs ordered execution and transaction phases.
- **Data & Limits** explains SOQL, DML, callouts, and governor-limit pressure.
- **Diagnostics** preserves parser warnings and confidence boundaries.
- **Log Explorer** keeps every conclusion connected to raw evidence.

Analyze an active editor, an Explorer-selected `.log` file, or a file chosen from the command palette. Select a **Log line** in the report to reveal that exact source line. When an open or on-disk source changes, the report stays visible and asks before refreshing. Unsaved editor content is analyzed in memory without saving it.

Commands and panel titles always use the **Apex Log Insights** name, making the extension clear when Certinia Apex Log Analyzer or Salesforce extensions are installed alongside it.

## Privacy

Parsing runs in the VS Code workspace extension host. The extension does not require Salesforce credentials, start a server, emit telemetry, or make a network request for log processing. Source text and reports remain in memory until the panel or extension host closes. In a remote workspace, parsing occurs in that remote extension host.

See the repository [privacy guide](../../../docs/user-guides/privacy.md) for the complete boundary.

## Support

Report defects through the repository issue tracker without attaching an unreviewed production log. Use a synthetic or sanitized reproduction.
