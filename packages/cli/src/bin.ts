#!/usr/bin/env node
/**
 * Apex Log Insights — CLI entry point.
 *
 * Parses command-line arguments and launches a local HTTP server that
 * serves the viewer UI. The viewer parses Apex debug logs client-side
 * in a Web Worker — nothing is uploaded or written to disk.
 *
 * Usage:
 *   apex-log <log-file-or-folder> [--port <number>] [--no-open]
 */
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { startViewServer } from './server.js';

function printUsage(): void {
  console.error('Usage: apex-log <log-file-or-folder> [--port <number>] [--no-open]');
  console.error('');
  console.error('  Opens Apex debug log(s) in the browser.');
  console.error('  Point to a single .log file or a folder of .log files.');
  console.error('  Logs are parsed client-side — nothing is written to disk.');
  console.error('');
  console.error('Options:');
  console.error('  --port <number>   Port for the local server (default: auto).');
  console.error('  --no-open         Do not open the browser automatically.');
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const next = args[i + 1];
  if (next === undefined || next.startsWith('--')) {
    throw new Error(`Flag ${flag} requires a value but got: ${next === undefined ? 'nothing' : next}`);
  }
  return next;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // Strip flags to find the positional argument
  const positional = args.filter((a) => !a.startsWith('--') && !isPrevFlag(args, a));

  const inputPath = positional[0];
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    printUsage();
    return;
  }
  if (!inputPath) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const portStr = getFlagValue(args, '--port');
  let port = 0;
  if (portStr !== undefined) {
    port = Number(portStr);
    if (!Number.isFinite(port) || port < 0 || port > 65535 || port !== Math.floor(port)) {
      console.error(`Invalid port: "${portStr}". Must be an integer between 0 and 65535.`);
      process.exitCode = 1;
      return;
    }
  }
  const noOpen = hasFlag(args, '--no-open');

  const absoluteTarget = resolve(process.cwd(), inputPath);
  await stat(absoluteTarget); // throws if path doesn't exist

  await startViewServer({
    target: absoluteTarget,
    port,
    open: !noOpen,
  });
}

/** Returns true if `arg` is the value of a preceding flag that takes a value. */
const FLAGS_WITH_VALUES = ['--port', '--version'];
function isPrevFlag(args: string[], arg: string): boolean {
  const i = args.lastIndexOf(arg);
  if (i <= 0) return false;
  const prev = args[i - 1];
  return FLAGS_WITH_VALUES.includes(prev!);
}

main().catch((err: unknown) => {
  const showDebug = process.argv.includes('--debug');
  const message =
    err instanceof Error
      ? showDebug
        ? err.stack ?? err.message
        : err.message
      : String(err);
  console.error(message);
  process.exitCode = 1;
});
