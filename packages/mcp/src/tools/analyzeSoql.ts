import { parseLog, buildInsightsReport } from '@apex-log-insights/core';
import { readLogFile } from './readLogFile.js';
import { redactReport } from '../redact.js';

export const analyzeSoqlTool = {
  name: 'analyze_soql',
  description:
    'Analyze SOQL queries in an Apex debug log. ' +
    'Detects duplicate queries, expensive patterns, and provides row counts.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      logText: { type: 'string', description: 'Raw Apex debug log text.' },
      filePath: { type: 'string', description: 'Path to an Apex debug log file.' },
      redact: {
        type: 'boolean',
        description:
          'Redact PII (Salesforce IDs, emails, phones, debug values) from the response. ' +
          'Recommended when using cloud-based AI services.',
      },
    },
  },
};

export async function handleAnalyzeSoql(args: Record<string, unknown> | undefined) {
  const logText = typeof args?.logText === 'string' ? args.logText : undefined;
  const filePath = typeof args?.filePath === 'string' ? args.filePath : undefined;
  const redact = typeof args?.redact === 'boolean' ? args.redact : false;

  if (!logText && !filePath) {
    throw new Error('Provide either logText or filePath.');
  }

  let text: string;
  if (logText) {
    text = logText;
  } else {
    text = await readLogFile(filePath!);
  }

  const parsed = await parseLog(text, {
    sourceName: filePath ?? 'inline.log',
    sourceType: filePath ? 'file' : 'clipboard',
    enablePhaseInference: true,
  });

  let report = buildInsightsReport({
    filePath: filePath ?? 'inline.log',
    fileBytes: new TextEncoder().encode(text).length,
    generatedAt: new Date().toISOString(),
    parseTimeMs: parsed.parseTimeMs,
    parserResult: parsed.parserResult,
  }) as Record<string, unknown>;

  if (redact) {
    report = redactReport(report) as typeof report;
  }

  const soql = {
    database: report.database,
    soqlPatternAnalysis: report.soqlPatternAnalysis,
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(soql, null, 2) }],
  };
}
