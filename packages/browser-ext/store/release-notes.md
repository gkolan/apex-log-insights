# Release Notes — Apex Log Insights

Chrome Web Store "What's new" copy for each submission.

---

## v1.0 — Initial Release

**What's new**

Apex Log Insights is now on the Chrome Web Store.

This is the first public release of a tool that has been in active development and private use since early 2026. The extension has gone through over 340 internal build iterations and is stable for production use.

**Highlights in this release:**

- Five structured views: Triage, Execution, Data & Limits, Diagnostics, and Log Explorer
- 20-phase Salesforce DML execution lifecycle mapping
- N+1 SOQL detection — automatically flags queries inside loops
- Governor limit burn rate — shows which execution phase consumed CPU, heap, and query rows
- Evidence linking — click any item in any view to jump to its exact raw log line
- Mixed DML and recursive trigger detection
- Execution context detection (trigger, queueable, future method, batch, scheduled, anonymous Apex, platform event)
- Debug level quality scoring — tells you if your log is missing key event types
- PHI/PII redaction — mask sensitive data before copying log content to tickets or bug reports
- HTTP callout analysis with status codes and Named Credential pairing
- Auto-detection — browse to any .log URL and the extension intercepts it automatically
- Fully offline — no server, no account, no data transmitted

**Note:** The underlying parser is built on the same open-source Apex log tokenizer used by other Salesforce developer tools.

---

## v1.1.17 — Bug Fixes & Security Hardening

**What's new in v1.1.17**

This release fixes several bugs found during a comprehensive code review, hardens security, and adds automated quality tooling to the build pipeline.

**Bug fixes:**
- Execution timeline now shows correct event durations instead of 0.0 ms
- Execution Story Detail table correctly displays per-event duration
- N+1 SOQL detection accuracy improved
- Visualforce namespace parsing fixed (was always returning 'default')
- Timestamp regex in parser entry-point corrected (unescaped dot)
- Worker build artifact now stays in sync with source on every build

**Security:**
- XSS vulnerability patched in `displayValue()` and `queryTable()` output
- Path traversal vulnerability fixed in CLI local server
- MCP tool handlers now return proper error responses instead of crashing

**Improvements:**
- Automated security scanning (`pnpm audit`) and bug detection (`pnpm bugs`) added to the build toolchain
- 45 unsafe index-access patterns fixed across the core package
- Dead code removal across viewer, report engine, and public API

---

## Template for future releases

*(Copy and fill in for each subsequent Web Store update)*

**What's new in vX.Y**

[1–3 sentence summary of the most user-visible change]

**Changes:**
- [Feature or fix 1]
- [Feature or fix 2]
- [Feature or fix 3]

**Bug fixes:**
- [Bug fix 1]
- [Bug fix 2]
