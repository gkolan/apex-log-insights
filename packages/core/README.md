# `@apex-log-insights/core`

Use this package to parse Apex debug-log text or build a report inside a JavaScript or TypeScript application. A successful integration supplies log text, receives typed parser or report output, and does not require a runtime dependency from this package.

## Install and use

```bash
pnpm add @apex-log-insights/core
```

```typescript
import {
  buildOfflineReport,
  MAX_LOG_BYTES,
  parseLog,
  utf8ByteLength,
} from "@apex-log-insights/core";

if (utf8ByteLength(logText) > MAX_LOG_BYTES) {
  throw new Error("Log exceeds the 25 MiB input limit.");
}

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
  limits: {
    eventsPerType: 20,
    triggerNames: 50,
    soqlPatterns: 25,
    triggerCascadeChildren: 20,
    spanHotspots: 25,
    recordsPerSObject: 100,
    errorItems: 500,
    recursiveTriggers: 50,
  },
});
```

Every `limits` property is optional. Nonnegative finite values, including zero,
bound the corresponding report collection while aggregate counts and truncation
metadata continue to describe the full analysis. Fractional values are floored,
negative values become zero, and `NaN` or infinite values use the documented
default. `report.metadata.limits` records the effective value of every supplied
limit. Error, warning, and parser-issue candidates are counted as they are found
and only the chronologically earliest `errorItems` details are retained, avoiding
an unbounded pre-truncation merge.

Read the complete [Core API](../../docs/reference/api/core.md) and [Report schema](../../docs/reference/report-schema.md) before building a persistent integration.

`MAX_LOG_BYTES` is the exported 25 MiB ceiling enforced by both `parseLog()` and the low-level `parse()` before line expansion. `utf8ByteLength(text)` matches UTF-8 `TextEncoder` sizing without allocating another full-size byte buffer, making it suitable for an earlier host-specific check in memory-constrained workers.

