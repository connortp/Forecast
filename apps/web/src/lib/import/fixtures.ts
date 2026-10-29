// Synthetic history for tests and the import preview. Nothing here is a real account.
//
// Eighteen months for one made-up person: paid every other Friday, rent on the 1st, a phone
// bill, Spotify, an electric bill that moves with the season, quarterly water, an annual
// Prime renewal, weekly groceries, and everyday spending with one expensive week.

import { addDays, addMonths } from "./learn";

export type Fake = {
  date: string;
  name: string;
  statement: string;
  category: string;
  /** Positive is money out. */
  amount: number;
  account: "Everyday Checking" | "Sapphire Card";
  mask: "4417" | "9020";
  kind: "pay" | "bill" | "spend" | "transfer";
};

export const FIXTURE_TODAY = "2026-10-28";
const START = "2025-05-01";

export function fakeHistory(): Fake[] {
  const out: Fake[] = [];
  const checking = { account: "Everyday Checking", mask: "4417" } as const;
  const card = { account: "Sapphire Card", mask: "9020" } as const;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  for (let d = "2025-05-02"; d <= FIXTURE_TODAY; d = addDays(d, 14))
    out.push({ date: d, name: "Northwind Payroll", statement: "NORTHWIND INC PAYROLL PPD ID 99120", category: "Paychecks", amount: -2650, ...checking, kind: "pay" });

  for (let m = 0; ; m++) {
    const first = addMonths(START, m);
    if (first > FIXTURE_TODAY) break;
    const on = (day: number) => first.slice(0, 8) + String(day).padStart(2, "0");
    const bill = (day: number, name: string, statement: string, category: string, amount: number, acct: Pick<Fake, "account" | "mask"> = checking) => {
      if (on(day) <= FIXTURE_TODAY) out.push({ date: on(day), name, statement, category, amount, ...acct, kind: "bill" });
    };
    bill(1, "Bilt Rent", "BILT RENT PMT 0001", "Rent", 1450);
    bill(4, "Verizon", "VZ WIRELESS VE 800-922-0204", "Phone", 85, card);
    bill(6, "Spotify", "SPOTIFY USA 877-778-1161", "Entertainment & Recreation", 11.99, card);
    const winter = [11, 0, 1].includes(new Date(`${first}T00:00:00Z`).getUTCMonth());
    bill(12, "PG&E", "PGANDE WEB ONLINE", "Gas & Electric", Math.round((winter ? 120 : 78) + rand() * 18));
    if (m % 3 === 0) bill(20, "City Water", "CITY OF OAKVIEW WATER", "Water", 64);
    if (on(15) <= FIXTURE_TODAY)
      out.push({ date: on(15), name: "Chase Card Payment", statement: "CHASE CREDIT CRD AUTOPAY", category: "Credit Card Payment", amount: 900, ...checking, kind: "transfer" });
  }
  for (const d of ["2025-06-10", "2026-06-10"])
    out.push({ date: d, name: "Amazon Prime", statement: "AMAZON PRIME*2K4", category: "Subscriptions", amount: 139, ...card, kind: "bill" });

  for (let d = START; d <= FIXTURE_TODAY; d = addDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow === 0) out.push({ date: d, name: "Trader Joe's", statement: "TRADER JOE S #552", category: "Groceries", amount: Math.round(60 + rand() * 50), ...card, kind: "spend" });
    if (rand() < 0.7) out.push({ date: d, name: "Blue Bottle", statement: "SQ *BLUE BOTTLE 4471", category: "Coffee Shops", amount: 6.5, ...card, kind: "spend" });
    if (rand() < 0.45) out.push({ date: d, name: "Local Kitchen", statement: "TST* LOCAL KITCHEN", category: "Restaurants & Bars", amount: Math.round(20 + rand() * 45), ...card, kind: "spend" });
    if (rand() < 0.2) out.push({ date: d, name: "Target", statement: "TARGET 00012345", category: "Shopping", amount: Math.round(15 + rand() * 70), ...card, kind: "spend" });
  }
  out.push({ date: "2026-03-14", name: "United Airlines", statement: "UNITED 0162345", category: "Travel & Vacation", amount: 612, ...card, kind: "spend" });

  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

const q = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const line = (cells: (string | number)[]) => cells.map(q).join(",");
const mdy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

export function asMonarch(rows: Fake[]): string {
  return [
    line(["Date", "Merchant", "Category", "Account", "Original Statement", "Notes", "Amount", "Tags"]),
    ...rows.map((r) => line([r.date, r.name, r.category, `${r.account} (...${r.mask})`, r.statement, "", (-r.amount).toFixed(2), ""])),
  ].join("\n");
}

export function asCopilot(rows: Fake[]): string {
  const type = (r: Fake) => (r.kind === "pay" ? "income" : r.kind === "transfer" ? "internal transfer" : "regular");
  return [
    line(["date", "name", "amount", "status", "category", "parent category", "excluded", "tags", "type", "account", "account mask", "note", "recurring"]),
    ...rows.map((r) => line([r.date, r.name, r.amount.toFixed(2), "posted", r.category, "", "false", "", type(r), r.account, r.mask, "", r.kind === "bill" ? r.name : ""])),
  ].join("\n");
}

export function asMint(rows: Fake[]): string {
  return [
    line(["Date", "Description", "Original Description", "Amount", "Transaction Type", "Category", "Account Name", "Labels", "Notes"]),
    ...rows.map((r) => line([mdy(r.date), r.name, r.statement, Math.abs(r.amount).toFixed(2), r.amount < 0 ? "credit" : "debit", r.category, r.account, "", ""])),
  ].join("\r\n");
}

export function asYnab(rows: Fake[]): string {
  const money = (n: number) => `$${n.toFixed(2)}`;
  return [
    line(["Account", "Flag", "Date", "Payee", "Category Group/Category", "Category Group", "Category", "Memo", "Outflow", "Inflow", "Cleared"]),
    ...rows.map((r) =>
      line([
        r.account, "", mdy(r.date), r.kind === "transfer" ? `Transfer : ${r.account}` : r.name, "", "",
        r.kind === "pay" ? "Inflow: Ready to Assign" : r.category, "", money(Math.max(0, r.amount)), money(Math.max(0, -r.amount)), "Cleared",
      ]),
    ),
  ].join("\n");
}

/** A typical bank download (Chase checking style): signed amounts, negative is money out. */
export function asBank(rows: Fake[]): string {
  return [
    line(["Details", "Posting Date", "Description", "Amount", "Type", "Balance", "Check or Slip #"]),
    ...rows.map((r) => line([r.amount < 0 ? "CREDIT" : "DEBIT", mdy(r.date), r.statement, (-r.amount).toFixed(2), "ACH_DEBIT", "", ""])),
  ].join("\n");
}
