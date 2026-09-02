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
import { stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { getFlagValue, hasFlag, positionalArgs } from "./args.js";
import { startViewServer } from "./server.js";

function printUsage(): void {
  console.error(
    "Usage: apex-log <log-file-or-folder> [--port <number>] [--no-open]",
  );
  console.error("");
  console.error("  Opens Apex debug log(s) in the browser.");
  console.error("  Point to a single .log file or a folder of .log files.");
  console.error("  Logs are parsed client-side — nothing is written to disk.");
  console.error("");
  console.error("Options:");
  console.error(
    "  --port <number>   Port for the local server (default: auto).",
  );
  console.error("  --no-open         Do not open the browser automatically.");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    printUsage();
    return;
  }
  const knownFlags = new Set([
    "--port",
    "--no-open",
    "--debug",
    "--help",
    "-h",
  ]);
  const unknownFlag = args.find(
    (arg) => arg.startsWith("-") && !knownFlags.has(arg),
  );
  if (unknownFlag) {
    console.error(`Unknown option: ${unknownFlag}`);
    printUsage();
    process.exitCode = 1;
    return;
  }
  const positional = positionalArgs(args);
  const inputPath = positional[0];
  if (!inputPath) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  if (positional.length > 1) {
    console.error(`Unexpected argument: ${positional[1]}`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  const portStr = getFlagValue(args, "--port");
  let port = 0;
  if (portStr !== undefined) {
    port = Number(portStr);
    if (
      !Number.isFinite(port) ||
      port < 0 ||
      port > 65535 ||
      port !== Math.floor(port)
    ) {
      console.error(
        `Invalid port: "${portStr}". Must be an integer between 0 and 65535.`,
      );
      process.exitCode = 1;
      return;
    }
  }
  const noOpen = hasFlag(args, "--no-open");

  const absoluteTarget = resolve(process.cwd(), inputPath);
  const targetStat = await stat(absoluteTarget); // throws if path doesn't exist
  if (
    !targetStat.isDirectory() &&
    extname(absoluteTarget).toLowerCase() !== ".log"
  ) {
    console.error(
      `Unsupported file: "${inputPath}". Expected a .log file or a directory.`,
    );
    process.exitCode = 1;
    return;
  }

  const server = await startViewServer({
    target: absoluteTarget,
    port,
    open: !noOpen,
  });

  let isShuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.warn("\nShutting down...");
    try {
      await server.close();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Could not stop the local server: ${message}`);
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch((err: unknown) => {
  const showDebug = process.argv.includes("--debug");
  const message =
    err instanceof Error
      ? showDebug
        ? (err.stack ?? err.message)
        : err.message
      : String(err);
  console.error(message);
  process.exitCode = 1;
});
