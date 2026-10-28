# Forecast web app: plan

Open the app and you see one number: what you can safely spend today. Everything else (the sky, the outlook, the savings) explains that number.

## The number

```
safe today = (cash this morning
              − bills due before next payday
              − savings contributions due before next payday
              − cushion) ÷ days until payday
             − spent so far today
```

- **Cash** is the available balance across checking accounts (not savings, not credit).
- **Bills** come from Plaid's `/transactions/recurring/get` outflow streams, plus credit card statement payments due before payday. Each bill counts once, on its next due date.
- **Savings buckets** are paid first from every paycheck, so they never look spendable.
- **Cushion** defaults to $150 and is user-adjustable.
- **Payday** comes from the recurring inflow stream (amount and cadence).
- Never below $0. When the pool is negative the app says how short you are.

This replaces Lodge's monthly formula, which double-counted bills already paid this month.

The engine lives in `apps/web/src/lib/engine.ts`. It is pure and works in day offsets from today, so it is easy to test (`pnpm --filter @forecast/web test`). The iOS app should port the same rules and share the test cases.

## Weather

Weather is today's allowance compared with a normal day for *this person* (their typical discretionary spend, learned from 90 days):

| Ratio to a typical day | Condition |
| --- | --- |
| ≥ 1.25 | Clear skies |
| ≥ 0.95 | Partly cloudy |
| ≥ 0.65 | Overcast |
| ≥ 0.30 | Light rain |
| below, or short of bills | Storm warning |

The sky also follows the local time of day (dawn, day, dusk, night). Copy comes in two personalities, Calm and Spicy, in the spirit of Carrot.

## Stack

- **Web:** Next.js (App Router) + TypeScript in `apps/web`, deployed on Vercel.
- **Backend:** Supabase (Postgres, Auth, Edge Functions). Fresh project with real migrations in `supabase/migrations`.
- **Bank data:** Plaid, reusing the three edge functions from SafeToSpend (`create-link-token`, `exchange-public-token`, `sync-transactions`) with these fixes:
  - CORS headers on error responses too.
  - `plaid_access_token` lives in a table with no client read policy (service role only).
  - Add a webhook function for `SYNC_UPDATES_AVAILABLE`; the first sync right after linking is often empty.
  - Use `/accounts/get` for routine refresh, not `/accounts/balance/get`.
  - Upsert accounts on `plaid_account_id`; set `redirect_uri` for OAuth banks; environments are `sandbox` and `production` only.
- **Analytics:** `@forecast/analytics` (PostHog), no dollar amounts or merchant names in events.

## Data model (first migration)

Built and live: see [backend.md](backend.md) for the final schema. Differences from this sketch: the access token moved to `plaid_item_secrets` so the app can still list linked banks, and `transactions` also holds imported history (`source`, `imports`).

| Table | Purpose | Client access |
| --- | --- | --- |
| `plaid_items` | One per linked institution, holds the access token and sync cursor | none |
| `accounts` | Type, subtype, balances, `include_in_cash` flag | own rows, read |
| `transactions` | Synced from `/transactions/sync` | own rows, read |
| `recurring_streams` | Bills and income from `/transactions/recurring/get` | own rows, read/update (user can confirm, rename, ignore) |
| `buckets` | Savings goals: name, goal, saved, per-paycheck amount | own rows, full |
| `settings` | Cushion, personality, payday overrides | own row, full |
| `daily_snapshots` | Cached result of the engine per day, for history and fast loads | own rows, read |

## Milestones

1. **Prototype (this PR).** The full screen running on example data, the engine with tests.
2. **Accounts.** Supabase Auth (email magic link + Sign in with Apple), the migration above, Plaid Link in sandbox, transactions syncing.
3. **Real number.** Adapter from Supabase rows to the engine's `Snapshot`; onboarding that confirms payday and bills.
4. **Buckets and settings.** Create and edit buckets, cushion, personality.
5. **Polish.** Pull-to-refresh, empty and error states, PWA install, accessibility pass, production Plaid.
