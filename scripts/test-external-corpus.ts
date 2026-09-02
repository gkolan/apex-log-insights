import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOfflineReport,
  MAX_LOG_BYTES,
  parseLog,
} from "../packages/core/src/index.js";
import { normalizeReport } from "../viewer/modules/normalize-report.js";
import { renderData } from "../viewer/modules/render-data.js";
import { renderDiagnostics } from "../viewer/modules/render-diagnostics.js";
import { renderEvidence } from "../viewer/modules/render-evidence.js";
import { renderExecution } from "../viewer/modules/render-execution.js";
import { renderTriage } from "../viewer/modules/render-triage.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

export const CERTINIA_EXTERNAL_SAMPLE = Object.freeze({
  name: "Certinia Debug Log Analyzer sample",
  fileName: "certinia-debug-log-analyzer-sample.log",
  source:
    "https://github.com/certinia/debug-log-analyzer/blob/main/sample-app/debug-logs/sample-log.log",
  download:
    "https://media.githubusercontent.com/media/certinia/debug-log-analyzer/main/sample-app/debug-logs/sample-log.log",
  license: "https://github.com/certinia/debug-log-analyzer/blob/main/LICENSE",
  bytes: 19_739_334,
  sha256: "f5fbbb9b17e9b614ac08e0e1bfd48aeb227e6c5cfba197b882e5d34a939a3bd3",
});

export interface ExternalCorpusOptions {
  keep: boolean;
  offline: boolean;
}

export function parseExternalCorpusArgs(args: string[]): ExternalCorpusOptions {
  const options: ExternalCorpusOptions = { keep: false, offline: false };
  for (const argument of args) {
    if (argument === "--") continue;
    if (argument === "--keep") options.keep = true;
    else if (argument === "--offline") options.offline = true;
    else {
      throw new Error(
        `Unknown option: ${argument}. Usage: pnpm test:corpus [--keep] [--offline]`,
      );
    }
  }
  return options;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function countSensitiveSignals(logText: string): {
  emailLikeValues: number;
  salesforceIdLikeValues: number;
  sensitiveEventRecords: number;
} {
  return {
    emailLikeValues:
      logText.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)?.length ?? 0,
    salesforceIdLikeValues:
      logText.match(/\b[A-Z0-9]{15}(?:[A-Z0-9]{3})?\b/gi)?.length ?? 0,
    sensitiveEventRecords:
      logText.match(
        /\|(?:USER_INFO|USER_DEBUG|CALLOUT_REQUEST|CALLOUT_RESPONSE|EMAIL_QUEUE)\|/g,
      )?.length ?? 0,
  };
}

function verifySample(bytes: Uint8Array): void {
  if (bytes.byteLength !== CERTINIA_EXTERNAL_SAMPLE.bytes) {
    throw new Error(
      `Certinia sample size mismatch: expected ${CERTINIA_EXTERNAL_SAMPLE.bytes}, received ${bytes.byteLength}.`,
    );
  }
  const digest = sha256(bytes);
  if (digest !== CERTINIA_EXTERNAL_SAMPLE.sha256) {
    throw new Error(
      `Certinia sample SHA-256 mismatch: expected ${CERTINIA_EXTERNAL_SAMPLE.sha256}, received ${digest}.`,
    );
  }
}

async function downloadVerifiedSample(destination: string): Promise<void> {
  const response = await fetch(CERTINIA_EXTERNAL_SAMPLE.download, {
    headers: { "User-Agent": "apex-log-insights-external-corpus-test" },
    redirect: "follow",
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `Certinia sample download failed with HTTP ${response.status}.`,
    );
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength !== CERTINIA_EXTERNAL_SAMPLE.bytes
  ) {
    throw new Error(
      `Certinia sample Content-Length mismatch: expected ${CERTINIA_EXTERNAL_SAMPLE.bytes}, received ${declaredLength}.`,
    );
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > CERTINIA_EXTERNAL_SAMPLE.bytes) {
      await reader.cancel();
      throw new Error("Certinia sample exceeded its pinned byte count.");
    }
    chunks.push(value);
  }

  const bytes = Buffer.concat(chunks, totalBytes);
  verifySample(bytes);
  await mkdir(dirname(destination), { recursive: true });
  const partialPath = `${destination}.part`;
  await rm(partialPath, { force: true });
  try {
    await writeFile(partialPath, bytes, { flag: "wx", mode: 0o600 });
    await rename(partialPath, destination);
  } finally {
    await rm(partialPath, { force: true });
  }
}

