# Documentation

Use this index to install an interface, analyze a log, or look up a report field. Contributor documentation is listed separately from user tasks. Product screenshots are kept outside this folder under [`assets/images/`](../assets/images/).

## Documentation buckets

| Bucket                      | Use it to                                                                              | Start here                                        |
| --------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [User guides](user-guides/) | Install an interface, analyze a log, protect sensitive information, or solve a problem | [Getting started](user-guides/getting-started.md) |
| [Reference](reference/)     | Look up public APIs, report fields, and approved project terms                         | [Reference index](reference/README.md)            |
| [Development](development/) | Understand architecture, write documentation, or publish a release                     | [Development index](development/README.md)        |
| [Releases](releases/)       | Find packaged Chrome, Edge, and Firefox extension builds                               | [Release packages](releases/README.md)            |

Documentation for a specific package remains beside that package:

- [Core library](../packages/core/README.md)
- [CLI](../packages/cli/README.md)
- [MCP server](../packages/mcp/README.md)
- [Browser extension](../packages/browser-ext/README.md)
- [VS Code extension](../packages/vscode-ext/README.md)

## Sources of truth

Each topic has one authoritative document. Other pages should link to it instead of copying it.

| Topic                           | Source of truth                                                 |
| ------------------------------- | --------------------------------------------------------------- |
| Product overview                | [Project README](../README.md)                                  |
| Installation and first run      | [Getting started](user-guides/getting-started.md)               |
| Privacy and data flow           | [Privacy and security](user-guides/privacy.md)                  |
| Common problems                 | [Troubleshooting](user-guides/troubleshooting.md)               |
| Public core API                 | [Core API](reference/api/core.md)                               |
| Report format                   | [Report schema](reference/report-schema.md)                     |
| Approved project terms          | [Project terminology](reference/terminology.md)                 |
| Architecture and file ownership | [Architecture](development/architecture.md)                     |
| Documentation structure         | [Documentation standard](development/documentation-standard.md) |
| Documentation prose             | [Writing guide](development/writing-guide.md)                   |
| Release procedure               | [Release guide](development/releasing.md)                       |
| Development workflow            | [Contributing](../CONTRIBUTING.md)                              |
| Code conventions                | [Style guide](../STYLE_GUIDE.md)                                |
| Test classes and coverage       | [Testing and coverage](development/testing.md)                  |
| Shipped changes                 | [Changelog](../CHANGELOG.md)                                    |
