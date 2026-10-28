# Analytics

Forecast uses [PostHog](https://posthog.com) for product analytics on the web app, the marketing site and (later) iOS. All tracking goes through `@forecast/analytics` (`packages/analytics`), which is the only place that talks to PostHog.

## Privacy rules

Forecast is a finance app, so analytics answer "what do people do" and never "how much money do they have".

1. **No financial values.** No safe-to-spend number, balances, amounts, income, bucket targets, or anything derived to the dollar.
2. **No identifying or account data.** No emails, names, merchant or institution names, account numbers, Plaid item/access tokens or ids.
3. **No free text.** Properties are enums, booleans or small counts (0 to 100).
4. **Internal ids only.** `identify()` takes Forecast's own user UUID.
5. **No autocapture.** On the forecast screen, button and label text is the user's money, so every event is explicit and all text is masked.
6. **URLs lose their query string and hash** before sending (Plaid OAuth redirects and auth codes live there).
7. **Session replay is off.** If it is ever turned on, every text node and input is masked.
8. **Marketing site is cookieless** (in-memory persistence), so it needs no consent banner. The web app uses first-party storage after sign-in. Do Not Track is respected everywhere, and `optOut()` is available for a settings toggle.

These are enforced twice: by TypeScript (`EventMap` in `packages/analytics/src/events.ts`) and at runtime by a `before_send` sanitizer that drops sensitive keys, money-looking values, emails and long digit runs from every payload, including PostHog's own.

The one deliberate exception: `forecast_viewed.condition` sends the coarse weather condition (`clear` through `storm`). It says roughly how a user's month is going without any number, and is the most useful property we have for retention analysis. Drop it if that is too much.

## Event taxonomy

Naming is `object_action`, snake_case, past tense. Every event gets a `surface` super property (`web`, `site`, `ios`). Pageviews (`$pageview`, `$pageleave`) are captured automatically on route changes.

| Event | Properties | Surface |
| --- | --- | --- |
| `site_cta_clicked` | `cta`, `location` (hero, nav, pricing, footer, inline) | site |
| `site_section_viewed` | `section` | site |
| `waitlist_joined` | `source` (hero, nav, footer, inline). The email itself is never sent. | site |
| `site_demo_condition_selected` | `condition` (clear, cloudy, stormy) | site |
| `site_demo_voice_selected` | `voice` (plain, friendly, snarky) | site |
| `signup_started` / `signup_completed` / `login_completed` | `method` (email, google, apple, passkey) | web, ios |
| `logout_completed` | none | web, ios |
| `onboarding_step_viewed` | `step` (welcome, link_bank, income, buckets, done) | web, ios |
| `onboarding_completed` | `skipped_steps` | web, ios |
| `bank_link_started` | `entry_point` (onboarding, settings, relink) | web, ios |
| `bank_link_succeeded` | `accounts_linked`, `entry_point` | web, ios |
| `bank_link_failed` | `error_type` (Plaid error category only), `entry_point` | web, ios |
| `bank_link_exited` | `last_step`, `entry_point` | web, ios |
| `forecast_viewed` | `condition`, `is_first_view` | web, ios |
| `forecast_refreshed` | `trigger` (pull, auto, focus) | web, ios |
| `forecast_detail_opened` | `panel` (buckets, upcoming, history, explainer) | web, ios |
| `bucket_created` / `bucket_deleted` | `kind` (emergency, bills, goal, custom) | web, ios |
| `bucket_updated` | `kind`, `field` (name, target, schedule) | web, ios |
| `settings_changed` | `setting` | web, ios |
| `notifications_permission_answered` | `granted` | web, ios |
| `error_shown` | `error_code`, `screen` | web, ios |

Person properties: `surface`, `signup_method`, `has_linked_bank`, `bucket_count`, `plan`.

### Key funnels this supports

- **Site to signup:** `$pageview` (site) → `site_cta_clicked` → `signup_started` → `signup_completed`
- **Activation:** `signup_completed` → `bank_link_started` → `bank_link_succeeded` → `onboarding_completed` → `forecast_viewed`
- **Habit:** daily unique `forecast_viewed` per user (the "check the weather" loop)

To add an event: add it to `EventMap`, add a row here, then call `track()`.

## Setup

Environment variables (never commit real values; the key is public but stays out of git anyway):

| App | Key | Host |
| --- | --- | --- |
| `apps/web` (Next.js) | `NEXT_PUBLIC_POSTHOG_KEY` | `NEXT_PUBLIC_POSTHOG_HOST` |
| `apps/site` (static HTML) | `<meta name="posthog-key">` filled at deploy | `<meta name="posthog-host">` |

With no key set, every call is a no-op, so local dev and previews send nothing unless configured.

Use one PostHog project for web and site (so the site-to-signup funnel works across domains) and a separate project for development.

```ts
import { initAnalytics, identify, track, resetAnalytics } from "@forecast/analytics";

initAnalytics({
  key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  surface: "web",
});

identify(user.id, { has_linked_bank: true, plan: "free" }); // after sign-in
track("bank_link_succeeded", { accounts_linked: 2, entry_point: "onboarding" });
resetAnalytics(); // on logout
```

### Static pages (marketing site)

The site has no bundler, so the package also builds a standalone script with the same config and sanitizer:

```sh
pnpm --filter @forecast/analytics build   # writes dist/forecast-analytics.js
```

```html
<meta name="posthog-key" content="phc_..." />
<meta name="posthog-host" content="https://us.i.posthog.com" />
<script src="/forecast-analytics.js" defer></script>
<script>
  addEventListener("DOMContentLoaded", () => {
    ForecastAnalytics.init({ surface: "site" }); // reads the meta tags
    ForecastAnalytics.track("site_demo_voice_selected", { voice: "snarky" });
  });
</script>
```

Recommended later: route ingestion through a first-party reverse proxy (for example `/ingest` on the web app's domain) so ad blockers do not drop events, and set `host` to that path.

## iOS

When the iOS app starts, port `EventMap` to a Swift enum with associated values and use `posthog-ios` with `captureScreenViews` on, `captureElementInteractions` off and session replay off (or `maskAllTextInputs` and `maskAllImages` on). Apply the same key and value rules before calling `capture`. This table is the contract both platforms follow.