async function renderAllViews(
  report: unknown,
  rawLines: unknown[],
): Promise<string[]> {
  const viewModel = normalizeReport({ report, rawLines });
  const rendered = {
    triage: renderTriage(viewModel),
    execution: renderExecution(viewModel),
    data: renderData(viewModel),
    diagnostics: renderDiagnostics(viewModel),
    evidence: renderEvidence(viewModel, { query: "" }),
  };
  for (const [name, html] of Object.entries(rendered)) {
    if (typeof html !== "string" || html.trim().length === 0) {
      throw new Error(`${name} view returned no HTML.`);
    }
  }
  return Object.keys(rendered);
}

export async function runExternalCorpus(
  options: ExternalCorpusOptions,
): Promise<void> {
  if (CERTINIA_EXTERNAL_SAMPLE.bytes > MAX_LOG_BYTES) {
    throw new Error(
      "The pinned corpus sample exceeds the parser input ceiling.",
    );
  }

  const corpusDirectory = resolve(repositoryRoot, "external-corpus");
  const samplePath = resolve(
    corpusDirectory,
    CERTINIA_EXTERNAL_SAMPLE.fileName,
  );
  let downloaded = false;

  try {
    let sampleBytes: Buffer;
    try {
      sampleBytes = await readFile(samplePath);
      verifySample(sampleBytes);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        if (options.offline) {
          throw new Error(
            `No cached corpus sample exists at ${samplePath}. Run without --offline to download it.`,
          );
        }
        await downloadVerifiedSample(samplePath);
        downloaded = true;
        sampleBytes = await readFile(samplePath);
      } else {
        throw error;
      }
    }

    verifySample(sampleBytes);
    const logText = sampleBytes.toString("utf8");
    const startedAt = performance.now();
    const parseResult = await parseLog(logText, {
      sourceName: CERTINIA_EXTERNAL_SAMPLE.fileName,
      sourceType: "file",
      includeRawLines: true,
      enablePhaseInference: true,
    });
    const report = buildOfflineReport({
      source: {
        fileName: CERTINIA_EXTERNAL_SAMPLE.fileName,
        bytes: sampleBytes.byteLength,
      },
      parseResult,
      rawLogText: logText,
    });
    const renderedViews = await renderAllViews(
      report,
      parseResult.rawLines ?? [],
    );
    const parserDiagnosticRecords = parseResult.parserDiagnostics.reduce(
      (total, diagnostic) => total + diagnostic.count,
      0,
    );
    const unsupportedTimelineEvents = parseResult.normalizedTimeline.filter(
      (event) => event.classification === "unsupported",
    ).length;

    if (parserDiagnosticRecords > 0 || unsupportedTimelineEvents > 0) {
      throw new Error(
        `Corpus compatibility failed: ${parserDiagnosticRecords} parser diagnostic records and ${unsupportedTimelineEvents} unsupported timeline events.`,
      );
    }

    console.log(
      JSON.stringify(
        {
          status: "passed",
          corpus: CERTINIA_EXTERNAL_SAMPLE.name,
          source: CERTINIA_EXTERNAL_SAMPLE.source,
          license: CERTINIA_EXTERNAL_SAMPLE.license,
          bytes: sampleBytes.byteLength,
          sha256: CERTINIA_EXTERNAL_SAMPLE.sha256,
          elapsedMs: Math.round(performance.now() - startedAt),
          rawLines: parseResult.rawLines?.length ?? 0,
          parserDiagnosticRecords,
          parserIssueGroups: parseResult.issues.length,
          unsupportedTimelineEvents,
          reportVersion: report.reportVersion,
          renderedViews,
          sensitiveSignals: countSensitiveSignals(logText),
          rawValuesPrinted: false,
        },
        null,
        2,
      ),
    );
  } finally {
    if (downloaded && !options.keep) {
      await rm(samplePath, { force: true });
    }
  }
}

async function main(): Promise<void> {
  await runExternalCorpus(parseExternalCorpusArgs(process.argv.slice(2)));
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
