# Forecast marketing site

The public website for Forecast. Right now it is a single static page (`index.html`) with no build step, so it can be previewed anywhere.

```bash
pnpm --filter @forecast/site dev   # http://localhost:3001
```

## Design

- Dark, cinematic page with rounded "windows" of sky. Direction: Origin Financial's polish, Carrot Weather's personality, (Not Boring) Weather's tactile objects.
- Type: Instrument Serif for headlines, Geist for body and numbers, Geist Mono for labels.
- Weather objects (sun, clouds, rain, payday coin) are pure CSS and scale with `font-size` (`.wx` components), so the web and iOS apps can reuse the same look.
- The hero cycles Clear, Cloudy and Stormy; the phone mock and sky follow. The Personality section shows Plain, Friendly and Snarky voices.

## Not wired up yet

- The waitlist form only validates and shows a message. It does not store emails.
- Analytics (PostHog via `@forecast/analytics`) will be added with a snippet since this page has no bundler.
- The Data section's privacy claims (read-only via Plaid, not sold, deleted on request) need to match the real policy before launch.
