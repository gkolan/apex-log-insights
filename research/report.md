# Parser Logic Report: Salesforce Debug Log Chrome Extension

## Overview

This Chrome extension retrieves and visualizes Salesforce Apex debug logs. Its parser pipeline covers three distinct concerns: **log content parsing** (extracting structured sections from raw log text), **Salesforce object notation parsing** (deserializing Apex debug output into JSON), and **error extraction** (identifying and classifying runtime faults). These are distributed across several files in `js/`, each with a focused responsibility.

---

## File Map

| File | Responsibility |
|---|---|
| `js/basic-utilities.js` | `extractUserDebugBlocks()`, HTML escaping, storage helpers |
| `js/log-parsing.js` | `parseDebugLogContent()`, limits extraction, display dispatch |
| `js/basic-parsing.js` | Core Salesforce object notation parser |
| `js/complex-parsing.js` | Nested collection and complex value parser |
| `js/formatting-utilities.js` | JSON highlighting, governor limits formatter, top-level object extractor |
| `js/salesforce-response-cleaner.js` | JSON extraction and metadata field stripping |
| `js/error-extraction.js` | `extractErrorsFromDebugLog()`, error deduplication, stack trace parsing |
| `js/log-loader.js` | `LogLoader` class — SOQL queries, cache management, log content retrieval |

---

## Stage 1: Raw Log Extraction

**Entry point:** `extractUserDebugBlocks()` in `basic-utilities.js`

This function uses a single multiline regex to extract all `USER_DEBUG` message payloads from the raw log text:

```js
/^\d{2}:\d{2}:\d{2}\.\d+\s+\(\d+\)\|USER_DEBUG\|\[[^\]]+\]\|DEBUG\|(.*?)(?=\r?\n\d{2}:\d{2}:\d{2}\.\d+)/gms
```

The lookahead on the next timestamp ensures each capture group ends cleanly at the next log event boundary. Newlines within the message body are preserved, which is important for multi-line JSON from `JSON.serializePretty()`.

**Limits extraction** in `parseDebugLogContent()` scans the log backwards for the *last* `LIMIT_USAGE_FOR_NS` section (this correctly handles logs with multiple execution contexts), then collects indented lines until a new pipe-delimited section begins. The result is passed to `formatGovernorLimits()` for HTML rendering with color-coded usage indicators.

---

## Stage 2: Salesforce Object Notation Parsing

This is the most complex part of the parser, split across `basic-parsing.js` and `complex-parsing.js`.

### Detection: `containsSalesforceObjects()`

Before any structured parsing occurs, `containsSalesforceObjects()` runs a battery of regex checks against the decoded message text to decide whether structured parsing is worthwhile. It detects:

- Standard SObject notation: `Account:{Id=001..., Name=...}`
- Custom Apex class notation: `MyWrapper:[field=value, ...]`
- Nested collections: `Bookmarks=(Bookmark:[...], Bookmark:[...])`
- JSON arrays/objects
- Quoted array strings: `"[key=value, ...]"`

If none match, the message is passed directly to `applyDebugLogHighlighting()` for syntax coloring without parsing.

### Top-Level Dispatch: `extractAndParseSalesforceObjects()`

This function in `formatting-utilities.js` is the router. It:

1. Decodes HTML entities first (`decodeHtmlEntities()`)
2. Attempts `cleanSalesforceResponse()` — strips Salesforce REST metadata (`attributes`, `done`) before displaying
3. Checks for the multi-line pattern `ObjectName:\n"[...]"` (from `JSON.serializePretty()`)
4. Tries native `JSON.parse()` for standard JSON
5. Falls back to `parseSalesforceObjectNotation()` for Apex debug-format notation
6. Splits off any text prefix (e.g., `"Full Account → "`) to preserve context labels

### Core Parser: `parseSalesforceObjectNotation()`

This function handles six patterns, evaluated in priority order:

