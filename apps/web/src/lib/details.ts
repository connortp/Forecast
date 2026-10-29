import type { Snapshot, Today } from "./engine";
import { events } from "./engine";

// The numbers behind the drawn cards under the hero. Pure, so web and iOS agree:
// ForecastKit/Details.swift is a port, and DetailsTests mirror details.test.ts.

export type CycleMark = { p: number; kind: "bill" | "pay" };

/** Where today sits in the pay cycle (0 = last paycheck, 1 = the next), and every bill on the way. */
export function cycle(s: Snapshot, t: Today): { since: number; today: number; marks: CycleMark[] } {
  const every = Math.max(1, s.paycheck.every, t.until);
  const since = Math.max(0, every - t.until);
  const marks: CycleMark[] = events(s, 0, t.until)
    .filter((e) => e.kind === "bill")
    .map((e) => ({ p: (since + e.day) / every, kind: "bill" as const }));
  marks.push({ p: 1, kind: "pay" });
  return { since, today: since / every, marks };
}

export type SplitKey = "bills" | "savings" | "cushion" | "later" | "today";
export type Split = { key: SplitKey; label: string; amount: number };

/** This morning's cash, split the way the engine spends it. Parts sum to the cash unless it falls short. */
export function splitToday(s: Snapshot, t: Today): Split[] {
  const daily = Math.max(0, t.daily);
  const later = Math.max(0, t.pool - daily);
  const rest = t.until - 1;
  const parts: Split[] = [
    { key: "bills", label: `Bills before payday (${t.billCount})`, amount: t.bills },
    { key: "savings", label: "To savings before payday", amount: t.saving },
    { key: "cushion", label: "Cushion", amount: s.cushion },
    { key: "later", label: `The ${rest} day${rest === 1 ? "" : "s"} after today`, amount: later },
    { key: "today", label: "Today", amount: daily },
  ];
  return parts.filter((p) => p.key === "bills" || p.key === "today" || p.amount > 0);
}
