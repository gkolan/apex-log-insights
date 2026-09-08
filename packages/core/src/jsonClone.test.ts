import { describe, expect, it } from "vitest";

import { cloneJsonLike } from "./jsonClone.js";

describe("cloneJsonLike", () => {
  it("clones deeply nested values without consuming the JavaScript call stack", () => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let depth = 0; depth < 20_000; depth += 1) {
      const child: Record<string, unknown> = {};
      cursor.child = child;
      cursor = child;
    }
    cursor.value = "leaf";

    const clone = cloneJsonLike(root);
    let clonedCursor = clone;
    for (let depth = 0; depth < 20_000; depth += 1) {
      clonedCursor = clonedCursor.child as Record<string, unknown>;
    }
    expect(clonedCursor.value).toBe("leaf");
  });

  it("bounds cycles while preserving repeated non-circular values", () => {
    const shared = { value: 7 };
    const root: Record<string, unknown> = { first: shared, second: shared };
    root.self = root;

    expect(cloneJsonLike(root)).toEqual({
      first: { value: 7 },
      second: { value: 7 },
      self: null,
    });
  });

  it("produces JSON-safe values for unsupported primitives and numbers", () => {
    expect(
      cloneJsonLike({
        nan: Number.NaN,
        infinity: Number.POSITIVE_INFINITY,
        omitted: undefined,
        values: [undefined, 1n, Number.NEGATIVE_INFINITY],
      }),
    ).toEqual({ nan: null, infinity: null, values: [null, null, null] });
  });
});
