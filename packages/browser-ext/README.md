# @apex-log-insights/browser-ext

Browser extension for analyzing Salesforce Apex debug logs. One shared codebase, three browser targets.

## How It Works

The extension uses a single set of source files (`shared/`) compiled against browser-specific manifests (`manifests/chrome`, `manifests/edge`, `manifests/firefox`). The build scripts assemble the correct combination for each store.

```
shared/                 ← HTML, JS, CSS, icons (identical across browsers)
  app.html, app.js      ← Main analyzer UI
  popup.html, popup.js  ← Extension popup (quick actions)
  background.js         ← Service worker / background script
  content/              ← Content scripts + built worker
  icons/                ← Extension icons (idle + active states)
  styles.css            ← Shared stylesheet

manifests/
  chrome/manifest.json  ← Manifest V3 for Chrome Web Store
  edge/manifest.json    ← Manifest V3 for Edge Add-ons (nearly identical to Chrome)
  firefox/manifest.json ← Manifest V3 for Firefox Add-ons (uses background.scripts + gecko data_collection_permissions)

src/
  worker-entry.ts       ← TypeScript source for the Web Worker (bundled by esbuild)
  perf-shim.ts          ← Browser polyfill for node:perf_hooks
```

## Building

Running `pnpm build` from the repo root builds **all** packages, including the extension. The browser-ext `build` step does two things: (1) bundles the TypeScript worker via esbuild, and (2) assembles `shared/app.js` and `shared/styles.css` by merging the viewer sources with extension-only overlays (`scripts/assemble-extension-ui.ts`). This means changes to `viewer/app.js` or `viewer/styles.css` are automatically propagated to the extension on every build.

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

| Browser | Unpacked directory | Upload-ready file |
|---------|-------------------|-------------------|
| Chrome  | `dist/chrome/`    | `dist/chrome-extension-v1.2.0.zip` |
| Edge    | `dist/edge/`      | `dist/edge-extension-v1.2.0.zip`   |
| Firefox | `dist/firefox/`   | `dist/firefox-extension-v1.2.0.xpi`|

All JavaScript in the zips is minified. Source code in `src/` stays readable for contributors.

## Loading for Development

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

## Why One Codebase, Three Manifests?

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

## Version Management

All versions are managed from the root `package.json` and synced into each manifest via `node scripts/sync-versions.mjs`. Never edit manifest versions by hand.

The easiest way to bump and build is the `--version` flag on the build scripts (see Building above). For a manual bump: edit the root `package.json`, run `node scripts/sync-versions.mjs`, then build.
