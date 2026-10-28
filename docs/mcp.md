# Forecast MCP server

Lets someone ask Claude (or any MCP client) about their own money: "How much can I spend today?", "Can I afford a $120 dinner?", "When's rent?". The server lives in `apps/mcp`.

## Principles

- **Read-only.** No tool moves money, edits bills, or changes settings. Every tool is annotated `readOnlyHint: true`. Write tools (say, "move $50 to the Japan bucket") would be a separate, opt-in scope later.
- **Same number as the app.** Tools call the same engine as `apps/web`, so Claude never shows a different safe-to-spend than the home screen.
- **Derived numbers only.** Tools return the safe-to-spend math, bills, paydays, and buckets. They never return account names or numbers, per-account balances, transactions, merchants, or Plaid identifiers.
- **Per user, by the user.** Each request is bound to one signed-in Forecast user. Data is read with that user's own token under row-level security, never a service key.
- **Nothing logged.** No amounts or tool results in logs or analytics (same rule as `@forecast/analytics`).

## Tools

| Tool | Answers | Input |
| --- | --- | --- |
| `get_safe_to_spend` | Today's number, weather, next payday, and the breakdown (cash, bills before payday, savings, cushion) | none |
| `get_outlook` | Daily allowance and weather for the coming days, paydays marked | `days` 1 to 14, default 7 |
| `get_upcoming` | Bills, paychecks, and savings transfers in date order | `days` 1 to 45, default 14 |
| `get_savings_buckets` | Each goal's progress and paychecks left to reach it | none |
| `check_purchase` | Whether a purchase fits today and how it changes tomorrow's allowance | `amount` in dollars |

Each tool returns a short text answer plus typed `structuredContent`, so clients can either read the sentence or build on the numbers. When a user has not connected a bank yet, tools return a friendly error instead of zeros.

## Auth

The MCP server is an OAuth 2.1 **resource server** only. Sign-in is handled by an authorization server, planned as **Supabase Auth's OAuth 2.1 server** so a user connects with their existing Forecast login.

1. The user adds Forecast as a connector in Claude (URL like `https://mcp.forecast.app/mcp`).
2. Claude reads `/.well-known/oauth-protected-resource/mcp`, finds the issuer, registers itself (dynamic client registration), and starts PKCE.
3. The user signs in to Forecast and approves a consent screen: "Claude wants to read your safe-to-spend number, bills, and savings goals. It can't move money."
4. Claude calls tools with a short-lived JWT. The server verifies issuer, audience (this server's URL), and expiry against the issuer's JWKS, and uses `sub` as the user id.
5. Users can revoke access from Forecast settings, which revokes the client's refresh tokens.

Scope: `forecast:read`. Enforcement is behind `FORECAST_REQUIRE_SCOPE=1` until the authorization server issues it.

## Running it

Demo mode (no sign-in, sample data, localhost only):

```bash
pnpm --filter @forecast/mcp dev        # HTTP at http://localhost:8787/mcp
pnpm --filter @forecast/mcp stdio      # stdio, for Claude Desktop / Claude Code / MCP Inspector
FORECAST_MOCK_SCENARIO=storm pnpm --filter @forecast/mcp dev   # sunny | partly | rain | storm
```

Claude Code: `claude mcp add forecast -- pnpm --dir apps/mcp stdio`

With auth: set `FORECAST_AUTH_ISSUER` (for Supabase, `https://<ref>.supabase.co/auth/v1`) and `FORECAST_MCP_URL` (the public `/mcp` URL).

## Not done yet

- **Real data.** `SupabaseData` reading a per-user snapshot table under RLS. Depends on the backend schema.
- **Shared engine.** `apps/mcp/src/engine.ts` is a copy of `apps/web/src/lib/engine.ts`. Move it to `packages/engine` once the web app PR lands.
- **Authorization server.** Turn on Supabase OAuth 2.1 server, build the consent screen in `apps/web`, confirm its endpoint paths match `src/http.ts`.
- **Hosting.** Stateless, so it fits a Vercel function, Cloudflare Worker, or Fly app. Needs a domain and rate limits.
- **Listing.** Submitting to Anthropic's connector directory is an outward step and needs Connor's go-ahead.
