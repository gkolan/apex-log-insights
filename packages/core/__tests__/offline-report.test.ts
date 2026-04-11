import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { buildOfflineReport } from '../src/offlineReport.js';
import { parseLog } from '../src/parserCore.js';
import { EXECUTION_PHASE_DEFINITIONS } from '../src/phases.js';

const SYNTHETIC_BLOCK_INDEX_BY_PHASE = new Map<string, number>([
  ['phase-01-load-original-record', 0],
  ['phase-02-system-validation', 0],
  ['phase-03-before-triggers', 0],
  ['phase-04-before-save-flows', 0],
  ['phase-05-validation-rules', 0],
  ['phase-06-duplicate-rules', 0],
  ['phase-07-save-to-database', 1],
  ['phase-08-after-triggers', 0],
  ['phase-09-assignment-rules', 0],
  ['phase-10-auto-response-rules', 1],
  ['phase-11-workflow-rules', 0],
  ['phase-12-escalation-rules', 0],
  ['phase-13-process-builder', 1],
  ['phase-14-after-save-flows', 0],
  ['phase-15-entitlement-rules', 0],
  ['phase-16-rollup-summary', 1],
  ['phase-17-criteria-evaluation', 2],
  ['phase-17a-process-builder', 1],
  ['phase-17b-workflow-criteria', 0],
  ['phase-18-sharing-rules', 0],
  ['phase-19-dml-commit', 0],
  ['phase-20-post-commit-logic', 0],
]);

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

it('parseLog handles empty input without crashing', async () => {
  const result = await parseLog('', { includeRawLines: true });
  expect(result.sourceType).toBe('file');
  expect(result.normalizedTimeline.length).toBe(0);
  expect(result.rawLines?.length).toBe(1);
});

it('buildOfflineReport emits canonical v3 sections and 20 synthetic phases', async () => {
  const filePath = resolve(__dirname, '../../../fixtures/apex-07Lbc00000Ihnw6EAB.log');
  const rawLogText = await readFile(filePath, 'utf8');
  const parseResult = await parseLog(rawLogText, {
    sourceName: filePath,
    sourceType: 'file',
    includeRawLines: true,
    enablePhaseInference: true,
  });

  const report = buildOfflineReport({
    source: {
      fileName: filePath,
      bytes: Buffer.byteLength(rawLogText),
    },
    parseResult,
    rawLogText,
  });

  expect(report.reportVersion).toBe('3.0.0');
  expect(report.source).toBeTruthy();
  expect(report.metadata).toBeTruthy();
  expect(report.entryPoint).toBeTruthy();
  expect(Array.isArray(report.timeline)).toBeTruthy();
  expect(report.execution).toBeTruthy();
  expect(Array.isArray(report.phases)).toBeTruthy();
  expect(report.database).toBeTruthy();
  expect(report.governorLimits).toBeTruthy();
  expect(Array.isArray(report.issues)).toBeTruthy();
  expect(report.evidenceIndex).toBeTruthy();
  expect(report.uiHints).toBeTruthy();

  const phases = report.phases as Array<{ id: string; syntheticDoc: string }>;
  expect(phases.length).toBe(EXECUTION_PHASE_DEFINITIONS.length);
  expect(phases[0]?.id).toBe('phase-01-load-original-record');
  expect(phases.at(-1)?.id).toBe('phase-20-post-commit-logic');
  expect(phases.every((phase) => typeof phase.syntheticDoc === 'string' && phase.syntheticDoc.includes('docs/synthetic_logs/'))).toBeTruthy();

  const uiHints = report.uiHints as { brand?: Record<string, unknown> };
  expect(uiHints.brand?.productName).toBe('Apex Log Insights');
  expect(!Object.hasOwn(uiHints.brand ?? {}, 'logoAsset')).toBeTruthy();
  expect(JSON.stringify(report)).not.toMatch(/docs\/loglens-icons\/svgs\/active\.svg/);
});

it('offline report keeps flow event stream parity between parser timeline and trace events', async () => {
  const rawLogText = [
    '10:00:00.000 (1)|FLOW_CREATE_INTERVIEW_BEGIN|org|def|ver',
    '10:00:00.001 (2)|FLOW_CREATE_INTERVIEW_END|i-1|MyFlow',
    '10:00:00.002 (3)|FLOW_START_INTERVIEW_BEGIN|i-1|MyFlow',
    '10:00:00.003 (4)|FLOW_ELEMENT_BEGIN|i-1|Assignment|SetX',
    '10:00:00.004 (5)|FLOW_VALUE_ASSIGNMENT|i-1|x|5',
    '10:00:00.005 (6)|FLOW_RULE_DETAIL|i-1|RuleA|true',
    '10:00:00.006 (7)|FLOW_ACTIONCALL_DETAIL|i-1|Act|Apex|Id|true|',
    '10:00:00.007 (8)|FLOW_WAIT_WAITING_DETAIL|i-1|Wait1|1|p-1',
  ].join('\n');

  const parseResult = await parseLog(rawLogText, {
    sourceName: 'synthetic-flow.log',
    sourceType: 'file',
    includeRawLines: true,
    enablePhaseInference: true,
  });

  const report = buildOfflineReport({
    source: {
      fileName: 'synthetic-flow.log',
      bytes: Buffer.byteLength(rawLogText),
    },
    parseResult,
    rawLogText,
  }) as any;

  const parserFlowTypes = new Set(
    parseResult.normalizedTimeline
      .map((event) => String(event?.type || '').trim())
      .filter((type) => type.startsWith('FLOW_')),
  );
  const traceFlowTypes = new Set(
    (Array.isArray(report?.trace?.events) ? report.trace.events : [])
      .map((event: any) => String(event?.type || '').trim())
      .filter((type: string) => type.startsWith('FLOW_')),
  );

  expect(parserFlowTypes.size > 0, 'expected flow events in parser timeline').toBeTruthy();
  for (const type of parserFlowTypes) {
    expect(traceFlowTypes.has(type), `trace.events missing parser flow type ${type}`).toBeTruthy();
  }
});

// Skipped: synthetic doc fixtures (docs/synthetic_logs/*.md) have not been created yet.
// Re-enable this loop once the markdown files with embedded log blocks are written.
for (const definition of EXECUTION_PHASE_DEFINITIONS) {
  it.skip(`synthetic doc fixture covers ${definition.id}`, async () => {
    const docPath = resolve(process.cwd(), definition.syntheticDoc);
    const markdown = await readFile(docPath, 'utf8');
    const codeBlocks = extractSyntheticLogBlocks(markdown);
    const blockIndex = SYNTHETIC_BLOCK_INDEX_BY_PHASE.get(definition.id) ?? 0;
    const rawLogText = codeBlocks[blockIndex];

    expect(rawLogText, `expected fenced synthetic log block ${blockIndex} in ${definition.syntheticDoc}`).toBeTruthy();

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
    });

    const phases = report.phases as Array<{ id: string; status: string; confidence: string }>;
    const targetPhase = phases.find((phase) => phase.id === definition.id);

    expect(targetPhase, `missing target phase ${definition.id}`).toBeTruthy();
    expect(targetPhase?.status).not.toBe('not_observed');
    expect(['direct', 'derived', 'inferred'].includes(String(targetPhase?.confidence))).toBeTruthy();
  });
}
