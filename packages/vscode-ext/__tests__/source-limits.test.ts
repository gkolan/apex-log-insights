import { describe, expect, it } from "vitest";

import { logSizeError, MAX_LOG_BYTES } from "../src/source-limits.js";

describe("VS Code source size limit", () => {
  it("accepts the exact 25 MiB boundary", () => {
    expect(logSizeError(MAX_LOG_BYTES)).toBeUndefined();
  });

  it("rejects the first byte above the boundary with an actionable message", () => {
    expect(logSizeError(MAX_LOG_BYTES + 1)).toBe(
      "The selected log is 25.0 MiB; the limit is 25.0 MiB.",
    );
  });
});
