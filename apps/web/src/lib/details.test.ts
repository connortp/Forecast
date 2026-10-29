import { describe, expect, it } from "vitest";
import { today } from "./engine";
import { cycle, splitToday } from "./details";
import { SCENARIOS } from "./sample-data";

describe("cycle", () => {
  it("places today and the bills between the two paychecks", () => {
    const s = SCENARIOS.partly.snapshot; // pay in 6 of 14 days, bills on days 2, 4, 5
    const c = cycle(s, today(s));
    expect(c.since).toBe(8);
    expect(c.today).toBeCloseTo(8 / 14);
    expect(c.marks.map((m) => m.p)).toEqual([10 / 14, 12 / 14, 13 / 14, 1]);
    expect(c.marks.at(-1)?.kind).toBe("pay");
  });
});

describe("splitToday", () => {
  it("adds back up to this morning's cash", () => {
    for (const { snapshot: s } of Object.values(SCENARIOS)) {
      const t = today(s);
      if (t.pool < 0) continue;
      const sum = splitToday(s, t).reduce((n, p) => n + p.amount, 0);
      expect(sum).toBeCloseTo(t.startCash);
    }
  });

  it("shows only what's owed when the cash falls short", () => {
    const s = SCENARIOS.storm.snapshot;
    const t = today(s);
    const parts = splitToday(s, t);
    expect(t.pool).toBeLessThan(0);
    expect(parts.find((p) => p.key === "today")?.amount).toBe(0);
    expect(parts.some((p) => p.key === "later")).toBe(false);
  });
});
