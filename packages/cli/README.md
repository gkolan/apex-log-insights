# @apex-log-insights/cli

Command-line tool for analyzing Salesforce Apex debug logs in the browser.

## Install

```bash
# Global install
npm install -g @apex-log-insights/cli

# Or run without installing
npx @apex-log-insights/cli debug.log
```

## Usage

```bash
# Open a single log in the browser
apex-log debug.log

# Open a folder of logs
apex-log ./logs/

# Specify a port
apex-log debug.log --port 3000

# Prevent auto-opening the browser
apex-log debug.log --no-open
```

### Flags

| Flag | Description |
|------|-------------|
| `--port <number>` | Port for the local server (default: auto) |
| `--no-open` | Do not open the browser automatically |
| `--debug` | Show full stack traces on error |

Logs are parsed client-side — nothing is written to disk.

## Build

```bash
pnpm --filter @apex-log-insights/cli build
```
