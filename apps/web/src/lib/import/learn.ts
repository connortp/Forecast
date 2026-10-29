// Learns what the engine needs from transaction history: the paycheck, the recurring
// bills, and what a normal day of spending looks like.
//
// Plaid's recurring endpoint sees about 90 days, which is enough for a biweekly paycheck
// but not for quarterly or annual bills, or for a typical day that isn't skewed by one
// unusual month. Imported history fills that in. This runs on any mix of imported and
// Plaid rows, so the same code serves sign-up and later refreshes.

import type { Bill, Paycheck } from "../engine";
import { dayDiff } from "./merge";
import type { Txn } from "./types";

export type Cadence = "weekly" | "biweekly" | "semimonthly" | "monthly" | "quarterly" | "annual";

/** [cadence, average days between, tolerance in days, fewest occurrences, days the engine repeats on] */
const CADENCES: [Cadence, number, number, number, number][] = [
  ["weekly", 7, 1, 4, 7],
  ["biweekly", 14, 1, 3, 14],
  ["semimonthly", 15.2, 3, 4, 15],
  ["monthly", 30.4, 4, 3, 30],
  ["quarterly", 91, 10, 3, 91],
  ["annual", 365, 20, 2, 365],
];

export type Stream = {
  name: string;
  cadence: Cadence;
  /** Days between occurrences, as the engine counts them. */
  every: number;
  /** Typical amount, always positive. */
  amount: number;
  count: number;
  firstDate: string;
  lastDate: string;
  /** Next expected date on or after today (after today for paychecks). */
  nextDate: string;
  /** 0 to 1: how regular the timing and amount have been. Below 0.5, ask before counting it. */
  confidence: number;
  /** How much the amount moves between occurrences (coefficient of variation; 0 = identical). */
  variability: number;
  category?: string;
  /** Account of the latest occurrence, with its last digits when known. */
  account?: string;
  /** The grouped names (see keyOf) this stream was built from. */
  keys: string[];
};

/** Fixed costs never count toward a normal day, even when they aren't regular enough to be a bill. */
const FIXED = /^(rent|mortgage|.*insurance|loan repayment|student loans|auto payment|taxes|.*income tax|tuition|child care)$/i;

export type Learned = {
  paycheck?: Stream;
  /** Every recurring deposit found, the paycheck first. */
  income: Stream[];
  bills: Stream[];
  /** Median discretionary spend per day, from weekly totals. */
  typicalDay: number;
  /** Discretionary spend per day over the last 7 days. */
  recentPace: number;
  /** First and last dates of usable history, and how many days that spans. */
  from?: string;
  to?: string;
  historyDays: number;
};

export function learn(txns: Txn[], today: string): Learned {
  const usable = txns.filter((t) => t.kind !== "ignored" && t.kind !== "transfer" && !t.pending && t.date <= today);
  const dates = usable.map((t) => t.date).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];

  const deposits = usable.filter((t) => t.amount < 0);
  const labelled = deposits.filter((t) => t.kind === "income");
  const income = streams(labelled.length ? labelled : deposits, today, "in")
    .filter((s) => PAY_CADENCES.includes(s.cadence))
    .sort((a, b) => monthly(b) - monthly(a));

  const bills = streams(
    usable.filter((t) => t.kind === "spend" && t.amount > 0),
    today,
    "out",
  ).filter(isBillLike);

  const billKeys = new Set(bills.flatMap((b) => b.keys));
  const discretionary = usable.filter((t) => t.kind === "spend" && !billKeys.has(keyOf(t.name)) && !FIXED.test(t.category ?? ""));

  return {
    paycheck: household(income),
    income,
    bills,
    typicalDay: typicalDay(discretionary, to ?? today),
    recentPace: round2(sumBetween(discretionary, addDays(today, -6), today) / 7),
    from,
    to,
    historyDays: from && to ? dayDiff(to, from) + 1 : 0,
  };
}

/** Converts learned streams to the engine's day offsets from today. */
/** Bills below this confidence are shown as "ask first" and not held back until confirmed. */
export const CONFIDENT = 0.5;

export function toEngine(l: Learned, today: string): { paycheck?: Paycheck; bills: Bill[]; typicalDay: number; recentPace: number } {
  return {
    paycheck: l.paycheck && { amount: l.paycheck.amount, nextIn: Math.max(1, dayDiff(l.paycheck.nextDate, today)), every: l.paycheck.every },
    bills: l.bills
      .filter((b) => b.confidence >= CONFIDENT)
      .map((b) => ({ name: b.name, amount: b.amount, dueIn: Math.max(0, dayDiff(b.nextDate, today)), every: b.every })),
    typicalDay: l.typicalDay,
    recentPace: l.recentPace,
  };
}

