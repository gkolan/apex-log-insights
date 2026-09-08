import { it, expect } from "vitest";

import { parseLog } from "../src/parserCore.js";
import { buildOfflineReport } from "../src/offlineReport.js";

it("synthetic async log verifies queueable context, burn-rate limits, and viewstate warning", async () => {
  const rawLogText = [
    "12:00:00.000 (1)|EXECUTION_STARTED",
    "12:00:00.001 (2)|QUEUEABLE_BEGIN|[42]|MyQueueableJob",
    "12:00:00.002 (3)|QUEUEABLE_END|[42]",
    "12:00:00.003 (4)|VF_SERIALIZE_VIEWSTATE_END|[100]|Viewstate Size: 150 KB",
    "12:00:00.010 (10)|LIMIT_USAGE_FOR_NS|(default)|Number of SOQL queries: 1 out of 100|Number of query rows: 10 out of 50000|Number of DML statements: 1 out of 150|Number of DML rows: 1 out of 10000|Maximum CPU time: 100 out of 10000|Maximum heap size: 1024 out of 6291456|Number of callouts: 2 out of 100|Number of future calls: 1 out of 50|Number of queueable jobs added to the queue: 3 out of 50",
    "12:00:00.020 (20)|LIMIT_USAGE_FOR_NS|(default)|Number of SOQL queries: 2 out of 100|Number of query rows: 20 out of 50000|Number of DML statements: 2 out of 150|Number of DML rows: 2 out of 10000|Maximum CPU time: 200 out of 10000|Maximum heap size: 2048 out of 6291456|Number of callouts: 4 out of 100|Number of future calls: 2 out of 50|Number of queueable jobs added to the queue: 5 out of 50",
    "12:00:00.030 (30)|EXECUTION_FINISHED",
  ].join("\n");

  const parseResult = await parseLog(rawLogText, {
    sourceName: "async-synthetic.log",
    sourceType: "file",
    includeRawLines: true,
    enablePhaseInference: true,
  });

  const report = buildOfflineReport({
    source: {
      fileName: "async-synthetic.log",
      bytes: Buffer.byteLength(rawLogText),
    },
    parseResult,
    rawLogText,
  }) as any;

  expect(report.context?.executionContext?.type).toBe("queueable");

  const burnRates = Array.isArray(report.governorBurnRate?.burnRates)
    ? report.governorBurnRate.burnRates
    : [];
  const burnRateKeys = new Set(
    burnRates.map((row: any) => String(row?.limitName || "")),
  );
  expect(burnRateKeys.has("callouts")).toBeTruthy();
  expect(burnRateKeys.has("futureCalls")).toBeTruthy();
  expect(burnRateKeys.has("queueableJobsAddedToQueue")).toBeTruthy();

  expect(Array.isArray(report.issues)).toBeTruthy();
  expect(
    report.issues.some(
      (item: any) => String(item?.type) === "VF_VIEWSTATE_SIZE_WARNING",
    ),
  ).toBeTruthy();
});

it("does not create viewstate warnings from partial, negative, fractional-byte, or overflowed numeric tokens", async () => {
  const rawLogText = [
    "12:00:00.000 (1)|EXECUTION_STARTED",
    "12:00:00.001 (2)|VF_SERIALIZE_VIEWSTATE_END|[100]|Viewstate Size: 150 KB trailing",
    "12:00:00.002 (3)|VF_SERIALIZE_VIEWSTATE_END|[100]|Viewstate Size: -999999 bytes",
    "12:00:00.003 (4)|VF_SERIALIZE_VIEWSTATE_END|[100]|Viewstate Size: 999999.5 bytes",
    "12:00:00.004 (5)|VF_SERIALIZE_VIEWSTATE_END|[100]|Viewstate Size: 999999999999999999999 MB",
    "12:00:00.005 (6)|VF_SERIALIZE_VIEWSTATE_END|[100]|Viewstate Size: 150oops KB",
    "12:00:00.006 (7)|EXECUTION_FINISHED",
  ].join("\n");

  const parseResult = await parseLog(rawLogText, {
    sourceName: "malformed-viewstate.log",
    sourceType: "file",
    includeRawLines: true,
  });
  const report = buildOfflineReport({
    source: {
      fileName: "malformed-viewstate.log",
      bytes: Buffer.byteLength(rawLogText),
    },
    parseResult,
    rawLogText,
  }) as any;

  expect(
    report.issues.filter(
      (item: any) => String(item?.type) === "VF_VIEWSTATE_SIZE_WARNING",
    ),
  ).toHaveLength(1);
  expect(
    report.issues.find(
      (item: any) => String(item?.type) === "VF_VIEWSTATE_SIZE_WARNING",
    )?.evidence?.raw,
  ).toContain("150 KB trailing");
});
