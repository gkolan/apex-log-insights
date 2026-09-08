# Report schema

Use this reference to consume the canonical offline report produced by
`buildOfflineReport()` and displayed by every maintained interface. The current
`reportVersion` is `3.0.0`.

## Compatibility contract

- `reportVersion` describes the public JSON format; it is independent of the npm package version.
- Additive implementation changes that do not alter output do not change `reportVersion`.
- Output-shape changes require a schema-version decision and coordinated producer, normalizer, renderer, and test updates.
- Consumers should use documented canonical fields. Viewer compatibility handling belongs in `viewer/modules/normalize-report.js` and its focused normalization modules.

## Top-level sections

| Field            | Purpose                                                      |
| ---------------- | ------------------------------------------------------------ |
| `reportVersion`  | Offline report schema version                                |
| `source`         | File name and byte count supplied by the caller              |
| `metadata`       | Generation and parser metadata                               |
| `entryPoint`     | Best-supported transaction entry point                       |
| `overview`       | Triage outcome and headline metrics                          |
| `context`        | Execution-context classification and supporting evidence     |
| `timeline`       | Canonical ordered events                                     |
| `execution`      | Blocks, spans, trace data, and execution analysis            |
| `phases`         | Salesforce lifecycle phases with status and confidence       |
| `database`       | SOQL, DML, Apex cursors, callouts, credentials, and patterns |
| `governorLimits` | Limit values and snapshots                                   |
| `issues`         | Evidence-backed diagnostics and warnings                     |
| `evidenceIndex`  | Mapping from findings to raw evidence                        |
| `uiHints`        | Presentation metadata that does not replace canonical data   |

Not every section is populated for every log. Absence can mean that an event did not occur, the necessary debug level was not enabled, or the parser could not support the conclusion confidently.

Parser-result normalization accepts only own fields as evidence. Values inherited through an object's prototype cannot supply events, namespaces, diagnostics, timing, or governor data. Dynamic keys in component histograms and event indexes are treated as literal data: `__proto__`, `constructor`, and other JavaScript prototype names remain ordinary own properties in the emitted JSON shape.

`governorLimits.current` contains the latest merged namespace totals. `governorLimits.snapshots` preserves cumulative observations in log order. The producer accepts both multiline Salesforce limit blocks and repeated inline `LIMIT_USAGE_FOR_NS` records; an empty namespace token is canonicalized to `default`.

`governorBurnRate` keeps the full multi-namespace trajectory, but rates and phase headroom compare one consistent namespace: `default` when present, otherwise the earliest observed namespace. A rate is `null` when elapsed time is not positive, either boundary is unknown, or a counter decreases. `projectedHeadroom` is zero once a growing limit is exhausted and never negative. Namespace-map keys are treated as data even when they equal JavaScript prototype property names.

Namespace and managed-package summaries are conservative. Ambiguous dotted Apex class and inner-class names do not establish a package namespace by themselves; the parser requires an explicit package event or another supported namespace-bearing event before attributing work to that prefix.

Custom object and platform-event API names establish a package namespace only when they contain both a namespace separator and a custom-type suffix, as in `pkg__Invoice__c` or `pkg__Order_Event__e`. Unmanaged `Invoice__c` and `Order_Event__e` belong to `default`; their leading API-name token must not appear in `components.namespaces` or `managedPackageImpact`.

Generic code-unit paths do not infer a namespace merely because they contain multiple dots: `Outer.Inner.run()` remains in `default` unless another record has already established `Outer`. For `__sfdc_trigger/Object/Trigger` descriptors, the object segment is not itself a package name. Managed custom-object syntax may establish a namespace directly; a trigger prefix requires prior namespace evidence. The complete descriptor remains the canonical trigger label used by execution detection.

