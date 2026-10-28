import type { Snapshot } from "@/lib/engine";

// What sign-up "finds" until Plaid is connected. Nothing here is a real account.
// Offsets are days from today, the same as the engine.

export type FoundBill = { name: string; payee?: string; amount: number; dueIn: number; unsure?: boolean };
export type Cadence = { label: string; chip: string; every: number };

export const EXAMPLE = {
  bank: "Harbor Federal",
  transactions: 1284,
  accounts: [
    { name: "Everyday Checking", mask: "4021", balance: 2486, cash: true, on: true },
    { name: "High-Yield Savings", mask: "8830", balance: 6210, cash: false, on: false, note: "not counted as cash" },
    { name: "Cash Back Visa", mask: "1177", balance: 412, cash: false, on: true, note: "for statement due dates" },
  ],
  employer: "Acme Studio payroll",
  paycheck: { amount: 2140, nextIn: 9 },
  bills: [
    { name: "Rent", payee: "Greenline Properties", amount: 1200, dueIn: 4 },
    { name: "Verizon", amount: 65, dueIn: 5 },
    { name: "Spotify", amount: 11.99, dueIn: 6 },
    { name: "Geico", amount: 118, dueIn: 8 },
    { name: "Venmo to Sam", payee: "repeats monthly", amount: 40, dueIn: 7, unsure: true },
  ] satisfies FoundBill[],
  buckets: [
    { name: "Emergency fund", goal: 3000, perPaycheck: 100 },
    { name: "Japan trip", goal: 2400, perPaycheck: 120 },
  ],
  typicalDay: 85,
  recentPace: 80,
};

export const CADENCES: Cadence[] = [
  { label: "every week", chip: "Weekly", every: 7 },
  { label: "every other Friday", chip: "Every 2 weeks", every: 14 },
  { label: "twice a month", chip: "1st & 15th", every: 15 },
  { label: "once a month", chip: "Monthly", every: 30 },
];

export type Choices = {
  every: number;
  billsOn: boolean[];
  buckets: { name: string; goal: number; perPaycheck: number }[];
  cushion: number;
};

export const initialChoices = (): Choices => ({
  every: 14,
  billsOn: EXAMPLE.bills.map((b) => !b.unsure),
  buckets: EXAMPLE.buckets.map((b) => ({ ...b })),
  cushion: 150,
});

/** Turns what the person confirmed into the engine's input. */
export function snapshotFrom(c: Choices): Snapshot {
  const cash = EXAMPLE.accounts.filter((a) => a.cash && a.on).reduce((t, a) => t + a.balance, 0);
  return {
    cash,
    spentToday: 0,
    paycheck: { amount: EXAMPLE.paycheck.amount, nextIn: EXAMPLE.paycheck.nextIn, every: c.every },
    bills: EXAMPLE.bills.filter((_, i) => c.billsOn[i]).map((b) => ({ name: b.name, amount: b.amount, dueIn: b.dueIn, every: 30 })),
    buckets: c.buckets.map((b) => ({ name: b.name, saved: 0, goal: b.goal, perPaycheck: b.perPaycheck })),
    cushion: c.cushion,
    typicalDay: EXAMPLE.typicalDay,
    recentPace: EXAMPLE.recentPace,
  };
}
