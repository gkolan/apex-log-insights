import { parseLog, buildInsightsReport } from '@apex-log-insights/core';
import { readLogFile } from './readLogFile.js';
import { redactReport } from '../redact.js';

export const parseLogTool = {
  name: 'parse_apex_log',
  description:
    'Parse a Salesforce Apex debug log into a structured analysis. ' +
    'Accepts either raw log text or a file path. Returns execution timeline, ' +
    'governor limit usage, SOQL/DML breakdown, and diagnostics.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      logText: {
        type: 'string',
        description: 'Raw Apex debug log text to parse.',
      },
      filePath: {
        type: 'string',
        description: 'Path to an Apex debug log file on disk.',
      },
      redact: {
        type: 'boolean',
        description:
          'Redact PII (Salesforce IDs, emails, phones, debug values) from the response. ' +
          'Recommended when using cloud-based AI services.',
      },
    },
  },
};

export async function handleParseLog(args: Record<string, unknown> | undefined) {
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
  });

  if (redact) {
    report = redactReport(report) as typeof report;
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }],
  };
}