Database callouts and Named Credential entries represent logical operations, not physical log-record counts. Salesforce may emit endpoint, method, headers, body, and response details as repeated typed records; the producer consolidates those fragments and retains the primary request and response evidence. Structured request parsing separates fields at recognized field labels rather than every comma, so literal commas remain part of the endpoint URL. Named Credential-to-HTTP correlation additionally requires close timestamp and physical-line proximity.

Current labeled Named Credential records populate `credentialId`, `credentialName`, `endpoint`, `method`, `externalCredentialType`, `requestSizeBytes`, `retryOn401`, `statusCode`, `responseSizeBytes`, `durationMs`, and `connectTimeMs` where Salesforce emitted those values. Older positional `Managed` and `namedCredential` layouts remain supported. HTTP authorization values are intentionally not promoted to structured fields, but `evidence.raw` and the source log can still contain them and must be treated as sensitive data.

SOQL and DML sections accept Salesforce's compact, expanded, and Flow-emitted field layouts. Symbolic bracket markers such as `[FLOW]` are retained as supported evidence with `sourceLineNumber: null`. Explain plans use parser parentage as their primary ownership key so repeated Apex lines and symbolic markers do not cause cross-query attribution.

`database.soql[].aggregations` is a safe nonnegative integer only when Salesforce emitted a valid `Aggregations:` value. Missing, empty, malformed, and precision-losing values are `null`, distinct from an observed zero. Empty or invalid explain-plan cardinality and cost fields follow the same unknown-value rule.

Named Credential sizes, timings, and status codes also require complete safe integer tokens. Malformed comma grouping, fractions, suffixes, and overflow produce `null`; HTTP response parsing does not accept a three-digit prefix from a longer labeled number. Multiline governor usage applies the same token rules before a metric becomes authoritative.

When normalizing legacy or fallback report objects, string-valued integer evidence follows the same grammar. Correctly grouped values such as `"1,000"` are accepted, while coercive JavaScript spellings such as `"1.0"` and `"1e3"` remain unknown rather than becoming numeric evidence.

