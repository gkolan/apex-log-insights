# Salesforce Debug Log — Complete Event Type Reference

> **Scope**: All event categories emitted in Salesforce Apex debug logs (`.log` files). Covers log levels, logged fields, and execution lifecycle for every major category. Flow events are excluded — see the companion Flow reference.
>
> **Audiences**: General Salesforce developer reference; LogLens parser/analysis implementation guide.

---

## Table of Contents

1. [Log Level Hierarchy](#1-log-level-hierarchy)
2. [Apex Code](#2-apex-code)
3. [Database](#3-database)
4. [Callout](#4-callout)
5. [Validation](#5-validation)
6. [Workflow & Process Builder](#6-workflow--process-builder)
7. [Visualforce](#7-visualforce)
8. [System & Governor Limits](#8-system--governor-limits)
9. [Security & Sharing](#9-security--sharing)
10. [NBA / Einstein Next Best Action](#10-nba--einstein-next-best-action)
11. [Wave / CRM Analytics](#11-wave--crm-analytics)
12. [Event Monitoring & Platform Events](#12-event-monitoring--platform-events)
13. [Cross-Category Notes for LogLens](#13-cross-category-notes-for-loglens)

---

## 1. Log Level Hierarchy

Each log category has an independent level setting. Events at or below the configured level are emitted.

| Level | Numeric | Notes |
|-------|---------|-------|
| `NONE` | 0 | No events emitted for this category |
| `ERROR` | 1 | Unhandled exceptions and fatal conditions only |
| `WARN` | 2 | Recoverable conditions worth surfacing |
| `INFO` | 3 | Lifecycle milestones; default minimum for most categories |
| `DEBUG` | 4 | General developer debug output (`System.debug()` at default) |
| `FINE` | 5 | Entry/exit of constructors, methods |
| `FINER` | 6 | Local variable state, field assignments |
| `FINEST` | 7 | Deepest granularity — call stack, heap snapshots |

The `Workflow` log category maps to FINE/FINER levels when referring to Flow, but for classic Workflow Rules and Process Builder it uses its own level setting. The `ApexCode` category is most commonly set to `DEBUG` for general debugging; `FINER` or `FINEST` adds significant noise.

---

## 2. Apex Code

**Category setting name**: `ApexCode`

This is the primary category for all Apex execution — classes, triggers, anonymous scripts, test methods, and inbound invocations. It is the most verbose and most commonly used category.

### 2.1 Error and Warning Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `FATAL_ERROR` | `ERROR` | Exception type, message, stack trace |
| `EXCEPTION_THROWN` | `ERROR` | Exception type, message |

**`FATAL_ERROR`**: Unhandled exception that terminates the transaction. The message and stack trace are the definitive source for exception root cause. In a multi-trigger transaction the stack trace will show the outermost entry point, not necessarily the originating class.

**`EXCEPTION_THROWN`**: Emitted every time an exception is instantiated via `throw` or re-thrown, regardless of whether it is caught. You will see this even for caught exceptions — it does not indicate a transaction failure on its own. Cross-reference with `FATAL_ERROR` or the absence of a closing `CODE_UNIT_FINISHED` to determine if the exception propagated.

### 2.2 INFO and Above Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `CODE_UNIT_STARTED` | `INFO` | Unit type, identifier (class/trigger name, method) |
| `CODE_UNIT_FINISHED` | `INFO` | Unit type, identifier |
| `EXECUTION_STARTED` | `INFO` | (none) |
| `EXECUTION_FINISHED` | `INFO` | (none) |

**`EXECUTION_STARTED` / `EXECUTION_FINISHED`**: Top-level transaction boundary. Everything in a single log is bracketed by these two events. There is exactly one pair per log file.

**`CODE_UNIT_STARTED` / `CODE_UNIT_FINISHED`**: Each discrete unit of Apex execution — a trigger invocation, a VF controller method, a future call dispatch, a Queueable `execute()`, etc. — emits this pair. These are the primary lifecycle events for execution time attribution at the unit level. Unit types include: `TRIGGERS`, `VF_PAGE`, `AURA_COMPONENT`, `VALIDATION`, `WORKFLOW`, `PROCESS_BUILDER`, `FLOW`, `CALLOUT_RESPONSE`, `TEST_METHOD`, `ANONYMOUS_BLOCK`, `SYSTEM_MODE_ENTER`, and others.

A `CODE_UNIT_STARTED` with no matching `CODE_UNIT_FINISHED` indicates the unit was terminated by an unhandled exception or limit violation.

### 2.3 DEBUG and Above Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `USER_DEBUG` | `DEBUG` | Log level used in the call, message |
| `SYSTEM_MODE_ENTER` | `DEBUG` | (none) |
| `SYSTEM_MODE_EXIT` | `DEBUG` | (none) |

**`USER_DEBUG`**: Emitted by `System.debug()` calls. The level within the log line reflects the level passed to `System.debug(LoggingLevel.X, ...)`. If no level is passed, defaults to `DEBUG`. These are the primary developer-inserted instrumentation points. High volume in tight loops is a common log truncation cause.

**`SYSTEM_MODE_ENTER` / `SYSTEM_MODE_EXIT`**: Brackets execution of code running in system context (e.g. `without sharing` class, or a `Database.runAs()` block boundary). Relevant for security auditing.

### 2.4 FINE and Above Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `CONSTRUCTOR_ENTRY` | `FINE` | Class name, parameter types |
| `CONSTRUCTOR_EXIT` | `FINE` | Class name |
| `METHOD_ENTRY` | `FINE` | Class name, method name, parameter types |
| `METHOD_EXIT` | `FINE` | Class name, method name |
| `STATIC_VARIABLE_INIT` | `FINE` | Class name, variable name, value |

**`METHOD_ENTRY` / `METHOD_EXIT`**: The core call graph trace. Every non-trivial invocation emits this pair. The gap between ENTRY and EXIT is the method's wall-clock execution time in the log — useful for identifying hotspots. At FINER+ these entries proliferate rapidly; platform/system class calls are also emitted and can dwarf application code.

**`CONSTRUCTOR_ENTRY` / `CONSTRUCTOR_EXIT`**: Equivalent to METHOD_ENTRY/EXIT but for object instantiation. Shows parameter types (not values) to distinguish overloads.

**`STATIC_VARIABLE_INIT`**: Fires once per class per transaction when a static variable is initialized. Useful for detecting unexpected class re-initialization or static context issues across trigger re-entrant scenarios.

### 2.5 FINER and Above Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `VARIABLE_SCOPE_BEGIN` | `FINER` | Variable name, type, declared value |
| `VARIABLE_ASSIGNMENT` | `FINER` | Variable name, value, line number |
| `HEAP_ALLOCATE` | `FINER` | Size (bytes), object type |
| `STATEMENT_EXECUTE` | `FINER` | Line number |

**`VARIABLE_ASSIGNMENT`**: Every local variable write with the new value. Essential for tracking data flow through complex methods. The value is serialized to a string representation — collections show truncated contents, large objects show field counts.

**`HEAP_ALLOCATE`**: Every heap allocation with byte size. Volume and cumulative size inform heap pressure analysis. Rarely needed for application debugging; primary use case is profiling and LogLens heap watermark tracking.

**`STATEMENT_EXECUTE`**: Line-by-line execution trace. Extremely high volume — a single method invocation can emit hundreds of these. Typically only useful for pinpointing the exact line of a runtime fault.

### 2.6 FINEST Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `CUMULATIVE_LIMIT_USAGE` | `FINEST` | Governor limit snapshot (all limits) |
| `CUMULATIVE_LIMIT_USAGE_END` | `FINEST` | (closes the snapshot block) |
| `TOTAL_EMAIL_RECIPIENTS_QUEUED` | `FINEST` | Count |
| `SAVEPOINT_SET` | `FINEST` | Savepoint name |
| `SAVEPOINT_ROLLBACK` | `FINEST` | Savepoint name |

**`CUMULATIVE_LIMIT_USAGE`**: A formatted multi-line block showing all governor limits at the point of emission — SOQL queries, DML statements, CPU time, heap size, callouts, etc. The block is not a single log line; it spans multiple lines until `CUMULATIVE_LIMIT_USAGE_END`. This is the primary data source for LogLens governor limit burn rate analysis.

**`SAVEPOINT_SET` / `SAVEPOINT_ROLLBACK`**: Tracks `Database.setSavepoint()` and `Database.rollback()` calls. Useful for identifying partial rollback patterns and unexpected rollback paths.

### 2.7 Apex Lifecycle Mental Model

```
EXECUTION_STARTED
  CODE_UNIT_STARTED [Trigger: AccountTrigger]
    CONSTRUCTOR_ENTRY / EXIT           ← handler class init
    METHOD_ENTRY / EXIT                ← handler method calls
      USER_DEBUG                       ←   instrumentation
      VARIABLE_ASSIGNMENT              ←   data flow (FINER)
      HEAP_ALLOCATE                    ←   object creation (FINER)
      STATEMENT_EXECUTE                ←   line trace (FINEST)
    EXCEPTION_THROWN                   ← if thrown (even if caught)
  CODE_UNIT_FINISHED [Trigger: AccountTrigger]

  CODE_UNIT_STARTED [VF: MyPage/init]
    ...
  CODE_UNIT_FINISHED [VF: MyPage/init]

  CUMULATIVE_LIMIT_USAGE               ← governor snapshot (FINEST)
  CUMULATIVE_LIMIT_USAGE_END

EXECUTION_FINISHED

// Abnormal exits:
FATAL_ERROR                            ← transaction terminated
// CODE_UNIT_FINISHED absent           ← unit did not complete normally
```

The `CODE_UNIT_STARTED` / `CODE_UNIT_FINISHED` pairing is the primary execution tree anchor — build the call graph by nesting these. `METHOD_ENTRY` / `METHOD_EXIT` builds the per-unit call graph. Unmatched opens indicate the termination point.

---

## 3. Database

**Category setting name**: `Database`

All SOQL queries, SOSL searches, DML operations (insert/update/delete/upsert/undelete), and related execution events.

### 3.1 Error Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `DML_ERROR` | `ERROR` | DML operation, object type, error message |

**`DML_ERROR`**: Emitted when a DML operation raises an exception — either a hard exception (unhandled) or a partial success scenario with error rows. In partial-success DML (`allOrNone=false`), this may fire without aborting the transaction.

### 3.2 INFO Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `DML_BEGIN` | `INFO` | DML operation type, object, row count |
| `DML_END` | `INFO` | DML operation type, object |
| `SOQL_EXECUTE_BEGIN` | `INFO` | Query string (truncated), row limit |
| `SOQL_EXECUTE_END` | `INFO` | Row count returned |
| `SOSL_EXECUTE_BEGIN` | `INFO` | Search query string |
| `SOSL_EXECUTE_END` | `INFO` | Object and row counts per type |

**`DML_BEGIN` / `DML_END`**: Brackets every DML statement. The operation type (`Insert`, `Update`, `Delete`, `Upsert`, `Undelete`, `Merge`) and row count are the primary data points. A DML_BEGIN with no DML_END indicates the operation did not complete — either a hard exception or transaction termination. These are the events to correlate with DML governor limit consumption.

**`SOQL_EXECUTE_BEGIN` / `SOQL_EXECUTE_END`**: Brackets every `[SELECT ...]` execution. `BEGIN` shows the query text (may be truncated for long queries). `END` shows the actual rows returned. The gap between timestamps is the SOQL execution time — the primary data source for slow query identification. SOQL in a loop pattern is detectable by repeated `SOQL_EXECUTE_BEGIN` inside a `METHOD_ENTRY` or `FLOW_ELEMENT_BEGIN` context.

**`SOSL_EXECUTE_BEGIN` / `SOSL_EXECUTE_END`**: Equivalent for `[FIND ...]` searches. Less common but structurally identical.

### 3.3 FINE Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `SOQL_EXECUTE_EXPLAIN` | `FINE` | Query plan details (leading operation, cost, rows) |

**`SOQL_EXECUTE_EXPLAIN`**: The query plan emitted alongside the query. Shows whether a query hit an index, triggered a full table scan, or used a custom index. The "cost" field is a relative selectivity estimate, not a time value. Available at FINE; extremely useful for query optimization but rarely emitted by default.

### 3.4 FINER Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `QUERY_MORE_BEGIN` | `FINER` | Query locator |
| `QUERY_MORE_END` | `FINER` | Row count |

**`QUERY_MORE_BEGIN` / `QUERY_MORE_END`**: Emitted when a query returns more than 200 rows and subsequent pages are fetched via `QueryLocator.iterator()` in batch or via explicit `queryMore`. Identifies pagination in bulk operations.

### 3.5 Database Lifecycle Mental Model

```
CODE_UNIT_STARTED
  SOQL_EXECUTE_BEGIN [SELECT Id FROM Account WHERE ...]
  SOQL_EXECUTE_END   [17 rows]
    SOQL_EXECUTE_EXPLAIN  ← query plan (FINE)

  DML_BEGIN [Insert, Account, 5 rows]
  DML_END   [Insert, Account]

  DML_BEGIN [Update, Contact, 200 rows]
  DML_END   [Update, Contact]

  // Error path:
  DML_BEGIN [Delete, Opportunity, 1 row]
  DML_ERROR [Delete failed: ENTITY_IS_DELETED]
CODE_UNIT_FINISHED
```

`SOQL_EXECUTE_BEGIN` with the query string is the primary key for SOQL pattern normalization in LogLens — strip bind variable values, normalize IN clauses, and group identical query patterns across invocations.

---

## 4. Callout

**Category setting name**: `Callout`

HTTP callouts, SOAP callouts, named credential calls, and any outbound external service invocation.

### 4.1 Error Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `CALLOUT_REQUEST` (on error) | `ERROR` | Method, URL, headers, body |
| `CALLOUT_RESPONSE` (on error) | `ERROR` | Status code, headers, body |

### 4.2 INFO Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `CALLOUT_REQUEST` | `INFO` | HTTP method, URL, request headers, request body |
| `CALLOUT_RESPONSE` | `INFO` | HTTP status code, response headers, response body |

**`CALLOUT_REQUEST`**: Emitted immediately before the outbound request is sent. Contains the full URL (including query parameters), HTTP method, all headers (including authorization headers if not masked), and the request body up to the log body limit. For named credentials, the endpoint is shown as the resolved URL. This is the definitive record of what was actually sent.

**`CALLOUT_RESPONSE`**: Emitted immediately after the response is received. Contains the status code, response headers, and response body. Timeout and network-level failures still emit this event with appropriate error status.

Body content is truncated at the log line character limit. For large payloads, only the first portion is visible. No separate BEGIN/END pairing — each callout is a single REQUEST followed by a single RESPONSE.

### 4.3 Callout Lifecycle Mental Model

```
CODE_UNIT_STARTED
  CALLOUT_REQUEST  [POST https://api.example.com/data]
    headers: Authorization: Bearer ****
    body: {"id":"...", "name":"..."}
  CALLOUT_RESPONSE [200 OK]
    body: {"result":"success", ...}
CODE_UNIT_FINISHED

// Error path:
  CALLOUT_REQUEST  [GET https://api.example.com/timeout]
  CALLOUT_RESPONSE [408 Request Timeout]
```

Callout governor limit consumption (max 100 callouts per transaction, max 120s total callout time) is tracked via `CUMULATIVE_LIMIT_USAGE`. Callouts cannot occur inside `@future` methods that are called from a context that already has an open DML operation — this constraint surface is identifiable by analyzing the transaction structure around `CALLOUT_REQUEST`.

---

## 5. Validation

**Category setting name**: `Validation`

Record validation rules — both standard and custom — evaluated during DML operations.

### 5.1 INFO Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `VALIDATION_RULE` | `INFO` | Validation rule name, object, result (pass/fail) |
| `VALIDATION_ERROR` | `INFO` | Validation rule name, error message, field |
| `VALIDATION_PASS` | `INFO` | Validation rule name, object |
| `VALIDATION_FORMULA` | `INFO` | Formula text, result |
| `VALIDATION_FAIL` | `INFO` | Validation rule name, object |

**`VALIDATION_RULE`**: Emitted when a validation rule is evaluated. Result field indicates whether the rule triggered (`true` = failed = error raised, `false` = passed = no error).

**`VALIDATION_ERROR`**: Only emitted when a validation rule fails and raises an error. The message is the error message configured on the rule. The field is the field the error is attached to, or blank if the rule-level error (page-level).

**`VALIDATION_PASS` / `VALIDATION_FAIL`**: Complementary events to `VALIDATION_RULE` at different verbosity — PASS fires for rules that did not trigger, FAIL fires for rules that did. These are aliases for the result values on `VALIDATION_RULE` and may be used interchangeably across log viewers.

**`VALIDATION_FORMULA`**: Emitted alongside rule evaluation showing the formula text and its computed boolean result. Useful for tracing why a formula returned true/false, especially for complex multi-field formulas. The formula text is the raw SFDC formula source, not a parsed AST.

### 5.2 Validation Lifecycle Mental Model

```
DML_BEGIN [Insert, Contact, 1 row]
  VALIDATION_RULE [ContactEmail_Required, Contact, result: false]
  VALIDATION_PASS [ContactEmail_Required]

  VALIDATION_RULE [ContactPhone_Format, Contact, result: true]
  VALIDATION_FORMULA [NOT(REGEX(Phone, ...)), true]
  VALIDATION_FAIL  [ContactPhone_Format]
  VALIDATION_ERROR [ContactPhone_Format, "Phone must be 10 digits", Phone]
DML_ERROR [Insert failed: validation errors]
```

All validation rules for a record are evaluated in the order configured. A single failing rule causes DML to fail unless partial success is enabled.

---

## 6. Workflow & Process Builder

**Category setting name**: `Workflow`

Classic Workflow Rules and Process Builder actions (field updates, tasks, emails, outbound messages). Note: Salesforce Flow uses the `Workflow` category at the `FINE`/`FINER` level for `FLOW_*` events. The events listed here are specific to the legacy Workflow Rules engine and Process Builder.

### 6.1 INFO Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `WF_RULE_EVAL_BEGIN` | `INFO` | Object type |
| `WF_RULE_EVAL_END` | `INFO` | Object type |
| `WF_RULE_EVAL_VALUE` | `INFO` | Rule name, criteria, result |
| `WF_RULE_FILTER` | `INFO` | Object ID, rule name, filtered reason |
| `WF_RULE_NOT_EVALUATED` | `INFO` | Rule name, reason not evaluated |
| `WF_CRITERIA_BEGIN` | `INFO` | Rule name, object ID, action type, trigger type |
| `WF_CRITERIA_END` | `INFO` | Rule name, result |
| `WF_FORMULA` | `INFO` | Formula text, result |
| `WF_ACTION` | `INFO` | Action type, object ID |
| `WF_ACTION_TASK` | `INFO` | Task subject, assigned user |
| `WF_ACTION_EMAIL` | `INFO` | Template name, recipient |
| `WF_ACTION_FIELD_UPDATE` | `INFO` | Field name, old value, new value |
| `WF_ACTION_OUTBOUND_MSG` | `INFO` | Endpoint URL, message ID |
| `WF_ACTIONS_END` | `INFO` | Object type |
| `WF_NEXT_APPROVER` | `INFO` | Approver name, step name |
| `WF_SOFT_REJECT` | `INFO` | Step name |
| `WF_REASSIGN_RECORD` | `INFO` | New owner, reason |
| `WF_PROCESS_NODE` | `INFO` | Process name, node name |
| `WF_SPOOL_ACTION_BEGIN` | `INFO` | Object ID |

**`WF_RULE_EVAL_BEGIN` / `WF_RULE_EVAL_END`**: Top-level brackets for workflow rule evaluation on a set of records. All rule evaluations for one DML batch occur between these events.

**`WF_CRITERIA_BEGIN` / `WF_CRITERIA_END`**: Each rule gets its own criteria evaluation bracket. The trigger type indicates why the rule was re-evaluated (`Any time record is created or edited`, `Only when record is created`, etc.). The result is `true` (criteria met, actions will fire) or `false` (criteria not met).

**`WF_FORMULA`**: Shows the formula text and its computed result for formula-based criteria. Equivalent to `VALIDATION_FORMULA` but for workflow criteria.

**`WF_ACTION_FIELD_UPDATE`**: Shows the field name, the value before the update, and the value after. These updates can trigger re-evaluation of workflow rules, creating cascade chains. Detecting recursive field update chains is a common use case.

**`WF_PROCESS_NODE`**: Emitted during Process Builder execution, identifying the process name and the decision node being evaluated. This is the Process Builder equivalent of `WF_CRITERIA_BEGIN`.

**`WF_SPOOL_ACTION_BEGIN`**: Indicates an action has been added to the deferred spool queue — most commonly outbound messages and emails — which will be sent after the transaction commits.

### 6.2 Workflow Lifecycle Mental Model

```
DML_BEGIN [Update, Account, 3 rows]
  WF_RULE_EVAL_BEGIN [Account]
    WF_CRITERIA_BEGIN [AccountStatus_Notify, rule type: Any time]
      WF_FORMULA [Status == 'Active', true]
    WF_CRITERIA_END  [result: true]

    WF_ACTION [Email]
    WF_ACTION_EMAIL [StatusChangeTemplate, ops@example.com]

    WF_ACTION [FieldUpdate]
    WF_ACTION_FIELD_UPDATE [Rating, 'Cold', 'Warm']

    WF_CRITERIA_BEGIN [AccountRating_Update, rule type: Any time]
      WF_FORMULA [Rating == 'Warm', true]
    WF_CRITERIA_END  [result: true]
    WF_ACTION_FIELD_UPDATE [SLA__c, null, 'Standard']

  WF_ACTIONS_END [Account]
  WF_RULE_EVAL_END [Account]
DML_END [Update, Account]
```

Field updates that change field values can trigger a second pass of workflow rule evaluation (up to a limit). This recursive pattern is detectable by multiple `WF_RULE_EVAL_BEGIN` / `WF_RULE_EVAL_END` pairs inside the same DML bracket. Salesforce limits this to 10 passes.

---

## 7. Visualforce

**Category setting name**: `Visualforce`

Visualforce page rendering, component lifecycle, controller interactions, and AJAX/partial-page re-renders.

### 7.1 WARN Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `VF_SERIALIZE_VIEWSTATE_BEGIN` | `WARN` | (trigger for large viewstate warning) |
| `VF_DESERIALIZE_VIEWSTATE_BEGIN` | `WARN` | (trigger for large viewstate) |

These emit at WARN only when viewstate size exceeds the 135 KB limit warning threshold. Standard operation emits them at FINE.

### 7.2 INFO Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `VF_PAGE_MESSAGE` | `INFO` | Message type, message text |

**`VF_PAGE_MESSAGE`**: Emitted when `ApexPages.addMessage()` is called or when the platform adds a page-level message. The type corresponds to `ApexPages.Severity` (`INFO`, `WARNING`, `ERROR`, `CONFIRM`, `FATAL`).

### 7.3 FINE Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `VF_SERIALIZE_VIEWSTATE_BEGIN` | `FINE` | Component tree |
| `VF_SERIALIZE_VIEWSTATE_END` | `FINE` | Viewstate size (bytes) |
| `VF_DESERIALIZE_VIEWSTATE_BEGIN` | `FINE` | (none) |
| `VF_DESERIALIZE_VIEWSTATE_END` | `FINE` | Viewstate size (bytes) |
| `VF_EVALUATE_FORMULA_BEGIN` | `FINE` | Expression text |
| `VF_EVALUATE_FORMULA_END` | `FINE` | Result value |
| `VF_COMPONENT_INITIALIZE_BEGIN` | `FINE` | Component type, component ID |
| `VF_COMPONENT_INITIALIZE_END` | `FINE` | Component type, component ID |
| `VF_COMPONENT_INVOKE_BEGIN` | `FINE` | Component type, method name |
| `VF_COMPONENT_INVOKE_END` | `FINE` | Component type, method name |

**`VF_SERIALIZE_VIEWSTATE_BEGIN` / `VF_SERIALIZE_VIEWSTATE_END`**: Brackets viewstate serialization. `END` includes the serialized size — this is the primary data source for viewstate bloat analysis. Large viewstate sizes are a common performance issue with complex VF pages.

**`VF_DESERIALIZE_VIEWSTATE_BEGIN` / `VF_DESERIALIZE_VIEWSTATE_END`**: Occurs at the start of every postback. The size at END represents the transmitted viewstate. Repeated large values indicate the page is sending excessive state on every action.

**`VF_EVALUATE_FORMULA_BEGIN` / `VF_EVALUATE_FORMULA_END`**: Each `{!expression}` in the VF markup evaluates and emits this pair. High volume of these events indicates expression-heavy pages. The expression text identifies which binding is being evaluated.

**`VF_COMPONENT_INITIALIZE_BEGIN` / `VF_COMPONENT_INITIALIZE_END`**: Each custom component initialization. Useful for tracking component-level execution time.

### 7.4 Visualforce Lifecycle Mental Model

```
EXECUTION_STARTED
  CODE_UNIT_STARTED [VF: MyPage/init]
    VF_DESERIALIZE_VIEWSTATE_BEGIN
    VF_DESERIALIZE_VIEWSTATE_END   [32408 bytes]

    // Controller action
    METHOD_ENTRY  [MyController.init]
    SOQL_EXECUTE_BEGIN [SELECT ...]
    SOQL_EXECUTE_END   [50 rows]
    METHOD_EXIT   [MyController.init]

    // Render phase
    VF_EVALUATE_FORMULA_BEGIN  [{!account.Name}]
    VF_EVALUATE_FORMULA_END    ["Acme Corp"]
    ... (repeated per binding)

    VF_SERIALIZE_VIEWSTATE_BEGIN
    VF_SERIALIZE_VIEWSTATE_END  [41200 bytes]  ← watch this number
  CODE_UNIT_FINISHED [VF: MyPage/init]

  // Postback (action method click)
  CODE_UNIT_STARTED [VF: MyPage/save]
    VF_DESERIALIZE_VIEWSTATE_BEGIN
    VF_DESERIALIZE_VIEWSTATE_END
    ...
    VF_SERIALIZE_VIEWSTATE_BEGIN
    VF_SERIALIZE_VIEWSTATE_END
  CODE_UNIT_FINISHED [VF: MyPage/save]
EXECUTION_FINISHED
```

The viewstate size at `VF_SERIALIZE_VIEWSTATE_END` is the canonical metric for VF page weight. Exceeding 135 KB causes a platform error. Growth between postbacks indicates accumulation of state (often collections or wrapped objects) that should be marked `transient`.

---

## 8. System & Governor Limits

**Category setting name**: `System`

Platform-level events: governor limit enforcement, async dispatch, test execution, and platform internals.

### 8.1 ERROR Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `LIMIT_USAGE` (at error) | `ERROR` | Limit type, current usage, max allowed |
| `LIMIT_USAGE_FOR_NS` | `ERROR` | Namespace, limit type, usage, max |

**`LIMIT_USAGE`**: Emitted when a governor limit is exceeded and the platform raises a `LimitException`. The limit type (e.g. `Total SOQL queries`, `Total heap size`, `Maximum CPU time`) and the values at violation are the diagnostic data. This event appears in the log at the point of violation — the enclosing `CODE_UNIT_STARTED` context identifies which unit caused the violation.

**`LIMIT_USAGE_FOR_NS`**: Variant for managed package namespaced limits. Shows the namespace and its limit consumption separately from the org's limit pool.

### 8.2 INFO Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `ENTERING_MANAGED_PKG` | `INFO` | Namespace, class name |
| `SYSTEM_METHOD_ENTRY` | `INFO` | Class name, method name |
| `SYSTEM_METHOD_EXIT` | `INFO` | Class name, method name |
| `PUSH_NOTIFICATION_INVALID_APP` | `INFO` | App name |
| `PUSH_NOTIFICATION_NO_DEVICES` | `INFO` | App name |
| `PUSH_NOTIFICATION_SENT` | `INFO` | Recipient count |
| `EMAIL_QUEUE` | `INFO` | Template, recipient |

**`ENTERING_MANAGED_PKG`**: Signals that execution is crossing the package boundary into a managed namespace. Code inside a managed package runs in a separate context — method calls inside are not emitted at application log level unless the package itself has logging enabled. The absence of METHOD_ENTRY/EXIT events inside a managed package call is expected behavior.

**`SYSTEM_METHOD_ENTRY` / `SYSTEM_METHOD_EXIT`**: Platform/system class method calls (e.g. `System.currentPageReference()`, `String.valueOf()`). These proliferate significantly at FINER and can dominate log volume.

### 8.3 FINE Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `FUTURE_BEGIN` | `FINE` | Class name, method name |
| `FUTURE_END` | `FINE` | Class name, method name |
| `QUEUEABLE_BEGIN` | `FINE` | Job ID, class name |
| `QUEUEABLE_END` | `FINE` | Job ID |
| `BATCH_EXECUTE_BEGIN` | `FINE` | Job ID, class name, scope size |
| `BATCH_EXECUTE_END` | `FINE` | Job ID |
| `SCHEDULED_EXECUTE_BEGIN` | `FINE` | Job ID, class name |
| `SCHEDULED_EXECUTE_END` | `FINE` | Job ID |

**`FUTURE_BEGIN` / `FUTURE_END`**: Brackets `@future` method execution. Note: a `@future` call dispatched from a transaction does not execute in that transaction's log — it executes asynchronously in a separate transaction with its own log. These events appear in the *child* transaction's log, not the caller's.

**`QUEUEABLE_BEGIN` / `QUEUEABLE_END`**: Same async separation applies — the Queueable job runs in a separate transaction. The Job ID links the child log to the parent dispatch.

**`BATCH_EXECUTE_BEGIN` / `BATCH_EXECUTE_END`**: Each `execute(scope)` chunk emits these events. The scope size is the number of records in the chunk. Batch `start()` and `finish()` also have their own `CODE_UNIT_STARTED` events.

### 8.4 System Lifecycle Mental Model

```
// Caller transaction:
CODE_UNIT_STARTED [Trigger: ContactTrigger]
  // @future dispatch — no FUTURE_BEGIN here, just the System.enqueueJob call
  SYSTEM_METHOD_ENTRY [System, enqueueJob]
  SYSTEM_METHOD_EXIT  [System, enqueueJob]
CODE_UNIT_FINISHED

// Async transaction (separate log):
EXECUTION_STARTED
  QUEUEABLE_BEGIN [0023x00000ABC, MyQueueable]
    CODE_UNIT_STARTED [Queueable: MyQueueable]
      ...
    CODE_UNIT_FINISHED
  QUEUEABLE_END
EXECUTION_FINISHED

// Limit violation:
CODE_UNIT_STARTED [Trigger: AccountTrigger]
  SOQL_EXECUTE_BEGIN ...   (repeated 101 times)
  LIMIT_USAGE [Total SOQL queries: 101 of 100]
  FATAL_ERROR [System.LimitException: Too many SOQL queries: 101]
// CODE_UNIT_FINISHED absent — transaction terminated
EXECUTION_FINISHED
```

`LIMIT_USAGE` immediately before `FATAL_ERROR` with a `LimitException` is the canonical governor limit violation signature. The position in the log (which `CODE_UNIT_STARTED` context it is nested in) identifies the violating unit.

---

## 9. Security & Sharing

**Category setting name**: `Security`

Object-level security (OLS), field-level security (FLS), sharing rule evaluation, and record access checks. This category is frequently underutilized but critical for understanding unexpected data visibility or access errors.

### 9.1 ERROR Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `OLS_VIOLATION` | `ERROR` | Object name, operation (read/create/edit/delete), user profile |
| `FLS_VIOLATION` | `ERROR` | Field API name, operation (read/edit), user profile |

### 9.2 INFO Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `OBJ_SECURITY_CHECKED` | `INFO` | Object type, operation, result |
| `QUERY_MORE_ITERATIONS` | `INFO` | Count |

### 9.3 FINE Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `SHARING_RULE_EVAL_BEGIN` | `FINE` | Object type, operation |
| `SHARING_RULE_EVAL_DETAIL` | `FINE` | Rule name, type, result |
| `SHARING_RULE_EVAL_END` | `FINE` | Object type, result |
| `SHARING_INHERITED_SHARING_BEGIN` | `FINE` | Object type |
| `SHARING_INHERITED_SHARING_END` | `FINE` | Object type |
| `SHARING_POLICY_CHECK` | `FINE` | Object type, sharing model |

**`SHARING_RULE_EVAL_BEGIN` / `SHARING_RULE_EVAL_END`**: Brackets sharing rule evaluation for a query or DML operation in a user-context transaction. The result indicates whether sharing rules granted additional access beyond the user's profile. Only fires when running in user mode (with sharing enforcement).

**`SHARING_RULE_EVAL_DETAIL`**: Each individual sharing rule evaluated, with its type (`Owner-based`, `Criteria-based`, `Manual`, `Portal`, `Team`) and result (`Grant`, `Deny`, `Not evaluated`).

**`OLS_VIOLATION` / `FLS_VIOLATION`**: Object or field access violations. These are the primary diagnostic events for `System.NoAccessException` and the silent stripping behavior of `Schema.stripInaccessible()`. When using `stripInaccessible`, violations are logged here but do not throw — the field is silently removed from the record.

### 9.4 Security Lifecycle Mental Model

```
CODE_UNIT_STARTED [method with sharing enforcement]
  SOQL_EXECUTE_BEGIN [SELECT Id, Name, SSN__c FROM Contact WHERE ...]
    SHARING_RULE_EVAL_BEGIN [Contact, query]
      SHARING_RULE_EVAL_DETAIL [Criteria-based rule: Grant]
    SHARING_RULE_EVAL_END   [Contact, access granted]
    FLS_VIOLATION [SSN__c, read]  ← field stripped or exception
  SOQL_EXECUTE_END [10 rows]
CODE_UNIT_FINISHED
```

---

## 10. NBA / Einstein Next Best Action

**Category setting name**: `NBA`

Strategy execution for Salesforce Einstein Next Best Action (recommendations).

### 10.1 INFO Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `NBA_STRATEGY_BEGIN` | `INFO` | Strategy name, context record ID |
| `NBA_STRATEGY_END` | `INFO` | Strategy name, recommendations count |
| `NBA_NODE_BEGIN` | `INFO` | Node type, node name |
| `NBA_NODE_END` | `INFO` | Node type, node name, output count |
| `NBA_STRATEGY_ERROR` | `INFO` | Strategy name, error message |
| `NBA_OFFER_INVALID` | `INFO` | Offer name, reason |
| `NBA_DECISION_MATTER_EXPLAIN` | `INFO` | Node name, rule name, explanation |
| `NBA_FILTER_BEGIN` | `INFO` | Filter name |
| `NBA_FILTER_END` | `INFO` | Filter name, count before/after |

**`NBA_STRATEGY_BEGIN` / `NBA_STRATEGY_END`**: Brackets the full strategy execution. Output recommendations count at END is the definitive count after all filtering, ranking, and limit application.

**`NBA_NODE_BEGIN` / `NBA_NODE_END`**: Each strategy node (Load, Filter, Sort, Limit, Branch, Union, Intersection, Exclusion, Expression) emits this pair. The output count at END shows how many recommendations survived through that node. Comparing input (prior node's output) to output reveals which node is discarding recommendations.

**`NBA_FILTER_BEGIN` / `NBA_FILTER_END`**: Detailed filter events showing the count before and after a filter node. The delta is the number of offers filtered out by this specific rule.

### 10.2 NBA Mental Model

```
NBA_STRATEGY_BEGIN [CustomerOffersStrategy, Account:001xxx]
  NBA_NODE_BEGIN [Load, ProductOffersLoad]
  NBA_NODE_END   [Load, ProductOffersLoad, 42 offers]

  NBA_NODE_BEGIN [Filter, EligibilityFilter]
    NBA_FILTER_BEGIN [HasActiveContract]
    NBA_FILTER_END   [HasActiveContract, before: 42, after: 28]
    NBA_OFFER_INVALID [Premium Upgrade, insufficient tenure]
  NBA_NODE_END   [Filter, EligibilityFilter, 27 offers]

  NBA_NODE_BEGIN [Sort, PriorityRank]
  NBA_NODE_END   [Sort, PriorityRank, 27 offers]

  NBA_NODE_BEGIN [Limit, Top5]
  NBA_NODE_END   [Limit, Top5, 5 offers]
NBA_STRATEGY_END [CustomerOffersStrategy, 5 recommendations]
```

---

## 11. Wave / CRM Analytics

**Category setting name**: `Wave`

CRM Analytics (Tableau CRM / Einstein Analytics) dataset queries, recipe execution, and dashboard interactions initiated via SAQL or Salesforce DX.

### 11.1 INFO Events

| Event | Level | Logged Fields |
|-------|-------|---------------|
| `WAVE_QUERY_BEGIN` | `INFO` | Dataset name, query type |
| `WAVE_QUERY_END` | `INFO` | Dataset name, row count, execution time |
| `WAVE_QUERY_EXCEPTION` | `INFO` | Dataset name, exception message |
| `WAVE_LIMIT_EXCEPTION` | `INFO` | Limit type, usage, max |

**`WAVE_QUERY_BEGIN` / `WAVE_QUERY_END`**: Brackets a SAQL or SOQL-on-dataset query execution. Execution time at END is the analytics engine processing time — distinct from the Apex CPU time governor since analytics queries run outside the Apex limits. Row count is the result set size returned to the caller.

**`WAVE_LIMIT_EXCEPTION`**: CRM Analytics has its own query limits (rows per query, concurrent queries, query execution time). This event fires when those are hit — different from Apex governor limit violations.

### 11.2 Wave Mental Model

```
CODE_UNIT_STARTED [APEX class calling analytics]
  WAVE_QUERY_BEGIN  [OpportunityDataset, SAQL]
  WAVE_QUERY_END    [OpportunityDataset, 4800 rows, 1240ms]

  WAVE_QUERY_BEGIN  [AccountHealthDataset, SAQL]
  WAVE_QUERY_EXCEPTION [AccountHealthDataset, Dataset not found]
CODE_UNIT_FINISHED
```

---

## 12. Event Monitoring & Platform Events

**Category setting name**: Captured via standard `ApexCode` and `Database` categories.

Platform Events published via `EventBus.publish()` appear in the log as DML operations on event objects. There is no dedicated `PlatformEvent` log category — all platform event publishing is captured as `DML_BEGIN` / `DML_END` events on the event object type.

| Pattern | How it appears in log |
|---------|----------------------|
| `EventBus.publish(event)` | `DML_BEGIN [Insert, My_Event__e, 1 row]` |
| Event trigger fires | Separate log: `CODE_UNIT_STARTED [Trigger: My_Event__e Trigger]` |
| `EventBus.publish()` failure | `DML_ERROR` on the event object |

The publishing and the subscriber trigger execution are in separate transactions with separate logs. The subscriber trigger log has its own `EXECUTION_STARTED` / `EXECUTION_FINISHED` brackets and is not nested inside the publisher's log.

Change Data Capture (CDC) events follow the same pattern — the CDC trigger fires asynchronously in a separate transaction.

---

## 13. Cross-Category Notes for LogLens

### Event Pairing and Orphan Detection

Every `*_BEGIN` event should have a corresponding `*_END`. When parsing:

- A `CODE_UNIT_STARTED` with no `CODE_UNIT_FINISHED` → execution terminated abnormally (exception or limit)
- A `DML_BEGIN` with no `DML_END` → DML did not complete
- A `SOQL_EXECUTE_BEGIN` with no `SOQL_EXECUTE_END` → query did not return (rare; usually log truncation)
- `FLOW_ELEMENT_BEGIN` with no `FLOW_ELEMENT_END` → flow element faulted or errored

Orphaned BEGINs are high-signal diagnostic events. Log truncation (at 2 MB or 5 MB depending on log config) can also produce orphans at the tail of the file — differentiate by checking if `EXECUTION_FINISHED` is present.

### Log Truncation

Logs are truncated at 2 MB (Developer Edition) or 5 MB (full orgs with `System.setDebugLevel`). Truncation is silent — the file simply ends. `EXECUTION_FINISHED` absence is the indicator. Events after truncation are lost. High-volume events to watch: `USER_DEBUG` in loops, `STATEMENT_EXECUTE`, `VARIABLE_ASSIGNMENT`, and `HEAP_ALLOCATE`.

### Category to Log Level Defaults

| Category | Common Developer Setting | Notes |
|----------|--------------------------|-------|
| `ApexCode` | `DEBUG` | FINE+ for method-level tracing |
| `Database` | `INFO` | FINE for query plans |
| `Callout` | `INFO` | No useful granularity above INFO |
| `Validation` | `INFO` | No useful granularity above INFO |
| `Workflow` | `INFO` or `FINER` | FINER needed for Flow variable tracking |
| `Visualforce` | `FINE` | FINE for viewstate analysis |
| `System` | `DEBUG` | FINE for async tracking |
| `Security` | `FINE` | INFO for violations only |
| `NBA` | `INFO` | |
| `Wave` | `INFO` | |

### Execution Nesting Summary

```
EXECUTION_STARTED
  CODE_UNIT_STARTED [any entry point]

    // Apex
    METHOD_ENTRY / EXIT
    CONSTRUCTOR_ENTRY / EXIT
    USER_DEBUG
    VARIABLE_ASSIGNMENT          (FINER)
    HEAP_ALLOCATE                (FINER)

    // Database
    SOQL_EXECUTE_BEGIN / END
    DML_BEGIN / END
      VALIDATION_RULE / ERROR    (DML triggers validation)
      WF_RULE_EVAL_BEGIN / END   (DML triggers workflow)
        FLOW_*                   (workflow triggers flow)
      SHARING_RULE_EVAL_*        (DML checks sharing)

    // Callout
    CALLOUT_REQUEST
    CALLOUT_RESPONSE

    // Limits
    LIMIT_USAGE                  (on violation)
    CUMULATIVE_LIMIT_USAGE       (FINEST snapshot)

    EXCEPTION_THROWN             (if thrown)
    FATAL_ERROR                  (if unhandled)

  CODE_UNIT_FINISHED [entry point]
EXECUTION_FINISHED
```

The DML trigger chain — `DML_BEGIN` → `VALIDATION_RULE` → `WF_RULE_EVAL_BEGIN` → `FLOW_*` → `DML_END` — is the most complex nesting in a typical transaction log. All four sub-systems fire synchronously inside the DML operation and are bracketed by `DML_BEGIN` / `DML_END`.

---

*Reference compiled from Salesforce developer documentation, debug log format specifications, and empirical log analysis. Applicable to API version 59.0+. Some events may not be emitted in sandboxes with specific feature flags or in orgs on older API versions.*
