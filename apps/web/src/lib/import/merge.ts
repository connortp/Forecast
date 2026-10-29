// Merging imported history with Plaid.
//
// Plaid owns its window. For each imported account we can match to a linked Plaid account
// (by the last digits, then by name), imported rows dated on or after that account's
// earliest Plaid transaction are dropped, so the two never overlap. Rows from accounts we
// can't match are compared one by one with Plaid rows: same amount to the cent within three
// days counts as the same transaction. Pending imported rows are always dropped, since Plaid
// will deliver them once they post.

import type { Txn } from "./types";

export type LinkedAccount = { id: string; mask?: string; name?: string };

export type MergeResult = {
  /** Imported rows to save, with accountId filled in where matched. */
  rows: Txn[];
  overlap: number;
  duplicates: number;
  pending: number;
  /** Imported account label → linked Plaid account id. */
  matched: Record<string, string>;
};

const NEAR_DAYS = 3;

export function mergeWithPlaid(imported: Txn[], plaid: Txn[], linked: LinkedAccount[]): MergeResult {
  const earliest = new Map<string, string>();
  for (const t of plaid) {
    if (!t.accountId) continue;
    const e = earliest.get(t.accountId);
    if (!e || t.date < e) earliest.set(t.accountId, t.date);
  }

  const matched: Record<string, string> = {};
  const accountFor = (t: Txn): string | undefined => {
    const byMask = t.accountMask && linked.find((a) => a.mask && a.mask === t.accountMask);
    const byName = !byMask && t.accountLabel && linked.find((a) => a.name && a.name.toLowerCase() === t.accountLabel!.toLowerCase());
    const hit = byMask || byName || undefined;
    if (hit) matched[t.accountLabel ?? t.accountMask ?? hit.id] = hit.id;
    return hit?.id;
  };

  // Plaid rows by amount in cents, for near-date matching of unmatched accounts.
  const pool = new Map<number, { date: string; used: boolean }[]>();
  for (const t of plaid) {
    const k = cents(t.amount);
    pool.set(k, [...(pool.get(k) ?? []), { date: t.date, used: false }]);
  }

  const rows: Txn[] = [];
  let overlap = 0;
  let duplicates = 0;
  let pending = 0;
  for (const t of imported) {
    if (t.pending) {
      pending++;
      continue;
    }
    const accountId = accountFor(t);
    if (accountId) {
      const cutoff = earliest.get(accountId);
      if (cutoff && t.date >= cutoff) {
        overlap++;
        continue;
      }
      rows.push({ ...t, accountId });
      continue;
    }
    const twin = pool.get(cents(t.amount))?.find((p) => !p.used && Math.abs(dayDiff(p.date, t.date)) <= NEAR_DAYS);
    if (twin) {
      twin.used = true;
      duplicates++;
      continue;
    }
    rows.push(t);
  }
  return { rows, overlap, duplicates, pending, matched };
}

/**
 * Rows from several imports (say Monarch and a bank CSV) can describe the same purchase.
 * Earlier lists win; a later row is dropped only while an unclaimed twin from an earlier list remains.
 */
export function dedupeImports(lists: Txn[][]): Txn[] {
  const prior = new Map<string, number>();
  const out: Txn[] = [];
  for (const list of lists) {
    const added = new Map<string, number>();
    for (const t of list) {
      const key = `${t.date}|${cents(t.amount)}|${t.accountMask ?? ""}`;
      const left = prior.get(key) ?? 0;
      if (left > 0) {
        prior.set(key, left - 1);
        continue;
      }
      added.set(key, (added.get(key) ?? 0) + 1);
      out.push(t);
    }
    for (const [k, n] of added) prior.set(k, (prior.get(k) ?? 0) + n);
  }
  return out;
}

export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

function cents(n: number): number {
  return Math.round(n * 100);
}
