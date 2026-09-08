# Firefox reviewer build instructions

This archive contains the source needed to reproduce the bundled JavaScript in Apex Log Insights for Firefox. It is intended for the Firefox Add-ons reviewer source-code upload and is not the installable extension.

## Build environment

- Ubuntu 24.04 LTS or macOS 15
- Node.js 24
- pnpm 10.27.0, enabled with Corepack
- Standard `bash`, `cp`, and `zip` command-line tools

All build tools and dependencies are open source and locked by `pnpm-lock.yaml`. The build does not download code at runtime or require a network service after dependencies are installed.

## Reproduce the submitted extension

From the directory that contains the extracted `apex-log-insights-{{VERSION}}-source` folder:

```bash
cd apex-log-insights-{{VERSION}}-source
corepack enable
corepack prepare pnpm@10.27.0 --activate
pnpm install --frozen-lockfile
pnpm --filter @apex-log-insights/core build
pnpm --filter @apex-log-insights/browser-ext build:firefox
```

The installable package is written to:

```text
packages/browser-ext/dist/firefox-extension-v{{VERSION}}.xpi
```

To compare it with the submitted XPI, extract both archives and compare the extracted directories. ZIP timestamps and entry order may differ; the file contents should be identical.

The build performs two generation steps:

1. esbuild bundles `packages/browser-ext/src/worker-entry.ts` and the shared parser into `content/apex-parser-worker.js`.
2. `scripts/assemble-extension-ui.ts` combines the maintained viewer modules and extension overlay into `app.js` and combines their styles into `styles.css`.

The submitted extension is bundled for browser loading but is not obfuscated.
