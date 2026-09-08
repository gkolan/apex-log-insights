# Contributing

Use this guide to set up the repository, find the layer that owns a change, implement it, and prove that the repository remains healthy. Before editing, read [Architecture](docs/development/architecture.md) and the [Style guide](STYLE_GUIDE.md). Documentation changes also follow the [Documentation standard](docs/development/documentation-standard.md), [Writing guide](docs/development/writing-guide.md), and [Project terminology](docs/reference/terminology.md).

## Prerequisites

- Node.js 18 or later
- pnpm 9.15.4, managed through Corepack
- Git

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install --frozen-lockfile
pnpm validate
```

pnpm is the only supported package manager. Do not create or commit `package-lock.json` or `yarn.lock`.

## Repository map

| Location                                         | Responsibility                                      |
| ------------------------------------------------ | --------------------------------------------------- |
| `packages/core/src/certinia/`                    | Raw log parsing and event extraction                |
| `packages/core/src/insights/`                    | Analysis and structured findings                    |
| `packages/core/src/offlineReport.ts`             | Canonical viewer-compatible report assembly         |
| `packages/cli/`                                  | Local viewer server and CLI                         |
| `packages/mcp/`                                  | MCP server and redaction boundary                   |
| `packages/vscode-ext/`                           | VS Code host adapter and packaged webview           |
| `viewer/`                                        | Canonical browser UI shared by viewer and extension |
| `packages/browser-ext/shared/*-extension-only.*` | Extension-only UI overlays                          |
| `packages/browser-ext/src/`                      | Extension parser worker source                      |
| `fixtures/`                                      | Synthetic, reviewed test logs                       |
| `scripts/`                                       | Build, release, audit, and health checks            |

For generated-file ownership, read [Viewer and extension sources](docs/development/architecture.md#viewer-and-extension-sources).

## Choose the owning layer

Investigate in this order:

1. **Raw log:** Does the expected event exist?
2. **Parser:** Does `parseLog()` capture it in typed or normalized output?
3. **Report:** Does `buildOfflineReport()` expose it canonically?
4. **Normalizer:** Does the view model preserve it safely?
5. **Renderer:** Does the correct view display it?

Fix the lowest layer that first becomes incorrect. Do not add renderer logic to compensate for missing parser or report data.

## Development commands

| Command              | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `pnpm dev:cli`       | Watch the CLI package                           |
| `pnpm dev:mcp`       | Watch the MCP package                           |
| `pnpm dev:vscode`    | Watch the VS Code extension host bundle         |
| `pnpm test:vscode`   | Run the VS Code Extension Host integration test |
| `pnpm dev:ext`       | Watch the extension parser worker               |
| `pnpm format`        | Format every maintained non-UI source and doc   |
| `pnpm format:check`  | Verify maintained non-UI formatting             |
| `pnpm test:watch`    | Run Vitest in watch mode                        |
| `pnpm test:coverage` | Run tests and write local coverage reports      |
| `pnpm test:corpus`   | Validate the pinned external Certinia sample    |
| `pnpm audit:docs`    | Score maintained docs against the writing gate  |
| `pnpm build`         | Build the current version without changing it   |
| `pnpm validate`      | Run the complete required health gate           |
| `pnpm audit:report`  | Write security findings under `audit/`          |
| `pnpm bugs:report`   | Write static-analysis findings under `bugs/`    |

`knip.json` declares runtime and integration-test entry points and excludes generated bundles, downloaded test harnesses, and tool-owned worktrees. Root scripts, tests, and viewer entry points belong to the `"."` workspace because Knip does not apply top-level entry patterns when explicit workspaces are configured. Update the applicable workspace when adding an entry point or generated runtime companion so `pnpm bugs:report` does not classify shipped files as unused or unresolved.

`code-analyzer.yml` applies the repository ESLint rules, excludes generated artifacts, and sets CPD's substantial-duplication threshold to 300 tokens. Four renderer modules are excluded from Code Analyzer because its CPD lexer cannot parse their valid nested template literals; `pnpm lint` and the renderer test suite continue to cover those files. `pnpm audit:report` uses the installed Secretlint and ESLint security packages, fails when a scanner cannot return its expected result, and fails when any finding is written.

### Validation gate

`pnpm validate` runs, in order:

1. Prettier check for Git-discovered maintained non-UI sources and documentation;
2. ESLint;
3. TypeScript checks for all packages;
4. all active Vitest tests;
5. version synchronization;
6. documentation consistency, local-link and heading-anchor checks, and the 10/10 structural writing audit.

All steps must pass before a commit. Skipped tests must identify an issue or a concrete missing prerequisite; do not use skips to hide a regression.

The formatting inventory includes tracked files and non-ignored new files, then excludes generated browser/viewer assets, UI-only source trees, research notes, and the package-manager lockfile. Discovered paths are passed after Prettier's option terminator so unusual Git filenames cannot become CLI flags. Add a path-level or real-process regression in `__tests__/format-maintained.test.ts` when changing those boundaries.

For the test-class map, coverage floors, and browser-release checks, read [Testing and coverage](docs/development/testing.md).

## Bug-fix workflows

### Parser defect

1. Add the smallest synthetic log line or fixture that reproduces the problem.
2. Update the event class in `packages/core/src/certinia/LogEvents.ts`.
3. Register a new event type in both `types.ts` and `LogLineMapping.ts` when necessary.
4. Assert typed extraction, normalized output, classification, and raw-line evidence.
5. Parse every committed `.log` fixture and confirm that newly supported records do not remain in `parsingErrors`.
6. Run `pnpm validate`.

### Report defect

1. Prove the parser already captures the required event.
2. Update the focused module under `packages/core/src/insights/`.
3. Expose canonical output through the report assembler.
4. Add report-shape and evidence assertions.
5. Update [Report schema](docs/reference/report-schema.md) and decide whether `reportVersion` changes.
6. Run `pnpm validate`.

### Viewer or extension defect

1. Prove the canonical report contains the correct data.
2. Put report-format compatibility handling in the normalization modules.
3. Change `viewer/app.js`, `viewer/index.html`, and `viewer/styles.css` for the shared five-view presentation.
4. Keep extension-only behavior in the extension overlay sources; do not fork the shared report layout in a host adapter.
5. Add a focused viewer or normalization test and run `pnpm validate`.

## Adding a report field

Update all applicable parts in one changeset:

- raw event extraction;
- analysis types and builder;
- offline report assembly;
- report schema metadata when compatibility changes;
- normalization;
- rendering;
- synthetic fixture and tests;
- bounded collection metadata when a field can repeat with log size;
- [Report schema](docs/reference/report-schema.md), [Feature reference](FEATURES.md), and [Changelog](CHANGELOG.md).

Never leave a producer and consumer on different field names.

## Test data rules

Only synthetic or deliberately sanitized logs may be committed to `fixtures/`.

- Use reserved example values and domains such as `example.com`.
- Do not copy production tokens, credentials, endpoints, names, or business data.
- Keep a fixture as small as the behavior permits.
- Explain unusual sequences in the corresponding test.

See [Privacy and security](docs/user-guides/privacy.md).

For optional large-log compatibility testing, `pnpm test:corpus` downloads the
pinned public Certinia Debug Log Analyzer sample into the ignored
`external-corpus/` directory, verifies its byte count and SHA-256 digest, then
runs parser, report, normalizer, and five-view rendering checks. It prints only
aggregate counts and removes a newly downloaded sample after the run. Use
`--keep` to retain the verified sample locally or `--offline` to require an
already cached copy. Never move external corpus files into `fixtures/`.

## Documentation requirements

Every code change includes documentation in the same changeset.

| Change                                    | Required documentation                                               |
| ----------------------------------------- | -------------------------------------------------------------------- |
| User-visible behavior or bug fix          | `CHANGELOG.md`; relevant user/package guide                          |
| Feature added or removed                  | `FEATURES.md`                                                        |
| Report field or schema behavior           | `docs/reference/report-schema.md`; core API if applicable            |
| Command, flag, build, or release behavior | this guide; `docs/development/releasing.md`; affected package README |
| Architecture or ownership                 | `docs/development/architecture.md`, `STYLE_GUIDE.md`, agent guides   |
| Public name, label, option, or status     | `docs/reference/terminology.md`; affected reference and tests        |
| Security or data flow                     | `docs/user-guides/privacy.md`; affected package README               |

Do not duplicate long instructions. Update the source-of-truth page and link to it from other pages. The [Documentation index](docs/README.md) lists ownership.

Keep user instructions separate from contributor checks, following the [audience boundary](docs/development/documentation-standard.md#keep-user-guidance-separate-from-contributor-checks). Store point-in-time audit and release evidence under ignored `internal/` or `reports/`; preserve local evidence rather than deleting it to satisfy a check. Public screenshots may retain their synthetic-input provenance, but not audit scorecards.

Read each affected page completely, verify its facts against source, then review its prose and rendered links. Distinguish source builds, local candidates, and published installs. Before handing off a pull request, run the checks and build from `.github/workflows/ci.yml`; after pushing, confirm the hosted validation and VS Code Extension Host jobs pass. Do not call a branch CI-ready while a required check is missing or failing.

Write concrete prose. State what changed, identify the responsible file or command, and explain how the reader can verify it. Avoid promotional claims, generic conclusions, vague attribution, and mechanical formatting. The [Writing guide](docs/development/writing-guide.md) includes examples and a review checklist.

Every maintained page under `docs/` must pass `pnpm audit:docs`. The audit requires a clear title, reader-oriented opening, explicit purpose, ordered headings, an actionable aid, concise paragraphs, readable tables, labeled code fences, final navigation, and prose without em dashes. Automated structure checks supplement factual and editorial review; they do not replace it.

## Versions and releases

The root `package.json` is the version source. `pnpm build` never increments it.

```bash
# after editing the root version
pnpm version:bump
pnpm check:version-sync
pnpm validate
pnpm build
```

Browser archives and the VS Code VSIX must contain `THIRD-PARTY-NOTICES.md`
because their parser bundles include vendored Certinia code.

Read [Release guide](docs/development/releasing.md) for publishing. Do not claim CI automation exists unless a tested workflow is checked into `.github/workflows/`.

### Published package contract

A published package ships only its `dist` directory. Every bare import that survives bundling must therefore resolve from the package's own `dependencies`; a `workspace:*` entry in `devDependencies` is not installed for consumers. The CLI bundles `@apex-log-insights/core` into `dist/bin.js` and declares no runtime dependencies, while the MCP server keeps core external and declares it. `packages/cli/src/publish-contract.test.ts` fails if the CLI build reintroduces an undeclared external, so verify a packed tarball in an empty directory before changing bundling flags:

```bash
pnpm --dir packages/cli pack --pack-destination /tmp
```

## Commit messages

Use the lowest affected layer as the prefix:

- `parser:`
- `report:`
- `viewer:`
- `extension:`
- `cli:`
- `mcp:`
- `docs:`
- `build:`

Keep commits focused and include tests and documentation with the implementation they describe.
