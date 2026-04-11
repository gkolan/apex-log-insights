# Chrome Manifest

This `manifest.json` is the Manifest V3 configuration for the Chrome Web Store.

## Key differences from other browsers

- Uses `"background": { "service_worker": "background.js" }` (Chrome's MV3 format)
- No `browser_specific_settings` field

## Build

```bash
pnpm --filter @apex-log-insights/browser-ext build:chrome
```

Output: `dist/chrome/` (unpacked) and `dist/chrome-extension-v*.zip` (for store upload).

## Load for development

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `dist/chrome/`
