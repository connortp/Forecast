# Forecast marketing site

The public website for Forecast. Right now it is a single static page (`index.html`) with no build step, so it can be previewed anywhere.

```bash
pnpm --filter @forecast/site dev   # http://localhost:3001
```

## Design

- Modeled on Origin Financial's site: near-black page (#0a0a0b), rounded panels that alternate between soft-focus sky photography and dark product panels (#121214), serif headlines with one italic word, mono uppercase labels and buttons.
- Type: Newsreader (headlines and big dollar figures), Geist (body), Geist Mono (labels). Shared with apps/web.
- Photos in `assets/` are generated stand-ins (sky, noon, dawn, golden, overcast, rain, dusk). Swap in licensed photography by replacing the files with the same names.
- Conditions section switches Clear, Cloudy and Stormy; the photo and the sample week follow. Personality shows Plain, Friendly and Snarky voices (Carrot Weather's idea).

## Not wired up yet

- The waitlist form only validates and shows a message. It does not store emails.
- Analytics: PostHog via `@forecast/analytics`. `pnpm --filter @forecast/site build` copies `forecast-analytics.js` next to the page; without it (plain preview) or on localhost, nothing is sent. Events are listed in docs/analytics.md.
- The Data section's privacy claims (read-only via Plaid, not sold, deleted on request) need to match the real policy before launch.
