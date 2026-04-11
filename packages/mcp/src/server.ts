#!/usr/bin/env node
/**
 * Apex Log Insights — MCP Server
 *
 * Exposes the Apex debug log parser as an MCP (Model Context Protocol) server
 * so AI tools like Claude Desktop, Claude Code, and Cursor can analyze logs.
 *
 * Transport: stdio
 *
 * Usage:
 *   npx @apex-log-insights/mcp
 *
 * MCP config (Claude Desktop / Claude Code):
 *   {
 *     "mcpServers": {
 *       "apex-log-insights": {
 *         "command": "npx",
 *         "args": ["-y", "@apex-log-insights/mcp"]
 *       }
 *     }
 *   }
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { handleParseLog, parseLogTool } from './tools/parseLog.js';
import { handleAnalyzePerformance, analyzePerformanceTool } from './tools/analyzePerformance.js';
import { handleAnalyzeSoql, analyzeSoqlTool } from './tools/analyzeSoql.js';
import { handleAnalyzeGovernorLimits, analyzeGovernorLimitsTool } from './tools/analyzeGovernorLimits.js';
import { handleSummarize, summarizeTool } from './tools/summarize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgJson = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));

const server = new Server(
  {
    name: 'apex-log-insights',
    version: pkgJson.version,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    parseLogTool,
    analyzePerformanceTool,
    analyzeSoqlTool,
    analyzeGovernorLimitsTool,
    summarizeTool,
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'parse_apex_log':
      return handleParseLog(args);
    case 'analyze_performance':
      return handleAnalyzePerformance(args);
    case 'analyze_soql':
      return handleAnalyzeSoql(args);
    case 'analyze_governor_limits':
      return handleAnalyzeGovernorLimits(args);
    case 'summarize_log':
      return handleSummarize(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Apex Log Insights MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Graceful shutdown
const shutdown = () => {
  console.error('MCP server shutting down...');
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
