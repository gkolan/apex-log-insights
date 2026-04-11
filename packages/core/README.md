# @apex-log-insights/core

The shared parsing engine for Salesforce Apex debug logs. Zero runtime dependencies, pure TypeScript.

Every other package in the monorepo depends on this.

## Install

```bash
pnpm add @apex-log-insights/core
```

## Usage

```typescript
import { parseLog, buildInsightsReport } from '@apex-log-insights/core';

// Parse a raw Apex debug log
const parsed = await parseLog(logText, {
  sourceName: 'debug.log',
  sourceType: 'file',
  enablePhaseInference: true,
});

// Build a structured analysis report
const report = buildInsightsReport({
  filePath: 'debug.log',
  fileBytes: logText.length,
  generatedAt: new Date().toISOString(),
  parseTimeMs: parsed.parseTimeMs,
  parserResult: parsed.parserResult,
});
```

## What it parses

- Execution timeline with 20-phase Salesforce DML lifecycle mapping
- SOQL queries (text, rows, duration, explain plans, N+1 detection)
- DML operations (type, sObject, row counts)
- Governor limit usage and burn rates
- CPU attribution by class and namespace
- Trigger cascades and recursive trigger detection
- Mixed DML detection
- HTTP callouts and named credentials
- Debug level quality assessment

## Build

```bash
pnpm --filter @apex-log-insights/core build
```

Outputs dual CJS + ESM bundles to `dist/` with TypeScript declarations.

## Architecture

```
src/
  certinia/           ← Vendored Certinia parser (BSD 3-Clause)
  insights/           ← Analysis modules (governor, execution, database, etc.)
  parserCore.ts       ← High-level parse entry point
  insightsReport.ts   ← Full analysis report builder
  offlineReport.ts    ← Offline viewer report format (v3.0.0 schema)
  report.ts           ← Deterministic report format (v1.0.0 schema)
  phases.ts           ← 20-phase execution model definitions
  index.ts            ← Public API barrel export
```