| Priority | Pattern | Example |
|---|---|---|
| 1 | `WRAPS (raw): ...` | Internal wrapper notation |
| 2 | `(WrapperType:[...])` | Parenthesized typed list |
| 3 | `ClassName:[...]` | Custom Apex class |
| 4 | `(Object:{...}, Object:{...})` | Multiple SObjects in parens |
| 5 | `ObjectType:{...}` | Single SObject |
| 6 | `{...}` | Raw Set or Map |

For pattern 6, the parser distinguishes a **Set** from a **Map** by calling `hasEqualsAtDepthZero()` — if `=` appears outside all brackets, it's a Map; otherwise it's a Set parsed as an array.

### Key-Value Extraction: `extractKeyValuePairs()`

Rather than splitting naively on commas, this function uses a two-pass approach:

1. **Forward pass**: uses `/\b(\w+)\s*=/g` to find all key positions in the string
2. **Backward scan**: from each next-key's start position, walks back to find the depth-0 comma that terminates the current value

This handles cases like `name=John, address=City:{Name=Dallas, State=TX}` correctly — the nested `{...}` doesn't cause a false split. The depth counter tracks `{}`, `()`, and `[]` simultaneously, with a string-escape guard (`\"` and `\'`) to avoid false bracket counts inside string values.

The same pattern is duplicated in `extractComplexKeyValuePairs()` and `extractCollectionItems()` in `complex-parsing.js` — these handle nested collection types like `(Bookmark:[...], Bookmark:[...])`.

### Value Parsing: `parseValue()` / `parseComplexValue()`

Terminal value parsing handles:

- `null`, `true`, `false` as typed primitives
- Integer and float via regex with sign support
- Quoted strings (single and double quote stripping)
- Nested `(...)` collections dispatched back to `parseStructure()`
- Salesforce object notation (`key:{...}`) dispatched to `parseSingleObject()`
- Datetime normalization: `00: 00: 00` → `00:00:00` (Salesforce quirk)

### Nested Wrapper Detection

Before recursing into a `ClassName:[...]` structure, `hasNestedWrappers()` checks for another `\w+:\[` pattern inside the content. If found, the raw string is returned instead of attempting to parse it — this is a safety valve to prevent misparse of deeply nested custom types that the parser can't reliably handle.

---

## Stage 3: Error Extraction

**Entry point:** `extractErrorsFromDebugLog()` in `error-extraction.js`

This is a single-pass line parser that simultaneously tracks execution context and captures errors.

### CODE_UNIT Context Tracking

A `codeUnitStack` is maintained throughout the parse. Every `CODE_UNIT_STARTED` line pushes a unit name, and `CODE_UNIT_FINISHED` pops it. When an error is captured, `codeUnitStack[last]` is attached as `codeUnitContext` — this tells the user which class or trigger was executing when the error occurred.

### Error Types Captured

| Event Type | `isFatal` | Notes |
|---|---|---|
| `FATAL_ERROR` | `true` | Terminates transaction |
| `EXCEPTION_THROWN` | `false` | May be caught/handled |
| `COMPILE_ERROR` | `true` | Detected via pipe-line scan |
| `VALIDATION_ERROR` | `true` | Detected via pipe-line scan |

After a `FATAL_ERROR` or `EXCEPTION_THROWN` is captured, subsequent non-pipe lines are collected as stack trace fragments. Lines matching `^(Class\.|Trigger\.|AnonymousBlock:)` are added to `stackTrace[]`; all other lines are appended to `rawMessage`.

### Stack Trace Line/Column Extraction

After the parse pass, `lineNumber` and `columnNumber` are extracted from the first stack trace entry using pattern arrays like `/line\s+(\d+)/i`. If no stack trace is present, the parser falls back to scanning the raw error message itself.

### Deduplication

`deduplicateErrors()` uses a composite key of `exceptionType|message|codeUnitContext`. When the same error appears as both `EXCEPTION_THROWN` and `FATAL_ERROR` (which is common when an uncaught exception propagates), the `FATAL_ERROR` entry takes priority over the `EXCEPTION_THROWN` entry.

