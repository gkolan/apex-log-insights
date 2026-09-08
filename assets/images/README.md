# Product screenshots

The capture set contains 14 browser-extension Light/Night pairs, nine VS Code Light/Dark pairs, and the shared white log-page launcher. The toolbar popup includes its permission prompt, ready state, expanded redaction options, and scrolled views of the lower controls. Lead documentation and store listings with the white verification screen, `1.png`.

## Light and Night pairs

Full-page screens use a 1280 × 800 viewport. Actual toolbar popups use their native 360-pixel content width; the browser adds a scrollbar where needed. Separate top and bottom images preserve the popup's 600-pixel maximum visible height.

| Screen                                    | Light                                             | Night                                            |
| ----------------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| Setup: verification required              | [Light](light/setup-verification.png)             | [Night](dark/setup-verification.png)             |
| Setup: complete                           | [Light](light/setup-complete.png)                 | [Night](dark/setup-complete.png)                 |
| Analyzer: choose a log                    | [Light](light/analyzer-start.png)                 | [Night](dark/analyzer-start.png)                 |
| Toolbar popup: verification required      | [Light](light/toolbar-popup-verification.png)     | [Night](dark/toolbar-popup-verification.png)     |
| Toolbar popup: ready, top                 | [Light](light/toolbar-popup-ready.png)            | [Night](dark/toolbar-popup-ready.png)            |
| Toolbar popup: ready, bottom              | [Light](light/toolbar-popup-ready-bottom.png)     | [Night](dark/toolbar-popup-ready-bottom.png)     |
| Toolbar popup: redaction expanded, top    | [Light](light/toolbar-popup-redaction.png)        | [Night](dark/toolbar-popup-redaction.png)        |
| Toolbar popup: redaction expanded, bottom | [Light](light/toolbar-popup-redaction-bottom.png) | [Night](dark/toolbar-popup-redaction-bottom.png) |
| Triage Summary                            | [Light](light/triage-summary.png)                 | [Night](dark/triage-summary.png)                 |
| Execution Story                           | [Light](light/execution-story.png)                | [Night](dark/execution-story.png)                |
| Data & Limits                             | [Light](light/data-and-limits.png)                | [Night](dark/data-and-limits.png)                |
| Diagnostics                               | [Light](light/diagnostics.png)                    | [Night](dark/diagnostics.png)                    |
| Log Explorer                              | [Light](light/log-explorer.png)                   | [Night](dark/log-explorer.png)                   |

| Log Explorer: ID search regression | [Light](light/log-explorer-id.png) | [Night](dark/log-explorer-id.png) |

The [log-page launcher](log-launcher.png) intentionally stays white with grey text in either report theme. It has no separate dark variant.

## VS Code screenshots

These images were captured from the rebuilt VSIX runtime in an isolated VS Code 1.132.0 Extension Development Host using **Default Light Modern** and **Default Dark Modern**. The report screenshots show the actual webview; the workspace images include the source editor and report together. VS Code follows the active editor theme and has no browser setup screen or toolbar popup.

| Screen                              | Light                                     | Dark                                    |
| ----------------------------------- | ----------------------------------------- | --------------------------------------- |
| Workspace and source editor         | [Light](light/vscode-workspace.png)       | [Dark](dark/vscode-workspace.png)       |
| Triage Summary                      | [Light](light/vscode-triage-summary.png)  | [Dark](dark/vscode-triage-summary.png)  |
| Execution Story                     | [Light](light/vscode-execution-story.png) | [Dark](dark/vscode-execution-story.png) |
| Data & Limits                       | [Light](light/vscode-data-and-limits.png) | [Dark](dark/vscode-data-and-limits.png) |
| Diagnostics                         | [Light](light/vscode-diagnostics.png)     | [Dark](dark/vscode-diagnostics.png)     |
| Log Explorer                        | [Light](light/vscode-log-explorer.png)    | [Dark](dark/vscode-log-explorer.png)    |
| Redaction settings                  | [Light](light/vscode-redaction.png)       | [Dark](dark/vscode-redaction.png)       |
| Source changed and Refresh Analysis | [Light](light/vscode-source-changed.png)  | [Dark](dark/vscode-source-changed.png)  |

| Log Explorer: ID search regression | [Light](light/vscode-log-explorer-id.png) | [Dark](dark/vscode-log-explorer-id.png) |

The screenshots use the synthetic store fixture. VS Code follows the editor theme and can display a stale-source notice when a log changes after analysis.

## Documentation and store images

These existing filenames are copies of the paired captures selected for documentation and store use:

| File                          | Content                                                               | Theme |
| ----------------------------- | --------------------------------------------------------------------- | ----- |
| `1.png`                       | Setup: verification required                                          | Light |
| `2.png`                       | Execution Story                                                       | Night |
| `3.png`                       | Triage Summary                                                        | Night |
| `4.png`                       | Diagnostics                                                           | Night |
| `5.png`                       | Log Explorer: 20 “Read timed out” matches, two context lines          | Night |
| `6.png`                       | Data & Limits                                                         | Night |
| `setup-complete.png`          | Setup complete                                                        | Light |
| `setup-verification-crop.png` | Setup: verification required, cropped to the card for the main README | Light |
| `chrome-promo-tile.png`       | Required 440 × 280 Chrome Web Store promotional tile                  | Night |

`chrome-promo-tile.svg` is the editable source for the promotional tile. The tile uses the shipped report icon and contains no screenshots, customer data, or text that could become stale.

## Capture source

Browser-extension captures were taken on 2026-09-03 from the rebuilt Edge 1.2.0 package loaded into a temporary Microsoft Edge 152.0.4191.53 profile. Report images use only [the synthetic store fixture](../../fixtures/webstore-demo-opportunity-trigger.log), containing 2,169 lines. The example.com address, Salesforce-shaped IDs, class names, and endpoints belong to that fixture; no production log or profile data was used. Images have no decorative overlays or browser controls.

Full-page images use a 1280 × 800 viewport. Popup captures preserve their native width and visible top/bottom portions. These are product illustrations from local builds, not evidence of Marketplace publication or accessibility certification. Detailed runtime and accessibility audit records remain in local maintainer evidence.

## Recreate the images

Follow the [store screenshot guide](../../packages/browser-ext/store/screenshots-guide.md). Capture only synthetic or deliberately sanitized inputs and verify labels against the [terminology contract](../../docs/reference/terminology.md).