Web Worker hosts can call `processWorkerParseMessage(message, { sourceType })` to share the maintained `PARSE_LOG` validation and offline-report pipeline. The helper returns a `PARSE_RESULT` object but does not install an event handler or post to a worker scope; those lifecycle operations remain host responsibilities. See the [Core API](../../docs/reference/api/core.md#processworkerparsemessagemessage-options) for the message contract.

The low-level `parse()` result reports `ApexLog.size` using that UTF-8 definition. Pass the same helper's result to report builders; `text.length` measures UTF-16 code units and undercounts non-ASCII logs.

Log-record tokenization is bounded independently of payload delimiter count. The parser reads the positional fields required by Salesforce event schemas and retains the exact remaining pipe-delimited payload as one tail token, preventing delimiter-heavy input from creating unbounded token arrays.

Salesforce wall-clock prefixes support 1–9 fractional digits. Canonical reports normalize them to millisecond precision after validating the 24-hour clock, so nanosecond-precision logs retain transaction timestamps without accepting impossible time values.

The low-level parser applies that same exact `HH:MM:SS.f` grammar before setting `ApexLog.startTime`. Canonical `relativeTimeNs` values are derived separately from the execution records' relative nanosecond counters; wall-clock milliseconds are never used in relative duration arithmetic. Transaction duration and its end boundary require a complete `EXECUTION_STARTED`/`EXECUTION_FINISHED` pair. Missing or partial boundaries remain `null`, while a matched same-timestamp transaction remains an observed zero duration.

Parser recovery may retain a synthetic `exitStamp` so tree structure and evidence windows remain navigable. Normalized durations are nevertheless `null` whenever pairing is partial (`missing_end`, `orphan_end`, exception/truncation closure, or depth limit). Only complete boundaries and intentionally bounded `not_applicable` pseudo-spans can produce measured timing. Beyond the 500-level recursive safety boundary, an iterative fallback continues matching typed ends and extracting their row, response, method, and timing evidence. It unwinds missing inner entries without consuming an exit owned by an earlier or recursive ancestor; frames left open at EOF are explicitly partial.

Integer evidence is accepted only when it is nonnegative and exactly representable by JavaScript. Overflowed timestamps or Apex source lines become bounded malformed-event diagnostics; aggregate metrics such as rows, heap bytes, and governor usage use their documented safe fallback instead of exposing lossy values.

Plain and comma-formatted integer fields share one complete-token parser. Three-digit grouping must be valid, and partial, fractional, or scientific-notation strings are rejected consistently for database rows, cursor offsets, Named Credential metrics, callout status codes, multiline governor usage, flattened legacy parser objects, and offline-report fallback fields.

Explain-plan cardinalities and cumulative-profiling counts, timings, and source lines use that same complete safe-integer contract. Explain relative cost accepts a complete finite nonnegative decimal or scientific token; malformed prefixes cannot become apparently valid plan evidence.

SOQL, SOSL, DML, and cursor row counts are evidence-aware: zero means Salesforce explicitly reported no rows, while `null` means the operation lacks a valid row-count field even if its typed boundaries are otherwise complete. Numeric tokens must be complete safe nonnegative integers; fractional values, numeric prefixes with junk suffixes, invalid comma grouping, and overflow remain unknown. Cursor offsets follow the same rule. Reports do not turn unknown results from truncated or malformed logs into empty-query or no-op-DML findings.

SOQL aggregation counts are also exact-or-unknown. A valid observed `Aggregations:` integer may be zero, while a missing, empty, malformed, or unsafe value is `null`; query-plan numeric fields do not coerce empty text to zero.

Derived row totals follow the same rule: transaction, phase, DML-impact, per-object, and repeated-query aggregates are `null` if any input is unknown or the exact sum would overflow a safe integer. Adjacent phase windows assign events at the next phase's start to that next phase rather than counting them twice.

Derived heap byte values are exact-or-unknown as well. Allocation, deallocation, net, peak, watermark, hotspot, namespace, and phase totals become `null` if safe-integer addition or subtraction would lose precision. Allocation counts remain available, and an allocation exactly at the next phase's start belongs only to that next phase.

Individual heap byte fields must be complete, correctly grouped positive safe integers. Namespace summaries treat namespace names as data even when they match JavaScript prototype properties. Repeated-SOQL duration totals and averages remain `null` if any grouped execution lacks a valid finite nonnegative duration, rather than treating missing timing as zero.

Phase data-flow assignments use those same half-open windows, so a boundary assignment cannot become both an output of one phase and an input to the next. Every Salesforce ID is collected from nested strings, including multi-ID strings, and object/map keys; record maps keyed by ID therefore contribute to `recordsProcessed`, `inputIds`, and `outputIds`.

Execution-phase SOQL, event-backed DML, and variable assignments are attributed in one pass per collection. This keeps phase enrichment proportional to the analyzed evidence rather than multiplying full collection scans by the number of phases, while retaining source order within each phase.

Governor-limit phase deltas use binary searches over the sorted snapshot timeline. The selected evidence remains the last snapshot at or before phase start and the last snapshot inside the phase, falling forward to the first later snapshot only when the phase contains none.

Governor burn rates and per-phase headroom compare snapshots from one namespace, preferring Salesforce's `default` transaction namespace. Zero elapsed time and decreasing counters leave the rate unknown, exhausted limits expose zero projected headroom, and untrusted namespace names cannot collide with JavaScript object prototypes.

Execution-context detection scans event evidence once and gives canonical asynchronous, Batch Apex, Platform Event, and trigger records priority over derived class-name fallbacks. Context overrides accept only the documented declared values; inherited JavaScript object-property names are not valid overrides.

Structured record-graph fields use stricter semantics than prose discovery. A direct `Id`, ID-list item, map key, or foreign-key value must be one complete 15- or 18-character alphanumeric Salesforce ID; surrounding text invalidates the field rather than becoming part of a fabricated ID. A valid record-map key is retained when its nested value has no valid `Id`, and dynamic prefix learning examines every literal ID in an `Id IN (...)` query.

Dynamic custom-prefix learning gives unambiguous literal `Id` equality/list predicates priority over tokenized variable-name hints. It ignores IDs from foreign-key predicates, comments, strings, and relationship subqueries; conflicting evidence leaves a prefix unknown instead of letting input order choose an sObject type. Standard Salesforce prefixes cannot be overridden.

Managed-package attribution for custom object and platform-event API names requires the full `namespace__Name__suffix` shape. A single suffix boundary in an unmanaged name such as `Invoice__c` or `Order_Event__e` does not establish a namespace; Event Service execution for those types remains in `default`.

Generic dotted code-unit names are equally conservative: `Outer.Inner.run()` is an unmanaged inner-class path unless `Outer` was independently observed as a namespace. Salesforce trigger descriptors use `__sfdc_trigger/Object/Trigger`; the object segment is identity data, not a namespace. A managed custom-object segment can establish its package, while a trigger-name prefix is accepted only when prior evidence established it.

Lineage and relationship-graph walkers are iterative and cycle-aware. Deep nested variable values and `__r` relationship chains do not consume recursive call-stack depth, while repeated or cyclic legacy objects are visited once. The normal report pipeline remains bounded by its raw-log input limit and per-sObject output truncation.

CPU and managed-package timing summaries likewise return `null` when an included span is unmeasured rather than presenting missing work as zero milliseconds. Managed-package impact uses shared namespace accumulators in one span pass and one event pass rather than rescanning the transaction for each package. Managed-package row totals require completed database pairs, and no-op findings require both observed zero rows and observed zero duration.

CPU-type and namespace keys are treated as untrusted data and cannot collide with JavaScript object prototypes. Every duration and row operand must itself be finite, nonnegative, and exactly representable where required; a negative value cannot cancel positive work into an apparently valid total. Debug-level quality uses the final setting for duplicate categories and reports missing Apex Code or Database configuration evidence explicitly.

Report normalization reads parser evidence from own properties only; inherited prototype values are never promoted into canonical facts. Event-type, namespace, category, and debug-category histograms and indexes treat every label as data, including names such as `__proto__` and `constructor`.

Visualforce viewstate warnings require a complete finite size with a supported byte, KB, or MB unit. Direct byte values must be safe integers, and converted sizes must remain safely representable; malformed numeric prefixes cannot create a false large-viewstate warning.

Recursive-trigger detection follows parent chains against a same-trigger ID set instead of comparing every span pair. Reports retain the highest-count groups up to `recursiveTriggers`; per-group firing counts remain complete while source-line and raw-text evidence is deduplicated into at most 50 samples with explicit occurrence and truncation metadata.

## Capabilities

The engine parses execution events and produces analysis for lifecycle phases, SOQL and DML, Apex cursor creation and fetches, callouts, governor limits, CPU and heap usage, trigger cascades, recursion, execution context, Apex and DataWeave user-debug records, Formula evaluation and Revenue Lifecycle Management spans, diagnostics, and raw-line evidence. Its event registry tracks the current upstream Certinia parser set; recognized generic events retain their full payload even before event-specific fields are modeled. A malformed event is isolated to its own record, retains its original evidence, and does not prevent later valid records from being analyzed. Pre-execution `USER_INFO` records are retained for user and timezone metadata, while transaction timing remains anchored to `EXECUTION_STARTED` and its matched finish. Paired events expose both begin and end evidence lines. Timeline durations are present only when both timestamp boundaries exist; `null` means unmeasured, while zero can represent an observed same-timestamp pair. A backwards end boundary is unmeasured and partial, never a negative duration. Timestamp-order violations cover every retained event and `parseLog().issues` preserves their grouped `occurrences`, `firstTimestampNs`, and `lastTimestampNs`. Issue storage is capped at 200 entries; long text and excess distinct errors cannot grow report memory without bound, and `logIssueOverflowCount` preserves how many occurrences are represented only by the overflow aggregate. LF, CRLF, and CR line endings produce the same event and evidence coordinates. `parseLog()` exposes bounded `parserDiagnostics` directly, so integrations do not need to inspect the opaque vendor parser result. Results depend on the events and debug levels present in the source log.

Relative timestamp zero is valid throughout the parser. It can anchor the first record, a matched exit, or a max-size truncation boundary without being mistaken for a missing value. Trailing profiling spans with an observed zero duration do not extend the low-level parser's measured execution end.

Named Credential analysis accepts both older positional log layouts and Salesforce's current labeled request/response-detail records. Structured output includes credential identity, endpoint, method, external credential type, byte counts, retry behavior, status, and callout/connect timing where observed. Authorization header values are not copied into those structured fields; the original raw evidence remains sensitive input.

Future-method and Batch Apex execute begin/end records are paired as code-unit spans. The normalized timeline retains their nested Apex children, exact start/end evidence, payload identity, and measured duration when both boundaries are present.

Flow interview creation and workflow-launched Flow actions are paired as Automation spans. Detail records remain children of the operation that emitted them rather than appearing as unrelated timeline entries.

## Public and internal APIs

Imports from `@apex-log-insights/core` are public. Source files under `src/certinia/` and `src/insights/` are internal unless exported by `src/index.ts`. The offline report schema has its own version and compatibility rules.

## Development

```bash
pnpm --filter @apex-log-insights/core build
pnpm --filter @apex-log-insights/core test
pnpm validate
```

Parser changes belong in `src/certinia/`; report changes belong in `src/insights/` and the report assemblers. Read [Architecture](../../docs/development/architecture.md).