### Error Message Parsing

`parseErrorMessage()` tries three regex patterns against the raw error string to extract `exceptionType` and `message` separately:

1. Standard: `ExceptionType: Message`
2. System-qualified: `System.ExceptionType: Message`
3. Generic: `Word: rest of message`

If none match, the full string is returned as a generic `Error` type.

---

## Stage 4: Log Loading and Caching

**Class:** `LogLoader` in `js/log-loader.js`

Log metadata is loaded from Salesforce via three fallback channels, tried in order:

1. **Direct tab communication** — queries the active Salesforce tab using `chrome.tabs`
2. **Background service worker** — `GET_RECENT_LOGS` message to the service worker
3. **Runtime tooling query** — `EXECUTE_TOOLING_QUERY` message with a full SOQL string

The SOQL queries target `ApexLog` with fields: `Id`, `LogUserId`, `StartTime`, `LogLength`, `Application`, `Operation`, `DurationMilliseconds`, `Location`.

### Incremental Cache Strategy

On first load, up to 100 recent logs are fetched. On subsequent loads, only logs newer than the stored `lastFetchTime` are fetched, then merged with the cached list (deduped by `Id`). The cache ceiling is 1,000 logs per org per log type, keyed by `cachedLogs_{orgId}_{logType}`. Entries older than 24 hours are pruned on initialization (matching Salesforce's own log retention policy).

Log *content* is not cached at the `LogLoader` level — it's fetched on demand via `getLogContent()` and cached separately by the `logCache` module.

---

## Identified Issues and Risks

### 1. Duplicated Parsing Logic

`extractKeyValuePairs()` (basic-parsing.js), `extractComplexKeyValuePairs()` (complex-parsing.js), and `extractCollectionItems()` (complex-parsing.js) are near-identical implementations of the same depth-aware backward-scan algorithm. This creates a maintenance risk: a bug fix or edge-case improvement needs to be applied in three places.

**Recommendation:** Extract into a single shared `extractPairsWithSeparator(content, separatorChar)` utility.

### 2. String Escape Handling is Incomplete

The `inString` flag in all parsers toggles on `"` or `'` but does not track *which* quote character opened the string. This means `"it's a test"` would incorrectly toggle off at the apostrophe. For typical Apex debug output this is unlikely to trigger, but it is a latent correctness bug.

### 3. Nested Wrapper Fallback is Too Broad

`hasNestedWrappers()` returns `true` for any content matching `\w+:\[`. This pattern also matches datetime strings like `2025-01-15T12:30:00.000Z` if the content happens to contain a colon-bracket sequence in a field value. The fallback to raw string output in that case hides potentially parseable data.

### 4. `extractKeyValuePairs` Regex Matches Inside Values

The forward-pass key scan using `/\b(\w+)\s*=/g` will match `=` signs inside string values (e.g., `url=https://example.com?foo=bar`). The backward-scan boundary logic partially mitigates this, but false key detections mid-value can still produce malformed output for URL-containing fields.

### 5. SOQL Injection in Log Queries

The `_fetchNewLogs()` and related methods interpolate `logType` directly from a DOM element (`document.getElementById('logTypeFilter').value`) into SOQL strings without sanitization. While this is within a Chrome extension context (no server-side risk), a compromised or malformed filter value could produce an invalid SOQL query or unexpected behavior.

### 6. `localStorage` Used for Log Caching

The cache layer uses `localStorage` directly for log metadata. This is synchronous, size-limited (~5MB across all keys), and shared across all windows. For large orgs with many logs, the 1,000-log cap combined with `JSON.stringify` overhead on every write could introduce noticeable UI jank.

---

## Summary

The parser pipeline is well-structured for its purpose and handles the irregular, non-standard output format of Salesforce Apex debug logs competently. The depth-aware, position-indexed key-value extraction is a sound approach to a genuinely difficult parsing problem. The main areas for improvement are code deduplication across the three parallel parser implementations, hardening the string-escape logic, and tightening the nested wrapper detection heuristic.
