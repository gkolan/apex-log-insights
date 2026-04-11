# Firefox Manifest

This `manifest.json` is the Manifest V3 configuration for Firefox Add-ons.

## Key differences from other browsers

- Uses `"background": { "scripts": ["background.js"] }` instead of `"service_worker"`
- Includes `browser_specific_settings.gecko.id` (required for Firefox Add-ons)

## Build

```bash
pnpm --filter @apex-log-insights/browser-ext build:firefox
```

Output: `dist/firefox/` (unpacked) and `dist/firefox-extension-v*.xpi` (for store upload).

## Load for development

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select any file inside `dist/firefox/`

Note: Temporary add-ons are removed when Firefox closes.
