# Privacy and security

Use this guide before analyzing or sharing a Salesforce debug log. It explains
where each interface processes and retains data, what redaction covers, and
which values still require manual review.

## Data flow by interface

| Interface         | Parsing location                     | Network requests made by Apex Log Insights | Important boundary                                                     |
| ----------------- | ------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------- |
| Browser extension | Browser                              | None for log processing                    | Browser and extension-store infrastructure still operate normally      |
| CLI               | Local browser and local HTTP server  | None for log processing                    | Other local processes may be able to reach the selected localhost port |
| Core library      | Calling process                      | None                                       | The host application controls storage and transmission                 |
| MCP server        | Local MCP process                    | None                                       | Tool results pass to the AI client and may then reach a cloud model    |
| VS Code extension | Workspace extension host and webview | None                                       | In remote workspaces, parsing runs in the remote extension host        |

The VS Code extension keeps source text and the report in memory until its analysis panel is closed or the extension host stops. It does not persist either value, emit telemetry, start a server, or log raw content. Its webview can load only packaged resources and cannot make network requests. Selecting the explicit **Report a bug** link may ask VS Code to open the project website.

The CLI binds to `127.0.0.1`. Single-file mode serves only the selected `.log` file. Folder mode serves regular `.log` files inside the selected directory and does not follow symbolic links or serve special files such as named pipes. Validation and bounded reading use one nonblocking file handle, preventing a path replacement between the check and the read. Other local processes may still access the server while it is running, so stop it when you finish.

The core parser, CLI, browser extension, VS Code extension, and MCP server limit raw Apex debug-log input to 25 MiB. Maintained hosts validate the shared boundary before transfer or file expansion, and the core parser validates it again before splitting text into log lines, so bypassing a picker or host check does not start an unbounded parse.

MCP report serialization is iterative as well. Deep structured values do not depend on the JavaScript call stack, circular references become `null`, and indentation growth is capped after 20 levels so formatting whitespace remains proportional to report size.

The MCP server accepts only relative `.log` paths that resolve within its working directory. It rejects symbolic links that resolve outside that boundary and non-regular files such as named pipes, opens without blocking on a special-file writer, and reads at most 25 MB from a regular file. Small logs allocate in proportion to observed content rather than reserving the entire limit. Start the MCP server in a directory containing only logs that the connected MCP client is allowed to request.

## MCP redaction

Set `redact: true` for cloud AI clients. Redaction masks common Salesforce IDs,
email addresses, phone numbers, debug messages, Named Credential names,
authorization values, variable and record-field strings, quoted SOQL and SOSL
literals, URL credentials, callout query parameters, bodies, payloads, headers,
workflow errors, and raw evidence.

Raw evidence includes paired end records, recursive-trigger line arrays,
parser-diagnostic samples, and legacy `evidence` values. Query clauses, object
and field names, bind-variable names, callout methods, numeric status codes, and
numeric analysis values remain available. File names and paths still undergo
recognized-pattern masking.

Nested report sections use a stack-safe traversal. Circular references become
`null`, and a repeated value reached through a fully sensitive field receives
the stronger policy. Keys such as `__proto__` and `constructor` remain ordinary
serialized fields and cannot alter the redacted result's prototype.

Redaction reduces exposure; it is not a guarantee of anonymity. Class names, field names, object names, free-form strings outside recognized patterns, and relationships between events may still be sensitive. Review output before sharing it outside your organization.

## Bug reports and fixtures

- Never commit an unreviewed production log.
- Reduce a reproduction to the smallest synthetic log that still demonstrates the issue.
- Replace IDs, names, domains, email addresses, phone numbers, and business values.
- State that the fixture is synthetic or sanitized.
- Verify that the fixture contains no secrets before committing it.

The tracked files in `fixtures/` are intended to be synthetic test data only.

The contributor-only `pnpm test:corpus` command is the sole maintained path that
intentionally downloads an external raw log. It accepts only the pinned
Certinia sample after exact byte-count and SHA-256 verification, stores it under
ignored `external-corpus/`, and prints aggregate compatibility and sensitive
signal counts without printing matched values. A newly downloaded copy is
removed unless the contributor passes `--keep`; an existing cached copy is left
untouched. Treat any retained copy as sensitive test data even though its source
repository is public, and never commit or attach it to a bug report.

## Reporting a vulnerability

Do not include sensitive logs or exploit details in a public issue. Contact the repository owner privately through the security-reporting method configured on the GitHub repository.

## Related

- [Getting started](getting-started.md)
- [MCP server guide](../../packages/mcp/README.md)
- [Troubleshooting](troubleshooting.md)
