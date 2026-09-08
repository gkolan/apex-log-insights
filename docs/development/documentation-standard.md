# Documentation standard

Use this standard when creating or revising project documentation, package guides, store copy, labels, descriptions, help text, changelogs, or change summaries. The goal is to help a defined reader complete a task and verify the result without searching several pages.

This contributor standard adapts Record Health Check's reader-first documentation rules to Apex Log Insights. Use it with the project [writing guide](writing-guide.md) and [terminology](../reference/terminology.md). Verify product facts against the implementation, package manifest, or publication record that owns them, not another documentation page alone.

## Read before editing

Read the complete page and follow its local links before changing it. Identify the intended reader, the task or lookup need, and the observable result. Check that each linked prerequisite is available before the step that needs it.

Review one page at a time. Verify names, commands, defaults, input limits, storage, permissions, and supported environments against their owning source. Mark an unresolved claim as unverified rather than filling the gap with an assumption.

## Keep user guidance separate from contributor checks

User guides, package READMEs, public API references, and store descriptions explain how to use the product. Keep editorial scores, audit tables, reviewer instructions, build-gate results, and draft approval questions out of those pages. Instructions for checking a user's own analysis or recovering from an error belong there when they help complete the task.

Reusable release procedures, documentation standards, test commands, and submission checklists belong in contributor documentation. Route readers to them through clearly labeled contributor navigation, not as the normal next step after analyzing a log.

Keep point-in-time reviews, implementation plans, raw audit output, artifact hashes, and runtime verification records under ignored `internal/` or `reports/`. Preserve existing evidence when moving it out of public docs. Public screenshots may retain concise provenance, synthetic-input details, captions, and alt text; test transcripts and pass/fail matrices remain local.

Git ignore rules do not remove already tracked files. Check both the Git index and final archives before release. Maintainable checks and their fixtures remain tracked; generated evidence does not. Browser release archives under `docs/releases/` are an intentional distribution exception, not a location for audit reports.

## Open with purpose and outcome

The first paragraph answers three questions in natural prose:

1. Who should use this page?
2. What task or decision does it support?
3. What will the reader know or have completed afterward?

Do not add identical “Purpose” and “Goal” boxes to every page. A direct opening sentence is easier to read and less mechanical.

## Organize around the reader's path

Put information in the order needed to act:

1. prerequisites and safety boundaries;
2. the smallest successful path;
3. how to verify the result;
4. options and deeper reference;
5. failure recovery;
6. related tasks.

Reference pages may start with a contract table. Checklists may start with the condition that triggers the checklist. Historical pages such as the changelog keep chronological structure.

Choose a structure that fits the page. A task guide needs prerequisites, ordered steps, expected results, and recovery. A reference needs exact inputs, outputs, defaults, and limits. An overview helps readers choose a path. Avoid invented personas and repetitive sections added only to satisfy a template.

The page should pass the single-link test: a reader arriving directly can understand when it applies and complete its main task without hidden repository knowledge. Link to optional depth, but explain any prerequisite or decision needed at the current step.

## Keep one source for each topic

Update the source-of-truth page and link to it. Do not maintain competing instructions in several READMEs.

