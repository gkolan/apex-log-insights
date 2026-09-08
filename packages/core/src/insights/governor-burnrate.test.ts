import { describe, expect, it } from "vitest";

import { buildGovernorBurnRate } from "./governor-burnrate.js";

function snapshot(timestamp: number, namespace: string, soqlUsed: number) {
  return {
    timestamp,
    namespace,
    limits: { soqlQueries: { used: soqlUsed } },
  };
}

const governorLimits = { soqlQueries: { limit: 100 } };

describe("buildGovernorBurnRate", () => {
  it("derives rates and phase headroom from one preferred namespace", () => {
    const result = buildGovernorBurnRate(
      [
        snapshot(0, "managed", 90),
        snapshot(10, "default", 1),
        snapshot(20, "managed", 100),
        snapshot(1_000_000_010, "default", 11),
      ],
      [],
      [
        {
          id: "phase-1",
          label: "Phase 1",
          timing: { startNs: 0, endNs: 15 },
        },
      ],
      1_000,
      governorLimits,
    );

    expect(result.burnRates[0]).toMatchObject({
      limitName: "soqlQueries",
      used: 11,
      max: 100,
      pctUsed: 11,
      burnRatePerSec: 10,
      projectedHeadroom: 8.9,
      status: "ok",
    });
    expect(result.phaseHeadroom[0]).toMatchObject({
      soqlPctAfter: 11,
      warning: null,
    });
    expect(result.byNamespace).toMatchObject({
      default: expect.objectContaining({ soqlUsed: 11 }),
      managed: expect.objectContaining({ soqlUsed: 100 }),
    });
  });

  it("does not invent rates without elapsed time or across a counter reset", () => {
    const sameTimestamp = buildGovernorBurnRate(
      [snapshot(10, "default", 1), snapshot(10, "default", 2)],
      [],
      [],
      0,
      governorLimits,
    );
    const decreasing = buildGovernorBurnRate(
      [snapshot(10, "default", 10), snapshot(20, "default", 5)],
      [],
      [],
      0,
      governorLimits,
    );

    expect(sameTimestamp.burnRates[0]).toMatchObject({
      burnRatePerSec: null,
      projectedHeadroom: null,
    });
    expect(decreasing.burnRates[0]).toMatchObject({
      burnRatePerSec: null,
      projectedHeadroom: null,
    });
  });

  it("reports zero projected headroom once a growing limit is exhausted", () => {
    const result = buildGovernorBurnRate(
      [snapshot(0, "default", 90), snapshot(1_000_000_000, "default", 110)],
      [],
      [],
      1_000,
      governorLimits,
    );

    expect(result.burnRates[0]).toMatchObject({
      pctUsed: 110,
      burnRatePerSec: 20,
      projectedHeadroom: 0,
      status: "critical",
    });
  });

  it("stores untrusted namespace names without prototype collisions", () => {
    const result = buildGovernorBurnRate(
      [snapshot(1, "__proto__", 3), snapshot(2, "constructor", 4)],
      [],
      [],
      0,
      governorLimits,
    );

    expect(Object.getPrototypeOf(result.byNamespace)).toBeNull();
    expect(Object.hasOwn(result.byNamespace, "__proto__")).toBe(true);
    expect(Object.hasOwn(result.byNamespace, "constructor")).toBe(true);
    expect(result.byNamespace["__proto__"]?.soqlUsed).toBe(3);
    expect(result.byNamespace["constructor"]?.soqlUsed).toBe(4);
    expect(
      (Object.prototype as { soqlUsed?: number }).soqlUsed,
    ).toBeUndefined();
  });

  it("uses binary phase lookup across a large snapshot timeline", () => {
    const snapshots = Array.from({ length: 100_000 }, (_, index) =>
      snapshot(index * 10, "default", index),
    );
    const result = buildGovernorBurnRate(
      snapshots,
      [],
      [
        {
          id: "phase",
          label: "Phase",
          timing: { startNs: 543_200, endNs: 543_215 },
        },
      ],
      1,
      { soqlQueries: { limit: 1_000_000 } },
    );

    expect(result.phaseHeadroom[0]?.soqlPctAfter).toBe(5.43);
  });

  it("keeps phase evidence unknown when snapshots or limits are absent", () => {
    const result = buildGovernorBurnRate(
      [],
      [],
      [
        {
          id: "phase",
          label: "Phase",
          timing: { startNs: 1, endNs: null },
        },
      ],
      0,
      null,
    );

    expect(result.burnRates).toEqual([]);
    expect(result.phaseHeadroom[0]).toMatchObject({
      soqlPctAfter: null,
      cpuPctAfter: null,
      phasesRemaining: 0,
      warning: null,
    });
  });
});
