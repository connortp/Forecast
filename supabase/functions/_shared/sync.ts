// Pulls everything Plaid has for one item into our tables: balances, transactions
// (via /transactions/sync and the saved cursor) and recurring streams.
// Called right after linking, on demand from the app, and from the webhook.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { plaid, PlaidError } from "./plaid.ts";

type PlaidAccount = {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: {
    current: number | null;
    available: number | null;
    limit: number | null;
    iso_currency_code: string | null;
  };
};

type PlaidTransaction = {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code: string | null;
  date: string;
  authorized_date: string | null;
  name: string;
  merchant_name: string | null;
  pending: boolean;
  payment_channel: string | null;
  personal_finance_category?: { primary: string; detailed: string } | null;
};

type PlaidStream = {
  stream_id: string;
  account_id: string;
  description: string;
  merchant_name: string | null;
  frequency: string;
  average_amount: { amount: number | null };
  last_amount: { amount: number | null };
  first_date: string | null;
  last_date: string | null;
  predicted_next_date?: string | null;
  status: string;
  is_active: boolean;
  personal_finance_category?: { primary: string } | null;
};

export type ItemRow = { id: string; user_id: string };

export type SyncResult = { added: number; modified: number; removed: number; streams: number };

// Errors that mean the user has to go back through Link (update mode).
const LOGIN_ERRORS = new Set(["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "PENDING_DISCONNECT"]);

async function accessToken(db: SupabaseClient, itemId: string) {
  const { data, error } = await db
    .from("plaid_item_secrets")
    .select("access_token, transactions_cursor")
    .eq("item_id", itemId)
    .single();
  if (error || !data) throw new Error(`No access token for item ${itemId}`);
  return data as { access_token: string; transactions_cursor: string | null };
}

/** Upserts accounts from Plaid and returns a map of Plaid account_id to our account id. */
export async function upsertAccounts(db: SupabaseClient, item: ItemRow, accounts: PlaidAccount[]) {
  if (accounts.length === 0) return new Map<string, string>();
  const now = new Date().toISOString();

  // include_in_cash defaults to checking accounts on first sight; after that the user's choice wins.
  const { data: existing } = await db
    .from("accounts")
    .select("plaid_account_id, include_in_cash")
    .in("plaid_account_id", accounts.map((a) => a.account_id));
  const known = new Map((existing ?? []).map((r) => [r.plaid_account_id as string, r.include_in_cash as boolean]));

  const rows = accounts.map((a) => ({
    user_id: item.user_id,
    item_id: item.id,
    plaid_account_id: a.account_id,
    name: a.name,
    official_name: a.official_name,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    current_balance: a.balances.current,
    available_balance: a.balances.available,
    credit_limit: a.balances.limit,
    iso_currency_code: a.balances.iso_currency_code ?? "USD",
    balances_updated_at: now,
    include_in_cash: known.get(a.account_id) ?? (a.type === "depository" && a.subtype === "checking"),
  }));

  const { data, error } = await db
    .from("accounts")
    .upsert(rows, { onConflict: "plaid_account_id" })
    .select("id, plaid_account_id");
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.plaid_account_id as string, r.id as string]));
}

function toRow(item: ItemRow, accountIds: Map<string, string>, t: PlaidTransaction) {
  return {
    user_id: item.user_id,
    source: "plaid",
    source_txn_id: t.transaction_id,
    account_id: accountIds.get(t.account_id),
    amount: t.amount,
    iso_currency_code: t.iso_currency_code ?? "USD",
    date: t.date,
    authorized_date: t.authorized_date,
    name: t.name,
    merchant_name: t.merchant_name,
    category_primary: t.personal_finance_category?.primary ?? null,
    category_detailed: t.personal_finance_category?.detailed ?? null,
    pending: t.pending,
    payment_channel: t.payment_channel,
  };
}

