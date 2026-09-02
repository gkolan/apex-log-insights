import { describe, expect, it } from "vitest";

import {
  countByKey,
  flattenEvents,
  normalizeClock,
  parseCalloutResponseText,
  readPath,
} from "./utils.js";
import type { FlatEvent } from "./types.js";

describe("normalizeClock", () => {
  it("normalizes Salesforce fractional seconds through nanosecond precision", () => {
    expect(normalizeClock("00:00:00.1")).toBe("00:00:00.100");
    expect(normalizeClock("12:34:56.123")).toBe("12:34:56.123");
    expect(normalizeClock("23:59:59.987654321")).toBe("23:59:59.987");
  });

  it("rejects impossible or unsupported wall-clock values", () => {
    expect(normalizeClock("24:00:00.000")).toBeNull();
    expect(normalizeClock("12:60:00.000")).toBeNull();
    expect(normalizeClock("12:00:60.000")).toBeNull();
    expect(normalizeClock("12:00:00.1234567890")).toBeNull();
  });
});

describe("parseCalloutResponseText", () => {
  it("requires a complete three-digit labeled status code", () => {
    expect(parseCalloutResponseText("StatusCode=201, Status=Created")).toEqual({
      statusCode: 201,
      statusText: "Created",
    });
    expect(parseCalloutResponseText("StatusCode=2010, Status=Invalid")).toEqual(
      { statusCode: null, statusText: "Invalid" },
    );
  });
});

describe("flattenEvents numeric normalization", () => {
  it("accepts grouped integer strings but rejects coercive spellings", () => {
    const [event] = flattenEvents({
      children: [
        {
          type: "TEST_EVENT",
          timestamp: "1e3",
          rawLineNumber: "1.0",
          soqlRowCount: { total: "1,000" },
          children: [],
        },
      ],
    });

    expect(event).toMatchObject({
      timestampNs: 0,
      lineNumber: null,
      soqlRowCountTotal: 1_000,
    });
  });

  it("ignores inherited event fields", () => {
    const inherited = Object.create({
      type: "INHERITED_TYPE",
      timestamp: 99,
      children: [{ type: "INHERITED_CHILD", children: [] }],
    }) as Record<string, unknown>;
    inherited.children = [Object.create({ type: "INHERITED_EVENT" })];

    expect(flattenEvents(inherited)).toEqual([
      expect.objectContaining({ type: "UNKNOWN", timestampNs: 0 }),
    ]);
    expect(readPath(Object.create({ used: 7 }), ["used"])).toBeUndefined();
  });

  it("does not derive exact durations from synthetic partial boundaries", () => {
    const [partial, pseudoSpan] = flattenEvents({
      children: [
        {
          type: "METHOD_ENTRY",
          timestamp: 10,
          exitStamp: 20,
          duration: { self: 10 },
          pairingStatus: "missing_end",
          durationIsPartial: true,
          children: [],
        },
        {
          type: "ENTERING_MANAGED_PKG",
          timestamp: 20,
          exitStamp: 30,
          duration: { self: 10 },
          pairingStatus: "not_applicable",
          children: [],
        },
      ],
    });

    expect(partial).toMatchObject({
      durationSelfNs: null,
      durationTotalNs: null,
    });
    expect(pseudoSpan).toMatchObject({
      durationSelfNs: 10,
      durationTotalNs: 10,
    });
  });
});

describe("countByKey", () => {
  it("counts prototype-named labels as ordinary own properties", () => {
    const events = ["__proto__", "constructor", "__proto__"].map(
      (type) => ({ type }) as FlatEvent,
    );

    const counts = countByKey(events, (event) => event.type);

    expect(Object.getPrototypeOf(counts)).toBe(Object.prototype);
    expect(Object.hasOwn(counts, "__proto__")).toBe(true);
    expect(counts["__proto__"]).toBe(2);
    expect(counts.constructor).toBe(1);
  });
});
