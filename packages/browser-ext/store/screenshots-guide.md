# Store screenshot guide

Use this page to create store images that show a real user task without exposing production data. The finished set should let a store visitor see how a warning moves from Triage Summary to its supporting line in Log Explorer.

Chrome accepts one to five screenshots at 1280 × 800 or 640 × 400 pixels in PNG or JPEG format. Check the current store requirements before submission because dimensions can change.

## Prepare the source

Use the tracked synthetic fixture:

```text
fixtures/webstore-demo-opportunity-trigger.log
```

Do not use a production log. Before capture, check the visible file name, user information, Salesforce IDs, class names, endpoints, query values, and raw lines. Replace the fixture if any value could be mistaken for customer or employee data.

Build and load the Chrome extension as described in the [browser extension guide](../README.md#load-the-extension-for-development).

## Capture sequence

### 1. Triage Summary

Show the status, top metrics, and at least one evidence-backed finding.

Caption:

> Start with the transaction status, resource use, and findings that need attention.

### 2. Execution Story

Show several observed lifecycle phases and one expanded execution block. Keep confidence labels visible when possible.

Caption:

> Follow what ran, in order, with lifecycle phases and evidence confidence.

### 3. Data & Limits

Show SOQL and DML rows with duration and evidence controls. Include callouts only when the fixture contains them.

Caption:

> Review SOQL, DML, external calls, and governor-limit use in one transaction.

### 4. Diagnostics

Show execution context, instrumentation quality, and one supported warning or limitation.

Caption:

> Check what the log supports, what looks suspicious, and what could not be determined.

### 5. Log Explorer

Follow a finding to its raw line or search for a term that exists in the fixture. Keep the highlighted match and line number visible.

Caption:

> Verify a finding against the exact raw log line.

## Image rules

- Use the exact current view labels from `docs/reference/terminology.md`.
- Capture the submitted build, not a development mock-up.
- Do not add a feature in a caption unless the screenshot shows it.
- Keep browser controls and unrelated tabs out of the image.
- Use one theme across the set unless the image demonstrates theme selection.
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
