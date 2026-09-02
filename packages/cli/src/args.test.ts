import { describe, expect, it } from "vitest";

import { getFlagValue, hasFlag, positionalArgs } from "./args.js";

describe("positionalArgs", () => {
  // Regression: with no --port, the consumed-value index was computed as
  // -1 + 1 = 0, which discarded the log path in `apex-log debug.log`.
  it("keeps the log path when no --port flag is present", () => {
    expect(positionalArgs(["debug.log"])).toEqual(["debug.log"]);
    expect(positionalArgs(["debug.log", "--no-open"])).toEqual(["debug.log"]);
    expect(positionalArgs(["debug.log", "--debug"])).toEqual(["debug.log"]);
  });

  it("drops the value consumed by --port", () => {
    expect(positionalArgs(["--port", "8080", "debug.log"])).toEqual([
      "debug.log",
    ]);
    expect(positionalArgs(["debug.log", "--port", "8080"])).toEqual([
      "debug.log",
    ]);
    expect(positionalArgs(["--port", "8080", "logs", "--no-open"])).toEqual([
      "logs",
    ]);
  });

  it("reports extra positional arguments so the caller can reject them", () => {
    expect(positionalArgs(["a.log", "b.log"])).toEqual(["a.log", "b.log"]);
    expect(positionalArgs(["--port", "8080", "a.log", "b.log"])).toEqual([
      "a.log",
      "b.log",
    ]);
  });

  it("returns nothing when only flags are given", () => {
    expect(positionalArgs([])).toEqual([]);
    expect(positionalArgs(["--no-open"])).toEqual([]);
    expect(positionalArgs(["--port", "8080"])).toEqual([]);
  });
});

describe("hasFlag", () => {
  it("matches only exact flag tokens", () => {
    expect(hasFlag(["--no-open"], "--no-open")).toBe(true);
    expect(hasFlag(["--no-opener"], "--no-open")).toBe(false);
    expect(hasFlag([], "--no-open")).toBe(false);
  });
});

describe("getFlagValue", () => {
  it("returns the value that follows the flag", () => {
    expect(getFlagValue(["--port", "8080"], "--port")).toBe("8080");
  });

  it("returns undefined when the flag is absent", () => {
    expect(getFlagValue(["debug.log"], "--port")).toBeUndefined();
  });

  it("rejects a flag with a missing or flag-shaped value", () => {
    expect(() => getFlagValue(["--port"], "--port")).toThrow(
      /requires a value/,
    );
    expect(() => getFlagValue(["--port", "--no-open"], "--port")).toThrow(
      /requires a value/,
    );
  });
});
