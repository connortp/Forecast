import { describe, expect, it } from "vitest";
import { today as engineToday } from "./engine";
import { daysBetween, findBills, findPaycheck, toSnapshot, type LiveRows, type StreamRow } from "./live";

const TODAY = "2026-10-28";

const stream = (s: Partial<StreamRow>): StreamRow => ({
  id: s.description ?? "x",
  direction: "outflow",
  description: "Thing",
  merchant_name: null,
  user_name: null,
  frequency: "MONTHLY",
  average_amount: 50,
  last_amount: 50,
  last_date: null,
  predicted_next_date: null,
  is_active: true,
  ignored: false,
  category_primary: null,
  ...s,
});

const rows = (over: Partial<LiveRows> = {}): LiveRows => ({
  accounts: [
    { id: "chk", type: "depository", subtype: "checking", current_balance: 2100, available_balance: 2000, include_in_cash: true },
    { id: "sav", type: "depository", subtype: "savings", current_balance: 9000, available_balance: 9000, include_in_cash: false },
    { id: "cc", type: "credit", subtype: "credit card", current_balance: 300, available_balance: null, include_in_cash: false },
  ],
  transactions: [],
  streams: [
    stream({ direction: "inflow", description: "ACME PAYROLL", frequency: "BIWEEKLY", last_amount: 2200, predicted_next_date: "2026-11-06" }),
    stream({ direction: "inflow", description: "INTEREST", frequency: "MONTHLY", last_amount: 4, predicted_next_date: "2026-11-01" }),
    stream({ description: "Rent", last_amount: 1200, predicted_next_date: "2026-11-01" }),
    stream({ description: "Spotify", last_amount: 11.99, predicted_next_date: "2026-11-20" }),
  ],
  buckets: [{ name: "Trip", goal: 1000, saved: 100, per_paycheck: 50, archived_at: null }],
  settings: { cushion: 150, pay_amount_override: null, next_payday_override: null, pay_every_days_override: null },
  ...over,
});

describe("dates", () => {
  it("counts whole days across a DST change", () => {
    expect(daysBetween("2026-10-28", "2026-11-06")).toBe(9);
    expect(daysBetween("2026-11-06", "2026-10-28")).toBe(-9);
  });
});

describe("findPaycheck", () => {
  it("picks the biggest regular deposit, not interest", () => {
    expect(findPaycheck(rows(), TODAY)).toMatchObject({ amount: 2200, nextIn: 9, every: 14, name: "ACME PAYROLL" });
  });

  it("rolls a stale prediction forward to the next payday", () => {
    const r = rows({ streams: [stream({ direction: "inflow", frequency: "BIWEEKLY", last_amount: 2000, predicted_next_date: "2026-10-20" })] });
    expect(findPaycheck(r, TODAY)?.nextIn).toBe(6);
  });

  it("lets the person's settings win", () => {
    const r = rows({ settings: { cushion: 150, pay_amount_override: 1800, next_payday_override: "2026-10-31", pay_every_days_override: 7 } });
    expect(findPaycheck(r, TODAY)).toMatchObject({ amount: 1800, nextIn: 3, every: 7 });
  });

  it("returns null when nothing looks like a paycheck", () => {
    expect(findPaycheck(rows({ streams: [] }), TODAY)).toBeNull();
  });
});

describe("findBills", () => {
  it("skips ignored bills and transfers, sorted by due date", () => {
    const bills = findBills(
      [...rows().streams, stream({ description: "Gym", ignored: true, predicted_next_date: "2026-10-30" }), stream({ description: "To savings", category_primary: "TRANSFER_OUT", predicted_next_date: "2026-10-29" })],
      TODAY,
    );
    expect(bills.map((b) => [b.name, b.dueIn])).toEqual([["Rent", 4], ["Spotify", 23]]);
  });
});

describe("toSnapshot", () => {
  it("builds the engine input from rows", () => {
    const r = rows({
      transactions: [
        { account_id: "chk", amount: 12, date: TODAY, name: "Coffee", merchant_name: "Blue Bottle", category_primary: "FOOD_AND_DRINK", pending: true },
        { account_id: "chk", amount: 60, date: "2026-10-27", name: "Groceries", merchant_name: null, category_primary: "GENERAL_MERCHANDISE", pending: false },
        { account_id: "cc", amount: 40, date: "2026-10-26", name: "Dinner", merchant_name: null, category_primary: "FOOD_AND_DRINK", pending: false },
        { account_id: "chk", amount: 1200, date: "2026-10-01", name: "Rent", merchant_name: null, category_primary: "RENT_AND_UTILITIES", pending: false },
        { account_id: "chk", amount: 500, date: "2026-10-25", name: "Transfer", merchant_name: null, category_primary: "TRANSFER_OUT", pending: false },
        { account_id: "chk", amount: -2200, date: "2026-10-23", name: "ACME PAYROLL", merchant_name: null, category_primary: "INCOME", pending: false },
      ],
    });
    const s = toSnapshot(r, TODAY)!;
    expect(s.cash).toBe(2000);
    expect(s.spentToday).toBe(12);
    expect(s.paycheck).toEqual({ amount: 2200, nextIn: 9, every: 14 });
    expect(s.bills.map((b) => b.name)).toEqual(["Rent", "Spotify"]);
    expect(s.buckets).toEqual([{ name: "Trip", goal: 1000, saved: 100, perPaycheck: 50 }]);
    // 60 + 40 over the 2 days back to the oldest purchase; rent and the transfer don't count.
    expect(s.typicalDay).toBe(50);
    expect(engineToday(s).safeToSpend).toBeGreaterThan(0);
  });

  it("is null until a paycheck is known", () => {
    expect(toSnapshot(rows({ streams: [] }), TODAY)).toBeNull();
  });
});
