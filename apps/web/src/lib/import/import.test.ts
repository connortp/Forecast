import { describe, expect, it } from "vitest";
import { asBank, asCopilot, asMint, asMonarch, asYnab, fakeHistory, FIXTURE_TODAY } from "./fixtures";
import { dedupeImports, detectFormat, keyOf, learn, mergeWithPlaid, parseAmount, parseCsv, parseDate, parseExport, toEngine, type Txn } from ".";
import { today as computeToday } from "../engine";
import { addDays } from "./learn";

const history = fakeHistory();

describe("csv", () => {
  it("handles quotes, escaped quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });

  it("reads amounts and dates the way exports write them", () => {
    expect(parseAmount("$1,234.50")).toBe(1234.5);
    expect(parseAmount("(12.00)")).toBe(-12);
    expect(parseAmount("−4.25")).toBe(-4.25);
    expect(parseDate("10/28/2026")).toBe("2026-10-28");
    expect(parseDate("3/4/26")).toBe("2026-03-04");
    expect(() => parseDate("yesterday")).toThrow();
  });
});

describe("formats", () => {
  const cases = [
    ["monarch", asMonarch],
    ["copilot", asCopilot],
    ["mint", asMint],
    ["ynab", asYnab],
    ["csv", asBank],
  ] as const;

  for (const [format, render] of cases) {
    it(`reads a ${format} export with money out as positive`, () => {
      const r = parseExport(render(history));
      expect(r.format).toBe(format);
      expect(r.skipped).toEqual([]);
      expect(r.signGuessed).toBe(false);
      expect(r.txns).toHaveLength(history.length);
      const pay = r.txns.find((t) => t.amount === -2650)!;
      expect(pay.kind).toBe("income");
      expect(r.txns.filter((t) => t.amount > 0).length).toBeGreaterThan(r.txns.length * 0.9);
    });
  }

  it("splits Monarch's account label into a name and last digits", () => {
    const t = parseExport(asMonarch(history)).txns[0];
    expect(t.accountLabel).toBe("Sapphire Card");
    expect(t.accountMask).toBe("9020");
  });

  it("marks card payments and Copilot internal transfers as transfers", () => {
    for (const render of [asMonarch, asCopilot, asYnab]) {
      const card = parseExport(render(history)).txns.filter((t) => t.amount === 900);
      expect(card.every((t) => t.kind === "transfer")).toBe(true);
    }
  });

  it("guesses the sign when nothing says which way it points, and can be flipped", () => {
    const csv = "Date,Description,Amount\n2026-10-01,Coffee,4.50\n2026-10-02,Lunch,12.00\n2026-10-03,Refund,-3.00";
    const r = parseExport(csv);
    expect(r.signGuessed).toBe(true);
    expect(r.txns[0].amount).toBe(4.5);
    expect(parseExport(csv, { flip: true }).txns[0].amount).toBe(-4.5);
  });

  it("ignores trades, reinvestments and retirement accounts", () => {
    const csv = [
      "Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags,Owner,Review",
      "2026-10-01,Vanguard,Buy,Brokerage (...1111),BUY VTI,,-500.00,,,",
      "2026-10-01,Vanguard,Transfer,Checking (...2222),VTI REINVEST,,-12.00,,,",
      "2026-10-02,Fidelity,Groceries,Roth IRA (...1111),x,,-5.00,,,",
      "2026-10-03,Whole Foods,Groceries,Card (...XXXX-XXXX-XXXX-2222),x,,-42.10,,,",
    ].join("\n");
    const t = parseExport(csv).txns;
    expect(t.map((x) => x.kind)).toEqual(["ignored", "ignored", "ignored", "spend"]);
    expect(t[3].accountMask).toBe("2222");
  });

  it("gives identical rows distinct, stable ids so re-uploading changes nothing", () => {
    const csv = "Date,Description,Amount\n2026-10-01,Coffee,-4.50\n2026-10-01,Coffee,-4.50";
    const a = parseExport(csv).txns.map((t) => t.sourceTxnId);
    const b = parseExport(csv).txns.map((t) => t.sourceTxnId);
    expect(new Set(a).size).toBe(2);
    expect(a).toEqual(b);
  });

  it("falls back to a generic bank file and skips unreadable rows", () => {
    expect(detectFormat(["posting date", "description", "amount"])).toBe("csv");
    const r = parseExport("Posting Date,Description,Debit,Credit\n10/01/2026,Coffee,4.50,\nnot a date,Bad,1,\n10/02/2026,Payroll,,2000");
    expect(r.txns.map((t) => t.amount)).toEqual([4.5, -2000]);
    expect(r.skipped).toEqual([{ row: 3, reason: 'Unreadable date "not a date"' }]);
  });
});

describe("merge", () => {
  const imported = parseExport(asMonarch(history)).txns;
  const plaidStart = "2026-07-30";
  const plaid: Txn[] = imported
    .filter((t) => t.date >= plaidStart && t.accountMask === "4417")
    .map((t) => ({ ...t, source: "plaid", sourceTxnId: `plaid-${t.sourceTxnId}`, accountId: "acc_checking", accountMask: "4417" }));

  it("lets Plaid own its window on matched accounts", () => {
    const r = mergeWithPlaid(imported, plaid, [{ id: "acc_checking", mask: "4417", name: "Everyday Checking" }]);
    const checking = r.rows.filter((t) => t.accountId === "acc_checking");
    expect(checking.every((t) => t.date < plaidStart)).toBe(true);
    expect(r.overlap).toBe(plaid.length);
    expect(r.matched).toEqual({ "Everyday Checking": "acc_checking" });
    // The card isn't linked, so all its history stays.
    expect(r.rows.filter((t) => t.accountMask === "9020")).toHaveLength(imported.filter((t) => t.accountMask === "9020").length);
  });

  it("drops near-date, same-amount twins when the account can't be matched", () => {
    const r = mergeWithPlaid(
      [{ ...imported[0], date: "2026-10-10", amount: 42.17, accountMask: undefined, accountLabel: "Old bank" }],
      [{ ...imported[0], source: "plaid", sourceTxnId: "p1", date: "2026-10-12", amount: 42.17, accountId: "acc_x" }],
      [{ id: "acc_x", mask: "1111" }],
    );
    expect(r.rows).toHaveLength(0);
    expect(r.duplicates).toBe(1);
  });

  it("drops pending imported rows", () => {
    const r = mergeWithPlaid([{ ...imported[0], pending: true }], [], []);
    expect(r.rows).toHaveLength(0);
    expect(r.pending).toBe(1);
  });

  it("dedupes overlapping imports from two apps, keeping repeat purchases", () => {
    const a = parseExport(asMonarch(history)).txns;
    const b = parseExport(asCopilot(history)).txns;
    expect(dedupeImports([a, b])).toHaveLength(a.length);
  });
});

describe("learn", () => {
  const txns = parseExport(asMonarch(history)).txns;
  const l = learn(txns, FIXTURE_TODAY);

  it("finds the biweekly paycheck and when it lands next", () => {
    expect(l.paycheck).toMatchObject({ name: "Northwind Payroll", cadence: "biweekly", every: 14, amount: 2650 });
    expect(l.paycheck!.nextDate > FIXTURE_TODAY).toBe(true);
  });

  it("finds monthly, quarterly and annual bills, but not weekly groceries", () => {
    const byName = Object.fromEntries(l.bills.map((b) => [b.name, b]));
    expect(byName["Bilt Rent"]).toMatchObject({ cadence: "monthly", amount: 1450, nextDate: "2026-11-01" });
    expect(byName["Verizon"]).toMatchObject({ cadence: "monthly", amount: 85 });
    expect(byName["Spotify"]).toMatchObject({ cadence: "monthly", amount: 11.99 });
    expect(byName["PG&E"]?.cadence).toBe("monthly");
    expect(byName["City Water"]).toMatchObject({ cadence: "quarterly", amount: 64 });
    expect(byName["Amazon Prime"]).toMatchObject({ cadence: "annual", nextDate: "2027-06-10" });
    expect(byName["Trader Joe's"]).toBeUndefined();
    expect(byName["Blue Bottle"]).toBeUndefined();
    expect(byName["Chase Card Payment"]).toBeUndefined(); // a transfer
  });

  it("learns a typical day that one expensive week doesn't move", () => {
    expect(l.typicalDay).toBeGreaterThan(30);
    expect(l.typicalDay).toBeLessThan(60);
    const withSplurge = learn([...txns, { ...txns[0], date: "2026-10-20", amount: 3000, name: "Sofa World", sourceTxnId: "x" }], FIXTURE_TODAY);
    expect(Math.abs(withSplurge.typicalDay - l.typicalDay)).toBeLessThan(2);
  });

  it("only learns a quarterly or annual bill from history longer than Plaid's 90 days", () => {
    const recent = learn(txns.filter((t) => t.date >= "2026-07-30"), FIXTURE_TODAY);
    expect(recent.paycheck?.cadence).toBe("biweekly");
    expect(recent.bills.find((b) => b.name === "Amazon Prime")).toBeUndefined();
    expect(recent.bills.find((b) => b.name === "City Water")).toBeUndefined();
  });

  it("treats two people paid on the same rhythm as one household payday", () => {
    const partner = txns
      .filter((t) => t.kind === "income")
      .map((t) => ({ ...t, name: "Harbor Studio", amount: -1700, date: addDays(t.date, 1), sourceTxnId: `p-${t.sourceTxnId}` }));
    const both = learn([...txns, ...partner], FIXTURE_TODAY);
    expect(both.paycheck).toMatchObject({ name: "Northwind Payroll + Harbor Studio", amount: 4350, cadence: "biweekly", nextDate: "2026-10-30" });
    expect(both.income).toHaveLength(2);
  });

  it("doesn't mistake a coincidence in an everyday category for a yearly bill", () => {
    const dinner = ["2025-04-03", "2026-04-03"].map((date, i) => ({ ...txns[0], date, name: "A Friend", category: "Restaurants", amount: 33.25, kind: "spend" as const, sourceTxnId: `d${i}` }));
    expect(learn([...txns, ...dinner], FIXTURE_TODAY).bills.find((b) => b.name === "A Friend")).toBeUndefined();
  });

  it("groups messy bank descriptions under one name", () => {
    expect(keyOf("SQ *BLUE BOTTLE 4471")).toBe(keyOf("Blue Bottle"));
    expect(keyOf("NORTHWIND INC PAYROLL PPD ID 99120")).toBe("northwind inc payroll");
  });

  it("feeds the engine", () => {
    const parts = toEngine(l, FIXTURE_TODAY);
    const t = computeToday({ cash: 2400, spentToday: 0, cushion: 150, buckets: [], ...parts, paycheck: parts.paycheck! });
    expect(parts.paycheck).toEqual({ amount: 2650, nextIn: 2, every: 14 });
    expect(parts.bills.find((b) => b.name === "Bilt Rent")).toMatchObject({ dueIn: 4, every: 30 });
    expect(t.until).toBe(2); // rent lands after payday, so the paycheck covers it
    expect(Number.isFinite(t.safeToSpend)).toBe(true);
  });

  it("reads the same plan from every format", () => {
    for (const render of [asCopilot, asMint, asYnab]) {
      const other = learn(parseExport(render(history)).txns, FIXTURE_TODAY);
      expect(other.paycheck?.amount).toBe(2650);
      expect(other.bills.map((b) => b.cadence).sort()).toEqual(l.bills.map((b) => b.cadence).sort());
    }
  });
});
