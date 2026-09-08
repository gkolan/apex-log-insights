import { describe, expect, it } from "vitest";

import { parseSafeIntegerToken, splitLogFields } from "./logFields.js";

describe("splitLogFields", () => {
  it("bounds field allocation and preserves the exact tail", () => {
    const value = `time|TYPE|line|${"payload|".repeat(10_000)}end`;
    const fields = splitLogFields(value, 8);

    expect(fields).toHaveLength(8);
    expect(fields.slice(0, 3)).toEqual(["time", "TYPE", "line"]);
    expect(fields.join("|")).toBe(value);
  });

  it("supports a single opaque field", () => {
    expect(splitLogFields("a|b|c", 1)).toEqual(["a|b|c"]);
  });
});

describe("parseSafeIntegerToken", () => {
  it.each([
    ["0", 0],
    ["001", 1],
    ["1,000", 1_000],
    ["9,007,199,254,740,991", Number.MAX_SAFE_INTEGER],
  ])("parses %s exactly", (token, expected) => {
    expect(parseSafeIntegerToken(token)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "-1",
    "1.5",
    "1.0",
    "1e3",
    "12oops",
    "1,00",
    "1,,000",
    "9,007,199,254,740,992",
  ])("rejects malformed or unsafe token %#", (token) => {
    expect(parseSafeIntegerToken(token)).toBeNull();
  });
});
