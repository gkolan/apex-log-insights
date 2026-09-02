# Architecture and ownership

Apex Log Insights has three data layers. Fix a defect in the lowest layer that produces the incorrect value.

| Layer    | Responsibility                                         | Canonical location                                                     |
| -------- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Parser   | Convert raw log lines into typed events                | `packages/core/src/certinia/`                                          |
| Report   | Analyze events and create canonical report JSON        | `packages/core/src/insights/`, `insightsReport.ts`, `offlineReport.ts` |
| Renderer | Normalize a canonical report for display and render it | `viewer/modules/`, `viewer/app.js`, `viewer/styles.css`                |

`packages/vscode-ext/` is a host adapter, not a fourth data layer. It owns VS Code activation, editor integration, worker and webview lifecycles, and packaged assets. Parser, report, normalization, and rendering behavior remain in their canonical layers.

## Diagnostic path

1. Confirm the event exists in the raw log.
2. Inspect `parseLog()` output to determine whether the parser captured it.
3. Inspect the offline report to determine whether the report layer exposed it.
4. Inspect the normalized view model before changing a renderer.

Do not make a renderer infer data that should have been produced by the parser or report layer.

## Viewer and extension sources

The standalone viewer is the canonical shared UI. It has no application bundling step and uses browser-native JavaScript modules.

Host adapters acquire and parse a source, then call `showOfflineReport()` in `viewer/app.js` with the canonical offline report and raw lines. The function is the shared report-display boundary for the CLI, browser extension, and VS Code extension. It hydrates the established five-view panel shell in `viewer/index.html`; `viewer/app.js` owns routing and rendering while `viewer/styles.css` owns the shared visual hierarchy. It does not read files, parse logs, or resolve report-format differences. Those responsibilities remain with the host adapter, parser layer, and normalization modules respectively.

| Change                      | Edit                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| Shared application behavior | `viewer/app.js` or `viewer/modules/*.js`                                 |
| Shared styling              | `viewer/styles.css`                                                      |
| Extension-only behavior     | `packages/browser-ext/shared/app-extension-only.js`                      |
| Extension-only styling      | `packages/browser-ext/shared/styles-extension-only.css`                  |
| Parser worker               | `packages/browser-ext/src/worker-entry.ts` or core parser/report sources |

Never edit these generated files directly:

- `packages/browser-ext/shared/app.js`
- `packages/browser-ext/shared/styles.css`
- `packages/browser-ext/shared/content/apex-parser-worker.js`
- `viewer/apex-parser-worker.js`

`scripts/assemble-extension-ui.ts` combines the viewer and extension-only sources during a build.

## Report compatibility

`viewer/modules/normalize-report.js` and its focused normalization modules are the boundary between report JSON and renderers. Report-shape checks belong there, not in `render-*.js` files.

Read [Report schema](../reference/report-schema.md) before changing public output.

## Related

- [Contributing](../../CONTRIBUTING.md)
- [Report schema](../reference/report-schema.md)
- [Testing and coverage](testing.md)
