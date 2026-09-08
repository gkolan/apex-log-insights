# Testing and coverage

Use this guide to choose the smallest test that proves a change and to run the
additional checks required before a release. Every change must pass
`pnpm validate`; coverage and external-corpus checks provide deeper evidence.

## Choose the focused test

Run the focused command while developing, then run the complete validation gate.

| Test class                   | What it verifies                                                        | Run command                                                                                |
| ---------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Parser and report contracts  | Event fidelity, evidence, pairing, limits, and canonical report fields  | `pnpm test -- packages/core`                                                               |
| Shared report UI             | Normalization, five-view rendering, redaction, and host compatibility   | `pnpm test -- __tests__/viewer-modules.test.ts __tests__/viewer-compatibility.test.ts`     |
| Browser UI and worker        | Shell parity, large-view caps, worker messages, and input boundaries    | `pnpm test -- __tests__/browser-ui.test.ts packages/browser-ext/src/worker-entry.test.ts`  |
| CLI integration              | Arguments, local HTTP behavior, file isolation, and bounded reads       | `pnpm test -- packages/core/__tests__/cli.test.ts packages/cli/src`                        |
| MCP boundaries               | Input paths, serialization, redaction, comparison, and tool contracts   | `pnpm test -- packages/mcp`                                                                |
| VS Code unit and contract    | Detection, worker lifecycle, webview security, and message validation   | `pnpm test -- packages/vscode-ext/__tests__`                                               |
| VS Code Extension Host       | Activation, analysis, panel creation, navigation, and unsaved refresh   | `pnpm test:vscode`                                                                         |
| Formatting and documentation | Maintained-file discovery, Markdown structure, links, and writing rules | `pnpm test -- __tests__/format-maintained.test.ts __tests__/documentation-quality.test.ts` |

Add a regression at the lowest layer that first becomes incorrect. A browser
defect normally needs a focused renderer or UI-contract test and, when shared
assets change, a viewer/extension compatibility assertion.

## Run the required gate

```bash
pnpm validate
```

The command assembles the generated browser UI, builds the shared core type
declarations before checking TypeScript, then checks formatting, lint, all active
Vitest tests, version synchronization, and documentation. This makes the same
command work in a fresh clone with no generated UI or `dist/` directories. A
skipped test must identify a
specific unavailable prerequisite or tracked issue; do not use a skip to hide a
regression.

## Check rendered accessibility

Build the current sources, then audit the installed Chrome or Edge browser in an
isolated temporary profile:

```bash
pnpm build
node scripts/audit-accessibility.mjs --browser=chrome --report=/tmp/apex-chrome-accessibility.json
node scripts/audit-accessibility.mjs --browser=msedge --report=/tmp/apex-edge-accessibility.json
```

The runner uses the actual unpacked extension and browser-action popup. Edge
also exercises file-permission settings and the permission-required state. Chrome
disables debug-loaded extensions when file access changes, so that state is
recorded as not run in Chrome. It checks setup, the analyzer start screen, all five views,
redaction preferences, search matches, error matches, keyboard search and copy,
320 CSS-pixel reflow, and forced colors. Pass `--screenshots=/absolute/path` to
save paired Light and Night captures. Chromium extension debugging requires a
recent installed browser; these headed checks stay outside `pnpm validate`.

The axe-core scan includes WCAG 2.2 A/AA and best-practice rules. An additional
computed-color check requires at least 4.5:1 for search, matched rows, context
lines, and redaction text. Reports retain violations and items requiring review;
icons and clipped or obscured text must be inspected rather than counted as
passes. The W3C [text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
explains the threshold. Automated checks do not establish complete WCAG conformance.

Before release, repeat the same states in the packaged Firefox extension and an
actual VS Code Extension Host using `scripts/accessibility-dom.mjs`. Check both
default editor themes, the source-changed banner, and expanded redaction fields.
Verify keyboard order, visible focus, source navigation, selection text, zoom,
and high-contrast behavior. Review browser-owned permission UI separately from
extension-owned pages. Record browser versions, checked states, manual findings,
and screenshot provenance in ignored `reports/` or `internal/`. The public [screenshot index](../../assets/images/README.md) keeps only image captions and synthetic-input provenance.

## Test the external corpus

Run the optional extended gate after changing parser behavior, report assembly,
normalization, rendering, or large-log resource handling:

```bash
pnpm test:corpus
```

The command downloads Certinia's public Debug Log Analyzer sample and verifies
its exact size and SHA-256 digest before parsing. It requires zero parser
diagnostic records, zero unsupported timeline events, a canonical offline
report, and nonempty output from all five views. Its terminal summary contains
counts only and never prints matched email addresses, Salesforce IDs, debug
messages, or other raw values.

A newly downloaded sample is removed after the command finishes. Pass `--keep`
to retain it under ignored `external-corpus/`. Use
`pnpm test:corpus -- --offline` for a repeat run that requires the cached copy.
An existing cached sample is not deleted by a normal run.

This command stays outside `pnpm validate` because the public host can be
unavailable and the large sample materially increases test time. A download
failure is an infrastructure result. A verified sample that produces a parser,
report, normalization, or rendering failure blocks the release.

## Review coverage

```bash
pnpm test:coverage
```

The command writes an ignored HTML report to `coverage/index.html` and a
machine-readable summary to `coverage/coverage-summary.json`. The repository
floors are:

- 68% statements;
- 65% branches;
- 59% functions;
- 68% lines.

Package-specific floors protect the parser/report core, MCP tool handlers, and
directly unit-testable VS Code contracts. Review the uncovered-line table rather
than treating the aggregate percentage as proof of correct behavior.

Tests for trust boundaries must include malformed input, missing evidence,
prototype-named keys, deep nesting, cycles where the contract permits them, and
values around the 25 MiB boundary. Aggregate tests must distinguish an observed
zero from unknown or unsafe numeric evidence.

Filesystem tests create unique operating-system temporary directories and
remove them in teardown. Near-limit inputs may use a focused timeout that is
documented beside the test; do not raise a product boundary to make a test
faster.

## Check browser releases

Before packaging Chrome, Edge, and Firefox:

1. Run `pnpm validate`.
2. Run `pnpm test:coverage` and review material coverage changes.
3. Run `pnpm build` to assemble the canonical viewer into each extension.
4. Open a synthetic fixture in all five views.
5. Verify a **Log line** link when the same finding also has an **Apex source line**.

Do not commit `coverage/`; it is an ignored local diagnostic artifact.

## Check the VS Code release

`pnpm test:vscode` builds the shared core dependency and the VS Code package,
then launches the official Extension Host harness. CI tests VS Code 1.96.0 and
the current stable release. Set
`VSCODE_EXECUTABLE_PATH` locally to reuse an installed VS Code executable.

Before publishing, package the VSIX, install it in an isolated profile, and run
one Remote SSH or Dev Container smoke test. The automated host test proves the
desktop command and unsaved-document flow; it does not prove that a particular
remote environment is available.

## Related

- [Contributing](../../CONTRIBUTING.md)
- [Release guide](releasing.md)
- [Documentation standard](documentation-standard.md)
