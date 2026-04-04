# Chrome Web Store Listing — Apex Log Insights

---

## Extension Name

**Apex Log Insights**

---

## Short Description

*(132 character limit — used in search results and extension tiles)*

```
Free offline toolkit for Apex debug logs — execution timeline, governor limits, SOQL analysis, and guided triage.
```

*(113 chars)*

---

## Category

**Developer Tools**

---

## Language

English

---

## Long Description

*(Up to 16,000 characters. Shown on the store detail page. Plain text only — no Markdown, no HTML.)*

---

Apex Log Insights is a free, offline toolkit that turns raw Apex debug logs into actionable insights. Drop in a .log file, get instant structured analysis across five views — no servers, no uploads, no accounts.

Every parse runs locally in a Web Worker. Your log data never leaves your machine.

---

FIVE STRUCTURED VIEWS

Triage
Get an immediate verdict — OK, Warning, or Critical — based on governor limit consumption, error count, and query patterns. See the key metrics at a glance and catch N+1 SOQL loops before you dig deeper.

Execution
Salesforce executes Apex in a 20-phase lifecycle (trigger start, validation, DML, commit, etc.). Apex Log Insights maps every event to its phase so you can see exactly which phase consumed which governor limits. Each event links back to its exact line in the raw log.

Data & Limits
All SOQL queries ranked by duration. DML operations by sObject type. HTTP callouts with status codes and response metadata. Named Credential request/response pairs. Savepoints and rollbacks. Governor limit usage at a glance.

Diagnostics
Execution context detection (synchronous trigger, queueable, future method, batch, scheduled, anonymous Apex, platform event). Debug level completeness score. Trigger cascade analysis. Managed package overhead calculation. Mixed DML and recursive trigger warnings.

Log Explorer
The complete raw log with full-text and regex search, context line controls, user-debug-only and errors-only filters, and one-click copy. Every item in every other view links directly to its exact line number here. Nothing is truncated.

---

KEY FEATURES

Evidence Linking — click any SOQL query, DML operation, callout, or warning to jump instantly to the matching line in the raw log. No manual searching.

N+1 SOQL Detection — automatically flags queries executed inside loops, the most common cause of governor limit exceptions in Apex.

Governor Limit Burn Rate — shows which execution phase consumed CPU, heap, and query limits so you can pinpoint the bottleneck.

Mixed DML Detection — warns when setup objects (User, PermissionSet, etc.) and non-setup objects are modified in the same transaction, a common cause of hard-to-debug runtime errors.

Recursive Trigger Detection — flags when the same trigger fires multiple times in a single transaction.

Debug Level Quality Scoring — tells you if your log was captured at too low a level and is missing key event types that would affect analysis accuracy.

PHI/PII Redaction — before copying log content, optionally mask email addresses, Salesforce IDs, phone numbers, and custom person names so sensitive data stays out of bug reports and tickets.

Auto-Detection — browse to any .log URL in Chrome (including Salesforce's own debug log download links) and the extension intercepts and analyzes it automatically.

---

COMPLETELY OFFLINE

No server. No account. No API calls. No telemetry. The extension requires only two permissions: "tabs" (to detect when you open a .log file) and "storage" (to remember your preferences). Host permissions are scoped to *.log URLs and local files only.

---

HOW TO GET AN APEX DEBUG LOG

In Salesforce: Setup → Debug Logs → add a Trace Flag for your user → reproduce the operation → download the log file.

For best results, use these debug levels:
Apex Code: FINEST
Apex Profiling: FINE
Database: FINEST
Callout: FINE
System: FINE
Validation: FINE
Workflow: FINE

---

WHO IS IT FOR

Salesforce developers and release engineers who need to understand what a transaction actually did — how many queries ran, which governor limits were hit, what the trigger lifecycle looked like, and exactly which line of code caused a problem. Works on any Apex debug log regardless of org edition.

---

OPEN SOURCE

Apex Log Insights is open source. Contributions, bug reports, and feature requests are welcome.

---

## Tags / Keywords

*(Use in the "Keywords" field if the store provides one. Otherwise weave into the description.)*

- Salesforce
- Apex
- debug log
- governor limits
- SOQL
- DML
- log analyzer
- developer tools
- Salesforce developer
- performance
- N+1
- trigger
- Apex profiling

---

## Permissions Justification

*(Required during submission — answers the "Why does this extension need X?" prompts)*

**tabs**
Used to detect when the user navigates to a `.log` URL so the content script can offer to open the analyzer. No tab content is read.

**storage**
Used to persist user preferences (context line defaults, redaction settings, last-loaded report path) between browser sessions. No log data is stored — only UI preferences.

**Host permission: `*://*/*.log` and `file:///`**
Required for the content script to run on `.log` URLs (including local files) and for the extension to read log file contents for local parsing. All processing is done locally; no data is transmitted.

---

## Pricing

Free

---

## Single Purpose Description

*(Chrome Web Store asks for a one-sentence "single purpose" statement)*

Analyzes Salesforce Apex debug log files locally in the browser and presents the results as structured, navigable views.
