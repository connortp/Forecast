# Forecast marketing site

The public website for Forecast. Right now it is a single static page (`index.html`) with no build step, so it can be previewed anywhere.

```bash
pnpm --filter @forecast/site dev   # http://localhost:3001
```

## Design

- Modeled on Origin Financial's site: near-black page (#0a0a0b), rounded panels that alternate between soft-focus sky photography and dark product panels (#121214), serif headlines with one italic word, mono uppercase labels and buttons.
- Type: Newsreader (headlines and big dollar figures), Geist (body), Geist Mono (labels). Shared with apps/web.
- Media in `assets/` comes from Pexels (free commercial license). The sky plates and loops are copies from `packages/design/sky` (see its credits.md); `haze.jpg` (pexels.com/photo/8027031) are site-only.
- Art direction: skies are seen from above the clouds or at the horizon, never looking straight up at a blue sky, so the site doesn't read like Origin.
- Two light loops: a slow flight over a sea of clouds at sunrise in the hero and rain on glass for the Stormy state. They play only while on screen and never when the viewer prefers reduced motion.
- Conditions section switches Clear, Cloudy and Stormy; the photo and the sample week follow. Personality shows Plain, Friendly and Snarky voices (Carrot Weather's idea).

## Not wired up yet

- The waitlist form only validates and shows a message. It does not store emails.
- Analytics (PostHog via `@forecast/analytics`) will be added with a snippet since this page has no bundler.
- The Data section's privacy claims (read-only via Plaid, not sold, deleted on request) need to match the real policy before launch.
