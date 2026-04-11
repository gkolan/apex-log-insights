import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parseLog } from '../src/parserCore.js';
import { buildOfflineReport } from '../src/offlineReport.js';

function extractSyntheticLogBlocks(markdown: string): string[] {
  const sections = markdown.split(/^## Synthetic Log.*$/m).slice(1);
  return sections
    .map((section) => {
      const match = section.match(/```[\s\S]*?```/);
      if (!match) return '';
      return match[0].replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '').trim();
    })
    .filter(Boolean);
}

// Skipped: synthetic doc fixtures (docs/synthetic_logs/*.md) have not been created yet.
// Re-enable once the markdown files with embedded log blocks are written.
it.skip('advanced synthetic fixture verifies parser-backed surfacing features', async () => {
  const docPath = resolve(process.cwd(), 'docs/synthetic_logs/advanced-surfacing-features.md');
  const markdown = await readFile(docPath, 'utf8');
  const [rawLogText] = extractSyntheticLogBlocks(markdown);

  expect(rawLogText, 'expected synthetic log block').toBeTruthy();

  const parseResult = await parseLog(rawLogText, {
    sourceName: docPath,
    sourceType: 'file',
    includeRawLines: true,
    enablePhaseInference: true,
  });

  const report = buildOfflineReport({
    source: {
      fileName: docPath,
      bytes: Buffer.byteLength(rawLogText),
    },
    parseResult,
    rawLogText,
  }) as any;

  expect(Array.isArray(report.database?.soqlPatterns), 'expected soqlPatterns array').toBeTruthy();
  expect(
    report.database.soqlPatterns.some((pattern: any) => pattern?.isLoopSuspect),
  ).toBeTruthy();

  expect(Array.isArray(report.issues), 'expected issues array').toBeTruthy();
  expect(
    report.issues.some((item: any) => String(item?.type) === 'SOQL_LOOP_SUSPECT'),
  ).toBeTruthy();

  expect(Array.isArray(report.trace?.validationBlocks), 'expected validation blocks').toBeTruthy();
  expect(report.trace.validationBlocks.length > 0, 'expected at least one validation block').toBeTruthy();

  const validationRules = report.trace.validationBlocks.flatMap((block: any) => Array.isArray(block?.rules) ? block.rules : []);
  expect(
    validationRules.some((rule: any) => String(rule?.ruleName) === 'Account_Name_Required'),
  ).toBeTruthy();

  expect(Array.isArray(report.savepoints), 'expected savepoints array').toBeTruthy();
  expect(
    report.savepoints.some((sp: any) => String(sp?.name || '').toLowerCase().includes('savepoint')),
  ).toBeTruthy();

  const systemModeTransitions = Array.isArray(report.systemModeTransitions)
    ? report.systemModeTransitions
    : Array.isArray(report.systemModeTransitions?.items)
      ? report.systemModeTransitions.items
      : [];
  expect(systemModeTransitions.length >= 2, 'expected system mode transitions').toBeTruthy();

  expect(report.governorBurnRate, 'expected governorBurnRate object').toBeTruthy();
  const burnRates = Array.isArray(report.governorBurnRate?.burnRates) ? report.governorBurnRate.burnRates : [];
  expect(burnRates.length > 0, 'expected burn-rate rows').toBeTruthy();

  expect(Array.isArray(report.managedPackageImpact), 'expected managedPackageImpact array').toBeTruthy();
  const kimbleImpact = report.managedPackageImpact.find((item: any) => item?.namespace === 'KimbleOne');
  expect(kimbleImpact, 'expected managed package impact for KimbleOne').toBeTruthy();
  expect((kimbleImpact?.spanCount ?? 0) > 0, 'expected non-zero managed package span count').toBeTruthy();

  expect(report.cpuAttribution?.byNamespace, 'expected cpu attribution by namespace').toBeTruthy();
  const kimbleCpu = report.cpuAttribution.byNamespace?.KimbleOne;
  expect(kimbleCpu, 'expected KimbleOne CPU attribution').toBeTruthy();
  expect((kimbleCpu?.totalDurationMs ?? 0) > 0, 'expected non-zero managed package CPU attribution').toBeTruthy();

  expect(report.overview?.topMetrics?.queueablesEnqueued?.count).toBe(1);
  expect(Array.isArray(report.timeline), 'expected timeline').toBeTruthy();
  expect(report.timeline.length > 0, 'expected non-empty timeline').toBeTruthy();
  expect(report.evidenceIndex, 'expected evidenceIndex').toBeTruthy();
  expect(Array.isArray(report.evidenceIndex?.events), 'expected event evidence index').toBeTruthy();
  expect(Array.isArray(report.phases), 'expected canonical phases').toBeTruthy();
  expect(report.reportVersion).toBe('3.0.0');
});

