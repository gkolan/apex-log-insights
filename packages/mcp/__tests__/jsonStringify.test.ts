import { describe, expect, it } from "vitest";

import { stringifyJson } from "../src/jsonStringify.js";

describe("stringifyJson", () => {
  it("matches native pretty JSON for canonical values", () => {
    const hostile = JSON.parse(
      '{"__proto__":{"email":"user@example.com"},"constructor":7}',
    );
    const value = {
      text: 'line\n"quoted"',
      finite: 42,
      nonFinite: Number.POSITIVE_INFINITY,
      absent: undefined,
      array: [true, undefined, null, hostile],
    };

    expect(stringifyJson(value)).toBe(JSON.stringify(value, null, 2));
  });

  it("serializes deeply nested report values without using the call stack", () => {
    const value: Record<string, unknown> = {};
    let cursor = value;
    for (let depth = 0; depth < 12_000; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    cursor.value = "complete";

    const serialized = stringifyJson(value);
    expect(serialized.length).toBeLessThan(2_000_000);

    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    let parsedCursor = parsed;
    for (let depth = 0; depth < 12_000; depth += 1) {
      parsedCursor = parsedCursor.next as Record<string, unknown>;
    }
    expect(parsedCursor.value).toBe("complete");
  });

  it("uses null for cycles while duplicating non-circular shared values", () => {
    const shared = { count: 1 };
    const value: Record<string, unknown> = { first: shared, second: shared };
    value.self = value;

    expect(JSON.parse(stringifyJson(value))).toEqual({
      first: { count: 1 },
      second: { count: 1 },
      self: null,
    });
  });
});
