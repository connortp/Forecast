// Finishes Plaid Link: swaps the public token for an access token, stores the item,
// and runs a first sync. The access token never leaves the server.
// Body: { public_token, institution?: { institution_id, name } } (Link's onSuccess metadata).

import { admin, requireUser } from "../_shared/db.ts";
import { handle, HttpError, json, readBody } from "../_shared/http.ts";
import { plaid } from "../_shared/plaid.ts";
import { syncItem, upsertAccounts } from "../_shared/sync.ts";

Deno.serve(handle(async (req) => {
  const db = admin();
  const user = await requireUser(req, db);
  const { public_token, institution } = await readBody<{
    public_token: string;
    institution: { institution_id?: string; name?: string } | null;
  }>(req);
  if (!public_token) throw new HttpError(400, "public_token is required");

  const ex = await plaid<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token });

  const { data: item, error } = await db
    .from("plaid_items")
    .upsert(
      {
        user_id: user.id,
        plaid_item_id: ex.item_id,
        institution_id: institution?.institution_id ?? null,
        institution_name: institution?.name ?? null,
        status: "healthy",
        error_code: null,
      },
      { onConflict: "plaid_item_id" },
    )
    .select("id, user_id")
    .single();
  if (error) throw error;

  const { error: secretError } = await db
    .from("plaid_item_secrets")
    .upsert({ item_id: item.id, access_token: ex.access_token }, { onConflict: "item_id" });
  if (secretError) throw secretError;

  // Save accounts now: the first /transactions/sync often returns none while Plaid is still
  // pulling history, and onboarding needs the account list right away.
  const { accounts: plaidAccounts } = await plaid<{ accounts: Parameters<typeof upsertAccounts>[2] }>("/accounts/get", {
    access_token: ex.access_token,
  });
  await upsertAccounts(db, item, plaidAccounts);

  // The first sync is often empty: Plaid is still pulling history. The webhook
  // (SYNC_UPDATES_AVAILABLE) fills it in, so a failure here is not fatal.
  let sync = null;
  try {
    sync = await syncItem(db, item);
  } catch (err) {
    console.warn("first sync failed", (err as Error).message);
  }

  const { data: accounts } = await db
    .from("accounts")
    .select("id, name, mask, type, subtype, include_in_cash")
    .eq("item_id", item.id);

  return json({ item_id: item.id, accounts: accounts ?? [], sync });
}));
