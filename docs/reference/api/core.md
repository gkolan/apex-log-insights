# Core API

Use this reference to integrate `@apex-log-insights/core`, parse raw Salesforce
Apex debug-log text, and build structured reports. The package has no runtime
dependencies.

## Install

```bash
pnpm add @apex-log-insights/core
```

The package supports ESM and CommonJS and includes TypeScript declarations.

## Parse a log

```typescript
import { parseLog } from "@apex-log-insights/core";

const parsed = await parseLog(logText, {
  sourceName: "debug.log",
  sourceType: "file",
  includeRawLines: true,
  enablePhaseInference: true,
});
```

### `parseLog(logText, options?)`

`logText` is the complete log as a string. Parsing does not read files or make network requests. Both `parseLog()` and the low-level `parse()` reject input larger than the exported `MAX_LOG_BYTES` ceiling (25 MiB measured as UTF-8) before expanding it into log lines.

Important options:

| Option                 | Type                                         | Purpose                                                     |
| ---------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `sourceName`           | `string`                                     | Label retained in parser metadata                           |
| `sourceType`           | `'file' \| 'salesforce-page' \| 'clipboard'` | Origin of the supplied string                               |
| `includeRawLines`      | `boolean`                                    | Retain numbered raw lines for evidence views                |
| `enablePhaseInference` | `boolean`                                    | Enable lifecycle-phase inference where evidence supports it |

The resolved `NormalizedParseResult` contains the parser result, normalized timeline, source metadata, parse duration, warnings, structured parser diagnostics, and optional raw lines. Import the `NormalizedParseResult`, `NormalizedParsingDiagnostic`, and `ParseLogOptions` types rather than depending on undocumented internal properties.

The parser retains a Salesforce `USER_INFO` record immediately before `EXECUTION_STARTED`, so downstream reports can populate user ID, username, and timezone. For a successfully paired event, `evidence.startLine` points to the begin record, `evidence.endLine` points to the matched exit record, and `evidence.lineIds` contains both physical lines. Unpaired events use their own line for both boundaries.

Salesforce wall-clock prefixes accept 1–9 fractional digits. Report timestamps normalize that precision to `HH:MM:SS.mmm` by retaining the first three fractional digits; impossible clock components and fractions beyond nanosecond precision produce no normalized wall-clock value.

`durationNs` is derived from `endNs - timestampNs` only when both values form a valid boundary. Instant and unbounded events use `null`; a paired event whose two timestamps are equal uses zero. The canonical offline report applies the same contract to `timeline` and `trace.events`.

Database row counts follow the same provenance rule. A completed SOQL, SOSL, or DML pair can report an observed zero. If its typed end record is absent, the report exposes `rows: null` rather than converting the parser's internal zero-initialized counter into a false empty result.

Aggregated row metrics remain `null` whenever any contributing operation is unknown or an exact sum would exceed JavaScript's safe-integer range. This applies to transaction summaries, DML impact, execution phases, and repeated-query patterns. Consumers must not render `null` as zero. Governor usage is used as authoritative aggregate evidence only when a positive limit shows that the corresponding cumulative block was observed.

CPU-attribution and managed-package duration totals are also exact-or-unknown. If any contributing span lacks a measured duration, the corresponding aggregate is `null`. Managed-package impact aggregates all namespaces in shared span/event passes, and duplicate namespace declarations produce one result. Managed-package row totals require completed typed database pairs, and no-op DML analysis requires observed zero duration plus observed zero rows.

`parserDiagnostics` aggregates `INVALID_LOG_LINE`, `UNSUPPORTED_EVENT`, and `MALFORMED_EVENT` records with a count, first and last physical log lines, and at most three 500-character samples. `parsingErrorOverflowCount` records how many distinct legacy warning strings exceeded the compatibility list's safety cap. Log issues retain at most 200 entries with 500-character summaries and 2,000-character descriptions; `logIssueOverflowCount` counts occurrences represented only by the **Additional log issues omitted** aggregate. These normalized fields are the supported API; consumers do not need to inspect vendor-specific collections.

Malformed fields are isolated at the event boundary. When an event timestamp cannot be parsed, the parser retains the original evidence and event name, assigns the preceding safe timestamp for internal ordering, sets `timestampIsInferred` to `true`, records a `MALFORMED_EVENT` diagnostic, and continues with later records. Consumers must inspect the flag instead of treating the substituted value as observed timing.

Relative timestamp zero is valid observed evidence. The first zero-timestamp record remains the parser root timing source, a matched exit at zero remains present, and truncation or package boundaries recorded at zero are not discarded by missing-value checks. `executionEndTime` excludes later spans whose observed total duration is zero, as documented by the low-level parser contract.

## Build an offline report

Use `buildOfflineReport` for the canonical report consumed by the viewer and extension:

