import type { Bill, Bucket, Snapshot } from "./engine";

// Turns Supabase rows into the engine's Snapshot. Pure, so it is easy to test: the caller
// passes "today" as a YYYY-MM-DD string in the person's own timezone.

export type AccountRow = {
  id: string;
  type: string;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  include_in_cash: boolean;
};

export type TransactionRow = {
  account_id: string | null;
  amount: number;
  date: string;
  name: string;
  merchant_name: string | null;
  category_primary: string | null;
  pending: boolean;
};

export type StreamRow = {
  id: string;
  direction: "inflow" | "outflow";
  description: string;
  merchant_name: string | null;
  user_name: string | null;
  frequency: string;
  average_amount: number | null;
  last_amount: number | null;
  last_date: string | null;
  predicted_next_date: string | null;
  is_active: boolean;
  ignored: boolean;
  category_primary: string | null;
};

export type BucketRow = { name: string; goal: number; saved: number; per_paycheck: number; archived_at: string | null };

export type SettingsRow = {
  cushion: number;
  pay_amount_override: number | null;
  next_payday_override: string | null;
  pay_every_days_override: number | null;
};

export type LiveRows = {
  accounts: AccountRow[];
  transactions: TransactionRow[];
  streams: StreamRow[];
  buckets: BucketRow[];
  settings: SettingsRow | null;
};

export const EVERY: Record<string, number> = { WEEKLY: 7, BIWEEKLY: 14, SEMI_MONTHLY: 15, MONTHLY: 30, ANNUALLY: 365 };

// Money that moves between your own accounts, or pays off a card, isn't day-to-day spending.
const NOT_SPENDING = new Set(["TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS", "INCOME", "BANK_FEES"]);

const DAY = 86_400_000;
const utc = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY);

/** Today's date as YYYY-MM-DD in a timezone. */
export function localYmd(timeZone?: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Days from today until a stream's next date, rolled forward past anything already gone. */
function nextIn(s: Pick<StreamRow, "predicted_next_date" | "last_date" | "frequency">, today: string, min: number): number | null {
  const every = EVERY[s.frequency];
  const anchor = s.predicted_next_date ?? s.last_date;
  if (!every || !anchor) return null;
  let d = daysBetween(today, anchor);
  if (!s.predicted_next_date) d += every;
  while (d < min) d += every;
  return d;
}

const label = (s: StreamRow) => s.user_name ?? s.merchant_name ?? s.description;
const amountOf = (s: StreamRow) => s.last_amount ?? s.average_amount ?? 0;

export type Paycheck = { amount: number; nextIn: number; every: number; name: string; streamId?: string };

/** The paycheck: the biggest regular deposit, unless the person set it by hand. */
export function findPaycheck(rows: Pick<LiveRows, "streams" | "settings">, today: string): Paycheck | null {
  const inflows = rows.streams
    .filter((s) => s.direction === "inflow" && s.is_active && !s.ignored && EVERY[s.frequency] && EVERY[s.frequency] <= 30)
    .sort((a, b) => amountOf(b) / EVERY[b.frequency] - amountOf(a) / EVERY[a.frequency]);
  const best = inflows[0];
  const o = rows.settings;

  const every = o?.pay_every_days_override ?? (best ? EVERY[best.frequency] : null);
  const amount = o?.pay_amount_override ?? (best ? amountOf(best) : null);
  if (!every || !amount) return null;

  let due: number | null = null;
  if (o?.next_payday_override) {
    due = daysBetween(today, o.next_payday_override);
    while (due < 1) due += every;
  } else if (best) {
    due = nextIn({ ...best, frequency: Object.keys(EVERY).find((k) => EVERY[k] === every) ?? best.frequency }, today, 1);
  }
  if (due == null) return null;
  return { amount, nextIn: due, every, name: best ? label(best) : "Paycheck", streamId: best?.id };
}

/** Bills: regular outflows the person hasn't turned off. */
export function findBills(streams: StreamRow[], today: string): (Bill & { id: string })[] {
  const out: (Bill & { id: string })[] = [];
  for (const s of streams) {
    if (s.direction !== "outflow" || !s.is_active || s.ignored) continue;
    if (s.category_primary === "TRANSFER_OUT") continue;
    const every = EVERY[s.frequency];
    const dueIn = nextIn(s, today, 0);
    if (!every || dueIn == null) continue;
    out.push({ id: s.id, name: label(s), amount: amountOf(s), dueIn, every });
  }
  return out.sort((a, b) => a.dueIn - b.dueIn);
}

/** Day-to-day spending: outflows that aren't transfers, card payments or known bills. */
function isSpending(t: TransactionRow, billNames: Set<string>) {
  if (t.amount <= 0) return false;
  if (t.category_primary && NOT_SPENDING.has(t.category_primary)) return false;
  const name = (t.merchant_name ?? t.name).toLowerCase();
  return !billNames.has(name);
}

export function toSnapshot(rows: LiveRows, today: string): Snapshot | null {
  const paycheck = findPaycheck(rows, today);
  if (!paycheck) return null;

  const cashAccounts = rows.accounts.filter((a) => a.include_in_cash);
  const cash = cashAccounts.reduce((t, a) => t + Number(a.available_balance ?? a.current_balance ?? 0), 0);

  const bills = findBills(rows.streams, today);
  const billNames = new Set(
    rows.streams.filter((s) => s.direction === "outflow").flatMap((s) => [s.description, s.merchant_name].filter(Boolean).map((n) => n!.toLowerCase())),
  );

  const spendingAccounts = new Set(rows.accounts.filter((a) => a.include_in_cash || a.type === "credit").map((a) => a.id));
  const spending = rows.transactions.filter((t) => (t.account_id == null || spendingAccounts.has(t.account_id)) && isSpending(t, billNames));

  // Cash balances already reflect today's card-less spending; only count today's debits
  // from cash accounts so "spent today" isn't subtracted twice.
  const cashIds = new Set(cashAccounts.map((a) => a.id));
  const spentToday = spending.filter((t) => t.date === today && t.account_id && cashIds.has(t.account_id)).reduce((n, t) => n + Number(t.amount), 0);

  const average = (days: number) => {
    const inWindow = spending.filter((t) => {
      const d = daysBetween(today, t.date);
      return d < 0 && d >= -days;
    });
    if (!inWindow.length) return 0;
    const oldest = Math.min(...inWindow.map((t) => daysBetween(today, t.date)));
    const span = Math.max(1, Math.min(days, -oldest));
    return inWindow.reduce((n, t) => n + Number(t.amount), 0) / span;
  };

  const buckets: Bucket[] = rows.buckets
    .filter((b) => !b.archived_at)
    .map((b) => ({ name: b.name, goal: Number(b.goal), saved: Number(b.saved), perPaycheck: Number(b.per_paycheck) }));

  return {
    cash,
    spentToday,
    paycheck: { amount: paycheck.amount, nextIn: paycheck.nextIn, every: paycheck.every },
    bills: bills.map(({ name, amount, dueIn, every }) => ({ name, amount, dueIn, every })),
    buckets,
    cushion: Number(rows.settings?.cushion ?? 150),
    typicalDay: Math.round(average(90)),
    recentPace: Math.round(average(7)),
  };
}