// ---------------------------------------------------------------------------------------

function streams(txns: Txn[], today: string, dir: "in" | "out"): Stream[] {
  const groups = new Map<string, Txn[]>();
  // Oldest first, so a group's last row carries its current name and category.
  for (const t of [...txns].sort(byDate)) {
    const k = keyOf(t.name);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: Stream[] = [];
  for (const [keys, list] of mergeRenamed(groups)) {
    // A generic name ("Annual Fee") can be a separate bill on each card. Look per
    // account first, then at the name as a whole (a subscription that moved cards).
    const accounts = new Map<string, Txn[]>();
    for (const t of list) {
      const a = t.accountMask ?? t.accountLabel ?? "";
      accounts.set(a, [...(accounts.get(a) ?? []), t]);
    }
    const each = accounts.size > 1 ? [...accounts.values()].map((l) => detect(l, today, dir, keys)).filter((x) => x !== undefined) : [];
    const whole = each.length ? undefined : detect(list, today, dir, keys);
    out.push(...each, ...(whole ? [whole] : []));
  }
  return out;
}

/**
 * Merchants get renamed ("Acme Rentals" becomes "Acme"). Names where one is the other plus
 * more words, in the same category, are one stream.
 */
function mergeRenamed(groups: Map<string, Txn[]>): [string[], Txn[]][] {
  const byFirst = new Map<string, string[]>();
  for (const k of groups.keys()) {
    const w = k.split(" ")[0];
    byFirst.set(w, [...(byFirst.get(w) ?? []), k]);
  }
  const out: [string[], Txn[]][] = [];
  const category = (list: Txn[]) => list[list.length - 1].category ?? "";
  for (const keys of byFirst.values()) {
    const merged: [string[], Txn[]][] = [];
    for (const k of keys.sort((a, b) => a.length - b.length)) {
      const list = groups.get(k)!;
      const into = merged.find(([ks, l]) => ks.some((x) => k.startsWith(`${x} `)) && category(l) === category(list));
      if (into) {
        into[0].push(k);
        into[1] = [...into[1], ...list].sort(byDate);
      } else merged.push([[k], list]);
    }
    out.push(...merged);
  }
  return out;
}

function detect(list: Txn[], today: string, dir: "in" | "out", keys: string[]): Stream | undefined {
  // One occurrence per day; two charges from the same place on the same day are one visit.
  const byDay = new Map<string, number>();
  for (const t of list) byDay.set(t.date, (byDay.get(t.date) ?? 0) + Math.abs(t.amount));
  const days = [...byDay.keys()].sort();
  if (days.length < 2) return undefined;
  const gaps = days.slice(1).map((d, i) => dayDiff(d, days[i]));
  const gap = median(gaps);

  const fit = pickCadence(gaps, gap);
  if (!fit) return undefined;
  const [cadence, avg, tol, fewest, every] = fit;
  if (days.length < fewest) return undefined;

  const last = days[days.length - 1];
  if (dayDiff(today, last) > avg + Math.max(2 * tol, avg / 4)) return undefined; // it stopped

  const regular = gaps.filter((g) => Math.abs(g - avg) <= tol).length / gaps.length;
  if (regular < 0.6) return undefined;

  const amounts = days.map((d) => byDay.get(d)!);
  const recent = amounts.slice(-3);
  const amount = round2(median(recent));
  const spread = cv(amounts.slice(-6));

  return {
    name: list[list.length - 1].name,
    cadence,
    every,
    amount,
    count: days.length,
    firstDate: days[0],
    lastDate: last,
    nextDate: nextAfter(last, cadence, avg, today, dir === "in"),
    confidence: round2(regular * Math.min(1, days.length / 6) * Math.max(0, 1 - spread)),
    variability: round2(spread),
    category: list[list.length - 1].category,
    account: accountName(list[list.length - 1]),
    keys,
  };
}

function pickCadence(gaps: number[], gap: number) {
  // Biweekly pays land exactly 14 days apart (13 or 15 around holidays). Semimonthly
  // pays wander between 13 and 17 with the calendar. Tell them apart by how often it's 14.
  if (gap >= 12 && gap <= 18) {
    const fourteen = gaps.filter((g) => g >= 13 && g <= 15).length / gaps.length;
    return CADENCES.find(([c]) => c === (fourteen >= 0.8 && gaps.filter((g) => g === 14).length / gaps.length >= 0.5 ? "biweekly" : "semimonthly"));
  }
  return CADENCES.find(([, avg, tol]) => Math.abs(gap - avg) <= tol);
}

const PAY_CADENCES: Cadence[] = ["weekly", "biweekly", "semimonthly", "monthly"];

/**
 * Two people paid on the same rhythm, a day or two apart, are one household payday to the
 * engine, which models a single paycheck. Otherwise the largest stream is the paycheck.
 */
function household(income: Stream[]): Stream | undefined {
  const [top, ...rest] = income;
  if (!top) return undefined;
  const partners = rest.filter((s) => s.cadence === top.cadence && s.confidence >= 0.5 && Math.abs(dayDiff(s.nextDate, top.nextDate)) <= 3);
  if (!partners.length) return top;
  const all = [top, ...partners];
  return {
    ...top,
    name: all.map((s) => s.name).join(" + "),
    amount: round2(all.reduce((t, s) => t + s.amount, 0)),
    nextDate: all.map((s) => s.nextDate).sort()[0],
    confidence: Math.min(...all.map((s) => s.confidence)),
    variability: Math.max(...all.map((s) => s.variability)),
  };
}

/** Categories where a repeat is usually a habit or a coincidence, not a bill. */
const DISCRETIONARY = /restaurant|bar|coffee|fast food|food|groceries|shopping|clothing|gift|travel|vacation|entertainment|taxi|ride|gas$|parking|personal|electronics|furniture|home improvement|uncategorized|misc/i;

/**
 * A grocery store visited every week is a habit, not a bill. Short cadences need near-identical
 * amounts. In everyday categories (a restaurant twice in August) every bill needs a fixed amount,
 * and a yearly one needs three years of it.
 */
function isBillLike(s: Stream): boolean {
  if (s.cadence === "weekly" || s.cadence === "biweekly" || s.cadence === "semimonthly") return s.variability <= 0.05 && s.confidence >= 0.8;
  if (DISCRETIONARY.test(s.category ?? "")) return s.variability <= 0.05 && (s.cadence !== "annual" || s.count >= 3);
  return s.confidence > 0.25;
}

function nextAfter(last: string, cadence: Cadence, avg: number, today: string, strictlyAfter: boolean): string {
  let d = last;
  let n = 0;
  const step = () => {
    n++;
    if (cadence === "monthly") return addMonths(last, n);
    if (cadence === "quarterly") return addMonths(last, 3 * n);
    if (cadence === "annual") return addMonths(last, 12 * n);
    return addDays(last, Math.round(avg * n));
  };
  do d = step();
  while (strictlyAfter ? d <= today : d < today);
  return d;
}

/** Median of weekly totals, so one big week (a flight, a couch) doesn't move a normal day. */
function typicalDay(txns: Txn[], end: string): number {
  if (!txns.length) return 0;
  const first = txns.reduce((m, t) => (t.date < m ? t.date : m), txns[0].date);
  const weeks: number[] = [];
  for (let i = 0; i < 26; i++) {
    const hi = addDays(end, -7 * i);
    const lo = addDays(hi, -6);
    if (lo < first) break;
    weeks.push(sumBetween(txns, lo, hi));
  }
  return weeks.length ? round2(Math.max(0, median(weeks)) / 7) : 0;
}

function sumBetween(txns: Txn[], lo: string, hi: string): number {
  return txns.reduce((t, x) => (x.date >= lo && x.date <= hi ? t + x.amount : t), 0);
}

/** Groups "SQ *BLUE BOTTLE 4471" and "Blue Bottle" together; Monarch and Copilot names are already clean. */
export function keyOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(sq|tst|sp|pp|py|in)\s*\*\s*/, "")
    .replace(/\b(ach|pos|debit|credit|purchase|recurring|ppd|ccd|web|id|ref|online|pmt|payment|autopay|des|indn|co)\b/g, " ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 3)
    .join(" ");
}

const accountName = (t: Txn) => [t.accountLabel, t.accountMask && `…${t.accountMask}`].filter(Boolean).join(" ") || undefined;

const byDate = (a: Txn, b: Txn) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

const monthly = (s: Stream) => (s.amount * 30.4) / s.every;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function cv(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (!mean) return 1;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return sd / mean;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Same day of the month, clamped to the month's last day (Jan 31 → Feb 28). */
export function addMonths(iso: string, n: number): string {
  const [y, m, day] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
