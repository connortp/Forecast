// Vendored from apps/web/src/lib/engine.ts (PR #3) so the MCP server computes the
// exact same number the app shows. Once the web app lands, this should move to a
// shared packages/engine that both import; until then keep the two files identical.

// The safe-to-spend engine.
//
// Everything is measured in whole days from "today" (day 0) so the engine stays pure
// and easy to test. Adapters turn real dates from Plaid/Supabase into these offsets.
//
// The rule: cash this morning, minus every bill due before the next paycheck, minus
// savings contributions due before then, minus a cushion, spread evenly over the days
// until payday. Whatever is left of today's share after today's spending is the number.

export type Bill = {
  name: string;
  amount: number;
  /** Days from today until the next charge. */
  dueIn: number;
  /** How often it repeats, in days. Monthly bills use 30. */
  every: number;
};

export type Paycheck = {
  amount: number;
  /** Days from today until the next deposit (at least 1). */
  nextIn: number;
  every: number;
};

export type Bucket = {
  name: string;
  saved: number;
  goal: number;
  /** Moved out of each paycheck before anything counts as spendable. */
  perPaycheck: number;
};

export type Snapshot = {
  /** Spendable balance right now, across checking accounts. */
  cash: number;
  spentToday: number;
  paycheck: Paycheck;
  bills: Bill[];
  buckets: Bucket[];
  cushion: number;
  /** A normal day of discretionary spending, learned from history. */
  typicalDay: number;
  /** Average daily discretionary spend over the last 7 days. */
  recentPace: number;
};

export type Event = {
  day: number;
  name: string;
  amount: number;
  kind: "bill" | "pay" | "save";
};

export type Condition = "sunny" | "partly" | "cloudy" | "rain" | "storm";

export type Allowance = {
  /** Day of the next paycheck after this day. */
  until: number;
  bills: number;
  billCount: number;
  saving: number;
  /** Money left to cover every day until payday. Negative means short. */
  pool: number;
  daily: number;
};

export type Today = Allowance & {
  startCash: number;
  safeToSpend: number;
  condition: Condition;
};

export type OutlookDay = { day: number; daily: number; payday: boolean; condition: Condition };

export function events(s: Snapshot, from: number, to: number): Event[] {
  const out: Event[] = [];
  for (const b of s.bills) {
    for (let d = b.dueIn; d < to; d += b.every) if (d >= from) out.push({ day: d, name: b.name, amount: b.amount, kind: "bill" });
  }
  const saving = s.buckets.reduce((t, b) => t + b.perPaycheck, 0);
  for (let d = s.paycheck.nextIn; d < to; d += s.paycheck.every) {
    if (d < from) continue;
    out.push({ day: d, name: "Paycheck", amount: s.paycheck.amount, kind: "pay" });
    if (saving > 0) out.push({ day: d, name: "To savings", amount: saving, kind: "save" });
  }
  const order = { pay: 0, save: 1, bill: 2 };
  return out.sort((a, b) => a.day - b.day || order[a.kind] - order[b.kind]);
}

export function nextPaycheckAfter(s: Snapshot, day: number): number {
  let d = s.paycheck.nextIn;
  while (d <= day) d += s.paycheck.every;
  return d;
}

/** The allowance for one day, given the cash on hand at the start of that day. */
export function allowanceOn(s: Snapshot, day: number, cashAtStart: number): Allowance {
  const until = nextPaycheckAfter(s, day);
  const held = events(s, day, until).filter((e) => e.kind !== "pay");
  const billList = held.filter((e) => e.kind === "bill");
  const bills = sum(billList);
  const saving = sum(held.filter((e) => e.kind === "save"));
  const pool = cashAtStart - bills - saving - s.cushion;
  return { until, bills, billCount: billList.length, saving, pool, daily: pool / (until - day) };
}

const THRESHOLDS: [Condition, number][] = [
  ["sunny", 1.25],
  ["partly", 0.95],
  ["cloudy", 0.65],
  ["rain", 0.3],
];

/** Weather is how today's allowance compares with a normal day for this person. */
export function conditionFor(daily: number, typicalDay: number): Condition {
  if (daily <= 0 || typicalDay <= 0) return daily > 0 ? "sunny" : "storm";
  const ratio = daily / typicalDay;
  return THRESHOLDS.find(([, min]) => ratio >= min)?.[0] ?? "storm";
}

export function today(s: Snapshot): Today {
  const startCash = s.cash + s.spentToday;
  const a = allowanceOn(s, 0, startCash);
  return {
    ...a,
    startCash,
    safeToSpend: Math.max(0, a.daily - s.spentToday),
    condition: conditionFor(a.daily, s.typicalDay),
  };
}

/** Projects the daily allowance forward, assuming a typical day of spending. */
export function outlook(s: Snapshot, days = 10): OutlookDay[] {
  let cash = s.cash + s.spentToday;
  const out: OutlookDay[] = [];
  for (let d = 0; d < days; d++) {
    const todays = events(s, d, d + 1);
    const pay = todays.find((e) => e.kind === "pay");
    if (pay) cash += pay.amount;
    const a = allowanceOn(s, d, cash);
    out.push({ day: d, daily: a.daily, payday: !!pay, condition: conditionFor(a.daily, s.typicalDay) });
    cash -= d === 0 ? s.spentToday : Math.max(0, Math.min(s.typicalDay, a.daily));
    for (const e of todays) if (e.kind !== "pay") cash -= e.amount;
  }
  return out;
}

function sum(list: { amount: number }[]): number {
  return list.reduce((t, e) => t + e.amount, 0);
}
