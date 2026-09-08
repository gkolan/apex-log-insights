# Edge manifest

Use this page when changing or loading the Edge manifest. The goal is to preserve Edge-specific metadata while sharing runtime behavior with the Chrome build.

## Key differences from other browsers

- Nearly identical to Chrome (both use MV3 with `service_worker`)
- Submitted to the Edge Partner Center instead of Chrome Web Store

## Build

```bash
pnpm --filter @apex-log-insights/browser-ext build:edge
```

Output: `dist/edge/` (unpacked) and `dist/edge-extension-v*.zip` (for store upload).

## Load for development

1. Open `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `dist/edge/`