async function syncTransactions(db: SupabaseClient, item: ItemRow, token: string, startCursor: string | null) {
  // Page through every change first, then write. If Plaid reports the data moved under
  // us mid-pagination, start over from the saved cursor (per Plaid's docs).
  for (let attempt = 0; attempt < 3; attempt++) {
    let cursor = startCursor ?? undefined;
    const added: PlaidTransaction[] = [];
    const modified: PlaidTransaction[] = [];
    const removed: string[] = [];
    let accounts: PlaidAccount[] = [];
    try {
      while (true) {
        const page = await plaid<{
          added: PlaidTransaction[];
          modified: PlaidTransaction[];
          removed: { transaction_id: string }[];
          accounts: PlaidAccount[];
          next_cursor: string;
          has_more: boolean;
        }>("/transactions/sync", { access_token: token, cursor, count: 500, options: { include_personal_finance_category: true } });
        added.push(...page.added);
        modified.push(...page.modified);
        removed.push(...page.removed.map((r) => r.transaction_id));
        accounts = page.accounts;
        cursor = page.next_cursor;
        if (!page.has_more) break;
      }
    } catch (err) {
      if (err instanceof PlaidError && err.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") continue;
      throw err;
    }

    // /transactions/sync returns fresh account data too, so this doubles as the
    // routine balance refresh (no /accounts/balance/get, which is billed per call).
    const accountIds = await upsertAccounts(db, item, accounts);
    const missing = [...added, ...modified].some((t) => !accountIds.has(t.account_id));
    if (missing) {
      const { accounts: all } = await plaid<{ accounts: PlaidAccount[] }>("/accounts/get", { access_token: token });
      for (const [k, v] of await upsertAccounts(db, item, all)) accountIds.set(k, v);
    }

    const rows = [...added, ...modified].filter((t) => accountIds.has(t.account_id)).map((t) => toRow(item, accountIds, t));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("transactions").upsert(rows.slice(i, i + 500), { onConflict: "user_id,source,source_txn_id" });
      if (error) throw error;
    }
    if (removed.length) {
      const { error } = await db
        .from("transactions")
        .delete()
        .eq("user_id", item.user_id)
        .eq("source", "plaid")
        .in("source_txn_id", removed);
      if (error) throw error;
    }

    const { error } = await db.from("plaid_item_secrets").update({ transactions_cursor: cursor }).eq("item_id", item.id);
    if (error) throw error;
    return { added: added.length, modified: modified.length, removed: removed.length };
  }
  throw new Error("Plaid kept changing during sync; try again shortly");
}

export async function syncRecurring(db: SupabaseClient, item: ItemRow, token?: string): Promise<number> {
  token ??= (await accessToken(db, item.id)).access_token;
  let res: { inflow_streams: PlaidStream[]; outflow_streams: PlaidStream[] };
  try {
    res = await plaid("/transactions/recurring/get", { access_token: token });
  } catch (err) {
    // Recurring needs enough history; right after linking Plaid may not be ready yet.
    // The RECURRING_TRANSACTIONS_UPDATE webhook will call us again.
    if (err instanceof PlaidError && err.code === "PRODUCT_NOT_READY") return 0;
    throw err;
  }

  const { data: accts } = await db.from("accounts").select("id, plaid_account_id").eq("item_id", item.id);
  const accountIds = new Map((accts ?? []).map((a) => [a.plaid_account_id as string, a.id as string]));

  const toRows = (streams: PlaidStream[], direction: "inflow" | "outflow") =>
    streams.map((s) => ({
      user_id: item.user_id,
      item_id: item.id,
      account_id: accountIds.get(s.account_id) ?? null,
      plaid_stream_id: s.stream_id,
      direction,
      description: s.description,
      merchant_name: s.merchant_name,
      category_primary: s.personal_finance_category?.primary ?? null,
      frequency: s.frequency,
      // Plaid's sign: outflows positive, inflows negative. Store magnitudes.
      average_amount: s.average_amount.amount == null ? null : Math.abs(s.average_amount.amount),
      last_amount: s.last_amount.amount == null ? null : Math.abs(s.last_amount.amount),
      first_date: s.first_date,
      last_date: s.last_date,
      predicted_next_date: s.predicted_next_date ?? null,
      plaid_status: s.status,
      is_active: s.is_active,
    }));

  const rows = [...toRows(res.inflow_streams, "inflow"), ...toRows(res.outflow_streams, "outflow")];
  if (rows.length) {
    // user_name / user_confirmed / ignored are not in the payload, so upsert leaves them alone.
    const { error } = await db.from("recurring_streams").upsert(rows, { onConflict: "plaid_stream_id" });
    if (error) throw error;
  }
  return rows.length;
}

/** Full sync for one item. Records login errors on the item instead of throwing them. */
export async function syncItem(db: SupabaseClient, item: ItemRow): Promise<SyncResult> {
  const secret = await accessToken(db, item.id);
  try {
    const tx = await syncTransactions(db, item, secret.access_token, secret.transactions_cursor);
    const streams = await syncRecurring(db, item, secret.access_token);
    await db
      .from("plaid_items")
      .update({ status: "healthy", error_code: null, last_synced_at: new Date().toISOString() })
      .eq("id", item.id);
    return { ...tx, streams };
  } catch (err) {
    if (err instanceof PlaidError) {
      await db
        .from("plaid_items")
        .update({ status: LOGIN_ERRORS.has(err.code) ? "login_required" : "error", error_code: err.code })
        .eq("id", item.id);
    }
    throw err;
  }
}
