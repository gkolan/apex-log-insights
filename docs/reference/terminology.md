# Project terminology

Use this page when naming a command, report field, user-interface label, package, test, or documentation concept. The goal is for one term to carry one meaning across code, screens, tests, and documentation.

## Product and inputs

| Use               | Meaning                                                            | Do not substitute                            |
| ----------------- | ------------------------------------------------------------------ | -------------------------------------------- |
| Apex Log Insights | Product name                                                       | LogLens, ALI, the analyzer                   |
| Apex debug log    | A raw Salesforce Apex debug-log file                               | debug file, trace output                     |
| raw log           | The unchanged log text after the full term has been introduced     | source data, raw data                        |
| report            | Structured analysis produced from one raw log                      | results data, insights payload               |
| offline report    | The canonical `buildOfflineReport()` output consumed by the viewer | v3 data, viewer JSON                         |
| synthetic log     | Fabricated test input that contains no production data             | fake log, dummy data                         |
| sanitized log     | A real log reviewed and altered to remove sensitive content        | anonymized log unless anonymity was verified |

Use “Salesforce ID,” not “SF ID,” in prose. Use `Id` only when referring to a Salesforce or TypeScript identifier whose exact name contains that spelling.

## Interfaces

| User-facing name  | Package or location              | Purpose                                                 |
| ----------------- | -------------------------------- | ------------------------------------------------------- |
| browser extension | `@apex-log-insights/browser-ext` | Opens and analyzes logs in Chrome, Edge, or Firefox     |
| VS Code extension | `packages/vscode-ext/`           | Analyzes a selected log in the workspace extension host |
| CLI               | `@apex-log-insights/cli`         | Starts the local viewer for a file or directory         |
| core library      | `@apex-log-insights/core`        | Parses log text and builds reports in an application    |
| MCP server        | `@apex-log-insights/mcp`         | Exposes focused log-analysis tools to an MCP client     |
| viewer            | `viewer/`                        | Displays an offline report in a browser                 |

Use “MCP client” for the application that starts and calls the MCP server. Use “AI client” only when explaining that the client may send tool results to a model.

Use “Node.js/TypeScript library” when introducing the core library to users. Node.js is a runtime prerequisite for source-based CLI, library, and MCP usage, not a separate Apex Log Insights extension. Browser-extension users do not need Node.js or pnpm.

## Views

Use the exact labels shown in the application:

| Label           | Route          | Reader question                                                                  |
| --------------- | -------------- | -------------------------------------------------------------------------------- |
| Triage Summary  | `#triage`      | What happened, and what needs attention first?                                   |
| Execution Story | `#execution`   | What ran, and in what order?                                                     |
| Data & Limits   | `#data`        | What touched the database or an external service, and what limits were consumed? |
| Diagnostics     | `#diagnostics` | What looks suspicious or cannot be determined confidently?                       |
| Log Explorer    | `#evidence`    | Which raw lines support a finding?                                               |

Do not call Log Explorer “Evidence view” in user instructions. `evidence` remains the internal route and report concept.

## Report and code terms

| Term            | Meaning                                                                          |
| --------------- | -------------------------------------------------------------------------------- |
| parser layer    | Extracts typed events from raw log lines                                         |
| report layer    | Analyzes parsed events and creates canonical report fields                       |
| renderer layer  | Normalizes a report for display and renders a view                               |
| `reportVersion` | Public offline-report schema version                                             |
| package version | Shared npm and extension release version                                         |
| evidence        | Raw-log line references that support a report value or finding                   |
| finding         | Evidence-backed error, warning, or diagnostic result                             |
| inference       | A conclusion derived from an event pattern rather than a directly recorded event |

Do not use “data” as a stand-alone code concept when a narrower name is available. Prefer `report`, `rawLogText`, `timelineEvents`, `soqlQueries`, or another name that identifies the value.

## Capitalization and abbreviations

Keep these forms:

- Apex
- Salesforce
- SOQL
- DML
- CPU
- CLI
- MCP
- API
- URL
- ID in prose; `Id` in an exact code or Salesforce API identifier
- JavaScript
- TypeScript
- Web Worker
- Named Credential
- Permission Set

Spell out an uncommon abbreviation on first use. Do not invent an abbreviation solely to shorten a label or API name.

## Status and redaction terms

Preserve exact stored values in code formatting. Use natural labels in prose.

| User-facing label       | Stable value or replacement                                         |
| ----------------------- | ------------------------------------------------------------------- |
| OK                      | `OK`                                                                |
| Warning                 | `WARNING`                                                           |
| Critical                | `CRITICAL`                                                          |
| Unable to determine     | use the exact report value defined by the schema                    |
| Salesforce ID redaction | `[REDACTED-ID]` in MCP output; `[SF-ID]` in viewer copy controls    |
| Email redaction         | `[REDACTED-EMAIL]` in MCP output; `[EMAIL]` in viewer copy controls |

The two redaction paths currently use different replacement contracts. Document the contract for the interface being described; do not imply that the replacements are identical.

## Names to avoid

Avoid vague names such as `data`, `info`, `manager`, `helper`, `util`, `misc`, `new`, and `temp` when a more specific concept exists. Existing internal names may remain until a coordinated rename is justified; do not copy them into new public APIs.

Avoid promotional descriptions such as “powerful,” “seamless,” “actionable,” and “comprehensive.” State the behavior a reader can verify.

## Naming review

Before accepting a public name, check:

1. Does it describe one concept or operation?
2. Does this page already define the term?
3. Is the same term used in labels, code, tests, and documentation?
4. Is a Boolean name positive and unambiguous?
5. Does a number include its unit when the unit is not obvious?
6. Will the name still make sense if the implementation changes?
7. Is a rename a public contract change that needs migration notes?

## Related

- [Documentation home](../README.md)
- [Report schema](report-schema.md)
- [Writing guide](../development/writing-guide.md)
