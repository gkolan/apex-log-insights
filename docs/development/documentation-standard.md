# Documentation standard

Use this standard when creating or revising project documentation, package guides, store copy, labels, descriptions, help text, changelogs, or change summaries. The goal is to help a defined reader complete a task and verify the result without searching several pages.

This standard applies the project [writing guide](writing-guide.md) and the naming principles in the Record Health Check Salesforce naming and metadata writing standard. The current implementation, official Salesforce terminology, and current platform schemas take precedence when they change.

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

Use placeholders that describe the required value, such as `<path-to-log>`. Do not publish a placeholder that looks like a real credential, Salesforce ID, domain, or customer value.

## Separate shipped behavior from plans

Use present tense only for behavior available in the current repository or release. Label proposals as exploratory and keep prioritization in GitHub issues. Do not let a roadmap page masquerade as an API or feature reference.

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

`pnpm check:docs` also enforces one page title, a substantive opening, ordered
headings, concise paragraphs, readable tables, labeled code fences, valid local
links and heading anchors, a final navigation section, and prose without em
dashes. Each maintained page under `docs/` must pass all ten structural checks.
The automated result does not replace a factual or editorial review.

## Related

- [Writing guide](writing-guide.md)
- [Project terminology](../reference/terminology.md)
- [Documentation home](../README.md)
