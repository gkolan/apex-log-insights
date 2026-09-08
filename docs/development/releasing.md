# Release guide

Use this guide as a maintainer to validate, package, and publish one intentional
version without allowing a normal build to change that version.

## Before releasing

Keep one-off review records and artifact hashes in ignored `internal/` or `reports/`. Preserve existing evidence; do not delete it to make a check pass. Reusable release procedures and checks remain tracked. Public user guides and store descriptions contain product behavior and installation status, not audit scorecards.

1. Update `CHANGELOG.md` in Keep a Changelog format.
2. Choose the semantic version based on user-visible compatibility.
3. Run the code, dependency, package, and runtime-cycle gates:

   ```bash
   pnpm validate
   pnpm audit:report
   pnpm build
   pnpm bugs:report
   ```

   A stable release requires all four commands to finish successfully, `pnpm audit:report` to write zero issues, and `pnpm bugs:report` to write zero issues. `pnpm validate` builds the shared core type declarations, so it also works before a full build in a fresh clone. The bug report checks built package bundles, so run it after `pnpm build`.

4. For parser, report, normalizer, renderer, or large-log changes, run the
   optional external compatibility gate while the pinned public sample is
   available:

   ```bash
   pnpm test:corpus
   ```

   A network failure does not establish product failure. Once the download is
   verified, any parser diagnostic, unsupported timeline event, report error,
   or five-view rendering error blocks the release. See
   [Testing and coverage](testing.md#test-the-external-corpus) for storage,
   retention, and privacy behavior.

5. If Salesforce Code Analyzer is available, run the maintained-source scan from the repository root:

   ```bash
   mkdir -p code-analyzer-output
   sf code-analyzer run \
     --rule-selector Recommended \
     --target 'packages/*/src/**/*.ts' \
     --target 'packages/*/src/**/*.js' \
     --target 'viewer/modules/**/*.js' \
     --target 'scripts/**/*.ts' \
     --workspace . \
     --output-file code-analyzer-output/release-results.json
   ```

   The ignored `code-analyzer-output/` directory holds disposable scan results. The scan must complete without engine errors or violations. `code-analyzer.yml` remains versioned because it documents generated-file exclusions, the duplication threshold, and four renderer files that Code Analyzer's CPD lexer cannot parse. Those renderer files remain covered by ESLint and rendering tests.

## Set and synchronize the version

Edit the version in the root `package.json`, then synchronize every package, manifest, and viewer marker:

```bash
pnpm version:bump
pnpm check:version-sync
```

Alternatively, the extension exporter accepts an explicit version or bump type:

```bash
pnpm export:extension -- --version 1.2.0
```

Do not use `--version` merely to rebuild artifacts.

## Build artifacts

```bash
pnpm build
```

This builds packages, the viewer worker, generated extension UI, and Chrome, Edge, and Firefox archives for the already-selected version.

The VS Code package has a separate version-preserving release-candidate command:

```bash
pnpm --filter ./packages/vscode-ext package:vsix
```

The command writes the ignored local artifact `packages/vscode-ext/apex-log-insights.vsix` outside the allowlisted runtime directory. Inspect it with `vsce ls --tree`, confirm that `THIRD-PARTY-NOTICES.md` is present, install it in an isolated VS Code profile, and confirm the Marketplace publisher credentials before publication. Packaging does not publish or change the selected version.

Inspect the README inside the VSIX after packaging. Its links must point to existing repository pages without unresolved parent paths. Keep contributor instructions and audit evidence outside the Marketplace README. Recompute artifact hashes after any rebuild; an old review record cannot verify a new archive.

The release workflow runs the same command and attaches the resulting `.vsix` to the GitHub Release. Marketplace publication remains a separate manual step performed with maintainer publisher credentials.

## Publish with GitHub Actions

Pushing a semantic-version tag runs `.github/workflows/release.yml`. The workflow verifies that the tag matches the root package version, validates and builds the repository, publishes the three public npm packages, and attaches the browser archives and the VS Code `.vsix` to a GitHub Release.

Release notes come from `docs/releases/<version>.md` when that page exists, so the curated release page is published verbatim. The workflow falls back to generated commit notes only when no such page is present.

The repository must have an `NPM_TOKEN` Actions secret authorized to publish the packages.

```bash
git tag v1.2.0
git push origin v1.2.0
```

Before any publish operation, verify:

- the worktree contains only intended release changes;
- `pnpm validate` passes;
- `pnpm audit:report` writes zero dependency, secret, or security-lint issues;
- `pnpm bugs:report` writes zero issues after a fresh build;
- the external corpus gate passes for parser, report, normalizer, renderer, or large-log changes when the pinned sample is available;
- the maintained-source Code Analyzer scan reports zero violations when the tool is available;
- every browser archive and the VSIX contains `THIRD-PARTY-NOTICES.md`;
- versions match;
- generated extension assets and archives were rebuilt;
- store release notes and submission checklists are current;
- the Firefox reviewer source archive is present beside the XPI and rebuilds to identical extension file contents;
- the required Chrome 440×280 promotional tile and current screenshots are ready;
- npm and browser-store credentials are available through approved maintainer tooling.

The root `pnpm release` command is the manual fallback. It validates, builds, and invokes recursive npm publishing. Use it only after reviewing its publish targets and authenticating to npm.

## Related

- [Testing and coverage](testing.md)
- [Browser store submission checklist](../../packages/browser-ext/store/SUBMISSION-CHECKLIST.md)
- [Changelog](../../CHANGELOG.md)