The [documentation index](../README.md#sources-of-truth) assigns current ownership. Package READMEs explain package-specific installation and contracts; they link to shared privacy, architecture, and release guidance.

## Name one concept consistently

Use [Project terminology](../reference/terminology.md) for product terms, interface names, view labels, report concepts, abbreviations, capitalization, and redaction contracts.

When adding a public name:

- use a noun for stored information and a verb for an operation;
- use positive names for Boolean choices;
- include a unit when it is not obvious;
- avoid temporary implementation details, ticket numbers, dates, and release numbers;
- treat a public rename as a compatibility change.

## Write descriptions and help text for different jobs

A description tells an administrator or contributor what something controls, when it matters, and what dependency or consequence could be missed.

Help text tells a person what to enter or choose before acting. Start with the action, then give the default, format, unit, limit, or dependency that affects the choice.

Do not repeat a label as its own description. Do not put release history or implementation commentary in user-facing help text.

## Show commands as contracts

For every command or configuration example:

- show where to run it;
- identify required arguments;
- state files, ports, network access, storage, or credentials it affects;
- show the observable success condition;
- verify that the command exists before publishing.

Prefer cross-platform project commands. Label Bash-only examples and explain that Windows readers need Git Bash, or supply a PowerShell equivalent. Put warnings about publication, credentials, network access, or destructive changes before the action. State where each example input comes from and use synthetic or reviewed sanitized logs.

For a limit, explain the unit, what happens at the boundary, and how to reduce or split the input. For a task, describe both successful completion and a relevant failure or access outcome, with a safe recovery path.

Use placeholders that describe the required value, such as `<path-to-log>`. Do not publish a placeholder that looks like a real credential, Salesforce ID, domain, or customer value.

## Separate shipped behavior from plans

Distinguish source support, a locally built release candidate, a publicly downloadable artifact, and a published store or npm version. A successful build does not establish public availability. Keep the current installation status in [Getting started](../user-guides/getting-started.md#availability) and link to it rather than copying mutable version claims into every guide.

Use a verified install URL when saying an interface is available. Label an unsigned Firefox XPI as a submission or temporary-development artifact. Describe a local VSIX as a candidate until a public download or Marketplace installation has been verified. Source-only npm packages need source-build instructions rather than an unqualified registry install command.

Keep proposals and prioritization in issues or local design material. Compatibility claims name the host and known limitations. A skipped check, a past release review, or an untested remote workspace does not establish support for the current artifact.

## State privacy boundaries completely

“Local” does not always mean “never stored” or “never transmitted.” Identify:

- where parsing occurs;
- what browser or process storage retains;
- how long it remains or how it can be cleared;
- what another application, MCP client, browser, or cloud model may transmit;
- what redaction covers and what it can miss.

Review store listings, privacy policies, permission justifications, and package guides together after a storage or data-flow change.

## Verify before merging

Run:

```bash
pnpm validate
```

Then review the rendered page and confirm:

- the opening identifies the reader, task, and outcome;
- terms match `docs/reference/terminology.md`;
- commands, paths, labels, defaults, versions, and examples match the implementation;
- local and external links resolve to supporting content;
- privacy statements include storage and downstream transmission;
- planned behavior is marked as planned;
- the page ends with a useful result, limitation, or next action.

Review facts and prose in separate passes. Read every changed page from title to final link after the last material edit, then read the affected folder in navigation order. Remove contradictions and duplicate procedures without removing information needed to use an individual page.

For a new or substantially changed task, exercise the documented path in the stated environment when authorized, including the expected outcome and a relevant recovery path. Record what was actually checked and what remains unverified in local evidence. Link and structure checks do not substitute for runtime or editorial review.

Inspect package-rendered documentation as well as source Markdown. Marketplace packaging can rewrite relative README links incorrectly; use repository-absolute HTTPS links in the VS Code README and check the resulting VSIX. Keep browser store copy browser-neutral except where a host-specific capability or permission differs.

`pnpm check:docs` also enforces one page title, a substantive opening, ordered
headings, concise paragraphs, readable tables, labeled code fences, valid local
links and heading anchors, a final navigation section, and prose without em
dashes. Each maintained page under `docs/` must pass all ten structural checks.
The automated result does not replace a factual or editorial review.

The link checker also rejects known reviewer-only headings in user pages and links to local evidence. It checks package-safe VS Code README links and resolves this repository's absolute GitHub documentation URLs against the current source. These checks prevent known regressions; editorial review still decides whether each paragraph belongs with its audience.

## Related

- [Writing guide](writing-guide.md)
- [Project terminology](../reference/terminology.md)
- [Documentation home](../README.md)
