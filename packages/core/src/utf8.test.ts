import { describe, expect, it } from "vitest";

import { MAX_LOG_BYTES, utf8ByteLength } from "./utf8.js";

describe("utf8ByteLength", () => {
  it("matches TextEncoder for ASCII, multibyte text, and lone surrogates", () => {
    const samples = [
      "ASCII log text",
      "café",
      "Salesforce 🚀",
      "\ud800",
      "\udc00",
      "mixed \ud800 text \udc00",
    ];
    const encoder = new TextEncoder();
    for (const sample of samples) {
      expect(utf8ByteLength(sample)).toBe(encoder.encode(sample).byteLength);
    }
  });
});

describe("parser input ceiling", () => {
  it("publishes the canonical 25 MiB boundary", () => {
    expect(MAX_LOG_BYTES).toBe(25 * 1024 * 1024);
  });
});
