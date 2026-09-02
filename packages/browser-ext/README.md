# @apex-log-insights/browser-ext

Use this guide to build, load, and package the Apex Log Insights browser extension for Chrome, Edge, or Firefox. After following it, you should have either an unpacked development extension or a versioned store archive built from the canonical viewer sources.

## How it works

The extension reuses the canonical viewer and adds extension-only overlays. Build scripts generate shared assets and combine them with browser-specific manifests. Theme updates preserve the viewer's established panel, table, and finding hierarchy across every host.

The analyzer validates canonical schema `3.0.0` before display, supports picker and drag-and-drop input, shares theme state with the popup, and retains actionable automatic-load failures. Sibling-log storage cleanup is restricted to generated cache keys so user preferences survive.

```
shared/                 ← Extension HTML, overlays, icons, and generated assets
  app.html              ← Main analyzer shell
  app-extension-only.js ← Canonical extension-only behavior
  app.js                ← Generated; never edit directly
  popup.html, popup.js  ← Extension popup (quick actions)
  background.js         ← Service worker / background script
  content/              ← Content scripts + built worker
  icons/                ← Extension icons (idle + active states)
  styles-extension-only.css ← Canonical extension-only styles
  styles.css            ← Generated; never edit directly

manifests/
  chrome/manifest.json  ← Manifest V3 for Chrome Web Store
  edge/manifest.json    ← Manifest V3 for Edge Add-ons (nearly identical to Chrome)
  firefox/manifest.json ← Manifest V3 for Firefox Add-ons (uses background.scripts + gecko data_collection_permissions)

src/
  worker-entry.ts       ← TypeScript source for the Web Worker (bundled by esbuild)
  perf-shim.ts          ← Browser polyfill for node:perf_hooks
```

## Building

The popup's **Clear cached logs** action removes captured `apex-log-*` payloads while preserving theme, redaction, Log Explorer, and sidebar preferences.

The extension keeps investigation inside five views: **Triage Summary**, **Execution Story**, **Data & Limits**, **Diagnostics**, and **Log Explorer**.

Triage checks log quality without showing a routine success card. If Salesforce truncated the log, skipped content, or omitted a transaction boundary, Triage shows a **Log quality warning** explaining why some conclusions may be incomplete. When the log contains an exception, **Failure context** links the recorded events immediately before that failure to Log Explorer.

Raw logs and local JSON reports are limited to 25 MiB. Local-file and captured-page paths reject larger input before caching or expanding it into raw lines, and the parser worker independently enforces the same boundary for direct messages. Its single `PARSE_LOG` protocol requires non-empty text and accepts `fileId` only as an optional non-empty string, preserving report metadata types. Worker-side UTF-8 sizing does not allocate a second encoded copy of the complete log. URL-loaded logs are read through a bounded stream, so missing, compressed, or inaccurate `Content-Length` headers cannot bypass the decompressed-byte limit.

Automatic handoffs accept only credential-free HTTP, HTTPS, or file URLs whose path ends in `.log`. Storage handoffs accept only keys generated for captured logs or short-lived new-tab report state; arbitrary extension storage keys are ignored.

Running `pnpm build` from the repository root builds all packages and extension archives at the current version. It never increments the version. The browser-ext build bundles the TypeScript worker and assembles generated `shared/app.js` and `shared/styles.css` from viewer sources plus extension-only overlays.

To build the final browser-specific zips/xpi for store upload, use the per-browser build scripts. All three follow the same process: build the TypeScript worker, copy shared assets, overlay the browser-specific manifest, and zip with a versioned filename.

```bash
# Rebuild with the current version:
pnpm --filter @apex-log-insights/browser-ext build:chrome
pnpm --filter @apex-log-insights/browser-ext build:edge
pnpm --filter @apex-log-insights/browser-ext build:firefox

# Bump to a new version and build in one step:
pnpm --filter @apex-log-insights/browser-ext build:chrome -- --version 1.2.0
pnpm --filter @apex-log-insights/browser-ext build:edge -- -v 1.2.0
pnpm --filter @apex-log-insights/browser-ext build:firefox -- -v 1.2.0
```

The `--version` / `-v` flag updates the root `package.json`, syncs the version across all packages and manifests, then builds. Without it, the script just rebuilds with whatever version is currently set.

You can also run the scripts directly:

```bash
bash scripts/build-chrome.sh                 # current version
bash scripts/build-chrome.sh --version 1.2.0 # bump and build
```

### Build output

Each build produces an unpacked folder (for development) and a versioned zip (for distribution). Old versioned zips are cleaned up automatically on each build.

| Browser | Unpacked directory | Upload-ready file                   |
| ------- | ------------------ | ----------------------------------- |
| Chrome  | `dist/chrome/`     | `dist/chrome-extension-v1.2.0.zip`  |
| Edge    | `dist/edge/`       | `dist/edge-extension-v1.2.0.zip`    |
| Firefox | `dist/firefox/`    | `dist/firefox-extension-v1.2.0.xpi` |

All JavaScript in the zips is minified. Source code in `src/` stays readable for contributors.

## Load the extension for development

### Chrome

1. Run `bash scripts/build-chrome.sh`
2. Open `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `dist/chrome/` directory

### Edge

1. Run `bash scripts/build-edge.sh`
2. Open `edge://extensions`
3. Enable **Developer mode** (toggle in bottom-left)
4. Click **Load unpacked**
5. Select the `dist/edge/` directory

### Firefox

1. Run `bash scripts/build-firefox.sh`
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on**
4. Select any file inside `dist/firefox/` (e.g. `manifest.json`)

Note: Temporary add-ons in Firefox are removed when the browser closes. For persistent installation during development, use `web-ext run` or sign the extension.

## Why the project has three manifests

Chrome and Edge both use Manifest V3 with nearly identical schemas. The only difference between their manifests is metadata (store-specific fields). Firefox also supports MV3 but has a key structural difference: it uses `"background": { "scripts": ["background.js"] }` instead of `"background": { "service_worker": "background.js" }`. Keeping manifests separate while sharing all source code avoids duplicating the entire extension.

## Publishing

### Chrome Web Store

1. Build: `bash scripts/build-chrome.sh`
2. Upload `dist/chrome-extension-v*.zip` to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Store metadata and screenshots are in `store/`

### Edge Add-ons

1. Build: `bash scripts/build-edge.sh`
2. Upload `dist/edge-extension-v*.zip` to the [Edge Partner Center](https://partner.microsoft.com/dashboard/microsoftedge)

### Firefox Add-ons

1. Build: `bash scripts/build-firefox.sh`
2. Upload `dist/firefox-extension-v*.xpi` to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)

Firefox manifest note: `manifests/firefox/manifest.json` includes
`browser_specific_settings.gecko.data_collection_permissions` with
`required: ["none"]` to satisfy Firefox Add-ons validation for new submissions.

## Version management

All versions are managed from the root `package.json` and synced into each manifest via `node scripts/sync-versions.mjs`. Never edit manifest versions by hand.

For the complete validation, version, artifact, and publication sequence, use the repository [Release guide](../../docs/development/releasing.md).

Before packaging, run root `pnpm format:check` or `pnpm validate`. Formatting discovers maintained extension worker sources and documentation from Git but excludes assembled files under `shared/`, which are regenerated by the build pipeline.
