# VS Code extension release review

Review date: 2026-09-02

Candidate version: 1.2.0

Extension ID: `apex-log-insights.apex-log-insights`

Use this record to review the VS Code release candidate, reproduce its evidence, and distinguish completed package work from the still-unpublished Marketplace listing.

## Outcome

The VS Code extension is complete as a local release candidate. Marketplace publication remains a separate authorized action because it requires publisher authentication and produces a public external change.

Candidate artifact: `packages/vscode-ext/apex-log-insights.vsix`  
SHA-256: `c638c47c5bee1b0482677d6664f9795e55bcc868290a4a7701f22136fbbf798f`

## Verification record

| Gate                        | Evidence                                                                                                        | Result |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ |
| Repository health           | `pnpm validate`; 47 test files and 359 tests                                                                    | Pass   |
| Coverage                    | `pnpm test:coverage`; 66.68% statements, 69.39% branches, 58.96% functions, 66.68% lines                        | Pass   |
| Extension Host, minimum     | Official harness on VS Code 1.96.0, macOS arm64                                                                 | Pass   |
| Extension Host, current     | Official harness on installed VS Code 1.132.0, macOS arm64                                                      | Pass   |
| Package integrity           | 37 files; no tests, source maps, `node_modules`, server, service worker, fixture, or unrelated repository files | Pass   |
| Clean-profile installation  | VSIX installed as `apex-log-insights.apex-log-insights@1.2.0` in isolated user-data and extensions directories  | Pass   |
| Production dependency audit | `pnpm audit --prod` after the Hono patched-version override                                                     | Pass   |
| Version and documentation   | Version-sync and documentation consistency checks                                                               | Pass   |

CI repeats the Extension Host smoke test on Linux under Xvfb against VS Code 1.96.0 and the current stable release.

## Privacy and security review

The selected source moves through the VS Code document or file-system API, an in-memory source object, a dedicated parser worker, the canonical offline report, and a restricted webview message. Closing the panel removes host references to the raw lines and report; stopping the extension host terminates every parser worker. The extension does not persist source or report content, start a server, emit telemetry, or make a processing-time network request.

The webview uses a nonce-bearing Content Security Policy with `default-src 'none'` and `connect-src 'none'`. Its local resource root contains only generated viewer assets. Host messages are narrowed by type and value. Evidence navigation accepts only positive integer lines, and the only allowed external destination is the repository issue tracker. Raw content is not written to the output channel.

In Remote SSH and Dev Containers, parsing is designed to run in the workspace extension host. No remote environment was available in this review, so remote operation is not included in the tested-platform evidence and browser-hosted VS Code remains unsupported.

## Accessibility and performance review

The VS Code overlay follows editor, link, focus, warning, error, success, selection, and high-contrast theme tokens. It removes the redundant viewer theme toggle, preserves visible keyboard focus, retains semantic navigation and status markup from the canonical viewer, and gives refresh and evidence actions text labels. The shared viewer regression suite verifies the five named destinations and evidence terminology.

Source detection reads at most 100 lines or 64 KiB. Source acquisition rejects the first byte above 25 MiB, with an exact-boundary unit test. Parsing runs outside the extension-host event loop, is cancellable, has a 120-second timeout, and is independent per source panel. Hidden panels do not retain a live webview context. The canonical renderer retains its existing large-view caps and replacement-render tests.

## Publication boundary

Marketplace listing copy, release notes, icon, privacy text, support URL, publisher ID, and installable artifact are ready. Publication was not attempted. Before publishing, authenticate the `apex-log-insights` publisher, review the external listing one final time, publish this exact version, and record the Marketplace URL and returned artifact identity.

## Related

- [VS Code package guide](../../packages/vscode-ext/README.md)
- [VS Code extension specification](vscode-extension-spec.md)
- [Release process](releasing.md)
