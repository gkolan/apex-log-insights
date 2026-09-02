# MCP server roadmap

Use this page to evaluate possible MCP server work before creating implementation issues. It records design boundaries and open decisions; it does not describe shipped behavior or promise delivery. The goal is to turn an accepted idea into a scoped issue with a security model, test plan, and documentation owner.

For current tools and setup, read the [MCP server guide](README.md). GitHub issues are the source of truth for priority and delivery status.

## Current boundary

The shipped MCP server:

- accepts raw log text or a relative `.log` path;
- parses the log through `@apex-log-insights/core`;
- exposes six read-only analysis tools, including local log comparison;
- can mask recognized sensitive values before returning results;
- makes no Salesforce or third-party network request itself.

Tool results pass to the MCP client and may then reach a cloud model. Redaction reduces exposure but does not guarantee anonymity.

## Product goal under evaluation

A future Salesforce connection could retrieve logs and org context for a user who explicitly authorizes that access. Any such work must preserve a clear boundary between:

- local parsing;
- Salesforce authentication and API access;
- data returned to the MCP client;
- changes made to an org.

Read-only retrieval and org mutation are separate capabilities. Do not combine them in one tool or consent step.

## Candidate capabilities

Create a separate issue for each accepted capability.

### Retrieve a selected log

Possible operations:

- list recent `ApexLog` records;
- retrieve one log body by ID;
- parse it locally;
- return a focused report projection.

Decisions required:

- supported authentication source;
- org-selection rules;
- retention and temporary-file behavior;
- maximum log size and timeout;
- fields returned to the MCP client;
- tests against a controlled org or API mock.

### Manage debug instrumentation

Possible operations include creating a Debug Level or Trace Flag for a named user and removing metadata created by the tool.

This is an org mutation. It requires:

- explicit user confirmation before each change;
- an exact preview of metadata and expiration;
- names that follow the Salesforce naming standard;
- least-privilege permission guidance;
- idempotency and cleanup behavior;
- an audit result that identifies what changed;
- deployment or API tests in a fresh org.

### Watch for new logs

Possible transports include polling Salesforce APIs or subscribing to supported events. Select a transport only after verifying current Salesforce API support, authentication behavior, limits, reconnect semantics, and event delivery guarantees.

The design must define cancellation, backoff, duplicate handling, log retrieval, local storage, and what crosses the MCP boundary.

### Add org context

Potential read-only context includes current org limits or metadata needed to interpret a finding. Each data source needs a separate privacy and permission review. Transaction governor limits and org-wide limits are different concepts and must use different names.

## Naming rules for proposed tools

- Start an operation with a verb: `list_recent_logs`, `retrieve_apex_log`, `compare_reports`.
- Use one stable Salesforce term per concept.
- Include the target when a verb alone is ambiguous.
- Do not name a mutation as if it were analysis.
- Avoid `manager`, `helper`, `util`, `data`, and `info` when a specific noun is available.
- Treat a published tool name and input field as a public API contract.

Names above are working examples, not approved APIs.

## Security requirements

Every Salesforce-connected proposal documents:

1. authentication and credential ownership;
2. required Salesforce permissions;
3. allowed orgs and selection behavior;
4. network requests and endpoints;
5. local and remote storage;
6. data returned to the MCP client;
7. redaction coverage and known gaps;
8. confirmation for mutations;
9. timeouts, cancellation, and retries;
10. cleanup and audit evidence.

Do not log access tokens, session IDs, authorization headers, raw production logs, or unredacted tool results.

## Architecture rules

- Keep raw event extraction in the parser layer.
- Keep report analysis in the report layer.
- Put Salesforce connectivity in the MCP package, behind focused interfaces.
- Do not add Salesforce runtime dependencies to the core library.
- Keep retrieval separate from analysis so local inputs remain supported.
- Return bounded projections where a full report is unnecessary.
- Verify every Salesforce object, field, event, endpoint, and limit against current official documentation before implementation.

## Issue readiness checklist

An idea is ready for implementation only when its issue states:

- the user and task;
- the observable outcome;
- whether the operation reads or changes an org;
- the proposed public names and input contract;
- authentication, permissions, network, storage, and redaction behavior;
- failure, retry, cancellation, and cleanup behavior;
- acceptance tests;
- documentation and changelog updates;
- compatibility impact on existing MCP clients.
