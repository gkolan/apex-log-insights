# Troubleshooting

Use this page when installation, log loading, report content, browser opening, or repository validation does not behave as expected. Start with the observed symptom, apply the listed check, and stop when the expected result appears.

## A log does not open

Confirm that the input is a readable file ending in `.log`, or a directory containing `.log` files. With the CLI, rerun using `--debug` to show the full error stack:

```bash
apex-log debug.log --debug
```

## The report is empty or incomplete

Salesforce debug levels determine which events exist in a log. Apex Log Insights cannot reconstruct events Salesforce did not record. Check the Diagnostics view for instrumentation-quality warnings and capture a new log with appropriate Apex Code, Database, System, Validation, Workflow, and Callout levels.

## A finding looks wrong

Open its evidence link and compare the finding with the raw line. When reporting a problem, include:

- package or extension version;
- interface used;
- expected and actual result;
- smallest synthetic or sanitized log that reproduces it;
- the relevant evidence line numbers.

## The CLI does not open a browser

Copy the localhost URL printed by the CLI into a browser. On a headless machine, use `--no-open` intentionally:

```bash
apex-log debug.log --no-open
```

## VS Code does not offer an analysis action

Confirm that the active resource is a file whose name ends in `.log`. The CodeLens appears only when a bounded scan of the file prefix identifies a Salesforce debug log. You can still run **Apex Log Insights: Analyze Log File…** and confirm **Analyze Anyway** for an unusual but valid log.

## A VS Code report is stale

The extension does not reparse on every edit. Select **Refresh Analysis** in the report or run **Apex Log Insights: Refresh Analysis**. A deleted source remains visible as unavailable, but evidence links are disabled because their coordinates can no longer be verified.

## VS Code analysis fails or times out

Open **View: Output**, choose **Apex Log Insights**, and review the content-free lifecycle message. The extension rejects files larger than 25 MiB and stops parsing after 120 seconds. Close and reopen the analysis panel if its webview did not initialize; the extension never writes the raw log or report to the output channel.

## Development checks fail

Use the repository's supported package manager and Node version:

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install --frozen-lockfile
pnpm validate
```

If version synchronization fails, edit only the root `package.json` version and run `pnpm version:bump`.

## Related

- [Getting started](getting-started.md)
- [Privacy and security](privacy.md)
- [Testing and quality gates](../development/testing.md)