it.skip('trigger cascade synthetic fixture verifies nested trigger chains', async () => {
  const docPath = resolve(process.cwd(), 'docs/synthetic_logs/trigger-cascade-features.md');
  const markdown = await readFile(docPath, 'utf8');
  const [rawLogText] = extractSyntheticLogBlocks(markdown);

  expect(rawLogText, 'expected synthetic log block').toBeTruthy();

  const parseResult = await parseLog(rawLogText, {
    sourceName: docPath,
    sourceType: 'file',
    includeRawLines: true,
    enablePhaseInference: true,
  });

  const report = buildOfflineReport({
    source: {
      fileName: docPath,
      bytes: Buffer.byteLength(rawLogText),
    },
    parseResult,
    rawLogText,
  }) as any;

  expect(Array.isArray(report.triggerCascade), 'expected triggerCascade array').toBeTruthy();
  expect(report.triggerCascade.length > 0, 'expected at least one trigger cascade root').toBeTruthy();

  const root = report.triggerCascade[0];
  expect(String(root?.label ?? '')).toMatch(/AccountTrigger on Account trigger event AfterUpdate/);
  expect(Array.isArray(root?.children), 'expected trigger root children').toBeTruthy();
  expect(root.children.some((child: any) => child?.type === 'dml'), 'expected DML child under root trigger').toBeTruthy();

  const flatten = (nodes: any[]): any[] => nodes.flatMap((node) => [node, ...flatten(Array.isArray(node?.children) ? node.children : [])]);
  const cascadeNodes = flatten(report.triggerCascade);

  expect(
    cascadeNodes.some((node) => node?.type === 'trigger' && String(node?.label ?? '').includes('ContactTrigger')),
  ).toBeTruthy();
  expect(
    cascadeNodes.some((node) => node?.type === 'trigger' && String(node?.label ?? '').includes('TaskTrigger') && (node?.depth ?? 0) >= 4),
  ).toBeTruthy();
});

it.skip('post-commit async synthetic fixture verifies async governor metrics', async () => {
  const docPath = resolve(process.cwd(), 'docs/synthetic_logs/post-commit-async-features.md');
  const markdown = await readFile(docPath, 'utf8');
  const [rawLogText] = extractSyntheticLogBlocks(markdown);

  expect(rawLogText, 'expected synthetic log block').toBeTruthy();

  const parseResult = await parseLog(rawLogText, {
    sourceName: docPath,
    sourceType: 'file',
    includeRawLines: true,
    enablePhaseInference: true,
  });

  const report = buildOfflineReport({
    source: {
      fileName: docPath,
      bytes: Buffer.byteLength(rawLogText),
    },
    parseResult,
    rawLogText,
  }) as any;

  expect(report.overview?.topMetrics?.emailInvocations?.count).toBe(1);
  expect(report.overview?.topMetrics?.futureCalls?.count).toBe(1);
  expect(report.overview?.topMetrics?.queueablesEnqueued?.count).toBe(1);

  expect(Array.isArray(report.timeline), 'expected canonical timeline').toBeTruthy();
  expect(
    report.timeline.some((event: any) => String(event?.type) === 'EMAIL_QUEUE'),
  ).toBeTruthy();

  expect(Array.isArray(report.governorLimits?.snapshots), 'expected governor limit snapshots').toBeTruthy();
  expect(report.governorLimits.snapshots.length > 0, 'expected at least one governor snapshot').toBeTruthy();
});