`database.cursors` contains logical Apex cursor operations from Salesforce's `CURSOR_CREATE_BEGIN`, `CURSOR_CREATE_END`, `CURSOR_FETCH`, and `CURSOR_FETCH_PAGE` records. A create entry includes the query and matched creation duration; create and fetch entries retain query ID, offset, and row count when those fields are present. `database.cursorsMeta` reports the total, configured limit, and whether the returned collection was truncated. The default `cursorOperations` limit is 100. These event names and fields follow Salesforce's [Debug Log Levels event reference](https://help.salesforce.com/s/articleView?id=code_setting_debug_log_levels.htm&language=en_US).

`database.soql[].targetObject` is the object following the outer query's `FROM` clause. Relationship-subquery clauses, quoted text, and line or block comments do not override that object. Pattern grouping canonicalizes escaped string literals and dotted Apex bind expressions before counting repeated executions.

The normalized timeline recognizes both paired and compact Flow and workflow-rule records. `FLOW_START_INTERVIEWS`, `WF_RULE_EVAL`, and `EXITING_MANAGED_PKG` retain their payload, source marker, namespace where applicable, and raw evidence instead of being classified as unsupported.

`trace.debugEvents` includes standard `USER_DEBUG` records, the level-specific `USER_DEBUG_FINER`, `USER_DEBUG_FINEST`, `USER_DEBUG_FINE`, `USER_DEBUG_DEBUG`, `USER_DEBUG_INFO`, `USER_DEBUG_WARN`, and `USER_DEBUG_ERROR` variants, and `DATAWEAVE_USER_DEBUG`. Each entry retains its original `eventType`; `level` is the explicit event-name suffix for a level-specific record, the logged level for a standard record when present, or `null` for DataWeave output because that record does not declare a severity. DataWeave records tolerate layouts with or without a bracketed source marker. Wrapped message lines remain part of `message`, subject to the parser's bounded text limit.

## Evidence and confidence

Findings should carry evidence with a positive raw-log line number. Phase observations distinguish direct, derived, and inferred confidence. A renderer must not present inferred information as directly observed.

Within evidence objects, `lineNumber` identifies the 1-based raw debug-log row and `sourceLineNumber` identifies the bracketed Apex class or trigger line. Consumers must never use `sourceLineNumber` as a Log Explorer target. The viewer verifies a declared log line against `evidence.raw` before creating a navigation link.

Normalized paired events retain both physical boundaries: `evidence.startLine` is the begin record and `evidence.endLine` is the matched exit record. `context.user` is derived from the pre-execution `USER_INFO` record. Transaction start, finish, and duration remain anchored to `EXECUTION_STARTED` and its matched `EXECUTION_FINISHED`, so metadata preamble does not expand the measured execution.

`context.transaction.startTimestamp`, `context.transaction.endTimestamp`, and the wall-clock top metrics normalize Salesforce prefixes containing 1–9 fractional digits to millisecond precision. Values must use a valid 24-hour `HH:MM:SS` clock and no more than nanosecond precision; invalid prefixes produce `null` rather than a plausible-looking timestamp.

`overview.topMetrics.relativeTimeNs.start` and `.end` use the relative nanosecond counters from the execution boundary records. They are a separate time domain from `ApexLog.startTime`, which is wall-clock milliseconds since midnight. The producer never subtracts values across those domains. The end counter, wall-clock end, and transaction duration require a completely paired execution boundary; missing starts, orphan finishes, and partial recovery leave those values `null`. A complete transaction whose relative boundaries are equal has `durationMs: 0` rather than invoking a fallback.

Future-method and Batch Apex execute records follow the same pairing contract. `FUTURE_METHOD_BEGIN` closes on `FUTURE_METHOD_END`, and `BATCH_APEX_EXECUTE_BEGIN` closes on `BATCH_APEX_EXECUTE_END`; their nested Apex events retain the asynchronous span as `parentId`, and complete records expose measured `durationNs` rather than an inferred transaction-wide duration.

Automation pairing also covers `FLOW_CREATE_INTERVIEW_BEGIN/END` and `WF_FLOW_ACTION_BEGIN/END`. Flow assignment or workflow action detail records inside those boundaries retain the corresponding Automation span as `parentId`, while the begin record preserves its Flow or workflow identity payload.

Formula evaluation and Revenue Lifecycle Management operations also retain duration boundaries. `FORMULA_EVALUATE_BEGIN`, `RLM_CONFIGURATOR_BEGIN`, and `RLM_PRICING_BEGIN` pair with their corresponding `_END` records, own nested timeline children, and follow the standard partial-duration contract when an end is absent. Other registered current-generation Salesforce events retain their complete pipe-delimited payload in `text` even when the parser does not yet expose event-specific fields.

Phase event coordinates and phase evidence are derived from normalized `evidence.startLine`, never from an event's Apex `lineNumber`. This distinction also controls before-save and after-save Flow classification.

`heapAnalysis` byte aggregates follow the exact-or-unknown evidence rule. `totalAllocatedBytes`, `totalDeallocatedBytes`, `netAllocatedBytes`, `peakCumulativeBytes`, watermark `cumulativeBytes`, hotspot totals/averages, namespace totals, and phase `allocatedBytes` are `null` if their derivation would exceed JavaScript's safe-integer range. Counts remain exact, and adjacent phase windows are half-open so a boundary allocation is not counted twice.

An individual heap allocation is retained only when its complete `Bytes:` token is a correctly grouped positive safe integer. Heap namespace names are dynamic data keys and cannot collide with the object prototype. Repeated-SOQL `totalDurationMs` and `avgDurationMs` are exact only when every grouped query has a finite nonnegative measured duration; otherwise both are `null`.

Execution-phase `dataFlow` uses the same half-open boundary rule. A variable assignment whose timestamp equals the next phase start belongs only to the next phase. Record lineage scans every Salesforce ID in nested values, including strings containing multiple IDs, and object/map keys, allowing maps keyed by record ID to populate `recordsProcessed`, `inputIds`, and `outputIds` consistently.

Structured record identities and relationships require a complete 15- or 18-character alphanumeric Salesforce ID token. Direct `Id` fields, ID-list entries, record-map keys, and foreign-key values containing prefixes, suffixes, or other prose are ignored rather than copied as fabricated IDs. When a record-map key is valid and its nested `Id` is missing or malformed, the key supplies the identity. Dynamic key-prefix learning processes literal IDs from `Id = '…'` and `Id IN ('…')` predicates, excluding foreign-key fields, comments, strings, and relationship subqueries. Unambiguous query evidence outranks tokenized variable-name hints; conflicting evidence remains unresolved, and standard prefixes are immutable.

Assignment lineage and record-relationship extraction traverse nested arrays, objects, and `__r` chains iteratively with object-identity cycle detection. Deep valid values therefore retain IDs and relationship provenance without relying on recursive call-stack depth; cyclic legacy values terminate after each object is visited once.

Timeline `pairingStatus` is `not_applicable`, `complete`, `missing_end`,
`orphan_end`, `closed_by_exception`, `closed_at_truncation`, or `depth_limit`.
`durationNs` and `trace.events[].durationNs` equal `endNs - timestampNs` only
when a valid boundary exists. Instant and unbounded events use `null`; an
observed same-timestamp pair uses zero. A paired end earlier than its start is
an invalid boundary: duration is `null` and `durationIsPartial` is true rather
than exposing a negative value.

The parser groups timestamp regressions across retained physical events and
records their occurrence and first/last timestamp provenance. `classification`
is `unsupported` when an event is retained but its Salesforce field semantics
are not registered. `timestampIsInferred` is true only when the parser replaced
a malformed timestamp with the preceding safe value to preserve ordering; that
replacement is not observed timing.

Recovery-assigned end timestamps do not make an incomplete span measured. Pairing statuses `missing_end`, `orphan_end`, `closed_by_exception`, `closed_at_truncation`, and `depth_limit` always expose null normalized duration even when `endNs` is retained as structural/evidence metadata. A `not_applicable` pseudo-span may retain duration when its implementation observes both bounds, as with managed-package entry windows.

The parser changes from recursive to iterative tree construction after 500 nested events. Matched records inside that safety fallback still run their typed end processing and retain exact duration, database-row, callout-response, and method-end evidence. An exit matching an earlier fallback frame closes intervening entries as `missing_end`; an exit matching the recursive ancestor stack is left unconsumed for that ancestor. If EOF arrives first, every remaining fallback frame uses `depth_limit`, `durationIsPartial: true`, and a null normalized duration.

A relative timestamp or end boundary of zero is present evidence, not a missing field. Root timing, truncation classification, managed-package merging, and same-timestamp pairing preserve it. The low-level parser's `executionEndTime` ignores trailing measured spans with zero total duration so profiling metadata does not extend the code-execution boundary.

`asynchronousContinuations` contains evidence-backed clues for Queueable, Future, Batch Apex, and event-service activity. A clue can include an observed identity and `707` asynchronous job ID. It never means the related child transaction is present; the guidance directs the user to inspect its separate log.

`parserDiagnostics` groups malformed input by `INVALID_LOG_LINE`,
`UNSUPPORTED_EVENT`, or `MALFORMED_EVENT`. Each group includes its count, first
and last raw-log lines, and at most three 500-character samples. The offline
report copies this collection from `parseLog()` rather than exposing an
internal parser shape. The legacy parser-warning list remains bounded for
compatibility.

`metadata.parser.logIssueOverflowCount` counts occurrences represented only by
the bounded **Additional log issues omitted** entry. Aggregate timing and
occurrence evidence remain available in `issues`. The detailed `issues`
collection follows `metadata.limits.errorItems` (default 500), while
`errors.count`, `errors.truncated`, and `errors.limit` distinguish the complete
count from retained detail. Issue summaries are at most 500 characters;
descriptions and copied raw evidence are at most 2,000 characters. A log with
both execution boundary markers and parser diagnostics is `uncertain`, not
falsely classified as truncated.

`recursiveTriggerAnalysis.meta` reports the total detected recursive-trigger groups, retained-group limit, and truncation status. Each retained group exposes its full firing `count`, up to 50 unique Apex source lines and raw evidence samples, and `evidenceMeta` occurrence counts plus separate truncation flags. Raw evidence samples are at most 2,000 characters.

Integer evidence never exceeds JavaScript's exact safe-integer range. Overflowed event timestamps and Apex source lines are retained as malformed raw evidence rather than emitted as lossy numbers. Report-derived rows, bytes, limits, cardinalities, and profiling counts use null or zero when the source integer is invalid.

Database row counts also retain their evidence boundary. `database.soql[].rows`, `database.sosl[].rows`, and event-backed `database.dml[].rows` contain zero only when Salesforce emitted a matching typed end record with zero rows. When the end record is missing, `rows` is `null`; empty-query and no-op-DML findings are not inferred from that unknown value.

Row values and aggregates use an exact-or-unknown contract. SOQL, SOSL, DML,
and cursor operations expose a numeric row count only when the complete payload
token is a valid nonnegative safe integer; cursor offsets use the same rule.
Missing, nonnumeric, negative, fractional, partially numeric, incorrectly
comma-grouped, and overflowed fields are `null` even when typed boundaries are
complete.

Transaction top metrics, `analysis.dmlImpact`, execution-phase row totals,
per-object DML totals, and repeated-SOQL `totalRows` are numeric only when every
contributing row count is observed and the sum remains a safe integer. A
cumulative governor value is preferred when its positive configured limit
proves Salesforce emitted that usage block, including an observed zero. Adjacent
execution phases use half-open windows so a boundary operation belongs to one
phase only.

Timing summaries use the same contract. `cpuAttribution` and `managedPackageImpact` duration fields are `null` when any contributing span is unmeasured, negative, non-finite, or makes the aggregate non-finite. CPU-type and namespace names are data keys and cannot alter object prototypes. Managed-package row totals require completely paired database operations and valid nonnegative safe-integer operands. A no-op DML finding requires an observed duration of exactly zero as well as observed zero rows; a missing duration is not treated as zero.

`debugLevelQuality` consolidates repeated debug categories using the last observed setting. Unknown level names rank as unavailable regardless of JavaScript prototype property names. Missing Apex Code or Database configuration produces a specific `Not configured` warning rather than an unexplained low-quality result.

Visualforce viewstate warnings require a complete finite size token followed by bytes, B, KB, or MB. Direct byte values must be nonnegative safe integers and unit conversion must remain safely representable. Negative values, fractional bytes, malformed numeric suffixes, and overflow remain unknown and cannot produce a size warning.

## Safe consumption

- Treat arrays as optional at trust boundaries and normalize them before rendering.
- Escape every report-derived string before inserting it into HTML.
- Do not infer compatibility from the npm package version; inspect `reportVersion`.
- Preserve unknown fields when forwarding reports unless your application intentionally creates a projection.

The TypeScript source in `packages/core/src/offlineReport.ts`, `packages/core/src/insights/types.ts`, and `packages/core/src/report.ts` is the exact implementation contract. This page is the human-oriented map of that contract.

Source byte counts use UTF-8 encoding semantics, including `TextEncoder`-compatible replacement for lone UTF-16 surrogates. Core consumers should supply `utf8ByteLength(logText)` rather than `logText.length`; the low-level parser and bundled worker/MCP entry points use the same allocation-free counter.

## Related

- [Core API](api/core.md)
- [Project terminology](terminology.md)
- [Architecture](../development/architecture.md)
