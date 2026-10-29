import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { localYmd, toSnapshot, type LiveRows, type StreamRow } from "./live";
import type { Snapshot } from "./engine";

// The project URL and publishable key are public by design (RLS guards the data).
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://baylrzvbstukjsyfnlga.supabase.co";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_0CwEF_30F5Rtb2VHgi3ldQ_9mTVbqrd";

/** Sandbox gets a "use a test bank" shortcut that skips Plaid Link. */
export const PLAID_SANDBOX = (process.env.NEXT_PUBLIC_PLAID_ENV ?? "sandbox") === "sandbox";

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  client ??= createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}

/** Calls an edge function and throws its error message, so screens can show it. */
export async function call<T>(name: string, body: object = {}): Promise<T> {
  const { data, error } = await supabase().functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    try {
      const res = (error as { context?: Response }).context;
      if (res) message = (await res.json()).error ?? message;
    } catch {}
    throw new Error(message);
  }
  return data as T;
}

export type Account = { id: string; name: string; mask: string | null; type: string; subtype: string | null; include_in_cash: boolean; current_balance: number | null; available_balance: number | null };

export async function loadRows(): Promise<LiveRows & { timezone: string; hasBank: boolean; onboarded: boolean }> {
  const db = supabase();
  const since = new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10);
  const [items, accounts, transactions, streams, buckets, settings, profile] = await Promise.all([
    db.from("plaid_items").select("id", { count: "exact", head: true }),
    db.from("accounts").select("id, name, mask, type, subtype, include_in_cash, current_balance, available_balance"),
    db.from("transactions").select("account_id, amount, date, name, merchant_name, category_primary, pending").gte("date", since).limit(5000),
    db.from("recurring_streams").select("id, direction, description, merchant_name, user_name, frequency, average_amount, last_amount, last_date, predicted_next_date, is_active, ignored, category_primary"),
    db.from("buckets").select("name, goal, saved, per_paycheck, archived_at").order("sort"),
    db.from("settings").select("cushion, timezone, pay_amount_override, next_payday_override, pay_every_days_override").maybeSingle(),
    db.from("profiles").select("onboarded_at").maybeSingle(),
  ]);
  const err = [items, accounts, transactions, streams, buckets, settings, profile].find((r) => r.error)?.error;
  if (err) throw err;
  return {
    accounts: accounts.data ?? [],
    transactions: transactions.data ?? [],
    streams: (streams.data ?? []) as StreamRow[],
    buckets: buckets.data ?? [],
    settings: settings.data,
    // Screens format dates with the device clock, so "today" follows the device too.
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    hasBank: (items.count ?? 0) > 0,
    onboarded: !!profile.data?.onboarded_at,
  };
}

/** The signed-in person's snapshot, or null if they haven't linked a bank with a paycheck yet. */
export async function loadSnapshot(): Promise<Snapshot | null> {
  const rows = await loadRows();
  return toSnapshot(rows, localYmd(rows.timezone));
}
