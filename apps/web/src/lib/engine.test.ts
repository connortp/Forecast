import { describe, expect, it } from "vitest";
import { conditionFor, events, outlook, today, type Snapshot } from "./engine";
import { SCENARIOS } from "./sample-data";

const simple: Snapshot = {
  cash: 1000, spentToday: 0, cushion: 100, typicalDay: 50, recentPace: 50,
  paycheck: { amount: 2000, nextIn: 5, every: 14 },
  bills: [{ name: "Rent", amount: 400, dueIn: 2, every: 30 }],
  buckets: [{ name: "Rainy day", saved: 0, goal: 1000, perPaycheck: 100 }],
};

describe("today", () => {
  it("spreads cash after bills and cushion over the days until payday", () => {
    const t = today(simple);
    expect(t.until).toBe(5);
    expect(t.bills).toBe(400);
    expect(t.saving).toBe(0); // savings come out of the paycheck, not this cycle
    expect(t.pool).toBe(500);
    expect(t.daily).toBe(100);
    expect(t.safeToSpend).toBe(100);
    expect(t.condition).toBe("sunny");
  });

  it("subtracts what was already spent today without changing the daily share", () => {
    const t = today({ ...simple, cash: 960, spentToday: 40 });
    expect(t.daily).toBe(100);
    expect(t.safeToSpend).toBe(60);
  });

  it("never goes below zero and reports a storm when short", () => {
    const t = today({ ...simple, cash: 300 });
    expect(t.pool).toBeLessThan(0);
    expect(t.safeToSpend).toBe(0);
    expect(t.condition).toBe("storm");
  });
});

describe("events", () => {
  it("repeats bills and pays savings first on payday", () => {
    const e = events(simple, 0, 40);
    expect(e.filter((x) => x.name === "Rent").map((x) => x.day)).toEqual([2, 32]);
    const payday = e.filter((x) => x.day === 5).map((x) => x.kind);
    expect(payday).toEqual(["pay", "save"]);
  });
});

describe("outlook", () => {
  it("rolls unspent money forward and resets on payday", () => {
    const o = outlook(simple, 10);
    expect(o).toHaveLength(10);
    // Spending a typical $50 of a $100 allowance leaves more for each following day.
    expect(o[1].daily).toBeGreaterThan(o[0].daily);
    expect(o[5].payday).toBe(true);
    expect(o[5].condition).toBe("sunny");
  });
});

describe("conditionFor", () => {
  it("maps the ratio to a normal day onto weather", () => {
    expect(conditionFor(100, 70)).toBe("sunny");
    expect(conditionFor(70, 70)).toBe("partly");
    expect(conditionFor(50, 70)).toBe("cloudy");
    expect(conditionFor(25, 70)).toBe("rain");
    expect(conditionFor(10, 70)).toBe("storm");
  });
});

describe("sample scenarios", () => {
  it("cover every kind of weather the prototype shows", () => {
    const got = Object.values(SCENARIOS).map((s) => today(s.snapshot).condition);
    expect(got).toEqual(["sunny", "partly", "rain", "storm"]);
    expect(Math.round(today(SCENARIOS.partly.snapshot).safeToSpend)).toBe(57);
  });
});
