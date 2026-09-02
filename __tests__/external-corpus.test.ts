import { describe, expect, it } from "vitest";

import {
  CERTINIA_EXTERNAL_SAMPLE,
  countSensitiveSignals,
  parseExternalCorpusArgs,
  sha256,
} from "../scripts/test-external-corpus.js";

describe("external corpus validation", () => {
  it("pins the public Certinia sample by size and SHA-256", () => {
    expect(CERTINIA_EXTERNAL_SAMPLE.download).toMatch(
      /^https:\/\/media\.githubusercontent\.com\/media\/certinia\//,
    );
    expect(CERTINIA_EXTERNAL_SAMPLE.bytes).toBe(19_739_334);
    expect(CERTINIA_EXTERNAL_SAMPLE.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts only documented retention and offline options", () => {
    expect(parseExternalCorpusArgs([])).toEqual({
      keep: false,
      offline: false,
    });
    expect(parseExternalCorpusArgs(["--", "--keep", "--offline"])).toEqual({
      keep: true,
      offline: true,
    });
    expect(() => parseExternalCorpusArgs(["--unknown"])).toThrow(
      "Unknown option",
    );
  });

  it("reports sensitive signal counts without returning matched values", () => {
    const result = countSensitiveSignals(
      "|USER_DEBUG|person@example.com|001000000000000AAA\nordinary line",
    );
    expect(result).toEqual({
      emailLikeValues: 1,
      salesforceIdLikeValues: 1,
      sensitiveEventRecords: 1,
    });
    expect(JSON.stringify(result)).not.toContain("person@example.com");
    expect(JSON.stringify(result)).not.toContain("001000000000000AAA");
  });

  it("computes stable SHA-256 digests", () => {
    expect(sha256(Buffer.from("apex-log-insights"))).toBe(
      "6faee3307a0426e477f4589015f637ea32f7442e77284481fedabe5aa382fc92",
    );
  });
});
