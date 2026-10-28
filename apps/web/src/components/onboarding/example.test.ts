import { describe, expect, it } from "vitest";
import { today } from "@/lib/engine";
import { initialChoices, snapshotFrom } from "./example";

describe("sign-up example", () => {
  it("reveals $105 under partly cloudy skies with the defaults", () => {
    const t = today(snapshotFrom(initialChoices()));
    // (2486 − 1394.99 bills − 150 cushion) ÷ 9 days
    expect(Math.round(t.safeToSpend)).toBe(105);
    expect(t.billCount).toBe(4);
    expect(t.condition).toBe("partly");
  });

  it("does not take buckets out before the next paycheck", () => {
    const c = initialChoices();
    const before = today(snapshotFrom(c)).safeToSpend;
    c.buckets[0].perPaycheck = 500;
    expect(today(snapshotFrom(c)).safeToSpend).toBe(before);
  });

  it("counts a bill once it is switched on", () => {
    const c = initialChoices();
    const before = today(snapshotFrom(c)).pool;
    c.billsOn[4] = true;
    expect(today(snapshotFrom(c)).pool).toBeCloseTo(before - 40);
  });
});
