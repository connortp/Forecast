# Forecast backend

Supabase (Postgres, Auth, Edge Functions) plus Plaid, in sandbox for now.

- **Project:** "Forecast", ref `baylrzvbstukjsyfnlga`, region us-east-1, free plan.
- **URL:** `https://baylrzvbstukjsyfnlga.supabase.co`
- Clients (web, iOS) use the project URL and the **publishable** key only. The service role key is used only inside edge functions.

## Schema

`supabase/migrations/20261028233000_init.sql`. Every table has RLS; clients only see their own rows.

| Table | Holds | Client access |
| --- | --- | --- |
| `profiles` | Display name, onboarding time. Created on sign-up by a trigger. | read, update own |
| `settings` | Cushion ($150 default), personality, timezone, payday overrides. Created on sign-up. | read, update own |
| `plaid_items` | One per linked bank: institution, status (`healthy`, `login_required`, `pending_expiration`, `revoked`, `error`), last sync. | read own |
| `plaid_item_secrets` | Access token and `/transactions/sync` cursor. | **none** (service role only) |
| `accounts` | Type, subtype, balances, `include_in_cash` (defaults on for checking). | read own, update `include_in_cash` only |
| `imports` | One row per history upload (Monarch, Copilot, Mint, YNAB, CSV). | read, insert, delete own |
| `transactions` | Plaid and imported rows together, told apart by `source`. | read own; insert/update/delete own non-Plaid rows |
| `recurring_streams` | Bills (`outflow`) and paychecks (`inflow`) from Plaid. | read own, update `user_name`, `user_confirmed`, `ignored` only |
| `buckets` | Savings goals: goal, saved, per-paycheck amount. | full, own |
| `daily_snapshots` | Cached engine result per day. | read own |

Conventions:

- Money is `numeric(14,2)`. Transaction amounts keep Plaid's sign: positive is money out. Recurring stream amounts are stored as magnitudes; `direction` says which way.
- `transactions` is unique on `(user_id, source, source_txn_id)`. For Plaid rows `source_txn_id` is Plaid's `transaction_id`; for imports it is the importer's stable hash, so re-uploading a file is idempotent. Deleting an `imports` row deletes its transactions.
- Imported rows may have no `account_id`; `account_label` and `account_mask` keep what the file said. Where an imported account matches a linked one, Plaid owns its window: the importer drops imported rows dated on or after that account's earliest Plaid transaction.

## Edge functions

Source in `supabase/functions`, shared code in `_shared`.

| Function | Auth | Does |
| --- | --- | --- |
| `create-link-token` | user JWT | Link token for a new bank, or `{ item_id }` for update mode (re-login). Sets the webhook and, if configured, `redirect_uri` for OAuth banks. Requests 730 days of history. |
| `exchange-public-token` | user JWT | `{ public_token, institution }` from Link's `onSuccess`. Stores the item and token, saves the accounts from `/accounts/get`, runs a first sync, returns the accounts. |
| `sync-transactions` | user JWT | Pull-to-refresh: syncs all of the user's banks, or `{ item_id }`. |
| `sandbox-public-token` | user JWT | Sandbox only (404 in production). Makes a test-bank public token without opening Link; pass the result straight to `exchange-public-token`. |
| `plaid-webhook` | Plaid signature | `SYNC_UPDATES_AVAILABLE` syncs, `RECURRING_TRANSACTIONS_UPDATE` refreshes bills and paychecks, `ITEM` webhooks update the item's status. JWT check is off; every request is verified against the `Plaid-Verification` header instead. |

Calling from a client:

```ts
const { data, error } = await supabase.functions.invoke("create-link-token", { body: {} });
```

What changed from Lodge's functions: CORS headers on every response including errors; the access token is in a table clients can't read; a webhook, since the first sync after linking is usually empty; balances come back with `/transactions/sync` (no billed `/accounts/balance/get`); accounts upsert on `plaid_account_id` and keep the user's `include_in_cash` choice; only `sandbox` and `production` environments.

## Secrets

Set in the Supabase dashboard under Edge Functions, Secrets. Never commit them.

| Name | Value |
| --- | --- |
| `PLAID_CLIENT_ID` | From the Plaid dashboard, Developers, Keys |
| `PLAID_SECRET` | The **sandbox** secret for now |
| `PLAID_ENV` | `sandbox` (default) or `production` |
| `PLAID_REDIRECT_URI` | Optional; needed for OAuth banks in production. Must also be registered in Plaid. |
| `PLAID_WEBHOOK_URL` | Optional; defaults to this project's `plaid-webhook` |

## Deploying

With the Supabase CLI, linked to the project:

```sh
supabase link --project-ref baylrzvbstukjsyfnlga
supabase db push
supabase functions deploy create-link-token exchange-public-token sync-transactions sandbox-public-token
supabase functions deploy plaid-webhook --no-verify-jwt
```

## Trying it in sandbox

Plaid Link in sandbox accepts `user_good` / `pass_good` at any institution. Without Link, call `sandbox-public-token` and pass its response to `exchange-public-token`.

Verified 2026-10-28 with a throwaway user: the exchange returned the test bank's 5 accounts (only checking counted as cash), the `SYNC_UPDATES_AVAILABLE` webhook passed signature checks and filled 48 transactions and 8 recurring streams within seconds, a second sync was a no-op, and the client could read its own rows but got `permission denied` on `plaid_item_secrets` (and anon on everything).

## Not done yet

- Removing a bank (`/item/remove` and deleting its rows).
- Writing `daily_snapshots` (needs the Supabase-to-engine adapter, milestone 3).
- Auth providers (magic link, Sign in with Apple) are configured in the dashboard, not here.