it.skip('callout synthetic fixture verifies structured database callouts', async () => {
  const docPath = resolve(process.cwd(), 'docs/synthetic_logs/callout-features.md');
  const markdown = await readFile(docPath, 'utf8');
  const [rawLogText] = extractSyntheticLogBlocks(markdown);

  expect(rawLogText, 'expected synthetic log block').toBeTruthy();

  const parseResult = await parseLog(rawLogText, {
    sourceName: docPath,
    sourceType: 'file',
    includeRawLines: true,
    enablePhaseInference: true,
  });

  const report = buildOfflineReport({
    source: {
      fileName: docPath,
      bytes: Buffer.byteLength(rawLogText),
    },
    parseResult,
    rawLogText,
  }) as any;

  expect(Array.isArray(report.database?.callouts), 'expected database.callouts array').toBeTruthy();
  expect(report.database.callouts.length).toBe(1);
  expect(report.database.callouts[0]?.method).toBe('POST');
  expect(report.database.callouts[0]?.host).toBe('api.example.com');
  expect(String(report.database.callouts[0]?.endpoint ?? '')).toMatch(/\/v1\/accounts/);
  expect((report.database.callouts[0]?.durationMs ?? 0) > 0, 'expected callout duration').toBeTruthy();
  expect(report.overview?.topMetrics?.callouts?.count).toBe(1);
});

it('week-2 synthetic fixture verifies queueable context, burn-rate async limits, and viewstate warning', async () => {
  const rawLogText = [
    '12:00:00.000 (1)|EXECUTION_STARTED',
    '12:00:00.001 (2)|QUEUEABLE_BEGIN|[42]|MyQueueableJob',
    '12:00:00.002 (3)|QUEUEABLE_END|[42]',
    '12:00:00.003 (4)|VF_SERIALIZE_VIEWSTATE_END|[100]|Viewstate Size: 150 KB',
    '12:00:00.010 (10)|LIMIT_USAGE_FOR_NS|(default)|Number of SOQL queries: 1 out of 100|Number of query rows: 10 out of 50000|Number of DML statements: 1 out of 150|Number of DML rows: 1 out of 10000|Maximum CPU time: 100 out of 10000|Maximum heap size: 1024 out of 6291456|Number of callouts: 2 out of 100|Number of future calls: 1 out of 50|Number of queueable jobs added to the queue: 3 out of 50',
    '12:00:00.020 (20)|LIMIT_USAGE_FOR_NS|(default)|Number of SOQL queries: 2 out of 100|Number of query rows: 20 out of 50000|Number of DML statements: 2 out of 150|Number of DML rows: 2 out of 10000|Maximum CPU time: 200 out of 10000|Maximum heap size: 2048 out of 6291456|Number of callouts: 4 out of 100|Number of future calls: 2 out of 50|Number of queueable jobs added to the queue: 5 out of 50',
    '12:00:00.030 (30)|EXECUTION_FINISHED',
  ].join('\n');

  const parseResult = await parseLog(rawLogText, {
    sourceName: 'week2-synthetic.log',
    sourceType: 'file',
    includeRawLines: true,
    enablePhaseInference: true,
  });

  const report = buildOfflineReport({
    source: {
      fileName: 'week2-synthetic.log',
      bytes: Buffer.byteLength(rawLogText),
    },
    parseResult,
    rawLogText,
  }) as any;

  expect(report.context?.executionContext?.type).toBe('queueable');

  const burnRates = Array.isArray(report.governorBurnRate?.burnRates) ? report.governorBurnRate.burnRates : [];
  const burnRateKeys = new Set(burnRates.map((row: any) => String(row?.limitName || '')));
  expect(burnRateKeys.has('callouts'), 'expected callouts burn-rate row').toBeTruthy();
  expect(burnRateKeys.has('futureCalls'), 'expected futureCalls burn-rate row').toBeTruthy();
  expect(burnRateKeys.has('queueableJobsAddedToQueue'), 'expected queueable burn-rate row').toBeTruthy();

  expect(Array.isArray(report.issues), 'expected issues array').toBeTruthy();
  expect(
    report.issues.some((item: any) => String(item?.type) === 'VF_VIEWSTATE_SIZE_WARNING'),
  ).toBeTruthy();
});
