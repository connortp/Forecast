# @forecast/web

The signed-in Forecast app, on real data from Supabase and Plaid (sandbox for now).

```bash
pnpm --filter @forecast/web dev    # http://localhost:3000
pnpm --filter @forecast/web test   # engine, adapter and import tests
```

- `/welcome` is sign-up: email code (Supabase Auth), Plaid Link, then payday, bills and savings confirmed against the real rows. In sandbox, "Use a test bank" links Plaid's `user_transactions_dynamic` without opening Link.
- `/` needs a signed-in, onboarded account; otherwise it sends you to `/welcome`. `/?demo` shows the example scenarios for design review.
- `src/lib/live.ts` turns Supabase rows into the engine's `Snapshot` (paycheck, bills, cash, typical day). Pure and tested.
- `src/lib/supabase.ts` is the browser client and data loading. The URL and publishable key are public; Plaid keys live only in Supabase secrets.
- `src/lib/engine.ts` computes the number, the outlook and the weather. See `docs/web-app.md` and `docs/backend.md`.