```typescript
import {
  buildOfflineReport,
  parseLog,
  utf8ByteLength,
} from "@apex-log-insights/core";

const parseResult = await parseLog(logText, {
  sourceName: "debug.log",
  includeRawLines: true,
  enablePhaseInference: true,
});

const report = buildOfflineReport({
  source: {
    fileName: "debug.log",
    bytes: utf8ByteLength(logText),
  },
  parseResult,
  rawLogText: logText,
});
```

Use `buildInsightsReport` only when you need the analysis-layer report directly. New applications that need viewer-compatible JSON should prefer `buildOfflineReport`.

Both report builders accept `limits.cursorOperations` to cap detailed Apex cursor create/fetch records; the default is 100. Aggregate count and truncation metadata remain available in `database.cursorsMeta` even when the detailed collection is limited. `limits.errorItems` caps detailed errors, warnings, and parser issues at 500 by default; report construction retains only the chronologically earliest requested details while counting every candidate, and `errors.count`, `errors.truncated`, and `errors.limit` distinguish the complete count from retained detail. `limits.recursiveTriggers` retains at most 50 recursive-trigger groups by default. `recursiveTriggerAnalysis.meta` records the full group count, and each retained group keeps at most 50 unique source lines and bounded raw evidence samples with occurrence/truncation metadata.

Every `buildOfflineReport` collection limit is normalized before report construction. Fractional values are floored, negative values become zero, and non-finite values fall back to the documented default. This normalization applies to phase events and the limits forwarded to the analysis report, and `metadata.limits` records the effective values supplied by the caller.

### `processWorkerParseMessage(message, options)`

Use `processWorkerParseMessage()` when a Web Worker host needs the maintained `PARSE_LOG` validation and canonical offline-report pipeline. Pass `{ sourceType: "file" }` for a local-file host or `{ sourceType: "salesforce-page" }` for the browser extension. The helper accepts `{ type: "PARSE_LOG", logText, fileId? }` and resolves to a `PARSE_RESULT` success or error object; it does not install a worker event handler or post messages. Each host remains responsible for its worker lifecycle and transport.

The helper rejects unknown message types, empty log text, malformed optional file identifiers, and inputs above `MAX_LOG_BYTES`. A successful response preserves `fileId` as `report.source.fileName`, records the selected source type, and includes raw lines for report evidence.

### `MAX_LOG_BYTES` and `utf8ByteLength(value)`

`MAX_LOG_BYTES` is the canonical 25 MiB parser-input ceiling shared by the core parser and maintained TypeScript hosts. `utf8ByteLength()` returns the number of bytes required to encode a JavaScript string as UTF-8 without allocating the encoded byte array. Its handling of valid surrogate pairs and lone UTF-16 surrogates matches `TextEncoder`. Hosts may check the exported ceiling before calling the parser to provide a more specific error; the parser checks it again at the allocation boundary.

The low-level `parse()` result's `ApexLog.size` uses this exact UTF-8 byte definition. Use the same helper for `buildInsightsReport({ fileBytes })` and `buildOfflineReport({ source: { bytes } })`; JavaScript `string.length` counts UTF-16 code units and is not valid byte metadata for non-ASCII logs. MCP tools and all packaged parser workers already apply this contract.

`database.namedCredentials` normalizes Salesforce's current labeled request and response-detail fields as well as legacy positional records. It does not expose HTTP authorization as a structured property. Consumers must still protect or redact raw log evidence because Salesforce can include authorization and payload content in the original event text.

The parser bounds the number of tokens allocated for each pipe-delimited record. Positional schema fields are parsed normally, and the exact unsplit remainder is retained as the final payload field. This protects browser workers from delimiter-count-driven allocation without truncating generic payload evidence.

Timestamp, source-line, row-count, byte-count, governor-limit, cardinality, and profiling integers must be nonnegative safe integers. A timestamp or source-line violation makes that record malformed and preserves its raw evidence; derived metric readers return their field-specific null or zero fallback. Relative query-plan cost remains a finite nonnegative decimal.

## Errors and incomplete data

- File I/O errors belong to the calling application; this package accepts text.
- Non-string input throws `TypeError`; input larger than `MAX_LOG_BYTES` throws `RangeError` before line expansion.
- Empty or malformed input returns a parse result with no or partial events instead of inventing missing activity.
- Unsupported or malformed lines produce bounded `parserDiagnostics`; a structurally complete report is marked uncertain while any such diagnostics remain.
- Report confidence depends on the events and debug levels present in the source log.

## Public API stability

Only exports from the package root are public. Files under `src/certinia/` and `src/insights/` are implementation details unless re-exported by the package root. Report JSON has its own schema version; read [Report schema](../report-schema.md) before persisting or consuming it.

## Related

- [Core package README](../../../packages/core/README.md)
- [Report schema](../report-schema.md)
- [Privacy and security](../../user-guides/privacy.md)
