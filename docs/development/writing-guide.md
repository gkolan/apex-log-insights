# Writing clear, human documentation

Use this guide to draft or review documentation, release notes, store copy, and change summaries. The goal is prose whose facts, structure, terminology, and editorial choices can be explained by the author.

This guide adapts relevant observations from Wikipedia's [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) for software documentation. That article is a descriptive field guide, not a set of detection rules. A phrase, punctuation mark, or formatting choice does not prove that text came from AI. Automated detectors and unaided human guesses both produce false positives.

Apply this guide with the [Documentation standard](documentation-standard.md) and [Project terminology](../reference/terminology.md). The documentation standard defines page structure and verification; the terminology page defines approved project names.

## Start with the reader's question

Before drafting, write down:

1. Who will read this?
2. What are they trying to do?
3. What must they know before acting?
4. How will they verify that it worked?

If a paragraph does not help answer one of those questions, remove it or move it to a more appropriate page.

## State facts instead of significance

AI-generated prose often inflates ordinary facts with claims about importance, transformation, or a broader landscape. Technical documentation rarely needs those claims.

Avoid:

> The new validation command marks a pivotal step in the project's ongoing commitment to robust quality.

Write:

> `pnpm validate` runs formatting, linting, typechecking, tests, version checks, and documentation checks.

The second version tells the reader what the command does. It does not ask the reader to accept an opinion about its importance.

## Name the actor and action

Prefer a direct subject and a precise verb.

Avoid:

> Report consistency is enhanced through centralized normalization.

Write:

> `normalize-report.js` converts supported report inputs into the view model used by every renderer.

Use `is`, `has`, and `does` when they are the clearest verbs. Do not replace them merely to make a sentence sound more sophisticated.

## Do not add analysis that the evidence cannot support

Avoid attaching a vague interpretation to a fact with phrases such as “highlighting,” “underscoring,” “reflecting,” or “showcasing.” Explain an effect only when the code, test, source, or measurement demonstrates it.

Avoid:

> The local parser makes zero network requests, underscoring the project's commitment to privacy.

Write:

> The parser makes no network requests. The MCP server passes its results to the configured AI client, which may send them to a cloud model.

The revised text states the useful boundary and includes the exception.

## Replace vague attribution with a source

Phrases such as “users want,” “experts recommend,” and “industry practice suggests” hide who made the claim.

Use one of these approaches:

- cite the issue, specification, measurement, or source;
- identify the person or group when attribution matters;
- describe the observed behavior without inventing consensus;
- remove the claim if it cannot be verified.

Avoid:

> Developers often find large logs difficult to navigate.

Write:

> Rendering one row per event creates 10,000 DOM nodes for a 10,000-event log.

Use real measurements only. Never invent a number to make prose more concrete.

## Avoid promotional language

Documentation is not store copy. Remove praise that does not change a user's decision: “powerful,” “seamless,” “groundbreaking,” “robust,” “comprehensive,” “vibrant,” and similar adjectives.

Avoid:

> Apex Log Insights delivers a powerful and seamless debugging experience.

Write:

> Apex Log Insights parses Apex debug logs and links supported findings to raw log lines.

When a qualifier is necessary, define it. For example, replace “large file” with the byte threshold that triggers the warning.

## Vary structure only when the content requires it

Do not force every explanation into three items. Do not manufacture a contrast such as “not only X, but also Y.” Do not cycle through synonyms to avoid repeating the correct technical term.

Repeat canonical names consistently:

- use `reportVersion` every time you mean that field;
- use “browser extension” rather than alternating among “extension,” “add-on,” and “browser tool” without reason;
- use the same command and file names that exist in the repository.

Repetition is preferable to ambiguity.

## Use formatting to reveal structure

Formatting should help the reader scan, compare, or act.

- Use headings for real sections, in order: `#`, then `##`, then `###`.
- Use bullets for independent items and numbered lists for ordered steps.
- Use a table only when readers need to compare the same fields across several items.
- Use bold sparingly. Do not bold the first phrase of every bullet.
- Use code formatting for commands, fields, paths, and identifiers.
- Avoid emoji as section labels in technical references.
- Do not add a horizontal rule before every heading.

If two short sentences are easier to read than a list or table, use sentences.

## Keep transitions natural

Words such as “Additionally,” “Furthermore,” and “Moreover” are not wrong, but repeated sentence-opening transitions make prose mechanical. Usually, the relationship between adjacent sentences is already clear.

Avoid:

> Additionally, the CLI supports directories. Furthermore, it scans subdirectories. Moreover, results are sorted by modification time.

Write:

> The CLI scans a directory recursively and sorts matching logs by modification time.

## End when the task is complete

Do not add a generic conclusion about challenges, future prospects, or the project's wider significance. End with the result, verification step, known limitation, or next action the reader actually needs.

Avoid:

> As the ecosystem continues to evolve, Apex Log Insights is well positioned to meet future debugging challenges.

Write:

> Multi-log comparison is not currently supported. Track proposed work in GitHub issues.

## Write accountable change summaries

Commit messages, pull-request descriptions, and changelog entries should name the actual change. Avoid broad assurances that a change “improves quality,” “ensures compliance,” or “preserves existing behavior” unless you state how that was verified.

Avoid:

> Improved documentation for clarity and consistency while preserving all important information.

Write:

> Added MCP input examples and documented that `filePath` accepts only relative `.log` paths.

Useful summaries answer:

- What changed?
- Why did it change?
- What test or observation verifies it?

## Check citations and markup

AI-assisted drafts may contain fabricated references, search-result links, internal citation tokens, placeholder text, or markup copied from the wrong system.

Before publishing:

- open every external source you rely on;
- confirm that the source supports the nearby claim;
- link to the supporting page, not a search-results page;
- remove tracking parameters when they are unnecessary;
- verify every local file link;
- remove placeholders, prompt text, and tool-specific citation markers;
- preview the rendered Markdown.

This repository runs `pnpm check:docs` to verify local Markdown targets, but that check cannot determine whether an external source supports a claim.

## Review checklist

Read the draft once for facts and once for style.

### Facts

- Does every command exist?
- Does every path point to the canonical source rather than a generated file?
- Do option names, defaults, versions, limits, and outputs match the implementation?
- Are privacy and security boundaries complete, including exceptions?
- Can the reader distinguish shipped behavior from proposed work?
- Did you open and verify every source?

### Style

- Does the first paragraph answer the reader's main question?
- Can you replace praise with a fact?
- Can you remove a vague claim about significance, users, experts, or industry practice?
- Does each paragraph add new information?
- Are lists and tables helping comparison or sequence rather than decorating the page?
- Have you used the same technical term consistently?
- Can any sentence lose an introductory transition, trailing “-ing” clause, or redundant conclusion?
- Does the page stop once the reader has the result and next action?

## The final test

Ask the author to explain why each section exists, where each factual claim came from, and what changed during revision. A trustworthy document is not one that avoids a list of suspicious words. It is one whose author can account for its facts, structure, and editorial choices.

## Related

- [Documentation standard](documentation-standard.md)
- [Project terminology](../reference/terminology.md)
- [Documentation home](../README.md)
