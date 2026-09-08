# Store screenshot guide

Use this page to create store images that show a real user task without exposing production data. Start with the setup screen, then show how a warning moves from Triage Summary to its supporting line in Log Explorer.

Chrome accepts one to five screenshots at 1280 × 800 or 640 × 400 pixels in PNG or JPEG format. Check the current store requirements before submission because dimensions can change.

## Prepare the source

Use the tracked synthetic fixture:

```text
fixtures/webstore-demo-opportunity-trigger.log
```

Do not use a production log. Before capture, check the visible file name, user information, Salesforce IDs, class names, endpoints, query values, and raw lines. Replace the fixture if any value could be mistaken for customer or employee data.

Build and load the Chrome extension as described in the [browser extension guide](../../../docs/development/browser-extension.md#load-the-extension-for-development).

## Capture sequence

The current set is in [assets/images](../../../assets/images/README.md). Use a 1280 × 800 viewport. Capture Setup in its default Light theme and select **Dark mode** for the report views. The main README shows `setup-verification-crop.png` (the card-cropped copy of `1.png`) first, followed by `light/triage-summary.png` and `2.png`. Use the five-image upload order below; retain Diagnostics as an alternate image.

| Upload order | Screen          | File    |
| ------------ | --------------- | ------- |
| 1            | Setup           | `1.png` |
| 2            | Triage Summary  | `3.png` |
| 3            | Execution Story | `2.png` |
| 4            | Data & Limits   | `6.png` |
| 5            | Log Explorer    | `5.png` |
| Alternate    | Diagnostics     | `4.png` |

## Complete theme coverage

The [image inventory](../../../assets/images/README.md#light-and-night-pairs) links every Light and Night pair under `assets/images/light/` and `assets/images/dark/`. Capture both setup states, the analyzer start screen, all five report views, and the actual toolbar popup with file access required and enabled. Expand redaction options for an additional popup capture. Capture the top and bottom of scrolling popups separately at their native size so all controls remain visible.

The log-page launcher stays white in either report theme; keep its shared image as `log-launcher.png`. Keep the populated report images and the default white setup screen as the recommended store selection. The analyzer start screen and native popup images are supplementary UI references.

### 1. Setup

In a temporary Chrome or Edge profile, disable **Allow access to file URLs**, then open the extension's setup page. Show the white setup card, **Open extension settings** button, and file-access instructions. Restore the permission before capturing report views.

Capture the completed state as `setup-complete.png` after enabling access. At the same viewport size, verify that its card dimensions match the verification screen and that both show the outer border and section divider. Keep `1.png` first in the store listing; the completion image is a supplementary asset.

Caption:

> Allow access to local debug logs, then open a log to begin analysis.

### 2. Triage Summary

Show the outcome, top metrics, and at least one evidence-backed finding. Collapse the Scope IDs groups to keep the metrics visible.

Caption:

> Start with the transaction status, resource use, and findings that need attention.

### 3. Execution Story

Show the observed event table with **All events** selected. Keep event types, durations, source lines, log-line links, and the displayed-row limit visible.

Caption:

> Follow observed events in order, with recorded durations and links to raw log lines.

### 4. Data & Limits

Show SOQL and DML rows with duration and evidence controls. Include callouts only when the fixture contains them.

Caption:

> Review DML operations and SOQL queries with row counts, durations, and log-line links.

### 5. Log Explorer

Search for `Read timed out` and set **Context lines** to `2`. Confirm 20 matches, then capture the highlighted lines and their line numbers.

Caption:

> Verify a finding against the exact raw log line.

### Alternate: Diagnostics

Show execution context and its confidence, structural-warning status, and the **What is suspicious** table.

Caption:

> Check what the log supports, what looks suspicious, and what could not be determined.

## Image rules

- Use the exact current view labels from `docs/reference/terminology.md`.
- Capture the submitted build, not a development mock-up.
- Do not add a feature in a caption unless the screenshot shows it.
- Keep browser controls and unrelated tabs out of the image.
- Capture both themes for the complete UI inventory. Use the default Light setup screen and Night report views for the recommended store selection.
- Keep text large enough to read at the store's displayed size.
- Do not add decorative overlays that hide status, evidence, or limitations.
- Do not use placeholder or empty-state content.

## Optional promotional images

If the store still accepts them, use the current required dimensions shown in the developer dashboard.

- Small promotional tile: crop Triage Summary to the status and top metrics.
- Marquee image: show Triage Summary or Execution Story without adding unsupported claims.

Suggested title:

> Apex Log Insights

Suggested subtitle:

> Trace Apex log findings to the raw lines that support them.

## Final check

Confirm that all images:

- use the synthetic fixture;
- match the submitted version;
- contain no sensitive values;
- show distinct tasks rather than five similar screens;
- use captions that describe visible behavior;
- meet the store's current file, count, and dimension requirements.
