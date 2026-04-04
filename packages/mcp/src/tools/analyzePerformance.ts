import { parseLog, buildInsightsReport } from '@apex-log-insights/core';
import { readLogFile } from './readLogFile.js';
import { redactReport } from '../redact.js';

export const analyzePerformanceTool = {
  name: 'analyze_performance',
  description:
    'Analyze performance hotspots in an Apex debug log. ' +
    'Returns CPU attribution, execution phases, and timing breakdowns.',
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

export async function handleAnalyzePerformance(args: Record<string, unknown> | undefined) {
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

  // Extract performance-specific sections
  const performance = {
    cpuAttribution: report.cpuAttribution,
    executionPhases: report.executionPhases,
    spanHotspots: report.spanHotspots,
    parseTimeMs: parsed.parseTimeMs,
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(performance, null, 2) }],
  };
}
